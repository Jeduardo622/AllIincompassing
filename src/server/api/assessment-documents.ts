import { z } from "zod";
import {
  corsHeadersForRequest,
  fetchJson,
  getAccessToken,
  getAccessTokenSubject,
  getSupabaseConfig,
  jsonForRequest,
  resolveOrgAndRole,
} from "./shared";
import {
  loadChecklistTemplateRows,
  type AssessmentChecklistSeedRow,
  type AssessmentTemplateType,
} from "../assessmentChecklistTemplate";
import { getRequiredServerEnv } from "../env";
import { serverLogger } from "../../lib/logger/server";

const SUPPORTED_TEMPLATE_TYPES = ["caloptima_fba", "iehp_fba"] as const;
const ASSESSMENT_DOCUMENT_BUCKET_ID = "client-documents";
const EXTRACTION_WORKFLOW_TIMEOUT_MS = 55_000;

const templateTypeSchema = z.enum(SUPPORTED_TEMPLATE_TYPES);

const assessmentDocumentCreateSchema = z.object({
  client_id: z.string().uuid(),
  file_name: z.string().trim().min(1),
  mime_type: z.string().trim().min(1),
  file_size: z.number().int().nonnegative(),
  bucket_id: z.string().trim().min(1).optional(),
  object_path: z.string().trim().min(1),
  template_type: templateTypeSchema.optional(),
});

const isUuid = (value: string): boolean => z.string().uuid().safeParse(value).success;

const isAllowedAssessmentObjectPath = (objectPath: string, clientId: string): boolean => {
  const normalized = objectPath.trim();
  if (normalized.includes("..") || normalized.includes("\\")) return false;
  return /^clients\/[^/]+\/assessments\/[^/]+\.(pdf|docx)$/i.test(normalized) &&
    normalized.startsWith(`clients/${clientId}/assessments/`);
};

interface AssessmentDocumentRow {
  id: string;
  organization_id: string;
  client_id: string;
  status: string;
  created_at: string;
}

interface AssessmentDocumentExtractionRow {
  id: string;
  organization_id: string;
  client_id: string;
  status: string;
  template_type: AssessmentTemplateType;
  bucket_id: string | null;
  object_path: string | null;
}

interface AssessmentDocumentDeleteRow {
  id: string;
  organization_id: string;
  client_id: string;
  bucket_id: string | null;
  object_path: string | null;
}

interface ClientSnapshotRow {
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  date_of_birth?: string | null;
  cin_number?: string | null;
  client_id?: string | null;
  phone?: string | null;
  parent1_phone?: string | null;
  parent1_first_name?: string | null;
  parent1_last_name?: string | null;
}

const compactNullableRecord = <T extends Record<string, unknown>>(value: T): Partial<T> =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined)) as Partial<T>;

interface ExtractionFieldResult {
  placeholder_key: string;
  value_text: string | null;
  value_json: Record<string, unknown> | null;
  confidence: number | null;
  mode: "AUTO" | "ASSISTED" | "MANUAL";
  status: "not_started" | "drafted" | "verified" | "approved";
  source_span: Record<string, unknown> | null;
  review_notes: string | null;
}

interface ExtractionFunctionResponse {
  error?: string;
  extraction_provider?: string;
  adobe_element_count?: number | null;
  adobe_table_count?: number | null;
  structured_section_count?: number;
  structured_child_goal_count?: number;
  structured_parent_goal_count?: number;
  fields: ExtractionFieldResult[];
  structured_sections?: Array<{
    section_key: string;
    field_key: string;
    section_index: number;
    payload: Record<string, unknown>;
    source_span: Record<string, unknown> | null;
    status: "not_started" | "drafted" | "verified" | "approved";
    required: boolean;
    review_notes: string | null;
  }>;
  unresolved_keys: string[];
  extracted_count: number;
  unresolved_count: number;
}

const extractionFieldResultSchema = z.object({
  placeholder_key: z.string().min(1),
  value_text: z.string().nullable(),
  value_json: z.record(z.unknown()).nullable(),
  confidence: z.number().nullable(),
  mode: z.enum(["AUTO", "ASSISTED", "MANUAL"]),
  status: z.enum(["not_started", "drafted", "verified", "approved"]),
  source_span: z.record(z.unknown()).nullable(),
  review_notes: z.string().nullable(),
});

