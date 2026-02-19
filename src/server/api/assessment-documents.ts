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
import { loadChecklistTemplateRows, type AssessmentTemplateType } from "../assessmentChecklistTemplate";

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

    const checklistRows = await loadChecklistTemplateRows(templateType);
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

    return json(createdDocument, 201);
  }

  return json({ error: "Method not allowed" }, 405);
}
