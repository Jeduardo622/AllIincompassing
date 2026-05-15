import { readFileSync } from "node:fs";
import path from "node:path";

import {
  cleanupAssessmentImportArtifacts,
  deleteAssessmentStorageObject,
  type AssessmentImportCleanupTarget,
} from "./assessment-import-cleanup";
import { assertSmokeClientMarker, requireSmokeClientId } from "./assessment-upload-promote-smoke-guards";

type AssessmentStatus =
  | "uploaded"
  | "extracting"
  | "extracted"
  | "drafted"
  | "approved"
  | "rejected"
  | "extraction_failed";

type ChecklistItemStatus = "not_started" | "drafted" | "verified" | "approved";
type StructuredSectionStatus = "not_started" | "drafted" | "verified" | "approved" | "rejected";
type AcceptState = "pending" | "accepted" | "rejected" | "edited";

export type AssessmentDocumentRecord = {
  id: string;
  organization_id?: string | null;
  client_id: string;
  file_name: string;
  bucket_id?: string | null;
  object_path: string;
  status: AssessmentStatus;
  template_type?: string | null;
  created_at?: string | null;
};

type ChecklistResponse = {
  items: Array<{
    id: string;
    label: string;
    placeholder_key: string;
    required: boolean;
    status: ChecklistItemStatus;
    value_text: string | null;
  }>;
  structured_sections: Array<{
    id: string;
    field_key: string;
    section_key: string;
    section_index: number;
    payload: Record<string, unknown> | null;
    required: boolean;
    status: StructuredSectionStatus;
  }>;
};

type DraftResponse = {
  programs: Array<{
    id: string;
    name: string;
    description: string | null;
    accept_state: AcceptState;
  }>;
  goals: Array<{
    id: string;
    title: string;
    description: string;
    original_text: string;
    goal_type: "child" | "parent";
    accept_state: AcceptState;
  }>;
};

type ReadinessEvaluation = {
  ready: boolean;
  reasons: string[];
};

export type PdfSmokeAssessmentResolution = {
  assessmentDocumentId: string;
  source: "env" | "discovered" | "provisioned";
  cleanupTarget?: AssessmentImportCleanupTarget;
  cleanupGeneratedPdf?: {
    bucketId: string;
    objectPath: string;
  };
};

const DEFAULT_SAMPLE_FILE = path.resolve(
  process.cwd(),
  "7.21.2025_RoVa_CalOptima_FBA_FINAL (1).Redacted.docx.pdf",
);
const DEFAULT_BUCKET_ID = "client-documents";
const EXTRACTION_TIMEOUT_MS = 180_000;

const pause = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const resolveMimeType = (filePath: string): string => {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".pdf") return "application/pdf";
  if (extension === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return "application/octet-stream";
};

const escapeBody = async (response: Response): Promise<string> => {
  return response.text().catch(() => "");
};

const assertOk = async (response: Response, message: string): Promise<void> => {
  if (response.ok) return;
  const body = await escapeBody(response);
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

export const evaluatePdfSmokeAssessmentReadiness = (args: {
  document: AssessmentDocumentRecord;
  checklist: ChecklistResponse;
  drafts: DraftResponse;
}): ReadinessEvaluation => {
  const reasons: string[] = [];
  if (args.document.template_type && args.document.template_type !== "caloptima_fba") {
    reasons.push("template_type_not_caloptima");
  }
  if (["uploaded", "extracting", "extraction_failed"].includes(args.document.status)) {
    reasons.push(`document_status_${args.document.status}`);
  }
  const pendingChecklist = args.checklist.items.filter((item) => item.required && item.status !== "approved");
  if (pendingChecklist.length > 0) {
    reasons.push("required_checklist_pending");
  }
  const pendingStructuredSections = args.checklist.structured_sections.filter(
    (section) => section.required && section.status !== "approved",
  );
  if (pendingStructuredSections.length > 0) {
    reasons.push("required_structured_sections_pending");
  }
  if (!args.drafts.programs.some((program) => program.accept_state === "accepted" || program.accept_state === "edited")) {
    reasons.push("accepted_program_missing");
  }
  if (!args.drafts.goals.some((goal) => goal.accept_state === "accepted" || goal.accept_state === "edited")) {
    reasons.push("accepted_goal_missing");
  }
  return {
    ready: reasons.length === 0,
    reasons,
  };
};

const fetchAssessmentDocuments = async (args: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  accessToken: string;
  clientId?: string;
}): Promise<AssessmentDocumentRecord[]> => {
  const clientFilter = args.clientId ? `&client_id=eq.${encodeURIComponent(args.clientId)}` : "";
  return fetchJson<AssessmentDocumentRecord[]>(
    `${args.supabaseUrl}/rest/v1/assessment_documents?select=id,organization_id,client_id,file_name,bucket_id,object_path,status,template_type,created_at&template_type=eq.caloptima_fba${clientFilter}&order=created_at.desc&limit=25`,
    {
      method: "GET",
      anonKey: args.supabaseAnonKey,
      accessToken: args.accessToken,
    },
  );
};