const structuredSectionResultSchema = z.object({
  section_key: z.string().min(1),
  field_key: z.string().min(1),
  section_index: z.number().int().nonnegative(),
  payload: z.record(z.unknown()),
  source_span: z.record(z.unknown()).nullable(),
  status: z.enum(["not_started", "drafted", "verified", "approved"]),
  required: z.boolean(),
  review_notes: z.string().nullable(),
});

const extractionFunctionResponseSchema: z.ZodType<ExtractionFunctionResponse> = z.object({
  error: z.string().optional(),
  extraction_provider: z.string().optional(),
  adobe_element_count: z.number().nullable().optional(),
  adobe_table_count: z.number().nullable().optional(),
  structured_section_count: z.number().int().nonnegative().optional(),
  structured_child_goal_count: z.number().int().nonnegative().optional(),
  structured_parent_goal_count: z.number().int().nonnegative().optional(),
  fields: z.array(extractionFieldResultSchema),
  structured_sections: z.array(structuredSectionResultSchema).optional(),
  unresolved_keys: z.array(z.string()),
  extracted_count: z.number().int().nonnegative(),
  unresolved_count: z.number().int().nonnegative(),
});

type ExtractionWorkflowResult = {
  status: "extracted" | "extraction_failed";
  extractionError: string | null;
};

type CaloptimaExtractionWorkflowArgs = {
  supabaseUrl: string;
  headers: Record<string, string>;
  organizationId: string;
  actorId: string | null;
  createdDocumentId: string;
  clientId: string;
  checklistRows: AssessmentChecklistSeedRow[];
  bucketId: string;
  objectPath: string;
  signal?: AbortSignal;
};

type CaloptimaExtractionScheduleArgs = Omit<CaloptimaExtractionWorkflowArgs, "signal"> & {
  request: Request;
  accessToken: string;
};

type CaloptimaExtractionScheduleResult = {
  ok: boolean;
  status?: number;
};

type AssessmentDocumentsHandlerOptions = {
  scheduleCaloptimaExtraction?: (args: CaloptimaExtractionScheduleArgs) => Promise<CaloptimaExtractionScheduleResult>;
};

class ExtractionWorkflowError extends Error {
  readonly reasonCode: string;
  readonly status?: number;
  readonly publicMessage: string;

  constructor(reasonCode: string, message = reasonCode, status?: number, publicMessage = "Field extraction failed. Review checklist manually.") {
    super(message);
    this.name = "ExtractionWorkflowError";
    this.reasonCode = reasonCode;
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

const asExtractionWorkflowError = (error: unknown, signal?: AbortSignal): ExtractionWorkflowError => {
  if (error instanceof ExtractionWorkflowError) return error;
  if (signal?.aborted) {
    return signal.reason instanceof ExtractionWorkflowError
      ? signal.reason
      : new ExtractionWorkflowError("extraction_workflow_timeout", "extraction_workflow_timeout", 504, "Extraction timed out before completion.");
  }
  return new ExtractionWorkflowError("extraction_workflow_failed", "Field extraction failed. Review checklist manually.");
};

const assertFetchOk = (result: { ok: boolean; status?: number }, reasonCode: string): void => {
  if (!result.ok) {
    throw new ExtractionWorkflowError(reasonCode, reasonCode, result.status);
  }
};

const assertExtractionNotAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw asExtractionWorkflowError(signal.reason, signal);
  }
};

const processInBatches = async <T,>(
  items: T[],
  batchSize: number,
  handler: (item: T) => Promise<void>,
): Promise<void> => {
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    await Promise.all(batch.map((item) => handler(item)));
  }
};

const runBoundedCaloptimaExtractionWorkflow = async (args: Omit<CaloptimaExtractionWorkflowArgs, "signal">): Promise<void> => {
  const extractionController = new AbortController();
  const extractionTimeoutId = setTimeout(() => {
    extractionController.abort(
      new ExtractionWorkflowError(
        "extraction_workflow_timeout",
        "extraction_workflow_timeout",
        504,
        "Extraction timed out before completion.",
      ),
    );
  }, EXTRACTION_WORKFLOW_TIMEOUT_MS);

  try {
    await runCaloptimaExtractionWorkflow({ ...args, signal: extractionController.signal });
  } finally {
    clearTimeout(extractionTimeoutId);
  }
};

