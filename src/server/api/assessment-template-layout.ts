import { z } from "zod";
import {
  fetchJson,
  getAccessToken,
  getSupabaseConfig,
  jsonForRequest,
  resolveOrgAndRole,
} from "./shared";
import {
  loadIehpLayoutManifest,
  type AssessmentTemplateField,
  type AssessmentTemplatePage,
  type AssessmentTemplateVersion,
} from "../assessmentTemplateLayout";
import { normalizeIehpRequiredFlag } from "../iehpOptionalFinalOutput";

const uuidSchema = z.string().uuid();

interface AssessmentDocumentLayoutRow {
  id: string;
  organization_id: string;
  client_id: string;
  template_type: string;
  template_version_id?: string | null;
  status: string;
  file_name: string;
}

interface ChecklistRow {
  id: string;
  placeholder_key: string;
  section_key: string;
  label: string;
  mode: string;
  required: boolean;
  status: string;
  value_text: string | null;
  value_json: unknown;
  review_notes: string | null;
}

interface StructuredSectionRow {
  id: string;
  section_key: string;
  field_key: string;
  section_index: number;
  payload: Record<string, unknown>;
  source_span: Record<string, unknown> | null;
  status: string;
  required: boolean;
  review_notes: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const normalizeTemplateVersion = (row: Record<string, unknown>): AssessmentTemplateVersion | null => {
  if (
    typeof row.version_key !== "string" ||
    typeof row.source_document_name !== "string" ||
    typeof row.page_count !== "number"
  ) {
    return null;
  }
  return {
    id: typeof row.id === "string" ? row.id : null,
    template_type: "iehp_fba",
    version_key: row.version_key,
    source_document_name: row.source_document_name,
    page_count: row.page_count,
    source_sha256: typeof row.source_sha256 === "string" ? row.source_sha256 : null,
    status: row.status === "draft" || row.status === "retired" ? row.status : "active",
  };
};

const normalizePage = (row: Record<string, unknown>): AssessmentTemplatePage | null => {
  if (typeof row.page_number !== "number" || typeof row.title !== "string") return null;
  return {
    id: typeof row.id === "string" ? row.id : null,
    template_version_id: typeof row.template_version_id === "string" ? row.template_version_id : null,
    page_number: row.page_number,
    title: row.title,
    layout_json: isRecord(row.layout_json) ? row.layout_json : {},
  };
};

const normalizeField = (row: Record<string, unknown>): AssessmentTemplateField | null => {
  const mode = row.mode;
  if (mode !== "AUTO" && mode !== "ASSISTED" && mode !== "MANUAL") return null;
  if (
    typeof row.page_number !== "number" ||
    typeof row.section_key !== "string" ||
    typeof row.field_key !== "string" ||
    typeof row.label !== "string" ||
    typeof row.field_type !== "string" ||
    typeof row.required !== "boolean" ||
    typeof row.source !== "string"
  ) {
    return null;
  }
  return {
    id: typeof row.id === "string" ? row.id : null,
    template_version_id: typeof row.template_version_id === "string" ? row.template_version_id : null,
    page_number: row.page_number,
    section_key: row.section_key,
    field_key: row.field_key,
    label: row.label,
    field_type: row.field_type,
    mode,
    required: row.required,
    source: row.source,
    layout_json: isRecord(row.layout_json) ? row.layout_json : {},
    repeat_group_key: typeof row.repeat_group_key === "string" ? row.repeat_group_key : null,
  };
};

const loadFallbackLayout = async (): Promise<{
  template_version: AssessmentTemplateVersion;
  pages: AssessmentTemplatePage[];
  fields: AssessmentTemplateField[];
}> => {
  const manifest = await loadIehpLayoutManifest();
  return {
    template_version: {
      id: null,
      template_type: "iehp_fba",
      version_key: manifest.version_key,
      source_document_name: manifest.source_document_name,
      page_count: manifest.page_count,
      source_sha256: manifest.source_sha256,
      status: "active",
    },
    pages: manifest.pages,
    fields: manifest.fields,
  };
};

export async function assessmentTemplateLayoutHandler(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return jsonForRequest(request, { ok: true });
  }
  if (request.method !== "GET") {
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

  const assessmentDocumentId = new URL(request.url).searchParams.get("assessment_document_id");
  if (!assessmentDocumentId) {
    return jsonForRequest(request, { error: "assessment_document_id is required" }, 400);
  }
  if (!uuidSchema.safeParse(assessmentDocumentId).success) {
    return jsonForRequest(request, { error: "assessment_document_id must be a valid UUID" }, 400);
  }

  const { supabaseUrl, anonKey } = getSupabaseConfig();
  const headers = {
    "Content-Type": "application/json",
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
  };

  const documentResult = await fetchJson<AssessmentDocumentLayoutRow[]>(
    `${supabaseUrl}/rest/v1/assessment_documents?select=*&id=eq.${encodeURIComponent(
      assessmentDocumentId,
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
  if (document.template_type !== "iehp_fba") {
    return jsonForRequest(request, { error: "Template layout review is currently available only for IEHP FBA documents." }, 400);
  }

  const [checklistResult, structuredResult] = await Promise.all([
    fetchJson<ChecklistRow[]>(`${supabaseUrl}/rest/v1/assessment_checklist_items?select=*&organization_id=eq.${encodeURIComponent(
      organizationId,
    )}&assessment_document_id=eq.${encodeURIComponent(assessmentDocumentId)}&order=section_key.asc,created_at.asc`, {
      method: "GET",
      headers,
    }),
    fetchJson<StructuredSectionRow[]>(`${supabaseUrl}/rest/v1/assessment_structured_sections?select=*&organization_id=eq.${encodeURIComponent(
      organizationId,
    )}&assessment_document_id=eq.${encodeURIComponent(
      assessmentDocumentId,
    )}&order=section_key.asc,field_key.asc,section_index.asc`, {
      method: "GET",
      headers,
    }),
  ]);
  if (!checklistResult.ok) {
    return jsonForRequest(request, { error: "Failed to load checklist items" }, checklistResult.status || 500);
  }
  if (!structuredResult.ok) {
    return jsonForRequest(request, { error: "Failed to load structured assessment sections" }, structuredResult.status || 500);
  }

  const fallbackLayout = await loadFallbackLayout();
  const templateVersionFilter = document.template_version_id
    ? `id=eq.${encodeURIComponent(document.template_version_id)}`
    : `version_key=eq.${encodeURIComponent(fallbackLayout.template_version.version_key)}`;
  const versionResult = await fetchJson<Record<string, unknown>[]>(
    `${supabaseUrl}/rest/v1/assessment_template_versions?select=*&${templateVersionFilter}&order=created_at.desc&limit=1`,
    { method: "GET", headers },
  );

  const versionRow = versionResult.ok && Array.isArray(versionResult.data) ? versionResult.data[0] ?? null : null;
  const version = versionRow ? normalizeTemplateVersion(versionRow) : null;
  if (!version?.id) {
    const message = document.template_version_id
      ? "Linked IEHP template version metadata is unavailable."
      : "Seeded IEHP template version metadata is unavailable.";
    return jsonForRequest(request, { error: message }, 409);
  }

  const [pagesResult, fieldsResult] = await Promise.all([
    fetchJson<Record<string, unknown>[]>(
      `${supabaseUrl}/rest/v1/assessment_template_pages?select=*&template_version_id=eq.${encodeURIComponent(
        version.id,
      )}&order=page_number.asc`,
      { method: "GET", headers },
    ),
    fetchJson<Record<string, unknown>[]>(
      `${supabaseUrl}/rest/v1/assessment_template_fields?select=*&template_version_id=eq.${encodeURIComponent(
        version.id,
      )}&order=page_number.asc,section_key.asc,field_key.asc`,
      { method: "GET", headers },
    ),
  ]);
  const pages = pagesResult.ok && Array.isArray(pagesResult.data) ? pagesResult.data.map(normalizePage).filter(Boolean) : [];
  const fields = fieldsResult.ok && Array.isArray(fieldsResult.data) ? fieldsResult.data.map(normalizeField).filter(Boolean) : [];
  if (!pagesResult.ok || !fieldsResult.ok || pages.length === 0 || fields.length === 0) {
    return jsonForRequest(request, { error: "IEHP template layout metadata is incomplete for this document version." }, 409);
  }
  const layout = { template_version: version, pages, fields };

  const checklistRows = Array.isArray(checklistResult.data) ? checklistResult.data : [];
  const structuredSections = Array.isArray(structuredResult.data) ? structuredResult.data : [];
  const unresolvedRequiredCount = checklistRows
    .filter((row) => normalizeIehpRequiredFlag(row.placeholder_key, row.required) && row.status !== "approved")
    .length +
    structuredSections
      .filter((section) => normalizeIehpRequiredFlag(section.field_key, section.required) && section.status !== "approved")
      .length;
  const extractedValueCount = checklistRows.filter((row) => typeof row.value_text === "string" && row.value_text.trim().length > 0).length;

  return jsonForRequest(request, {
    assessment_document: document,
    template_version: layout.template_version,
    pages: layout.pages,
    fields: layout.fields,
    values: {
      checklist_items: checklistRows,
      structured_sections: structuredSections,
    },
    unresolved_required_count: unresolvedRequiredCount,
    extracted_value_count: extractedValueCount,
  });
}