const fetchAssessmentDocument = async (args: {
  baseUrl: string;
  accessToken: string;
  assessmentDocumentId: string;
}): Promise<AssessmentDocumentRecord> =>
  callAppJson<AssessmentDocumentRecord>(
    args.baseUrl,
    args.accessToken,
    `/api/assessment-documents?assessment_document_id=${encodeURIComponent(args.assessmentDocumentId)}`,
  );

const discoverReadyAssessmentDocument = async (args: {
  baseUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  accessToken: string;
  clientId?: string;
}): Promise<AssessmentDocumentRecord | null> => {
  const documents = await fetchAssessmentDocuments(args);
  for (const document of documents) {
    try {
      const [checklist, drafts] = await Promise.all([
        loadChecklist(args.baseUrl, args.accessToken, document.id),
        loadDrafts(args.baseUrl, args.accessToken, document.id),
      ]);
      const readiness = evaluatePdfSmokeAssessmentReadiness({
        document,
        checklist,
        drafts,
      });
      if (readiness.ready) {
        return document;
      }
    } catch {
      // Skip inaccessible or malformed candidates and keep discovery bounded.
    }
  }
  return null;
};

const selectProvisionClient = async (args: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  accessToken: string;
  requestedClientId: string;
}): Promise<{ clientId: string; clientName: string }> => {
  const clientId = requireSmokeClientId(args.requestedClientId);
  const clients = await fetchJson<Array<{ id: string; full_name: string | null }>>(
    `${args.supabaseUrl}/rest/v1/clients?select=id,full_name&id=eq.${encodeURIComponent(clientId)}&limit=1`,
    {
      method: "GET",
      anonKey: args.supabaseAnonKey,
      accessToken: args.accessToken,
    },
  );
  const client = clients[0];
  if (!client) {
    throw new Error(`Configured PW_ASSESSMENT_CLIENT_ID is not accessible: ${clientId}`);
  }
  assertSmokeClientMarker(client.full_name, client.id);
  return {
    clientId: client.id,
    clientName: client.full_name ?? client.id,
  };
};

const uploadAssessmentSource = async (args: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  accessToken: string;
  clientId: string;
  sampleFilePath: string;
}): Promise<{ fileName: string; mimeType: string; objectPath: string; fileSize: number }> => {
  const sourceFileBuffer = readFileSync(args.sampleFilePath);
  const sourceExtension = path.extname(args.sampleFilePath).toLowerCase();
  const sourceBaseName = path.basename(args.sampleFilePath, sourceExtension);
  const fileName = `${sourceBaseName}-pdf-smoke-${Date.now()}${sourceExtension}`;
  const objectPath = `clients/${args.clientId}/assessments/${fileName}`;
  const encodedObjectPath = objectPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const mimeType = resolveMimeType(args.sampleFilePath);
  const uploadResponse = await fetch(
    `${args.supabaseUrl}/storage/v1/object/${encodeURIComponent(DEFAULT_BUCKET_ID)}/${encodedObjectPath}`,
    {
      method: "POST",
      headers: {
        apikey: args.supabaseAnonKey,
        Authorization: `Bearer ${args.accessToken}`,
        "Content-Type": mimeType,
        "x-upsert": "false",
      },
      body: sourceFileBuffer,
    },
  );
  await assertOk(uploadResponse, "Assessment PDF smoke fixture upload failed");
  return {
    fileName,
    mimeType,
    objectPath,
    fileSize: sourceFileBuffer.byteLength,
  };
};

const createAssessmentDocument = async (args: {
  baseUrl: string;
  accessToken: string;
  clientId: string;
  fileName: string;
  mimeType: string;
  objectPath: string;
  fileSize: number;
}): Promise<AssessmentDocumentRecord> =>
  callAppJson<AssessmentDocumentRecord>(args.baseUrl, args.accessToken, "/api/assessment-documents", {
    method: "POST",
    body: JSON.stringify({
      client_id: args.clientId,
      file_name: args.fileName,
      mime_type: args.mimeType,
      file_size: args.fileSize,
      bucket_id: DEFAULT_BUCKET_ID,
      object_path: args.objectPath,
      template_type: "caloptima_fba",
    }),
  });

