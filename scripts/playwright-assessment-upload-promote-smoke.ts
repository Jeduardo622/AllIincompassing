import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";

import { cleanupAssessmentImportArtifacts } from "./lib/assessment-import-cleanup";
import {
  assertSmokeClientMarker,
  buildInFilter,
  buildPromotedLiveCleanupQueries,
  requireSmokeClientId,
} from "./lib/assessment-upload-promote-smoke-guards";
import { loadPlaywrightEnv } from "./lib/load-playwright-env";
import {
  captureFailureScreenshot,
  ensureArtifactsDir,
  loginAndAssertSession,
  preflightCredentials,
} from "./lib/playwright-smoke";

type AssessmentStatus =
  | "uploaded"
  | "extracting"
  | "extracted"
  | "drafted"
  | "approved"
  | "rejected"
  | "extraction_failed";

type AssessmentDocumentRecord = {
  id: string;
  organization_id?: string | null;
  client_id: string;
  file_name: string;
  bucket_id?: string | null;
  object_path: string;
  status: AssessmentStatus;
  extraction_error?: string | null;
};

type ChecklistResponse = {
  items: Array<{
    id: string;
    label: string;
    placeholder_key: string;
    required: boolean;
    status: "not_started" | "drafted" | "verified" | "approved";
    value_text: string | null;
  }>;
  structured_sections: Array<{
    id: string;
    field_key: string;
    section_key: string;
    section_index: number;
    payload: Record<string, unknown> | null;
    required: boolean;
    status: "not_started" | "drafted" | "verified" | "approved" | "rejected";
  }>;
};

type DraftResponse = {
  programs: Array<{
    id: string;
    name: string;
    description: string | null;
    accept_state: "pending" | "accepted" | "rejected" | "edited";
  }>;
  goals: Array<{
    id: string;
    title: string;
    description: string;
    original_text: string;
    goal_type: "child" | "parent";
    accept_state: "pending" | "accepted" | "rejected" | "edited";
  }>;
};

type PromoteResponse = {
  assessment_document_id: string;
  created_program_count: number;
  created_program_ids: string[];
  created_goal_count: number;
  promoted_program_count?: number;
  promoted_goal_count?: number;
  created_goal_data_point_count?: number;
};

type LiveProgram = {
  id: string;
  name: string;
  description: string | null;
  client_id?: string | null;
  organization_id?: string | null;
};

type LiveGoal = {
  id: string;
  title: string;
  program_id: string;
  client_id?: string | null;
  organization_id?: string | null;
};

const DEFAULT_BASE_URL = "https://app.allincompassing.ai";
const DEFAULT_SAMPLE_FILE = path.resolve(
  process.cwd(),
  "7.21.2025_RoVa_CalOptima_FBA_FINAL (1).Redacted.docx.pdf",
);
const EXTRACTION_TIMEOUT_MS = 180_000;
const MIN_CHILD_GOALS = 20;
const MIN_PARENT_GOALS = 6;
const GOAL_FIELD_KEYS = new Set([
  "CALOPTIMA_FBA_TARGET_REPLACEMENT_GOALS",
  "CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS",
  "CALOPTIMA_FBA_PARENT_GOALS",
]);

