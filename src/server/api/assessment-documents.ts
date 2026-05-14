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
import { serverLogger } from "../../lib/logger/server";

const SUPPORTED_TEMPLATE_TYPES = ["caloptima_fba", "iehp_fba"] as const;
const ASSESSMENT_DOCUMENT_BUCKET_ID = "client-documents";

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
  status: "not_started" | "drafted";
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

const templateTypeToDisplayLabel = (templateType: AssessmentTemplateType): string => {
  if (templateType === "iehp_fba") {
    return "IEHP FBA";
  }
  return "CalOptima FBA";
};

const runCaloptimaExtractionWorkflow = async (args: {
  supabaseUrl: string;
  headers: Record<string, string>;
  organizationId: string;
  actorId: string | null;
  createdDocumentId: string;
  clientId: string;
  checklistRows: AssessmentChecklistSeedRow[];
  bucketId: string;
  objectPath: string;
}) => {
  const { supabaseUrl, headers, organizationId, actorId, createdDocumentId, clientId, checklistRows, bucketId, objectPath } =
    args;
  try {
    const clientSnapshotResult = await fetchJson<ClientSnapshotRow[]>(
      `${supabaseUrl}/rest/v1/clients?select=full_name,first_name,last_name,date_of_birth,cin_number,client_id,phone,parent1_phone,parent1_first_name,parent1_last_name&id=eq.${encodeURIComponent(
        clientId,
      )}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`,
      { method: "GET", headers },
    );
    const clientSnapshotRow =
      clientSnapshotResult.ok && Array.isArray(clientSnapshotResult.data) && clientSnapshotResult.data[0]
        ? clientSnapshotResult.data[0]
        : null;
    const clientSnapshot = clientSnapshotRow ? compactNullableRecord(clientSnapshotRow) : undefined;

    const extractionResult = await fetchJson<ExtractionFunctionResponse>(`${supabaseUrl}/functions/v1/extract-assessment-fields`, {
      method: "POST",
      headers,
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

    if (extractionResult.ok && extractionResult.data) {
      await processInBatches(extractionResult.data.fields, 10, async (field) => {
        const reviewNotesParts = [
          field.review_notes ?? null,
          typeof field.confidence === "number" ? `Confidence: ${field.confidence.toFixed(2)}` : null,
          `Mode: ${field.mode}`,
        ].filter(Boolean) as string[];
        const mergedReviewNotes = reviewNotesParts.length > 0 ? reviewNotesParts.join(" | ") : null;
        const updatedAt = new Date().toISOString();

        await Promise.all([
          fetchJson(
            `${supabaseUrl}/rest/v1/assessment_checklist_items?assessment_document_id=eq.${encodeURIComponent(
              createdDocumentId,
            )}&placeholder_key=eq.${encodeURIComponent(field.placeholder_key)}&organization_id=eq.${encodeURIComponent(
              organizationId,
            )}`,
            {
              method: "PATCH",
              headers,
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
      });
      const structuredSections = extractionResult.data.structured_sections ?? [];
      if (structuredSections.length > 0) {
        const structuredInsertResult = await fetchJson(`${supabaseUrl}/rest/v1/assessment_structured_sections`, {
          method: "POST",
          headers,
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
        if (!structuredInsertResult.ok) {
          throw new Error("Structured section persistence failed.");
        }
      }

      await fetchJson(`${supabaseUrl}/rest/v1/assessment_documents?id=eq.${encodeURIComponent(createdDocumentId)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          status: "extracted",
          extracted_at: new Date().toISOString(),
          extraction_error: null,
          updated_at: new Date().toISOString(),
        }),
      });
      await fetchJson(`${supabaseUrl}/rest/v1/assessment_review_events`, {
        method: "POST",
        headers,
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
            extracted_count: extractionResult.data.extracted_count,
            unresolved_count: extractionResult.data.unresolved_count,
            unresolved_keys: extractionResult.data.unresolved_keys,
            structured_section_count: structuredSections.length,
            extraction_provider: extractionResult.data.extraction_provider ?? null,
            adobe_element_count: extractionResult.data.adobe_element_count ?? null,
            adobe_table_count: extractionResult.data.adobe_table_count ?? null,
          },
        }),
      });
      return;
    }

    const extractionError =
      typeof extractionResult.data?.error === "string" && extractionResult.data.error.trim().length > 0
        ? extractionResult.data.error
        : "Field extraction failed. Review checklist manually.";
    await fetchJson(`${supabaseUrl}/rest/v1/assessment_documents?id=eq.${encodeURIComponent(createdDocumentId)}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        status: "extraction_failed",
        extraction_error: extractionError,
        updated_at: new Date().toISOString(),
      }),
    });
    await fetchJson(`${supabaseUrl}/rest/v1/assessment_review_events`, {
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
      }),
    });
  } catch (error) {
    serverLogger.error("assessment-documents extraction workflow failed", { error });
    await fetchJson(`${supabaseUrl}/rest/v1/assessment_documents?id=eq.${encodeURIComponent(createdDocumentId)}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        status: "extraction_failed",
        extraction_error: "Field extraction failed. Review checklist manually.",
        updated_at: new Date().toISOString(),
      }),
    });
    await fetchJson(`${supabaseUrl}/rest/v1/assessment_review_events`, {
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
      }),
    });
  }
};

export async function assessmentDocumentsHandler(request: Request): Promise<Response> {
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

    let finalStatus: string = "uploaded";
    if (templateType === "caloptima_fba") {
      await fetchJson(`${supabaseUrl}/rest/v1/assessment_documents?id=eq.${encodeURIComponent(createdDocument.id)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: "extracting", updated_at: new Date().toISOString() }),
      });
      void runCaloptimaExtractionWorkflow({
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
      finalStatus = "extracting";
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

    await fetchJson(`${supabaseUrl}/rest/v1/assessment_review_events`, {
      method: "POST",
      headers,
      body: JSON.stringify(eventPayload),
    });

    return jsonForRequest(request, { ...createdDocument, status: finalStatus }, 201);
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