const scheduleInProcessCaloptimaExtraction = async (
  args: CaloptimaExtractionScheduleArgs,
): Promise<CaloptimaExtractionScheduleResult> => {
  setTimeout(() => {
    void runBoundedCaloptimaExtractionWorkflow(args).catch((error) => {
      serverLogger.error("assessment-documents scheduled extraction failed", {
        reasonCode: error instanceof ExtractionWorkflowError ? error.reasonCode : "scheduled_extraction_failed",
      });
    });
  }, 0);

  return { ok: true, status: 202 };
};

const templateTypeToDisplayLabel = (templateType: AssessmentTemplateType): string => {
  if (templateType === "iehp_fba") {
    return "IEHP FBA";
  }
  return "CalOptima FBA";
};

const persistExtractionFailure = async (args: {
  supabaseUrl: string;
  headers: Record<string, string>;
  organizationId: string;
  actorId: string | null;
  createdDocumentId: string;
  clientId: string;
  error: ExtractionWorkflowError;
}): Promise<ExtractionWorkflowResult> => {
  const { supabaseUrl, headers, organizationId, actorId, createdDocumentId, clientId, error } = args;
  const extractionError = error.publicMessage;
  const updatedAt = new Date().toISOString();

  const documentPatchResult = await fetchJson(
    `${supabaseUrl}/rest/v1/assessment_documents?id=eq.${encodeURIComponent(createdDocumentId)}`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        status: "extraction_failed",
        extraction_error: extractionError,
        updated_at: updatedAt,
      }),
    },
  );
  assertFetchOk(documentPatchResult, "extraction_failure_status_update_failed");

  const reviewEventResult = await fetchJson(`${supabaseUrl}/rest/v1/assessment_review_events`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      assessment_document_id: createdDocumentId,
      organization_id: organizationId,
      client_id: clientId,
      item_type: "document",
      item_id: createdDocumentId,
      action: "extraction_failed",
      from_status: "extracting",
      to_status: "extraction_failed",
      actor_id: actorId,
      event_payload: {
        reason_code: error.reasonCode,
        status: error.status ?? null,
      },
    }),
  });
  assertFetchOk(reviewEventResult, "extraction_failure_review_event_failed");

  return { status: "extraction_failed", extractionError };
};

export const persistCaloptimaExtractionScheduleFailure = async (
  args: Omit<CaloptimaExtractionWorkflowArgs, "checklistRows" | "bucketId" | "objectPath" | "signal">,
): Promise<ExtractionWorkflowResult> =>
  persistExtractionFailure({
    ...args,
    error: new ExtractionWorkflowError(
      "extraction_background_schedule_failed",
      "extraction_background_schedule_failed",
      500,
      "Unable to start extraction. Retry the upload or contact support.",
    ),
  });

