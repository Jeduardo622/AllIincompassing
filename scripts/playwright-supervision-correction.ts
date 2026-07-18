/**
 * Hosted disposable-proof continuation for the BT -> BCBA -> BT -> BCBA correction lifecycle.
 * This script assumes a marker-owned BT fixture and completed BT note already exist.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import {
  assertBranchOwnershipContract,
  DISPOSABLE_ACK,
  PRODUCTION_PROJECT_REF,
} from "./provision-ci-smoke-bt-aba";
import { loadPlaywrightEnv } from "./lib/load-playwright-env";
import { captureFailureScreenshot, loginAndAssertSession } from "./lib/playwright-smoke";

const FLOW = "BT supervision correction Playwright proof";
const PENDING_REVIEW_LABEL = "Pending Review";
const CORRECTION_REQUIRED_LABEL = "Correction Required";
const RESUBMITTED_LABEL = "Resubmitted";
const COMPLETED_LABEL = "Completed";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_REDACTION_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;
const TOKEN_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const WORKFLOW_RPC_NAMES = [
  "return_supervision_session_note_request_to_bt",
  "get_bt_supervision_correction_tasks",
  "resubmit_bt_supervision_correction",
  "complete_supervision_session_note_request",
] as const;

type SafetyConfig = {
  baseUrl: string;
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  projectRef: string;
  marker: string;
  btEmail: string;
  btPassword: string;
  branchOwnership: string;
  branchTeardownAcknowledgement: string;
};

type SupervisionTemplateFixture = {
  id: string;
  createdByProof: boolean;
};

type ActorIdentity = {
  id: string;
  email: string;
  organizationId: string;
};

type ProvisionedBcba = {
  id: string;
  email: string;
  password: string;
  organizationId: string;
};

type PendingRequestFixture = {
  requestId: string;
  organizationId: string;
  sessionId: string;
  clientId: string;
  clientName: string;
  btTherapistId: string;
  btNoteId: string;
  btTemplateSnapshot: Record<string, unknown>;
  btResponses: Record<string, unknown>;
  btSignedAt: string | null;
  btAttestationCount: number;
};

type CorrectionLifecycleState = {
  requestStatus: string;
  correctionId: string | null;
  correctionRound: number | null;
  correctionReason: string | null;
  correctionRequestedAt: string | null;
  correctionReviewerUserId: string | null;
  correctionResolvedAt: string | null;
  resultingAmendmentId: string | null;
  amendmentId: string | null;
  amendmentVersionNumber: number | null;
  amendmentCorrectionRound: number | null;
  amendmentResponses: Record<string, unknown> | null;
  amendmentSignedAt: string | null;
  assignedReviewerUserId: string | null;
  supervisionNoteId: string | null;
  supervisionCompletedBy: string | null;
  bcbaAttestationCount: number;
  originalBtAttestationCount: number;
};

const normalizedEnv = (key: string, fallback?: string): string => (process.env[key] ?? fallback ?? "").trim();

export const isMarkerOwnedSyntheticIdentity = (email: string, marker: string): boolean => (
  /^playwright\.ci\.(bt|bcba)\.[a-z0-9_.-]+@example\.com$/i.test(email.trim().toLowerCase())
  && email.trim().toLowerCase().includes(marker.trim().toLowerCase())
);

const redactCorrectionDiagnostic = (value: unknown): string => String(value ?? "unknown")
  .replace(UUID_REDACTION_PATTERN, "[uuid]")
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
  .replace(TOKEN_PATTERN, "[token]")
  .replace(/"responses"\s*:\s*\{[\s\S]*?\}/gi, '"responses":"[redacted]"')
  .replace(/[\r\n\t]+/g, " ")
  .slice(0, 320);

export const formatSupervisionCorrectionFailure = (status: number, responseBody: string): string => {
  let code = "unknown";
  let message = "request failed";
  try {
    const parsed = JSON.parse(responseBody) as { code?: unknown; message?: unknown; error?: unknown };
    if (typeof parsed.code === "string" && /^[a-z_]{1,64}$/i.test(parsed.code)) code = parsed.code;
    message = redactCorrectionDiagnostic(parsed.message ?? parsed.error ?? message);
  } catch {
    message = "request failed";
  }
  return `Supervision correction failed: status=${status} code=${code} message=${message}`;
};

type AuthAdminErrorShape = {
  status?: unknown;
  code?: unknown;
};

const authAdminErrorShape = (error: unknown): AuthAdminErrorShape => (
  error && typeof error === "object" ? error as AuthAdminErrorShape : {}
);

export const isAuthEmailCollision = (error: unknown): boolean => {
  const { status, code } = authAdminErrorShape(error);
  return status === 422 && ["email_exists", "email_conflict", "user_already_exists"].includes(String(code ?? ""));
};

export const assertSyntheticAuthUserDeleted = (lookup: {
  data: { user: unknown | null };
  error: unknown | null;
}): void => {
  if (lookup.data.user || !lookup.error) {
    throw new Error("Synthetic BCBA cleanup failed; auth user remains after cleanup.");
  }
  const { status, code } = authAdminErrorShape(lookup.error);
  if (status !== 404 || code !== "user_not_found") {
    throw new Error(`Synthetic BCBA cleanup verification failed with unexpected Auth result: status=${String(status ?? "unknown")} code=${String(code ?? "unknown")}`);
  }
};

const captureCorrectionFailureScreenshot = async (page: Page): Promise<string> => {
  const dedicatedDirectory = normalizedEnv("PW_BT_PROOF_ARTIFACT_DIR");
  if (!dedicatedDirectory) {
    return captureFailureScreenshot(page, "playwright-supervision-correction");
  }
  const resolvedDirectory = path.resolve(dedicatedDirectory);
  await mkdir(resolvedDirectory, { recursive: true });
  const screenshotPath = path.join(resolvedDirectory, `playwright-supervision-correction-${Date.now()}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
  return screenshotPath;
};

const loadSafetyConfig = (): SafetyConfig => {
  const required: Array<[string, string]> = [
    ["PW_BASE_URL", normalizedEnv("PW_BASE_URL")],
    ["VITE_SUPABASE_URL", normalizedEnv("VITE_SUPABASE_URL")],
    ["VITE_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY)", normalizedEnv("VITE_SUPABASE_ANON_KEY", process.env.SUPABASE_ANON_KEY)],
    ["SUPABASE_SERVICE_ROLE_KEY", normalizedEnv("SUPABASE_SERVICE_ROLE_KEY")],
    ["PW_BT_DISPOSABLE_PROJECT_REF", normalizedEnv("PW_BT_DISPOSABLE_PROJECT_REF")],
    ["PW_BT_FIXTURE_MARKER", normalizedEnv("PW_BT_FIXTURE_MARKER")],
    ["PW_BT_EMAIL", normalizedEnv("PW_BT_EMAIL")],
    ["PW_BT_PASSWORD", normalizedEnv("PW_BT_PASSWORD")],
    ["PW_BT_DISPOSABLE_ACK", normalizedEnv("PW_BT_DISPOSABLE_ACK")],
    ["PW_BT_BRANCH_OWNERSHIP", normalizedEnv("PW_BT_BRANCH_OWNERSHIP")],
    ["PW_BT_DISPOSABLE_BRANCH_TEARDOWN_ACK", normalizedEnv("PW_BT_DISPOSABLE_BRANCH_TEARDOWN_ACK")],
  ];
  const invalid = required.filter(([, value]) => !value || ["****", "<required>", "changeme"].includes(value.toLowerCase()));
  if (invalid.length) {
    throw new Error(`${FLOW} cannot run before any write: ${invalid.map(([key]) => key).join(", ")} must be explicitly configured.`);
  }

  const marker = normalizedEnv("PW_BT_FIXTURE_MARKER").toLowerCase();
  const btEmail = normalizedEnv("PW_BT_EMAIL").toLowerCase();
  const projectRef = normalizedEnv("PW_BT_DISPOSABLE_PROJECT_REF").toLowerCase();
  const supabaseUrl = normalizedEnv("VITE_SUPABASE_URL").replace(/\/$/, "");

  if (normalizedEnv("PW_BT_DISPOSABLE_ACK") !== DISPOSABLE_ACK) {
    throw new Error(`PW_BT_DISPOSABLE_ACK must equal ${DISPOSABLE_ACK}.`);
  }
  if (!isMarkerOwnedSyntheticIdentity(btEmail, marker)) {
    throw new Error("PW_BT_EMAIL must be a marker-owned synthetic BT identity.");
  }
  if (marker.length < 12 || !/^[a-z0-9-]+$/i.test(marker)) {
    throw new Error("PW_BT_FIXTURE_MARKER must be at least 12 characters and contain only letters, digits, or hyphens.");
  }

  let runtimeRef = "";
  try {
    const hostname = new URL(supabaseUrl).hostname.toLowerCase();
    runtimeRef = hostname.match(/^([a-z0-9-]+)\.supabase\.co$/)?.[1] ?? "";
  } catch {
    throw new Error("VITE_SUPABASE_URL must be a valid hosted Supabase URL.");
  }
  if (!runtimeRef || runtimeRef !== projectRef) {
    throw new Error(`Disposable project acknowledgement mismatch: runtime ref ${runtimeRef || "unresolved"} != ${projectRef}.`);
  }
  if (runtimeRef === PRODUCTION_PROJECT_REF || projectRef === PRODUCTION_PROJECT_REF) {
    throw new Error(`Refusing production Supabase project ${PRODUCTION_PROJECT_REF}.`);
  }
  assertBranchOwnershipContract(
    normalizedEnv("PW_BT_BRANCH_OWNERSHIP"),
    normalizedEnv("PW_BT_DISPOSABLE_BRANCH_TEARDOWN_ACK"),
  );

  return {
    baseUrl: normalizedEnv("PW_BASE_URL").replace(/\/$/, ""),
    supabaseUrl,
    anonKey: normalizedEnv("VITE_SUPABASE_ANON_KEY", process.env.SUPABASE_ANON_KEY),
    serviceRoleKey: normalizedEnv("SUPABASE_SERVICE_ROLE_KEY"),
    projectRef,
    marker,
    btEmail,
    btPassword: normalizedEnv("PW_BT_PASSWORD"),
    branchOwnership: normalizedEnv("PW_BT_BRANCH_OWNERSHIP"),
    branchTeardownAcknowledgement: normalizedEnv("PW_BT_DISPOSABLE_BRANCH_TEARDOWN_ACK"),
  };
};

const createAdmin = (config: SafetyConfig): SupabaseClient => createClient(
  config.supabaseUrl,
  config.serviceRoleKey,
  { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } },
);

const requireUuid = (value: string, label: string): string => {
  if (!UUID_PATTERN.test(value)) throw new Error(`${label} must be a UUID.`);
  return value;
};

const fetchAccessTokenForCredentials = async (config: SafetyConfig, email: string, password: string): Promise<string> => {
  const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: config.anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(formatSupervisionCorrectionFailure(response.status, body));
  const parsed = JSON.parse(body) as { access_token?: unknown };
  if (typeof parsed.access_token !== "string" || !parsed.access_token) {
    throw new Error("Authenticated token response was missing access_token.");
  }
  return parsed.access_token;
};

const resolveActor = async (config: SafetyConfig, token: string): Promise<ActorIdentity> => {
  const [userResponse, orgResponse] = await Promise.all([
    fetch(`${config.supabaseUrl}/auth/v1/user`, {
      headers: { apikey: config.anonKey, Authorization: `Bearer ${token}` },
    }),
    fetch(`${config.supabaseUrl}/rest/v1/rpc/current_user_organization_id`, {
      method: "POST",
      headers: { apikey: config.anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
    }),
  ]);
  const userJson = (await userResponse.json().catch(() => null)) as { id?: unknown; email?: unknown } | null;
  const orgJson = (await orgResponse.json().catch(() => null)) as unknown;
  if (!userResponse.ok || typeof userJson?.id !== "string" || typeof userJson?.email !== "string") {
    throw new Error(`Unable to resolve authenticated actor identity (${userResponse.status}).`);
  }
  if (!orgResponse.ok || typeof orgJson !== "string") {
    throw new Error(`Unable to resolve authenticated actor organization (${orgResponse.status}).`);
  }
  return {
    id: requireUuid(userJson.id, "Actor id"),
    email: userJson.email.toLowerCase(),
    organizationId: requireUuid(orgJson, "Actor organization"),
  };
};

const ensureSupervisionTemplate = async (
  admin: SupabaseClient,
  organizationId: string,
  creatorUserId: string,
  marker: string,
): Promise<SupervisionTemplateFixture> => {
  const existing = await admin
    .from("session_note_templates")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("template_type", "supervision_session_note")
    .eq("template_name", "Supervision Session Note")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing.error) throw new Error(`Unable to read supervision template: ${existing.error.message}`);
  if (existing.data?.id) return { id: existing.data.id, createdByProof: false };

  const templateStructure = {
    version: 1,
    sections: [
      {
        key: "purpose_of_session",
        label: "Purpose of Session",
        fields: [
          {
            key: "purpose_of_session",
            label: "Purpose of Session",
            type: "checkbox_group",
            required: true,
            options: ["Direct Supervision", "Assessment or Ongoing Assessment", "Treatment Planning", "Other"],
          },
        ],
      },
      {
        key: "team_signatures",
        label: "Team Signatures",
        fields: [
          { key: "bcba_supervisor_signature", label: "BCBA supervisor", type: "signature", required: true },
          { key: "bcba_licensure_credential", label: "Licensure/Credential: BCBA", type: "text", required: true },
        ],
      },
    ],
  } as const;

  const inserted = await admin
    .from("session_note_templates")
    .insert({
      template_name: "Supervision Session Note",
      template_type: "supervision_session_note",
      template_structure: templateStructure,
      description: `Synthetic supervision template ${marker}`,
      compliance_requirements: { source: "playwright-supervision-correction", marker },
      is_california_compliant: true,
      organization_id: organizationId,
      created_by: creatorUserId,
    })
    .select("id")
    .single();
  if (inserted.error || !inserted.data?.id) {
    throw new Error(`Unable to seed missing supervision template: ${inserted.error?.message ?? "missing id"}`);
  }
  return { id: inserted.data.id, createdByProof: true };
};

const cleanupBcbaFixture = async (
  admin: SupabaseClient,
  marker: string,
  bcba: ProvisionedBcba | null,
): Promise<void> => {
  if (!bcba) return;
  const zeroRetainedTables = [
    ["user_therapist_links", "user_id"],
    ["user_roles", "user_id"],
    ["profiles", "id"],
    ["session_note_attestations", "signer_user_id"],
    ["supervision_session_notes", "completed_by"],
  ] as const;
  const linkDelete = await admin.from("user_therapist_links").delete().eq("user_id", bcba.id);
  if (linkDelete.error) throw new Error(`Synthetic BCBA cleanup failed for user_therapist_links: ${linkDelete.error.message}`);
  const roleDelete = await admin.from("user_roles").delete().eq("user_id", bcba.id);
  if (roleDelete.error) throw new Error(`Synthetic BCBA cleanup failed for user_roles: ${roleDelete.error.message}`);
  const profileDelete = await admin.from("profiles").delete().eq("id", bcba.id);
  if (profileDelete.error) throw new Error(`Synthetic BCBA cleanup failed for profiles: ${profileDelete.error.message}`);
  const authDelete = await admin.auth.admin.deleteUser(bcba.id);
  if (authDelete.error) throw new Error(`Synthetic BCBA cleanup failed for auth user: ${authDelete.error.message}`);

  const retainedCounts: Record<string, number> = {};
  for (const [table, column] of zeroRetainedTables) {
    const { count, error } = await admin.from(table).select("*", { count: "exact", head: true }).eq(column, bcba.id);
    if (error) throw error;
    retainedCounts[table] = count ?? -1;
  }
  if (Object.values(retainedCounts).some((count) => count !== 0)) {
    throw new Error(`Synthetic BCBA cleanup failed; zero retained marker rows requirement was not met: ${JSON.stringify(retainedCounts)}`);
  }
  const remainingAuth = await admin.auth.admin.getUserById(bcba.id);
  assertSyntheticAuthUserDeleted(remainingAuth);
  console.log(JSON.stringify({ ok: true, marker, cleanup: "zero retained marker rows", retainedCounts }));
};

const cleanupPartialProvisionedBcba = async (
  admin: SupabaseClient,
  userId: string | null,
): Promise<void> => {
  if (!userId) return;
  const failures: string[] = [];
  for (const [table, column] of [["user_therapist_links", "user_id"], ["user_roles", "user_id"], ["profiles", "id"]] as const) {
    const { error } = await admin.from(table).delete().eq(column, userId);
    if (error) failures.push(`${table}: ${error.message}`);
  }
  const authDelete = await admin.auth.admin.deleteUser(userId);
  if (authDelete.error) failures.push(`auth.users: ${authDelete.error.message}`);
  if (failures.length) throw new Error(`Partial synthetic BCBA cleanup failed: ${failures.join("; ")}`);
};

const provisionMarkerOwnedBcba = async (
  admin: SupabaseClient,
  marker: string,
  organizationId: string,
  therapistId: string,
): Promise<ProvisionedBcba> => {
  const email = `playwright.ci.bcba.${marker}@example.com`.toLowerCase();
  if (!isMarkerOwnedSyntheticIdentity(email, marker)) {
    throw new Error("Provisioned BCBA email must be marker-owned and synthetic.");
  }
  const password = `C1-${randomBytes(18).toString("base64url")}!Aa`;

  let userId: string | null = null;
  try {
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        organization_id: organizationId,
        organizationId,
        fixture_marker: marker,
        first_name: "Playwright",
        last_name: "BCBA",
      },
      app_metadata: {
        smoke_actor: "bcba",
        smoke_expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        fixture_marker: marker,
        organization_id: organizationId,
        organizationId,
      },
    });
    if (created.error) {
      if (isAuthEmailCollision(created.error)) {
        throw new Error("Synthetic BCBA marker collision; use a fresh PW_BT_FIXTURE_MARKER. No broad Auth cleanup was attempted.");
      }
      throw new Error(`Unable to create synthetic BCBA auth user: ${created.error.message}`);
    }
    if (!created.data.user?.id) {
      throw new Error(`Unable to create synthetic BCBA auth user: ${created.error?.message ?? "missing user id"}`);
    }
    userId = created.data.user.id;

    const roleResult = await admin.from("roles").select("id").eq("name", "bcba").maybeSingle();
    if (roleResult.error || !roleResult.data?.id) {
      throw new Error(`Unable to resolve bcba role: ${roleResult.error?.message ?? "missing role id"}`);
    }

    const [profileResult, roleInsert, linkInsert] = await Promise.all([
      admin.from("profiles").upsert({
        id: userId,
        email,
        role: "bcba",
        is_active: true,
        first_name: "Playwright",
        last_name: "BCBA",
        organization_id: organizationId,
      }, { onConflict: "id" }),
      admin.from("user_roles").insert({
        user_id: userId,
        role_id: roleResult.data.id,
        is_active: true,
        expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      }),
      admin.from("user_therapist_links").insert({
        user_id: userId,
        therapist_id: therapistId,
      }),
    ]);
    if (profileResult.error) throw new Error(`Unable to create synthetic BCBA profile: ${profileResult.error.message}`);
    if (roleInsert.error) throw new Error(`Unable to assign synthetic BCBA role: ${roleInsert.error.message}`);
    if (linkInsert.error) throw new Error(`Unable to create synthetic BCBA therapist link: ${linkInsert.error.message}`);

    const provisioned = await admin.rpc("provision_ci_smoke_bcba_profile", { p_user_id: userId });
    if (provisioned.error || provisioned.data !== organizationId) {
      throw new Error(`Unable to finalize synthetic BCBA profile scope: ${provisioned.error?.message ?? "organization mismatch"}`);
    }
  } catch (error) {
    await cleanupPartialProvisionedBcba(admin, userId);
    throw error;
  }

  return { id: userId!, email, password, organizationId };
};

const resolvePendingRequestFixture = async (
  admin: SupabaseClient,
  bt: ActorIdentity,
): Promise<PendingRequestFixture> => {
  const requestResult = await admin
    .from("supervision_session_note_requests")
    .select("id, organization_id, session_id, client_id, bt_therapist_id, status, assigned_admin_user_id, created_at")
    .eq("organization_id", bt.organizationId)
    .eq("bt_therapist_id", bt.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (requestResult.error || !requestResult.data?.id) {
    throw new Error(`No pending supervision request was found for marker-owned BT fixture. Run the BT note proof first. ${requestResult.error?.message ?? ""}`.trim());
  }

  const request = requestResult.data;
  const [clientResult, noteResult] = await Promise.all([
    admin.from("clients").select("full_name").eq("id", request.client_id).eq("organization_id", request.organization_id).maybeSingle(),
    admin.from("client_session_notes")
      .select("id, bt_aba_template_snapshot, bt_aba_responses, signed_at")
      .eq("session_id", request.session_id)
      .eq("organization_id", request.organization_id)
      .eq("client_id", request.client_id)
      .eq("therapist_id", request.bt_therapist_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (clientResult.error || !clientResult.data?.full_name) throw new Error(`Unable to resolve supervision request client: ${clientResult.error?.message ?? "missing client"}`);
  if (noteResult.error || !noteResult.data?.id) throw new Error(`Unable to resolve original BT note packet: ${noteResult.error?.message ?? "missing note"}`);
  const attestationResult = await admin.from("session_note_attestations")
    .select("id", { count: "exact" })
    .eq("organization_id", request.organization_id)
    .eq("attestation_role", "bt")
    .eq("note_id", noteResult.data.id)
    .is("supervision_note_id", null)
    .limit(10);
  if (attestationResult.error) throw new Error(`Unable to resolve original BT attestation count: ${attestationResult.error.message}`);

  return {
    requestId: request.id,
    organizationId: request.organization_id,
    sessionId: request.session_id,
    clientId: request.client_id,
    clientName: clientResult.data.full_name,
    btTherapistId: request.bt_therapist_id,
    btNoteId: noteResult.data.id,
    btTemplateSnapshot: (noteResult.data.bt_aba_template_snapshot ?? {}) as Record<string, unknown>,
    btResponses: (noteResult.data.bt_aba_responses ?? {}) as Record<string, unknown>,
    btSignedAt: noteResult.data.signed_at,
    btAttestationCount: attestationResult.count ?? 0,
  };
};

const assignRequestToBcba = async (admin: SupabaseClient, requestId: string, organizationId: string, bcbaUserId: string): Promise<void> => {
  const result = await admin
    .from("supervision_session_note_requests")
    .update({
      assigned_admin_user_id: bcbaUserId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .eq("organization_id", organizationId)
    .eq("status", "pending")
    .is("assigned_admin_user_id", null)
    .select("id")
    .single();
  if (result.error || !result.data?.id) {
    throw new Error(`Unable to assign pending supervision request to synthetic BCBA: ${result.error?.message ?? "missing request id"}`);
  }
};

const cleanupCorrectionLifecycle = async (
  admin: SupabaseClient,
  fixture: PendingRequestFixture | null,
  template: SupervisionTemplateFixture | null,
): Promise<void> => {
  if (!fixture) return;
  const requestDelete = await admin.from("supervision_session_note_requests")
    .delete()
    .eq("id", fixture.requestId)
    .eq("organization_id", fixture.organizationId);
  if (requestDelete.error) {
    throw new Error(`Synthetic correction lifecycle cleanup failed for request: ${requestDelete.error.message}`);
  }

  const retainedCounts: Record<string, number> = {};
  for (const table of [
    "supervision_session_note_requests",
    "supervision_session_note_corrections",
    "bt_session_note_amendments",
    "supervision_session_notes",
  ] as const) {
    const column = table === "supervision_session_note_requests" ? "id" : "request_id";
    const { count, error } = await admin.from(table).select("*", { count: "exact", head: true }).eq(column, fixture.requestId);
    if (error) throw new Error(`Unable to verify synthetic correction cleanup for ${table}: ${error.message}`);
    retainedCounts[table] = count ?? -1;
  }
  if (Object.values(retainedCounts).some((count) => count !== 0)) {
    throw new Error(`Synthetic correction lifecycle rows remain after cleanup: ${JSON.stringify(retainedCounts)}`);
  }

  if (template?.createdByProof) {
    const templateDelete = await admin.from("session_note_templates")
      .delete()
      .eq("id", template.id)
      .eq("organization_id", fixture.organizationId);
    if (templateDelete.error) {
      throw new Error(`Synthetic supervision template cleanup failed: ${templateDelete.error.message}`);
    }
    const templateCount = await admin.from("session_note_templates")
      .select("*", { count: "exact", head: true })
      .eq("id", template.id)
      .eq("organization_id", fixture.organizationId);
    if (templateCount.error || templateCount.count !== 0) {
      throw new Error(`Synthetic supervision template remains after cleanup: ${templateCount.error?.message ?? "row retained"}`);
    }
  }
};

const openDashboard = async (page: Page, baseUrl: string): Promise<void> => {
  await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForLoadState("networkidle").catch(() => undefined);
};

const waitForText = async (page: Page, text: string): Promise<void> => {
  await page.getByText(text, { exact: true }).first().waitFor({ state: "visible", timeout: 30_000 });
};

const openBcbaReviewModal = async (page: Page, clientName: string): Promise<void> => {
  await page.getByRole("button", { name: new RegExp(`complete supervision note for ${clientName}`, "i") }).click();
  await page.getByRole("heading", { name: /supervision session note/i }).waitFor({ state: "visible", timeout: 15_000 });
};

const returnRequestThroughBrowser = async (
  page: Page,
  reason: string,
): Promise<void> => {
  await page.getByLabel("Correction reason", { exact: true }).fill(reason);
  await page.getByRole("button", { name: /return to bt/i }).click();
  await page.getByRole("heading", { name: /supervision session note/i }).waitFor({ state: "hidden", timeout: 20_000 });
};

const openBtAmendmentModal = async (page: Page, clientName: string): Promise<void> => {
  await page.getByRole("button", { name: new RegExp(`amend bt note for ${clientName}`, "i") }).click();
  await page.getByRole("dialog", { name: "Amend BT Note" }).waitFor({ state: "visible", timeout: 15_000 });
};

const resubmitCorrectionThroughBrowser = async (
  page: Page,
  updatedProgress: string,
  signatureValue: string,
): Promise<void> => {
  const progressField = page.getByLabel("Summary of Progress Toward Treatment Goals", { exact: true });
  await progressField.fill(updatedProgress);
  await page.getByRole("radio", { name: "Type signature", exact: true }).click();
  await page.getByLabel("Type Behavior Technician signature", { exact: true }).fill(signatureValue);
  await page.getByRole("button", { name: /re-attest and resubmit/i }).click();
  await page.getByRole("dialog", { name: "Amend BT Note" }).waitFor({ state: "hidden", timeout: 20_000 });
};

const completeReviewThroughBrowser = async (
  page: Page,
): Promise<void> => {
  await page.getByRole("checkbox", { name: "Direct Supervision", exact: true }).click();
  await page.getByLabel("Licensure/Credential: BCBA", { exact: true }).fill("BCBA");
  await page.getByRole("radio", { name: "Type signature", exact: true }).click();
  await page.getByLabel("Type BCBA signature", { exact: true }).fill("BCBA Synthetic Signature");
  await page.getByRole("button", { name: "Sign and Complete Supervision Note", exact: true }).click();
  await page.getByRole("heading", { name: /supervision session note/i }).waitFor({ state: "hidden", timeout: 20_000 });
};

const postRpc = async <T>(
  config: SafetyConfig,
  token: string,
  fn: string,
  body: Record<string, unknown>,
): Promise<T> => {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(formatSupervisionCorrectionFailure(response.status, text));
  return (text ? JSON.parse(text) : null) as T;
};

const loadBtTasks = async (
  config: SafetyConfig,
  token: string,
): Promise<Array<Record<string, unknown>>> => {
  const data = await postRpc<unknown>(config, token, WORKFLOW_RPC_NAMES[1], {});
  return Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
};

const loadReviewPackets = async (
  config: SafetyConfig,
  token: string,
): Promise<Array<Record<string, unknown>>> => {
  const data = await postRpc<unknown>(config, token, "get_pending_supervision_review_packets", {});
  return Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
};

const assertInitialReviewPacketVisible = async (
  admin: SupabaseClient,
  config: SafetyConfig,
  token: string,
  fixture: PendingRequestFixture,
): Promise<void> => {
  const packets = await loadReviewPackets(config, token);
  if (packets.some((packet) => packet.request_id === fixture.requestId)) return;

  const [actionCount, request, session, client, therapist, note, attestation] = await Promise.all([
    postRpc<unknown>(config, token, "get_supervision_session_note_action_count", {}),
    admin.from("supervision_session_note_requests")
      .select("id, status, assigned_admin_user_id")
      .eq("id", fixture.requestId)
      .eq("organization_id", fixture.organizationId)
      .maybeSingle(),
    admin.from("sessions").select("id")
      .eq("id", fixture.sessionId)
      .eq("organization_id", fixture.organizationId)
      .maybeSingle(),
    admin.from("clients").select("id")
      .eq("id", fixture.clientId)
      .eq("organization_id", fixture.organizationId)
      .maybeSingle(),
    admin.from("therapists").select("id")
      .eq("id", fixture.btTherapistId)
      .eq("organization_id", fixture.organizationId)
      .maybeSingle(),
    admin.from("client_session_notes").select("id")
      .eq("id", fixture.btNoteId)
      .eq("session_id", fixture.sessionId)
      .eq("organization_id", fixture.organizationId)
      .maybeSingle(),
    admin.from("session_note_attestations").select("id")
      .eq("note_id", fixture.btNoteId)
      .eq("organization_id", fixture.organizationId)
      .eq("attestation_role", "bt")
      .is("supervision_note_id", null)
      .limit(1)
      .maybeSingle(),
  ]);
  const queryErrors = [request.error, session.error, client.error, therapist.error, note.error, attestation.error]
    .filter((error): error is NonNullable<typeof error> => Boolean(error));
  if (queryErrors.length) throw new Error(`Initial review packet boundary diagnostics failed: ${queryErrors[0].message}`);

  throw new Error(`Assigned BCBA packet was absent before browser navigation: ${JSON.stringify({
    packetCount: packets.length,
    actionCount,
    requestPresent: Boolean(request.data?.id),
    requestPending: request.data?.status === "pending",
    assignmentPresent: Boolean(request.data?.assigned_admin_user_id),
    sessionPresent: Boolean(session.data?.id),
    clientPresent: Boolean(client.data?.id),
    therapistPresent: Boolean(therapist.data?.id),
    notePresent: Boolean(note.data?.id),
    attestationPresent: Boolean(attestation.data?.id),
  })}`);
};

const readCorrectionLifecycleState = async (
  admin: SupabaseClient,
  fixture: PendingRequestFixture,
): Promise<CorrectionLifecycleState> => {
  const [requestResult, correctionResult, amendmentResult, supervisionNoteResult, btAttestationResult] = await Promise.all([
    admin.from("supervision_session_note_requests")
      .select("status, assigned_admin_user_id")
      .eq("id", fixture.requestId)
      .eq("organization_id", fixture.organizationId)
      .single(),
    admin.from("supervision_session_note_corrections")
      .select("id, correction_round, correction_reason, requested_at, reviewer_user_id, resolved_at, resulting_amendment_id")
      .eq("request_id", fixture.requestId)
      .eq("organization_id", fixture.organizationId)
      .order("correction_round", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin.from("bt_session_note_amendments")
      .select("id, version_number, correction_round, bt_aba_responses, signed_at")
      .eq("request_id", fixture.requestId)
      .eq("organization_id", fixture.organizationId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin.from("supervision_session_notes")
      .select("id, completed_by")
      .eq("request_id", fixture.requestId)
      .eq("organization_id", fixture.organizationId)
      .order("signed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin.from("session_note_attestations")
      .select("id", { count: "exact" })
      .eq("organization_id", fixture.organizationId)
      .eq("attestation_role", "bt")
      .eq("note_id", fixture.btNoteId)
      .is("supervision_note_id", null)
      .limit(10),
  ]);
  if (requestResult.error) throw new Error(`Unable to read supervision request state: ${requestResult.error.message}`);
  if (correctionResult.error) throw new Error(`Unable to read correction state: ${correctionResult.error.message}`);
  if (amendmentResult.error) throw new Error(`Unable to read amendment state: ${amendmentResult.error.message}`);
  if (supervisionNoteResult.error) throw new Error(`Unable to read supervision note state: ${supervisionNoteResult.error.message}`);
  if (btAttestationResult.error) throw new Error(`Unable to read BT attestation count: ${btAttestationResult.error.message}`);

  const bcbaAttestationResult = supervisionNoteResult.data?.id
    ? await admin.from("session_note_attestations")
      .select("id", { count: "exact" })
      .eq("organization_id", fixture.organizationId)
      .eq("attestation_role", "bcba")
      .eq("supervision_note_id", supervisionNoteResult.data.id)
      .limit(10)
    : { count: 0, error: null };
  if (bcbaAttestationResult.error) throw new Error(`Unable to read BCBA attestation count: ${bcbaAttestationResult.error.message}`);

  return {
    requestStatus: requestResult.data.status,
    assignedReviewerUserId: requestResult.data.assigned_admin_user_id,
    correctionId: correctionResult.data?.id ?? null,
    correctionRound: correctionResult.data?.correction_round ?? null,
    correctionReason: correctionResult.data?.correction_reason ?? null,
    correctionRequestedAt: correctionResult.data?.requested_at ?? null,
    correctionReviewerUserId: correctionResult.data?.reviewer_user_id ?? null,
    correctionResolvedAt: correctionResult.data?.resolved_at ?? null,
    resultingAmendmentId: correctionResult.data?.resulting_amendment_id ?? null,
    amendmentId: amendmentResult.data?.id ?? null,
    amendmentVersionNumber: amendmentResult.data?.version_number ?? null,
    amendmentCorrectionRound: amendmentResult.data?.correction_round ?? null,
    amendmentResponses: (amendmentResult.data?.bt_aba_responses ?? null) as Record<string, unknown> | null,
    amendmentSignedAt: amendmentResult.data?.signed_at ?? null,
    supervisionNoteId: supervisionNoteResult.data?.id ?? null,
    supervisionCompletedBy: supervisionNoteResult.data?.completed_by ?? null,
    bcbaAttestationCount: bcbaAttestationResult.count ?? 0,
    originalBtAttestationCount: btAttestationResult.count ?? 0,
  };
};

const validateBtReadOnlyGraph = async (
  admin: SupabaseClient,
  config: SafetyConfig,
  bt: ActorIdentity,
): Promise<void> => {
  if (!isMarkerOwnedSyntheticIdentity(bt.email, config.marker)) {
    throw new Error("Authenticated BT actor is not marker-owned and synthetic.");
  }

  const [profileResult, roleResult, therapistResult] = await Promise.all([
    admin.from("profiles").select("organization_id, role, is_active").eq("id", bt.id).maybeSingle(),
    admin.from("user_roles").select("roles(name), is_active").eq("user_id", bt.id),
    admin.from("therapists").select("id, organization_id, email, full_name, title, status, deleted_at").eq("id", bt.id).maybeSingle(),
  ]);
  if (profileResult.error || !profileResult.data) throw new Error(`Unable to validate BT profile: ${profileResult.error?.message ?? "missing profile"}`);
  if (roleResult.error) throw new Error(`Unable to validate BT role mapping: ${roleResult.error.message}`);
  if (therapistResult.error || !therapistResult.data) throw new Error(`Unable to validate BT therapist fixture: ${therapistResult.error?.message ?? "missing therapist"}`);

  assert.equal(profileResult.data.organization_id, bt.organizationId);
  assert.equal(profileResult.data.role, "bt");
  assert.equal(profileResult.data.is_active, true);
  assert.equal(therapistResult.data.organization_id, bt.organizationId);
  assert.equal(therapistResult.data.status, "active");
  assert.equal(therapistResult.data.deleted_at, null);
  assert.match(String(therapistResult.data.title ?? "").trim().toUpperCase(), /^(BT|RBT)$/);
  assert.equal(isMarkerOwnedSyntheticIdentity(String(therapistResult.data.email ?? ""), config.marker), true);

  const roleNames = (roleResult.data ?? []).flatMap((row) => {
    const nested = row.roles as unknown as { name?: unknown } | Array<{ name?: unknown }> | null;
    return (Array.isArray(nested) ? nested : nested ? [nested] : []).map((role) => String(role.name ?? "").toLowerCase());
  });
  assert.equal(roleNames.includes("bt"), true);
  assert.equal(roleNames.some((role) => ["bcba", "admin", "admin_schedule", "therapist", "midtier"].includes(role)), false);
};

async function run(): Promise<void> {
  loadPlaywrightEnv();
  const config = loadSafetyConfig();
  const admin = createAdmin(config);
  let browser: Browser | undefined;
  let bcbaContext: BrowserContext | undefined;
  let bcbaPage: Page | undefined;
  let btContext: BrowserContext | undefined;
  let btPage: Page | undefined;
  let bcbaFixture: ProvisionedBcba | null = null;
  let pendingFixture: PendingRequestFixture | null = null;
  let supervisionTemplate: SupervisionTemplateFixture | null = null;
  let runError: unknown;
  let screenshotPath = "N/A";

  try {
    const btToken = await fetchAccessTokenForCredentials(config, config.btEmail, config.btPassword);
    const btActor = await resolveActor(config, btToken);
    await validateBtReadOnlyGraph(admin, config, btActor);

    pendingFixture = await resolvePendingRequestFixture(admin, btActor);
    assert.equal(pendingFixture.btAttestationCount, 1, "The original signed BT packet must have exactly one BT attestation.");

    supervisionTemplate = await ensureSupervisionTemplate(admin, btActor.organizationId, btActor.id, config.marker);
    bcbaFixture = await provisionMarkerOwnedBcba(admin, config.marker, btActor.organizationId, pendingFixture.btTherapistId);
    await assignRequestToBcba(admin, pendingFixture.requestId, pendingFixture.organizationId, bcbaFixture.id);
    assert.equal(isMarkerOwnedSyntheticIdentity(bcbaFixture.email, config.marker), true);

    browser = await chromium.launch({ headless: process.env.HEADLESS !== "false" });

    const bcbaToken = await fetchAccessTokenForCredentials(config, bcbaFixture.email, bcbaFixture.password);
    const bcbaActor = await resolveActor(config, bcbaToken);
    assert.equal(bcbaActor.organizationId, btActor.organizationId);
    await assertInitialReviewPacketVisible(admin, config, bcbaToken, pendingFixture);

    bcbaContext = await browser.newContext();
    bcbaPage = await bcbaContext.newPage();
    await loginAndAssertSession(bcbaPage, config.baseUrl, bcbaFixture.email, bcbaFixture.password);
    await openDashboard(bcbaPage, config.baseUrl);
    await waitForText(bcbaPage, PENDING_REVIEW_LABEL);
    await openBcbaReviewModal(bcbaPage, pendingFixture.clientName);
    const correctionReason = `Please update the client narrative for ${config.marker}.`;
    await returnRequestThroughBrowser(bcbaPage, correctionReason);
    await openDashboard(bcbaPage, config.baseUrl);
    await waitForText(bcbaPage, CORRECTION_REQUIRED_LABEL);

    const afterReturn = await readCorrectionLifecycleState(admin, pendingFixture);
    assert.equal(afterReturn.requestStatus, "correction_required");
    assert.equal(afterReturn.correctionReviewerUserId, bcbaActor.id);
    assert.equal(afterReturn.correctionReason, correctionReason);
    assert.ok(afterReturn.correctionRequestedAt);

    btContext = await browser.newContext();
    btPage = await btContext.newPage();
    await loginAndAssertSession(btPage, config.baseUrl, config.btEmail, config.btPassword);
    await openDashboard(btPage, config.baseUrl);
    await waitForText(btPage, CORRECTION_REQUIRED_LABEL);
    await btPage.getByText(correctionReason, { exact: true }).waitFor({ state: "visible", timeout: 15_000 });

    const btTasks = await loadBtTasks(config, btToken);
    const matchingTask = btTasks.find((task) => task.request_id === pendingFixture.requestId);
    assert.ok(matchingTask, "The correction task must be visible to the original BT.");
    assert.equal(String(matchingTask?.request_status), "correction_required");

    await openBtAmendmentModal(btPage, pendingFixture.clientName);
    const amendedProgress = `Corrected setting narrative ${config.marker}`;
    const freshSignature = `BT ${config.marker}`;
    await resubmitCorrectionThroughBrowser(btPage, amendedProgress, freshSignature);

    const afterResubmit = await readCorrectionLifecycleState(admin, pendingFixture);
    assert.equal(afterResubmit.requestStatus, "resubmitted");
    assert.equal(afterResubmit.assignedReviewerUserId, bcbaActor.id);
    assert.equal(afterResubmit.correctionResolvedAt !== null, true);
    assert.equal(afterResubmit.amendmentVersionNumber, 2);
    assert.equal(afterResubmit.amendmentCorrectionRound, 1);
    assert.equal(afterResubmit.resultingAmendmentId, afterResubmit.amendmentId);
    assert.equal(afterResubmit.amendmentResponses?.progress_toward_goals, amendedProgress);
    assert.equal(afterResubmit.originalBtAttestationCount, 1);

    await openDashboard(bcbaPage, config.baseUrl);
    await waitForText(bcbaPage, RESUBMITTED_LABEL);
    const reviewPackets = await loadReviewPackets(config, bcbaToken);
    const matchingPacket = reviewPackets.find((packet) => packet.request_id === pendingFixture.requestId);
    assert.ok(matchingPacket, "The resubmitted packet must remain visible to the assigned BCBA.");
    assert.equal(String(matchingPacket?.request_status), "resubmitted");
    assert.equal(String(matchingPacket?.supervision_template_id), supervisionTemplate.id);
    await openBcbaReviewModal(bcbaPage, pendingFixture.clientName);
    await completeReviewThroughBrowser(bcbaPage);

    await openDashboard(bcbaPage, config.baseUrl);
    await waitForText(bcbaPage, COMPLETED_LABEL);

    const afterCompletion = await readCorrectionLifecycleState(admin, pendingFixture);
    const originalNoteAfterCompletion = await admin.from("client_session_notes")
      .select("id, bt_aba_responses, bt_aba_template_snapshot, signed_at")
      .eq("id", pendingFixture.btNoteId)
      .eq("session_id", pendingFixture.sessionId)
      .eq("organization_id", pendingFixture.organizationId)
      .maybeSingle();
    if (originalNoteAfterCompletion.error || !originalNoteAfterCompletion.data?.id) {
      throw new Error(`Unable to re-read original BT note after completion: ${originalNoteAfterCompletion.error?.message ?? "missing note"}`);
    }
    assert.equal(afterCompletion.requestStatus, "completed");
    assert.equal(afterCompletion.assignedReviewerUserId, bcbaActor.id);
    assert.ok(afterCompletion.supervisionNoteId);
    assert.equal(afterCompletion.supervisionCompletedBy, bcbaActor.id);
    assert.equal(afterCompletion.bcbaAttestationCount, 1);
    assert.equal(afterCompletion.originalBtAttestationCount, 1);
    assert.equal(originalNoteAfterCompletion.data.id, pendingFixture.btNoteId, "Original signed packet must remain immutable.");
    assert.deepEqual(originalNoteAfterCompletion.data.bt_aba_responses ?? {}, pendingFixture.btResponses);
    assert.deepEqual(originalNoteAfterCompletion.data.bt_aba_template_snapshot ?? {}, pendingFixture.btTemplateSnapshot);
    assert.equal(originalNoteAfterCompletion.data.signed_at ?? null, pendingFixture.btSignedAt);

    console.log(JSON.stringify({
      ok: true,
      requestId: pendingFixture.requestId,
      correctionId: afterReturn.correctionId,
      amendmentId: afterResubmit.amendmentId,
      supervisionNoteId: afterCompletion.supervisionNoteId,
      labels: [PENDING_REVIEW_LABEL, CORRECTION_REQUIRED_LABEL, RESUBMITTED_LABEL, COMPLETED_LABEL],
      branchOwnership: config.branchOwnership,
    }));
  } catch (error) {
    runError = error;
    if (btPage) {
      screenshotPath = await captureCorrectionFailureScreenshot(btPage);
    } else if (bcbaPage) {
      screenshotPath = await captureCorrectionFailureScreenshot(bcbaPage);
    }
    console.error(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      screenshot: screenshotPath,
      projectRef: config.projectRef,
    }));
  } finally {
    await btContext?.close().catch(() => undefined);
    await bcbaContext?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await cleanupCorrectionLifecycle(admin, pendingFixture, supervisionTemplate).catch((cleanupError) => {
      if (!runError) runError = cleanupError;
      console.error(JSON.stringify({
        ok: false,
        warning: "correction-lifecycle-cleanup-failed",
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      }));
    });
    await cleanupBcbaFixture(admin, config.marker, bcbaFixture).catch((cleanupError) => {
      if (!runError) runError = cleanupError;
      console.error(JSON.stringify({
        ok: false,
        warning: "bcba-cleanup-failed",
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      }));
    });
  }

  if (runError) throw runError;
}

const isMainModule = (): boolean => Boolean(process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href);
if (isMainModule()) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
