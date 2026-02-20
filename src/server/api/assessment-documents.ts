import { z } from "zod";
import {
  CORS_HEADERS,
  fetchJson,
  getAccessToken,
  getAccessTokenSubject,
  getSupabaseConfig,
  json,
  resolveOrgAndRole,
} from "./shared";
import {
  loadChecklistTemplateRows,
  type AssessmentChecklistSeedRow,
  type AssessmentTemplateType,
} from "../assessmentChecklistTemplate";

const SUPPORTED_TEMPLATE_TYPES = ["caloptima_fba", "iehp_fba"] as const;

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

interface AssessmentDocumentRow {
  id: string;
  organization_id: string;
  client_id: string;
  status: string;
  created_at: string;
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
  fields: ExtractionFieldResult[];
  unresolved_keys: string[];
  extracted_count: number;
  unresolved_count: number;
}

const templateTypeToDisplayLabel = (templateType: AssessmentTemplateType): string => {
  if (templateType === "iehp_fba") {
    return "IEHP FBA";
  }
  return "CalOptima FBA";
};

export async function assessmentDocumentsHandler(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: { ...CORS_HEADERS } });
  }

  const accessToken = getAccessToken(request);
  if (!accessToken) {
    return json({ error: "Missing authorization token" }, 401, { "WWW-Authenticate": "Bearer" });
  }

  const { organizationId, isTherapist, isAdmin, isSuperAdmin } = await resolveOrgAndRole(accessToken);
  if (!organizationId || (!isTherapist && !isAdmin && !isSuperAdmin)) {
    return json({ error: "Forbidden" }, 403);
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
        return json({ error: "client_id must be a valid UUID" }, 400);
      }
      const urlValue = `${supabaseUrl}/rest/v1/assessment_documents?select=*&${baseQuery}&client_id=eq.${encodeURIComponent(
        clientId,
      )}&order=created_at.desc`;
      const result = await fetchJson(urlValue, { method: "GET", headers });
      if (!result.ok) {
        return json({ error: "Failed to load assessment documents" }, result.status || 500);
      }
      return json(result.data ?? []);
    }

    if (assessmentDocumentId) {
      if (!isUuid(assessmentDocumentId)) {
        return json({ error: "assessment_document_id must be a valid UUID" }, 400);
      }
      const urlValue = `${supabaseUrl}/rest/v1/assessment_documents?select=*&${baseQuery}&id=eq.${encodeURIComponent(
        assessmentDocumentId,
      )}&limit=1`;
      const result = await fetchJson<Array<Record<string, unknown>>>(urlValue, { method: "GET", headers });
      if (!result.ok) {
        return json({ error: "Failed to load assessment document" }, result.status || 500);
      }
      return json(Array.isArray(result.data) ? result.data[0] ?? null : null);
    }

    return json({ error: "client_id or assessment_document_id is required" }, 400);
  }

  if (request.method === "POST") {
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const parsed = assessmentDocumentCreateSchema.safeParse(payload);
    if (!parsed.success) {
      return json({ error: "Invalid request body" }, 400);
    }

    const clientExists = await clientExistsInOrg(parsed.data.client_id);
    if (!clientExists) {
      return json({ error: "client_id is not in scope for this organization" }, 403);
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
      bucket_id: parsed.data.bucket_id ?? "client-documents",
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
      return json({ error: "Failed to create assessment document" }, createResult.status || 500);
    }

    const createdDocument = createResult.data[0];

    let checklistRows: AssessmentChecklistSeedRow[];
    try {
      checklistRows = await loadChecklistTemplateRows(templateType);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load checklist template rows.";
      return json({ error: message }, 500);
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

    const checklistInsertResult = await fetchJson(
      `${supabaseUrl}/rest/v1/assessment_checklist_items`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(checklistInsertPayload),
      },
    );

    if (!checklistInsertResult.ok) {
      return json({ error: "Failed to seed checklist items" }, checklistInsertResult.status || 500);
    }

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

    const extractionInsertResult = await fetchJson(
      `${supabaseUrl}/rest/v1/assessment_extractions`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(extractionInsertPayload),
      },
    );

    if (!extractionInsertResult.ok) {
      return json({ error: "Failed to seed extraction records" }, extractionInsertResult.status || 500);
    }

    let finalStatus: string = "uploaded";
    if (templateType === "caloptima_fba") {
      const clientSnapshotResult = await fetchJson<ClientSnapshotRow[]>(
        `${supabaseUrl}/rest/v1/clients?select=full_name,first_name,last_name,date_of_birth,cin_number,client_id,phone,parent1_phone,parent1_first_name,parent1_last_name&id=eq.${encodeURIComponent(
          parsed.data.client_id,
        )}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`,
        { method: "GET", headers },
      );
      const clientSnapshot =
        clientSnapshotResult.ok && Array.isArray(clientSnapshotResult.data) && clientSnapshotResult.data[0]
          ? clientSnapshotResult.data[0]
          : null;

      await fetchJson(`${supabaseUrl}/rest/v1/assessment_documents?id=eq.${encodeURIComponent(createdDocument.id)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: "extracting", updated_at: new Date().toISOString() }),
      });

      const extractionResult = await fetchJson<ExtractionFunctionResponse>(
        `${supabaseUrl}/functions/v1/extract-assessment-fields`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            assessment_document_id: createdDocument.id,
            template_type: templateType,
            bucket_id: createPayload.bucket_id,
            object_path: createPayload.object_path,
            checklist_rows: checklistRows.map((row) => ({
              section: row.section,
              label: row.label,
              placeholder_key: row.placeholder_key,
              required: row.required,
            })),
            client_snapshot: clientSnapshot,
          }),
        },
      );

      if (extractionResult.ok && extractionResult.data) {
      for (const field of extractionResult.data.fields) {
        const reviewNotesParts = [
          field.review_notes ?? null,
          typeof field.confidence === "number" ? `Confidence: ${field.confidence.toFixed(2)}` : null,
          `Mode: ${field.mode}`,
        ].filter(Boolean) as string[];
        const mergedReviewNotes = reviewNotesParts.length > 0 ? reviewNotesParts.join(" | ") : null;

        await fetchJson(
          `${supabaseUrl}/rest/v1/assessment_checklist_items?assessment_document_id=eq.${encodeURIComponent(
            createdDocument.id,
          )}&placeholder_key=eq.${encodeURIComponent(field.placeholder_key)}&organization_id=eq.${encodeURIComponent(organizationId)}`,
          {
            method: "PATCH",
            headers,
            body: JSON.stringify({
              value_text: field.value_text,
              value_json: field.value_json,
              status: field.status,
              review_notes: mergedReviewNotes,
              updated_at: new Date().toISOString(),
            }),
          },
        );

        await fetchJson(
          `${supabaseUrl}/rest/v1/assessment_extractions?assessment_document_id=eq.${encodeURIComponent(
            createdDocument.id,
          )}&field_key=eq.${encodeURIComponent(field.placeholder_key)}&organization_id=eq.${encodeURIComponent(organizationId)}`,
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
              updated_at: new Date().toISOString(),
            }),
          },
        );
      }

      await fetchJson(`${supabaseUrl}/rest/v1/assessment_documents?id=eq.${encodeURIComponent(createdDocument.id)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          status: "extracted",
          extracted_at: new Date().toISOString(),
          extraction_error: null,
          updated_at: new Date().toISOString(),
        }),
      });
      finalStatus = "extracted";
      await fetchJson(`${supabaseUrl}/rest/v1/assessment_review_events`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          assessment_document_id: createdDocument.id,
          organization_id: organizationId,
          client_id: parsed.data.client_id,
          item_type: "document",
          item_id: createdDocument.id,
          action: "extraction_completed",
          from_status: "extracting",
          to_status: "extracted",
          actor_id: actorId,
          event_payload: {
            extracted_count: extractionResult.data.extracted_count,
            unresolved_count: extractionResult.data.unresolved_count,
            unresolved_keys: extractionResult.data.unresolved_keys,
          },
        }),
      });
      } else {
        const extractionError = "Field extraction failed. Review checklist manually.";
        await fetchJson(`${supabaseUrl}/rest/v1/assessment_documents?id=eq.${encodeURIComponent(createdDocument.id)}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({
            status: "extraction_failed",
            extraction_error: extractionError,
            updated_at: new Date().toISOString(),
          }),
        });
        finalStatus = "extraction_failed";
        await fetchJson(`${supabaseUrl}/rest/v1/assessment_review_events`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            assessment_document_id: createdDocument.id,
            organization_id: organizationId,
            client_id: parsed.data.client_id,
            item_type: "document",
            item_id: createdDocument.id,
            action: "extraction_failed",
            from_status: "extracting",
            to_status: "extraction_failed",
            actor_id: actorId,
          }),
        });
      }
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
      },
    };

    await fetchJson(`${supabaseUrl}/rest/v1/assessment_review_events`, {
      method: "POST",
      headers,
      body: JSON.stringify(eventPayload),
    });

    return json({ ...createdDocument, status: finalStatus }, 201);
  }

  return json({ error: "Method not allowed" }, 405);
}