const runCaloptimaExtractionWorkflow = async (args: CaloptimaExtractionWorkflowArgs): Promise<ExtractionWorkflowResult> => {
  const { supabaseUrl, headers, organizationId, actorId, createdDocumentId, clientId, checklistRows, bucketId, objectPath, signal } =
    args;
  try {
    assertExtractionNotAborted(signal);
    const clientSnapshotResult = await fetchJson<ClientSnapshotRow[]>(
      `${supabaseUrl}/rest/v1/clients?select=full_name,first_name,last_name,date_of_birth,cin_number,client_id,phone,parent1_phone,parent1_first_name,parent1_last_name&id=eq.${encodeURIComponent(
        clientId,
      )}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`,
      { method: "GET", headers, signal },
    );
    assertFetchOk(clientSnapshotResult, "client_snapshot_load_failed");
    assertExtractionNotAborted(signal);
    const clientSnapshotRow =
      clientSnapshotResult.ok && Array.isArray(clientSnapshotResult.data) && clientSnapshotResult.data[0]
        ? clientSnapshotResult.data[0]
        : null;
    const clientSnapshot = clientSnapshotRow ? compactNullableRecord(clientSnapshotRow) : undefined;

    const extractionResult = await fetchJson<ExtractionFunctionResponse>(`${supabaseUrl}/functions/v1/extract-assessment-fields`, {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify({
        assessment_document_id: createdDocumentId,
        template_type: "caloptima_fba",
        bucket_id: bucketId,
        object_path: objectPath,
        checklist_rows: checklistRows.map((row) => ({
          section: row.section,
          label: row.label,
          placeholder_key: row.placeholder_key,
          required: row.required,
          extraction_aliases: row.extraction_aliases ?? [],
        })),
        client_snapshot: clientSnapshot,
      }),
    });
    assertExtractionNotAborted(signal);

    if (extractionResult.ok && extractionResult.data) {
      const parsedExtraction = extractionFunctionResponseSchema.safeParse(extractionResult.data);
      if (!parsedExtraction.success) {
        throw new ExtractionWorkflowError(
          "invalid_extraction_response",
          "invalid_extraction_response",
          extractionResult.status,
          "Extraction returned an unexpected response shape.",
        );
      }
      const extractionData = parsedExtraction.data;

      await processInBatches(extractionData.fields, 10, async (field) => {
        const reviewNotesParts = [
          field.review_notes ?? null,
          typeof field.confidence === "number" ? `Confidence: ${field.confidence.toFixed(2)}` : null,
          `Mode: ${field.mode}`,
        ].filter(Boolean) as string[];
        const mergedReviewNotes = reviewNotesParts.length > 0 ? reviewNotesParts.join(" | ") : null;
        const updatedAt = new Date().toISOString();

        const [checklistPatchResult, extractionPatchResult] = await Promise.all([
          fetchJson(
            `${supabaseUrl}/rest/v1/assessment_checklist_items?assessment_document_id=eq.${encodeURIComponent(
              createdDocumentId,
            )}&placeholder_key=eq.${encodeURIComponent(field.placeholder_key)}&organization_id=eq.${encodeURIComponent(
              organizationId,
            )}`,
            {
              method: "PATCH",
              headers,
              signal,
              body: JSON.stringify({
                value_text: field.value_text,
                value_json: field.value_json,
                status: field.status,
                review_notes: mergedReviewNotes,
                updated_at: updatedAt,
              }),
            },
          ),
          fetchJson(
            `${supabaseUrl}/rest/v1/assessment_extractions?assessment_document_id=eq.${encodeURIComponent(
              createdDocumentId,
            )}&field_key=eq.${encodeURIComponent(field.placeholder_key)}&organization_id=eq.${encodeURIComponent(
              organizationId,
            )}`,
            {
              method: "PATCH",
              headers,
              signal,
              body: JSON.stringify({
                value_text: field.value_text,
                value_json: field.value_json,
                confidence: field.confidence,
                source_span: field.source_span,
                mode: field.mode,
                status: field.status,
                review_notes: field.review_notes,
                updated_at: updatedAt,
              }),
            },
          ),
        ]);
        assertExtractionNotAborted(signal);
        assertFetchOk(checklistPatchResult, "checklist_patch_failed");
        assertFetchOk(extractionPatchResult, "extraction_patch_failed");
      });
      const structuredSections = extractionData.structured_sections ?? [];
      if (structuredSections.length > 0) {
        const serviceRoleKey = getRequiredServerEnv("SUPABASE_SERVICE_ROLE_KEY");
        const serviceHeaders = {
          "Content-Type": "application/json",
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        };
        const structuredInsertResult = await fetchJson(`${supabaseUrl}/rest/v1/assessment_structured_sections`, {
          method: "POST",
          headers: serviceHeaders,
          signal,
          body: JSON.stringify(
            structuredSections.map((section) => ({
              assessment_document_id: createdDocumentId,
              organization_id: organizationId,
              client_id: clientId,
              section_key: section.section_key,
              field_key: section.field_key,
              section_index: section.section_index,
              payload: section.payload,
              source_span: section.source_span,
              status: section.status,
              required: section.required,
              review_notes: section.review_notes,
            })),
          ),
        });
        assertExtractionNotAborted(signal);
        assertFetchOk(structuredInsertResult, "structured_section_persistence_failed");
      }

      const documentExtractedResult = await fetchJson(`${supabaseUrl}/rest/v1/assessment_documents?id=eq.${encodeURIComponent(createdDocumentId)}`, {
        method: "PATCH",
        headers,
        signal,
        body: JSON.stringify({
          status: "extracted",
          extracted_at: new Date().toISOString(),
          extraction_error: null,
          updated_at: new Date().toISOString(),
        }),
      });
      assertExtractionNotAborted(signal);
      assertFetchOk(documentExtractedResult, "assessment_status_update_failed");

      const reviewEventResult = await fetchJson(`${supabaseUrl}/rest/v1/assessment_review_events`, {
        method: "POST",
        headers,
        signal,
        body: JSON.stringify({
          assessment_document_id: createdDocumentId,
          organization_id: organizationId,
          client_id: clientId,
          item_type: "document",
          item_id: createdDocumentId,
          action: "extraction_completed",
          from_status: "extracting",
          to_status: "extracted",
          actor_id: actorId,
          event_payload: {
            extracted_count: extractionData.extracted_count,
            unresolved_count: extractionData.unresolved_count,
            unresolved_keys: extractionData.unresolved_keys,
            structured_section_count: structuredSections.length,
            extraction_provider: extractionData.extraction_provider ?? null,
            adobe_element_count: extractionData.adobe_element_count ?? null,
            adobe_table_count: extractionData.adobe_table_count ?? null,
          },
        }),
      });
      assertExtractionNotAborted(signal);
      assertFetchOk(reviewEventResult, "review_event_persistence_failed");
      return { status: "extracted", extractionError: null };
    }

    const edgeError =
      typeof extractionResult.data?.error === "string" && extractionResult.data.error.trim().length > 0
        ? extractionResult.data.error.trim()
        : "edge_extraction_failed";
    throw new ExtractionWorkflowError("edge_extraction_failed", edgeError, extractionResult.status);
  } catch (error) {
    const workflowError = asExtractionWorkflowError(error, signal);
    serverLogger.error("assessment-documents extraction workflow failed", {
      reasonCode: workflowError.reasonCode,
      status: workflowError.status ?? null,
    });
    return persistExtractionFailure({ ...args, error: workflowError });
  }
};