const waitForExtractedAssessment = async (args: {
  baseUrl: string;
  accessToken: string;
  assessmentDocumentId: string;
}): Promise<AssessmentDocumentRecord> => {
  const deadline = Date.now() + EXTRACTION_TIMEOUT_MS;
  let latest: AssessmentDocumentRecord | null = null;
  while (Date.now() < deadline) {
    latest = await fetchAssessmentDocument(args);
    if (!["uploaded", "extracting"].includes(latest.status)) {
      break;
    }
    await pause(2_000);
  }
  if (!latest) {
    throw new Error(`Provisioned assessment document ${args.assessmentDocumentId} was not found.`);
  }
  if (latest.status !== "extracted") {
    throw new Error(
      `Provisioned assessment document ${latest.id} ended with ${latest.status}.`,
    );
  }
  return latest;
};

const approveChecklistAndStructuredSections = async (args: {
  baseUrl: string;
  accessToken: string;
  checklist: ChecklistResponse;
}): Promise<void> => {
  for (const item of args.checklist.items) {
    if (!item.required || item.status === "approved") continue;
    await callAppJson(args.baseUrl, args.accessToken, "/api/assessment-checklist", {
      method: "PATCH",
      body: JSON.stringify({
        item_id: item.id,
        status: "approved",
        review_notes: "PDF smoke auto-approved required checklist row from redacted fixture.",
        value_text: item.value_text?.trim() || `PDF smoke reviewed value for ${item.label}`,
      }),
    });
  }

  for (const section of args.checklist.structured_sections) {
    if (!section.required || section.status === "approved") continue;
    if (!section.payload || Object.keys(section.payload).length === 0) {
      throw new Error(`Structured section ${section.id} is required but has no payload.`);
    }
    await callAppJson(args.baseUrl, args.accessToken, "/api/assessment-checklist", {
      method: "PATCH",
      body: JSON.stringify({
        structured_section_id: section.id,
        status: "approved",
        review_notes: "PDF smoke auto-approved required structured section from redacted fixture.",
        payload: section.payload,
      }),
    });
  }
};

const generateDrafts = async (baseUrl: string, accessToken: string, assessmentDocumentId: string): Promise<void> => {
  await callAppJson(baseUrl, accessToken, "/api/assessment-drafts", {
    method: "POST",
    body: JSON.stringify({
      assessment_document_id: assessmentDocumentId,
      auto_generate: true,
    }),
  });
};

const acceptDrafts = async (baseUrl: string, accessToken: string, drafts: DraftResponse): Promise<void> => {
  for (const program of drafts.programs) {
    await callAppJson(baseUrl, accessToken, "/api/assessment-drafts", {
      method: "PATCH",
      body: JSON.stringify({
        draft_type: "program",
        id: program.id,
        accept_state: "accepted",
        review_notes: "PDF smoke accepted draft program.",
        name: program.name,
        description: program.description ?? "PDF smoke accepted draft program.",
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
        review_notes: "PDF smoke accepted draft goal.",
        title: goal.title,
        description: goal.description,
        original_text: goal.original_text,
        goal_type: goal.goal_type,
      }),
    });
  }
};