const pause = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const getRequiredEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for assessment upload promote smoke.`);
  }
  return value;
};

const resolveSupabaseUrl = (): string => process.env.VITE_SUPABASE_URL?.trim() || getRequiredEnv("SUPABASE_URL");
const resolveSupabaseAnonKey = (): string =>
  process.env.VITE_SUPABASE_ANON_KEY?.trim() || getRequiredEnv("SUPABASE_ANON_KEY");

const resolveMimeType = (filePath: string): string => {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".pdf") return "application/pdf";
  if (extension === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return "application/octet-stream";
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const assertOk = async (response: Response, message: string): Promise<void> => {
  if (response.ok) return;
  const body = await response.text().catch(() => "");
  throw new Error(`${message}: ${response.status}${body ? ` ${body}` : ""}`);
};

const fetchJson = async <T>(
  url: string,
  init: RequestInit & { accessToken?: string; anonKey?: string } = {},
): Promise<T> => {
  const { accessToken, anonKey, headers, ...rest } = init;
  const response = await fetch(url, {
    ...rest,
    headers: {
      ...(anonKey ? { apikey: anonKey } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(rest.body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
  });
  await assertOk(response, `Request failed for ${url}`);
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : ([] as T);
};

const callAppJson = async <T>(
  baseUrl: string,
  accessToken: string,
  pathValue: string,
  init: RequestInit = {},
): Promise<T> =>
  fetchJson<T>(`${baseUrl}${pathValue}`, {
    ...init,
    accessToken,
  });

const restUrl = (supabaseUrl: string, table: string, query: string): string =>
  `${supabaseUrl}/rest/v1/${table}?${query}`;

const selectClientForSmoke = async (
  supabaseUrl: string,
  supabaseAnonKey: string,
  email: string,
  password: string,
): Promise<{ accessToken: string; clientId: string; clientName: string; organizationId: string }> => {
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
  if (authError || !authData.session || !authData.user) {
    throw authError ?? new Error("Could not authenticate assessment upload promote smoke user.");
  }

  const configuredClientId = requireSmokeClientId(process.env.PW_ASSESSMENT_CLIENT_ID);

  const { data: client, error } = await supabase
    .from("clients")
    .select("id, full_name, organization_id")
    .eq("id", configuredClientId)
    .maybeSingle();
  if (error || !client) {
    throw error ?? new Error(`Configured PW_ASSESSMENT_CLIENT_ID is not accessible: ${configuredClientId}`);
  }
  if (typeof client.organization_id !== "string" || !client.organization_id.trim()) {
    throw new Error(`Configured PW_ASSESSMENT_CLIENT_ID has no organization_id: ${configuredClientId}`);
  }
  assertSmokeClientMarker(client.full_name, client.id);
  return {
    accessToken: authData.session.access_token,
    clientId: client.id,
    clientName: client.full_name ?? client.id,
    organizationId: client.organization_id,
  };
};

const fetchAssessmentDocuments = async (
  baseUrl: string,
  accessToken: string,
  clientId: string,
): Promise<AssessmentDocumentRecord[]> =>
  callAppJson<AssessmentDocumentRecord[]>(
    baseUrl,
    accessToken,
    `/api/assessment-documents?client_id=${encodeURIComponent(clientId)}`,
  );

const waitForExtractedAssessment = async (args: {
  baseUrl: string;
  accessToken: string;
  clientId: string;
  uploadFileName: string;
}): Promise<AssessmentDocumentRecord> => {
  const deadline = Date.now() + EXTRACTION_TIMEOUT_MS;
  let latest: AssessmentDocumentRecord | null = null;
  while (Date.now() < deadline) {
    const documents = await fetchAssessmentDocuments(args.baseUrl, args.accessToken, args.clientId);
    latest = documents.find((document) => document.file_name === args.uploadFileName) ?? null;
    if (latest && !["uploaded", "extracting"].includes(latest.status)) {
      break;
    }
    await pause(2_000);
  }

  if (!latest) {
    throw new Error(`Uploaded assessment document ${args.uploadFileName} was not found in the queue.`);
  }
  if (latest.status !== "extracted") {
    throw new Error(
      `Assessment extraction ended with ${latest.status}${latest.extraction_error ? `: ${latest.extraction_error}` : ""}`,
    );
  }
  return latest;
};

const loadChecklist = async (
  baseUrl: string,
  accessToken: string,
  assessmentDocumentId: string,
): Promise<ChecklistResponse> =>
  callAppJson<ChecklistResponse>(
    baseUrl,
    accessToken,
    `/api/assessment-checklist?assessment_document_id=${encodeURIComponent(assessmentDocumentId)}`,
  );

const approveChecklistAndStructuredSections = async (args: {
  baseUrl: string;
  accessToken: string;
  checklist: ChecklistResponse;
}): Promise<{ checklistApproved: number; structuredApproved: number; goalStructuredSectionCount: number }> => {
  let checklistApproved = 0;
  for (const item of args.checklist.items) {
    if (!item.required || item.status === "approved") continue;
    await callAppJson(args.baseUrl, args.accessToken, "/api/assessment-checklist", {
      method: "PATCH",
      body: JSON.stringify({
        item_id: item.id,
        status: "approved",
        review_notes: "Smoke approved required checklist row from redacted fixture.",
        value_text: item.value_text?.trim() || `Smoke reviewed value for ${item.label}`,
      }),
    });
    checklistApproved += 1;
  }

  const goalSections = args.checklist.structured_sections.filter((section) =>
    GOAL_FIELD_KEYS.has(section.field_key),
  );
  if (goalSections.length === 0) {
    throw new Error("No structured CalOptima goal sections were extracted from the fixture.");
  }

  let structuredApproved = 0;
  for (const section of goalSections) {
    if (!section.payload || Object.keys(section.payload).length === 0) {
      throw new Error(`Structured goal section ${section.id} has no payload.`);
    }
    if (section.status === "approved") continue;
    await callAppJson(args.baseUrl, args.accessToken, "/api/assessment-checklist", {
      method: "PATCH",
      body: JSON.stringify({
        structured_section_id: section.id,
        status: "approved",
        review_notes: "Smoke approved structured goal section from redacted fixture.",
        payload: section.payload,
      }),
    });
    structuredApproved += 1;
  }

  return {
    checklistApproved,
    structuredApproved,
    goalStructuredSectionCount: goalSections.length,
  };
};

const generateDrafts = async (
  baseUrl: string,
  accessToken: string,
  assessmentDocumentId: string,
): Promise<void> => {
  await callAppJson(baseUrl, accessToken, "/api/assessment-drafts", {
    method: "POST",
    body: JSON.stringify({
      assessment_document_id: assessmentDocumentId,
      auto_generate: true,
    }),
  });
};

const loadDrafts = async (
  baseUrl: string,
  accessToken: string,
  assessmentDocumentId: string,
): Promise<DraftResponse> =>
  callAppJson<DraftResponse>(
    baseUrl,
    accessToken,
    `/api/assessment-drafts?assessment_document_id=${encodeURIComponent(assessmentDocumentId)}`,
  );

const acceptDrafts = async (baseUrl: string, accessToken: string, drafts: DraftResponse): Promise<void> => {
  const childCount = drafts.goals.filter((goal) => goal.goal_type === "child").length;
  const parentCount = drafts.goals.filter((goal) => goal.goal_type === "parent").length;
  if (drafts.programs.length === 0) {
    throw new Error("Deterministic draft generation did not create any draft programs.");
  }
  if (childCount < MIN_CHILD_GOALS || parentCount < MIN_PARENT_GOALS) {
    throw new Error(
      `Fixture produced insufficient draft goals for promotion: ${childCount} child / ${parentCount} parent.`,
    );
  }

  for (const program of drafts.programs) {
    await callAppJson(baseUrl, accessToken, "/api/assessment-drafts", {
      method: "PATCH",
      body: JSON.stringify({
        draft_type: "program",
        id: program.id,
        accept_state: "accepted",
        review_notes: "Smoke accepted draft program.",
        name: program.name,
        description: program.description ?? "Smoke accepted draft program.",
      }),
    });
  }

  for (const goal of drafts.goals) {
    await callAppJson(baseUrl, accessToken, "/api/assessment-drafts", {
      method: "PATCH",
      body: JSON.stringify({
        draft_type: "goal",
        id: goal.id,
        accept_state: "accepted",
        review_notes: "Smoke accepted draft goal.",
        title: goal.title,
        description: goal.description,
        original_text: goal.original_text,
        goal_type: goal.goal_type,
      }),
    });
  }
};

const promoteAssessment = async (
  baseUrl: string,
  accessToken: string,
  assessmentDocumentId: string,
): Promise<PromoteResponse> =>
  callAppJson<PromoteResponse>(baseUrl, accessToken, "/api/assessment-promote", {
    method: "POST",
    body: JSON.stringify({ assessment_document_id: assessmentDocumentId }),
  });

const loadLiveRecords = async (args: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  accessToken: string;
  organizationId: string;
  clientId: string;
  programIds: string[];
}): Promise<{ programs: LiveProgram[]; goals: LiveGoal[] }> => {
  if (args.programIds.length === 0) {
    return { programs: [], goals: [] };
  }
  const filter = buildInFilter(args.programIds);
  const orgFilter = encodeURIComponent(args.organizationId);
  const clientFilter = encodeURIComponent(args.clientId);
  const programs = await fetchJson<LiveProgram[]>(
    restUrl(
      args.supabaseUrl,
      "programs",
      `select=id,name,description,client_id,organization_id&id=${filter}&organization_id=eq.${orgFilter}&client_id=eq.${clientFilter}`,
    ),
    {
      anonKey: args.supabaseAnonKey,
      accessToken: args.accessToken,
    },
  );
  const goals = await fetchJson<LiveGoal[]>(
    restUrl(
      args.supabaseUrl,
      "goals",
      `select=id,title,program_id,client_id,organization_id&program_id=${filter}&organization_id=eq.${orgFilter}&client_id=eq.${clientFilter}`,
    ),
    {
      anonKey: args.supabaseAnonKey,
      accessToken: args.accessToken,
    },
  );
  return { programs, goals };
};

const deleteByFilter = async (args: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  accessToken: string;
  table: string;
  query: string;
}): Promise<void> => {
  const response = await fetch(restUrl(args.supabaseUrl, args.table, args.query), {
    method: "DELETE",
    headers: {
      apikey: args.supabaseAnonKey,
      Authorization: `Bearer ${args.accessToken}`,
    },
  });
  if (!response.ok && response.status !== 404) {
    const body = await response.text().catch(() => "");
    throw new Error(`Cleanup failed for ${args.table}: ${response.status}${body ? ` ${body}` : ""}`);
  }
};

const cleanupPromotedLiveRecords = async (args: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  accessToken: string;
  assessmentDocumentId: string;
  organizationId: string;
  clientId: string;
  programIds: string[];
  goalIds: string[];
}): Promise<void> => {
  if (args.programIds.length === 0) return;
  const cleanupQueries = buildPromotedLiveCleanupQueries(args);
  if (cleanupQueries.goalDataPoints) {
    await deleteByFilter({
      ...args,
      table: "goal_data_points",
      query: cleanupQueries.goalDataPoints,
    });
  }
  await deleteByFilter({
    ...args,
    table: "goals",
    query: cleanupQueries.goals ?? "id=eq.__no_smoke_records__",
  });
  await deleteByFilter({
    ...args,
    table: "programs",
    query: cleanupQueries.programs ?? "id=eq.__no_smoke_records__",
  });
};

const writeCleanupFailureManifest = (args: {
  latestDir: string;
  assessment?: AssessmentDocumentRecord | null;
  promotedProgramIds: string[];
  cleanupError: Error;
  runError?: Error | null;
  organizationId?: string | null;
}): string => {
  const manifestPath = path.join(args.latestDir, `assessment-upload-promote-cleanup-failure-${Date.now()}.json`);
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        assessmentDocumentId: args.assessment?.id ?? null,
        organizationId: args.organizationId ?? args.assessment?.organization_id ?? null,
        clientId: args.assessment?.client_id ?? null,
        fileName: args.assessment?.file_name ?? null,
        bucketId: args.assessment?.bucket_id?.trim() || "client-documents",
        objectPath: args.assessment?.object_path ?? null,
        promotedProgramIds: args.promotedProgramIds,
        cleanupError: args.cleanupError.message,
        runError: args.runError?.message ?? null,
      },
      null,
      2,
    ),
  );
  return manifestPath;
};

const assertPromotedRecordsVisible = async (args: {
  page: Page;
  baseUrl: string;
  clientId: string;
  programName: string;
  goalTitle: string;
}): Promise<string> => {
  await args.page.goto(`${args.baseUrl}/clients/${args.clientId}?tab=programs-goals`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await args.page.waitForLoadState("networkidle").catch(() => undefined);
  await args.page.getByText("Live records only. Uploaded assessment drafts appear here after you publish.").waitFor({
    timeout: 20_000,
  });
  const programButton = args.page.getByRole("button", {
    name: new RegExp(escapeRegExp(args.programName), "i"),
  }).first();
  await programButton.waitFor({ timeout: 20_000 });
  await programButton.click();
  await args.page.getByText(args.goalTitle, { exact: false }).first().waitFor({ timeout: 20_000 });

  const latestDir = ensureArtifactsDir();
  const screenshotPath = path.join(latestDir, `assessment-upload-promote-smoke-${Date.now()}.png`);
  await args.page.screenshot({ path: screenshotPath, fullPage: true });
  return screenshotPath;
};

async function run() {
  loadPlaywrightEnv();

  const baseUrl = (process.env.PW_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, "");
  const supabaseUrl = resolveSupabaseUrl();
  const supabaseAnonKey = resolveSupabaseAnonKey();
  const sampleFilePath = process.env.PW_ASSESSMENT_SAMPLE_FILE?.trim()
    ? path.resolve(process.cwd(), process.env.PW_ASSESSMENT_SAMPLE_FILE.trim())
    : DEFAULT_SAMPLE_FILE;
  const sourceFileBuffer = readFileSync(sampleFilePath);
  const sourceExtension = path.extname(sampleFilePath).toLowerCase();
  const uploadFileName = `${path.basename(sampleFilePath, sourceExtension)}-promote-smoke-${Date.now()}${sourceExtension}`;
  const uploadMimeType = resolveMimeType(sampleFilePath);
  const credentials = preflightCredentials([
    {
      email: process.env.PW_ADMIN_EMAIL ?? process.env.PLAYWRIGHT_ADMIN_EMAIL,
      password: process.env.PW_ADMIN_PASSWORD ?? process.env.PLAYWRIGHT_ADMIN_PASSWORD,
      label: "PW_ADMIN_EMAIL + PW_ADMIN_PASSWORD",
    },
  ]);
  const { accessToken, clientId, clientName, organizationId } = await selectClientForSmoke(
    supabaseUrl,
    supabaseAnonKey,
    credentials.email,
    credentials.password,
  );

  const browser = await chromium.launch({ headless: process.env.HEADLESS !== "false" });
  const context = await browser.newContext();
  const page = await context.newPage();
  const latestDir = ensureArtifactsDir();

  let createdAssessment: AssessmentDocumentRecord | null = null;
  let promotedProgramIds: string[] = [];
  let promotedGoalIds: string[] = [];
  let cleanupFailure: Error | null = null;
  let runFailure: Error | null = null;
  let cleanupFailureManifestPath: string | null = null;

  try {
    await loginAndAssertSession(page, baseUrl, credentials.email, credentials.password);
    await page.goto(`${baseUrl}/clients/${clientId}?tab=programs-goals`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.getByText("FBA Upload + AI Workflow").waitFor({ timeout: 20_000 });

    await page.locator("#programs-goals-fba-file-upload").setInputFiles({
      name: uploadFileName,
      mimeType: uploadMimeType,
      buffer: sourceFileBuffer,
    });
    await page.getByRole("button", { name: /Upload CalOptima FBA/i }).click();
    await page.getByText("Uploading and processing your FBA. This can take a moment.").waitFor({ timeout: 20_000 });

    createdAssessment = await waitForExtractedAssessment({
      baseUrl,
      accessToken,
      clientId,
      uploadFileName,
    });
    if (createdAssessment.client_id !== clientId) {
      throw new Error(`Uploaded assessment client mismatch: ${createdAssessment.client_id} !== ${clientId}`);
    }
    const assessmentOrganizationId = createdAssessment.organization_id?.trim() || organizationId;
    if (assessmentOrganizationId !== organizationId) {
      throw new Error(`Uploaded assessment organization mismatch: ${assessmentOrganizationId} !== ${organizationId}`);
    }

    const checklist = await loadChecklist(baseUrl, accessToken, createdAssessment.id);
    const extractionRows = await fetchJson<Array<{ id: string }>>(
      restUrl(
        supabaseUrl,
        "assessment_extractions",
        `select=id&assessment_document_id=eq.${encodeURIComponent(createdAssessment.id)}&organization_id=eq.${encodeURIComponent(organizationId)}&client_id=eq.${encodeURIComponent(clientId)}`,
      ),
      { anonKey: supabaseAnonKey, accessToken },
    );
    if (checklist.items.length === 0 || extractionRows.length === 0) {
      throw new Error("Extraction did not persist checklist and extraction rows.");
    }

    const approvalSummary = await approveChecklistAndStructuredSections({
      baseUrl,
      accessToken,
      checklist,
    });

    await generateDrafts(baseUrl, accessToken, createdAssessment.id);
    const drafts = await loadDrafts(baseUrl, accessToken, createdAssessment.id);
    await acceptDrafts(baseUrl, accessToken, drafts);
    const acceptedDrafts = await loadDrafts(baseUrl, accessToken, createdAssessment.id);
    const acceptedChildGoalCount = acceptedDrafts.goals.filter(
      (goal) => goal.accept_state === "accepted" && goal.goal_type === "child",
    ).length;
    const acceptedParentGoalCount = acceptedDrafts.goals.filter(
      (goal) => goal.accept_state === "accepted" && goal.goal_type === "parent",
    ).length;
    if (acceptedChildGoalCount < MIN_CHILD_GOALS || acceptedParentGoalCount < MIN_PARENT_GOALS) {
      throw new Error(
        `Accepted draft goal counts are insufficient: ${acceptedChildGoalCount} child / ${acceptedParentGoalCount} parent.`,
      );
    }

    const promotion = await promoteAssessment(baseUrl, accessToken, createdAssessment.id);
    promotedProgramIds = promotion.created_program_ids;
    if (promotion.created_program_count < 1 || promotion.created_goal_count < MIN_CHILD_GOALS + MIN_PARENT_GOALS) {
      throw new Error(
        `Promotion created insufficient live records: ${promotion.created_program_count} programs / ${promotion.created_goal_count} goals.`,
      );
    }

    const liveRecords = await loadLiveRecords({
      supabaseUrl,
      supabaseAnonKey,
      accessToken,
      organizationId,
      clientId,
      programIds: promotedProgramIds,
    });
    if (liveRecords.programs.length !== promotedProgramIds.length) {
      throw new Error(`Expected ${promotedProgramIds.length} live programs, found ${liveRecords.programs.length}.`);
    }
    if (liveRecords.goals.length < MIN_CHILD_GOALS + MIN_PARENT_GOALS) {
      throw new Error(`Expected at least ${MIN_CHILD_GOALS + MIN_PARENT_GOALS} live goals, found ${liveRecords.goals.length}.`);
    }
    promotedGoalIds = liveRecords.goals.map((goal) => goal.id);

    const screenshotPath = await assertPromotedRecordsVisible({
      page,
      baseUrl,
      clientId,
      programName: liveRecords.programs[0].name,
      goalTitle: liveRecords.goals[0].title,
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          clientId,
          clientName,
          assessmentDocumentId: createdAssessment.id,
          fileName: uploadFileName,
          checklistRowCount: checklist.items.length,
          extractionRowCount: extractionRows.length,
          goalStructuredSectionCount: approvalSummary.goalStructuredSectionCount,
          checklistApproved: approvalSummary.checklistApproved,
          structuredApproved: approvalSummary.structuredApproved,
          draftProgramCount: drafts.programs.length,
          draftGoalCount: drafts.goals.length,
          acceptedChildGoalCount,
          acceptedParentGoalCount,
          createdProgramCount: promotion.created_program_count,
          createdGoalCount: promotion.created_goal_count,
          createdGoalDataPointCount: promotion.created_goal_data_point_count ?? 0,
          screenshot: screenshotPath,
          url: page.url(),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const screenshot = await captureFailureScreenshot(page, "playwright-assessment-upload-promote-smoke-failure");
    console.error(`Assessment upload promote smoke failed. Screenshot: ${screenshot}`);
    runFailure = error instanceof Error ? error : new Error(String(error));
  } finally {
    try {
      if (createdAssessment) {
        await cleanupPromotedLiveRecords({
          supabaseUrl,
          supabaseAnonKey,
          accessToken,
          assessmentDocumentId: createdAssessment.id,
          organizationId: createdAssessment.organization_id?.trim() || organizationId,
          clientId: createdAssessment.client_id,
          programIds: promotedProgramIds,
          goalIds: promotedGoalIds,
        });
        await cleanupAssessmentImportArtifacts({
          accessToken,
          baseUrl,
          supabaseAnonKey,
          supabaseUrl,
          target: {
            assessmentDocumentId: createdAssessment.id,
            bucketId: createdAssessment.bucket_id?.trim() || "client-documents",
            objectPath: createdAssessment.object_path,
          },
        });
      }
    } catch (cleanupError) {
      cleanupFailure = cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError));
      console.error("Assessment upload promote smoke cleanup failed", cleanupFailure);
    }
    await context.close();
    await browser.close();

    if (cleanupFailure) {
      cleanupFailureManifestPath = writeCleanupFailureManifest({
        latestDir,
        assessment: createdAssessment,
        promotedProgramIds,
        cleanupError: cleanupFailure,
        runError: runFailure,
        organizationId,
      });
      console.error(`Assessment upload promote smoke cleanup manifest written to ${cleanupFailureManifestPath}`);
    }
    if (runFailure && cleanupFailure) {
      throw new AggregateError(
        [runFailure, cleanupFailure],
        `Assessment upload promote smoke failed and cleanup also failed: ${runFailure.message}; ${cleanupFailure.message}${
          cleanupFailureManifestPath ? `; cleanup manifest: ${cleanupFailureManifestPath}` : ""
        }`,
      );
    }
    if (runFailure) {
      throw runFailure;
    }
    if (cleanupFailure) {
      throw new Error(
        `${cleanupFailure.message}${cleanupFailureManifestPath ? ` (cleanup manifest: ${cleanupFailureManifestPath})` : ""}`,
      );
    }
  }
}

run().catch((error) => {
  console.error("Playwright assessment upload promote smoke failed", error);
  process.exit(1);
});