export async function assessmentDocumentsExtractionBackgroundHandler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return jsonForRequest(request, { error: "Method not allowed" }, 405);
  }

  const accessToken = getAccessToken(request);
  if (!accessToken) {
    return jsonForRequest(request, { error: "Missing authorization token" }, 401, { "WWW-Authenticate": "Bearer" });
  }

  const { organizationId, isTherapist, isAdmin, isSuperAdmin } = await resolveOrgAndRole(accessToken);
  if (!organizationId || (!isTherapist && !isAdmin && !isSuperAdmin)) {
    return jsonForRequest(request, { error: "Forbidden" }, 403);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonForRequest(request, { error: "Invalid JSON body" }, 400);
  }

  const parsed = z.object({ assessment_document_id: z.string().uuid() }).safeParse(payload);
  if (!parsed.success) {
    return jsonForRequest(request, { error: "Invalid request body" }, 400);
  }

  const { supabaseUrl, anonKey } = getSupabaseConfig();
  const headers = {
    "Content-Type": "application/json",
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
  };

  const documentResult = await fetchJson<AssessmentDocumentExtractionRow[]>(
    `${supabaseUrl}/rest/v1/assessment_documents?select=id,organization_id,client_id,status,template_type,bucket_id,object_path&id=eq.${encodeURIComponent(
      parsed.data.assessment_document_id,
    )}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`,
    { method: "GET", headers },
  );
  if (!documentResult.ok) {
    return jsonForRequest(request, { error: "Failed to load assessment document" }, documentResult.status || 500);
  }

  const document = Array.isArray(documentResult.data) ? documentResult.data[0] ?? null : null;
  if (!document) {
    return jsonForRequest(request, { error: "assessment_document_id is not in scope for this organization" }, 403);
  }
  if (document.template_type !== "caloptima_fba") {
    return jsonForRequest(request, { error: "Only CalOptima FBA extraction can be run by this worker." }, 400);
  }
  if (document.status !== "extracting") {
    return jsonForRequest(request, { skipped: true, status: document.status }, 202);
  }
  if (!document.bucket_id || !document.object_path) {
    const actorId = getAccessTokenSubject(accessToken);
    const failure = new ExtractionWorkflowError(
      "assessment_document_storage_missing",
      "assessment_document_storage_missing",
      400,
      "Assessment document storage metadata is missing.",
    );
    await persistExtractionFailure({
      supabaseUrl,
      headers,
      organizationId,
      actorId,
      createdDocumentId: document.id,
      clientId: document.client_id,
      error: failure,
    });
    return jsonForRequest(request, { error: failure.publicMessage }, 400);
  }

  const actorId = getAccessTokenSubject(accessToken);
  const checklistRows = await loadChecklistTemplateRows(document.template_type);
  await runBoundedCaloptimaExtractionWorkflow({
    supabaseUrl,
    headers,
    organizationId,
    actorId,
    createdDocumentId: document.id,
    clientId: document.client_id,
    checklistRows,
    bucketId: document.bucket_id,
    objectPath: document.object_path,
  });

  return jsonForRequest(request, { accepted: true }, 202);
}