const provisionReadyAssessmentDocument = async (args: {
  baseUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  accessToken: string;
  provisionClientId: string;
  sampleFilePath?: string;
}): Promise<PdfSmokeAssessmentResolution> => {
  const { clientId, clientName } = await selectProvisionClient({
    supabaseUrl: args.supabaseUrl,
    supabaseAnonKey: args.supabaseAnonKey,
    accessToken: args.accessToken,
    requestedClientId: args.provisionClientId,
  });
  const sampleFilePath = args.sampleFilePath ? path.resolve(process.cwd(), args.sampleFilePath) : DEFAULT_SAMPLE_FILE;
  let upload:
    | {
        fileName: string;
        mimeType: string;
        objectPath: string;
        fileSize: number;
      }
    | null = null;
  let createdAssessment: AssessmentDocumentRecord | null = null;

  try {
    upload = await uploadAssessmentSource({
      supabaseUrl: args.supabaseUrl,
      supabaseAnonKey: args.supabaseAnonKey,
      accessToken: args.accessToken,
      clientId,
      sampleFilePath,
    });
    createdAssessment = await createAssessmentDocument({
      baseUrl: args.baseUrl,
      accessToken: args.accessToken,
      clientId,
      fileName: upload.fileName,
      mimeType: upload.mimeType,
      objectPath: upload.objectPath,
      fileSize: upload.fileSize,
    });
    const extractedAssessment = await waitForExtractedAssessment({
      baseUrl: args.baseUrl,
      accessToken: args.accessToken,
      assessmentDocumentId: createdAssessment.id,
    });
    const checklist = await loadChecklist(args.baseUrl, args.accessToken, extractedAssessment.id);
    await approveChecklistAndStructuredSections({
      baseUrl: args.baseUrl,
      accessToken: args.accessToken,
      checklist,
    });
    await generateDrafts(args.baseUrl, args.accessToken, extractedAssessment.id);
    const drafts = await loadDrafts(args.baseUrl, args.accessToken, extractedAssessment.id);
    if (drafts.programs.length === 0 || drafts.goals.length === 0) {
      throw new Error(
        `Provisioned PDF smoke fixture on ${clientName} did not generate any draft programs/goals.`,
      );
    }
    await acceptDrafts(args.baseUrl, args.accessToken, drafts);
    const acceptedDrafts = await loadDrafts(args.baseUrl, args.accessToken, extractedAssessment.id);
    const readiness = evaluatePdfSmokeAssessmentReadiness({
      document: extractedAssessment,
      checklist: await loadChecklist(args.baseUrl, args.accessToken, extractedAssessment.id),
      drafts: acceptedDrafts,
    });
    if (!readiness.ready) {
      throw new Error(
        `Provisioned PDF smoke fixture is not ready for generation: ${readiness.reasons.join(", ")}`,
      );
    }
    return {
      assessmentDocumentId: extractedAssessment.id,
      source: "provisioned",
      cleanupTarget: {
        assessmentDocumentId: extractedAssessment.id,
        bucketId: extractedAssessment.bucket_id?.trim() || DEFAULT_BUCKET_ID,
        objectPath: extractedAssessment.object_path,
      },
    };
  } catch (error) {
    if (createdAssessment) {
      await cleanupAssessmentImportArtifacts({
        baseUrl: args.baseUrl,
        supabaseUrl: args.supabaseUrl,
        supabaseAnonKey: args.supabaseAnonKey,
        accessToken: args.accessToken,
        target: {
          assessmentDocumentId: createdAssessment.id,
          bucketId: createdAssessment.bucket_id?.trim() || DEFAULT_BUCKET_ID,
          objectPath: createdAssessment.object_path,
        },
      }).catch(() => undefined);
    } else if (upload) {
      await deleteAssessmentStorageObject(fetch, {
        supabaseUrl: args.supabaseUrl,
        supabaseAnonKey: args.supabaseAnonKey,
        accessToken: args.accessToken,
        bucketId: DEFAULT_BUCKET_ID,
        objectPath: upload.objectPath,
      }).catch(() => undefined);
    }
    throw error;
  }
};

export const resolveAssessmentDocumentForPdfSmoke = async (args: {
  baseUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  accessToken: string;
  preferredAssessmentDocumentId?: string;
  provisionClientId?: string;
  sampleFilePath?: string;
}): Promise<PdfSmokeAssessmentResolution> => {
  const preferredAssessmentDocumentId = args.preferredAssessmentDocumentId?.trim();
  if (preferredAssessmentDocumentId) {
    return {
      assessmentDocumentId: preferredAssessmentDocumentId,
      source: "env",
    };
  }

  const discovered = await discoverReadyAssessmentDocument({
    baseUrl: args.baseUrl,
    supabaseUrl: args.supabaseUrl,
    supabaseAnonKey: args.supabaseAnonKey,
    accessToken: args.accessToken,
    clientId: args.provisionClientId?.trim() || undefined,
  });
  if (discovered) {
    return {
      assessmentDocumentId: discovered.id,
      source: "discovered",
    };
  }

  const provisionClientId = args.provisionClientId?.trim();
  if (!provisionClientId) {
    throw new Error(
      "No ready CalOptima assessment document was discovered for PDF smoke. Set PW_ASSESSMENT_CLIENT_ID to a dedicated smoke client so the harness can provision its own temporary fixture safely.",
    );
  }

  return provisionReadyAssessmentDocument({
    ...args,
    provisionClientId,
  });
};

export const cleanupProvisionedAssessmentPdfSmokeArtifacts = async (args: {
  baseUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  accessToken: string;
  resolution: PdfSmokeAssessmentResolution;
}): Promise<void> => {
  if (args.resolution.cleanupGeneratedPdf) {
    await deleteAssessmentStorageObject(fetch, {
      supabaseUrl: args.supabaseUrl,
      supabaseAnonKey: args.supabaseAnonKey,
      accessToken: args.accessToken,
      bucketId: args.resolution.cleanupGeneratedPdf.bucketId,
      objectPath: args.resolution.cleanupGeneratedPdf.objectPath,
    });
  }
  if (args.resolution.cleanupTarget) {
    await cleanupAssessmentImportArtifacts({
      baseUrl: args.baseUrl,
      supabaseUrl: args.supabaseUrl,
      supabaseAnonKey: args.supabaseAnonKey,
      accessToken: args.accessToken,
      target: args.resolution.cleanupTarget,
    });
  }
};