export async function assessmentDocumentsHandler(
  request: Request,
  options: AssessmentDocumentsHandlerOptions = {},
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: { ...corsHeadersForRequest(request) } });
  }

  const accessToken = getAccessToken(request);
  if (!accessToken) {
    return jsonForRequest(request, { error: "Missing authorization token" }, 401, { "WWW-Authenticate": "Bearer" });
  }

  const { organizationId, isTherapist, isAdmin, isSuperAdmin } = await resolveOrgAndRole(accessToken);
  if (!organizationId || (!isTherapist && !isAdmin && !isSuperAdmin)) {
    return jsonForRequest(request, { error: "Forbidden" }, 403);
  }

  const { supabaseUrl, anonKey } = getSupabaseConfig();
  const headers = {
    "Content-Type": "application/json",
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
  };

  const clientExistsInOrg = async (clientId: string): Promise<boolean> => {
    const clientLookupUrl = `${supabaseUrl}/rest/v1/clients?select=id&id=eq.${encodeURIComponent(
      clientId,
    )}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`;
    const lookupResult = await fetchJson<Array<{ id: string }>>(clientLookupUrl, { method: "GET", headers });
    return lookupResult.ok && Array.isArray(lookupResult.data) && lookupResult.data.length > 0;
  };

  if (request.method === "GET") {
    const url = new URL(request.url);
    const clientId = url.searchParams.get("client_id");
    const assessmentDocumentId = url.searchParams.get("assessment_document_id");
    const baseQuery = `organization_id=eq.${encodeURIComponent(organizationId)}`;

    if (clientId) {
      if (!isUuid(clientId)) {
        return jsonForRequest(request, { error: "client_id must be a valid UUID" }, 400);
      }
      const clientExists = await clientExistsInOrg(clientId);
      if (!clientExists) {
        return jsonForRequest(request, { error: "client_id is not in scope for this organization" }, 403);
      }
      const urlValue = `${supabaseUrl}/rest/v1/assessment_documents?select=*&${baseQuery}&client_id=eq.${encodeURIComponent(
        clientId,
      )}&order=created_at.desc`;
      const result = await fetchJson(urlValue, { method: "GET", headers });
      if (!result.ok) {
        return jsonForRequest(request, { error: "Failed to load assessment documents" }, result.status || 500);
      }
      return jsonForRequest(request, result.data ?? []);
    }

    if (assessmentDocumentId) {
      if (!isUuid(assessmentDocumentId)) {
        return jsonForRequest(request, { error: "assessment_document_id must be a valid UUID" }, 400);
      }
      const urlValue = `${supabaseUrl}/rest/v1/assessment_documents?select=*&${baseQuery}&id=eq.${encodeURIComponent(
        assessmentDocumentId,
      )}&limit=1`;
      const result = await fetchJson<Array<Record<string, unknown>>>(urlValue, { method: "GET", headers });
      if (!result.ok) {
        return jsonForRequest(request, { error: "Failed to load assessment document" }, result.status || 500);
      }
      const assessmentDocument = Array.isArray(result.data) ? result.data[0] ?? null : null;
      if (!assessmentDocument) {
        return jsonForRequest(request, { error: "assessment_document_id is not in scope for this organization" }, 403);
      }
      return jsonForRequest(request, assessmentDocument);
    }

    return jsonForRequest(request, { error: "client_id or assessment_document_id is required" }, 400);
  }

  if (request.method === "POST") {
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return jsonForRequest(request, { error: "Invalid JSON body" }, 400);
    }

    const parsed = assessmentDocumentCreateSchema.safeParse(payload);
    if (!parsed.success) {
      return jsonForRequest(request, { error: "Invalid request body" }, 400);
    }

    const clientExists = await clientExistsInOrg(parsed.data.client_id);
    if (!clientExists) {
      return jsonForRequest(request, { error: "client_id is not in scope for this organization" }, 403);
    }
    if (parsed.data.bucket_id && parsed.data.bucket_id !== ASSESSMENT_DOCUMENT_BUCKET_ID) {
      return jsonForRequest(request, { error: "Assessment documents must be uploaded to the approved bucket." }, 400);
    }
    if (!isAllowedAssessmentObjectPath(parsed.data.object_path, parsed.data.client_id)) {
      return jsonForRequest(request, { error: "Assessment document path is outside the allowed client scope." }, 400);
    }

    const actorId = getAccessTokenSubject(accessToken);
    const templateType = parsed.data.template_type ?? "caloptima_fba";
    if (templateType === "iehp_fba") {
      return jsonForRequest(
        request,
        { error: "IEHP FBA upload extraction is not currently supported. Use CalOptima FBA for document upload extraction." },
        501,
      );
    }
    const createPayload = {
      organization_id: organizationId,
      client_id: parsed.data.client_id,
      uploaded_by: actorId,
      template_type: templateType,
      file_name: parsed.data.file_name,
      mime_type: parsed.data.mime_type,
      file_size: parsed.data.file_size,
      bucket_id: ASSESSMENT_DOCUMENT_BUCKET_ID,
      object_path: parsed.data.object_path,
      status: "uploaded",
    };

    const createResult = await fetchJson<AssessmentDocumentRow[]>(
      `${supabaseUrl}/rest/v1/assessment_documents`,
      {
        method: "POST",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify(createPayload),
      },
    );

    if (!createResult.ok || !Array.isArray(createResult.data) || !createResult.data[0]) {
      return jsonForRequest(request, { error: "Failed to create assessment document" }, createResult.status || 500);
    }

    const createdDocument = createResult.data[0];

    let checklistRows: AssessmentChecklistSeedRow[];
    try {
      checklistRows = await loadChecklistTemplateRows(templateType);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load checklist template rows.";
      return jsonForRequest(request, { error: message }, 500);
    }
    const checklistInsertPayload = checklistRows.map((row) => ({
      assessment_document_id: createdDocument.id,
      organization_id: organizationId,
      client_id: parsed.data.client_id,
      section_key: row.section,
      label: row.label,
      placeholder_key: row.placeholder_key,
      mode: row.mode,
      source: row.source,
      required: row.required,
      extraction_method: row.extraction_method,
      validation_rule: row.validation_rule,
      status: row.status,
      extraction_owner: row.extraction_owner ?? null,
      review_owner: row.review_owner ?? null,
      review_notes: row.review_notes ?? null,
    }));

    const extractionInsertPayload = checklistRows.map((row) => ({
      assessment_document_id: createdDocument.id,
      organization_id: organizationId,
      client_id: parsed.data.client_id,
      section_key: row.section,
      field_key: row.placeholder_key,
      label: row.label,
      mode: row.mode,
      required: row.required,
      status: row.status,
      review_notes: row.review_notes ?? null,
    }));

    const [checklistInsertResult, extractionInsertResult] = await Promise.all([
      fetchJson(`${supabaseUrl}/rest/v1/assessment_checklist_items`, {
        method: "POST",
        headers,
        body: JSON.stringify(checklistInsertPayload),
      }),
      fetchJson(`${supabaseUrl}/rest/v1/assessment_extractions`, {
        method: "POST",
        headers,
        body: JSON.stringify(extractionInsertPayload),
      }),
    ]);

    if (!checklistInsertResult.ok) {
      return jsonForRequest(request, { error: "Failed to seed checklist items" }, checklistInsertResult.status || 500);
    }

    if (!extractionInsertResult.ok) {
      return jsonForRequest(request, { error: "Failed to seed extraction records" }, extractionInsertResult.status || 500);
    }

    const eventPayload = {
      assessment_document_id: createdDocument.id,
      organization_id: organizationId,
      client_id: parsed.data.client_id,
      item_type: "document",
      item_id: createdDocument.id,
      action: "uploaded",
      from_status: null,
      to_status: "uploaded",
      notes: "Assessment uploaded and checklist seeded.",
      actor_id: actorId,
      event_payload: {
        template_type: templateType,
        template_label: templateTypeToDisplayLabel(templateType),
        source: "assessment-documents-api",
        upload_workflow: "manual_fba_clinician_authored",
      },
    };

    const uploadedEventResult = await fetchJson(`${supabaseUrl}/rest/v1/assessment_review_events`, {
      method: "POST",
      headers,
      body: JSON.stringify(eventPayload),
    });
    if (!uploadedEventResult.ok) {
      return jsonForRequest(request, { error: "Failed to record assessment upload event" }, uploadedEventResult.status || 500);
    }

    if (templateType === "caloptima_fba") {
      const extractingStatusResult = await fetchJson(`${supabaseUrl}/rest/v1/assessment_documents?id=eq.${encodeURIComponent(createdDocument.id)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: "extracting", updated_at: new Date().toISOString() }),
      });
      if (!extractingStatusResult.ok) {
        return jsonForRequest(request, { error: "Failed to mark assessment document extracting" }, extractingStatusResult.status || 500);
      }

      let scheduleResult: CaloptimaExtractionScheduleResult;
      try {
        scheduleResult = await (options.scheduleCaloptimaExtraction ?? scheduleInProcessCaloptimaExtraction)({
            request,
            accessToken,
            supabaseUrl,
            headers,
            organizationId,
            actorId,
            createdDocumentId: createdDocument.id,
            clientId: parsed.data.client_id,
            checklistRows,
            bucketId: createPayload.bucket_id,
            objectPath: createPayload.object_path,
        });
      } catch {
        scheduleResult = { ok: false, status: 500 };
      }
      if (!scheduleResult.ok) {
        const failure = new ExtractionWorkflowError(
          "extraction_background_schedule_failed",
          "extraction_background_schedule_failed",
          scheduleResult.status,
          "Unable to start extraction. Retry the upload or contact support.",
        );
        await persistExtractionFailure({
          supabaseUrl,
          headers,
          organizationId,
          actorId,
          createdDocumentId: createdDocument.id,
          clientId: parsed.data.client_id,
          error: failure,
        });
        return jsonForRequest(request, { error: failure.publicMessage }, scheduleResult.status || 500);
      }

      return jsonForRequest(request, { ...createdDocument, status: "extracting", extraction_error: null }, 201);
    }

    return jsonForRequest(request, { ...createdDocument, status: "uploaded", extraction_error: null }, 201);
  }

  if (request.method === "DELETE") {
    const url = new URL(request.url);
    const assessmentDocumentId = url.searchParams.get("assessment_document_id");
    if (!assessmentDocumentId) {
      return jsonForRequest(request, { error: "assessment_document_id is required" }, 400);
    }
    if (!isUuid(assessmentDocumentId)) {
      return jsonForRequest(request, { error: "assessment_document_id must be a valid UUID" }, 400);
    }

    const lookup = await fetchJson<AssessmentDocumentDeleteRow[]>(
      `${supabaseUrl}/rest/v1/assessment_documents?select=id,organization_id,client_id,bucket_id,object_path&id=eq.${encodeURIComponent(
        assessmentDocumentId,
      )}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`,
      { method: "GET", headers },
    );
    const document = Array.isArray(lookup.data) ? lookup.data[0] : null;
    if (!lookup.ok || !document) {
      return jsonForRequest(request, { error: "assessment_document_id is not in scope for this organization" }, 403);
    }

    const dependentTables = [
      "assessment_review_events",
      "assessment_draft_goals",
      "assessment_draft_programs",
      "assessment_checklist_items",
      "assessment_extractions",
    ] as const;

    for (const table of dependentTables) {
      const deletion = await fetchJson(
        `${supabaseUrl}/rest/v1/${table}?assessment_document_id=eq.${encodeURIComponent(
          assessmentDocumentId,
        )}&organization_id=eq.${encodeURIComponent(organizationId)}`,
        { method: "DELETE", headers },
      );
      if (!deletion.ok) {
        return jsonForRequest(request, { error: `Failed to delete dependent ${table} records` }, deletion.status || 500);
      }
    }

    const deleteDocument = await fetchJson(
      `${supabaseUrl}/rest/v1/assessment_documents?id=eq.${encodeURIComponent(assessmentDocumentId)}&organization_id=eq.${encodeURIComponent(
        organizationId,
      )}`,
      { method: "DELETE", headers },
    );
    if (!deleteDocument.ok) {
      return jsonForRequest(request, { error: "Failed to delete assessment document" }, deleteDocument.status || 500);
    }

    return jsonForRequest(request, {
      deleted: true,
      assessment_document_id: assessmentDocumentId,
      bucket_id: document.bucket_id,
      object_path: document.object_path,
    });
  }

  return jsonForRequest(request, { error: "Method not allowed" }, 405);
}
