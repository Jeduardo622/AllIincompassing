import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
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
import { buildCalOptimaTemplatePayload, loadCalOptimaPdfRenderMap } from "../assessmentPlanPdf";
import { buildIehpDocxPayload } from "../iehpAssessmentDocx";

const requestSchema = z.object({
  assessment_document_id: z.string().uuid(),
  preflight_only: z.boolean().optional(),
});

interface AssessmentDocumentRow {
  id: string;
  organization_id: string;
  client_id: string;
  status: string;
  template_type: string;
  template_version_id?: string | null;
}

interface ChecklistItemRow {
  placeholder_key: string;
  required: boolean;
  status: "not_started" | "drafted" | "verified" | "approved";
  value_text: string | null;
  value_json: unknown | null;
}

interface StructuredSectionRow {
  field_key: string;
  section_key: string;
  section_index: number;
  payload: Record<string, unknown> | null;
  status: "not_started" | "drafted" | "verified" | "approved" | "rejected";
  required: boolean;
}

interface DraftProgramRow {
  id: string;
  name: string;
  description: string | null;
  accept_state: "pending" | "accepted" | "rejected" | "edited";
}

interface DraftGoalRow {
  id: string;
  title: string;
  description: string;
  original_text: string;
  goal_type?: "child" | "parent" | null;
  target_behavior?: string | null;
  measurement_type?: string | null;
  baseline_data?: string | null;
  target_criteria?: string | null;
  mastery_criteria?: string | null;
  maintenance_criteria?: string | null;
  generalization_criteria?: string | null;
  objective_data_points?: Array<Record<string, unknown>> | null;
  accept_state: "pending" | "accepted" | "rejected" | "edited";
}

interface ClientRow {
  full_name: string;
  first_name?: string | null;
  last_name?: string | null;
  date_of_birth?: string | null;
  cin_number?: string | null;
  client_id?: string | null;
  phone?: string | null;
  parent1_first_name?: string | null;
  parent1_last_name?: string | null;
  parent1_phone?: string | null;
  diagnosis?: string[] | null;
  preferred_language?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  insurance_info?: Record<string, unknown> | null;
}

interface TherapistRow {
  full_name?: string | null;
  title?: string | null;
  license_number?: string | null;
  bcba_number?: string | null;
  rbt_number?: string | null;
  phone?: string | null;
}

interface AuthorizationRow {
  member_id?: string | null;
  insurance_provider?: { name?: string | null } | null;
}

interface GeneratePdfFunctionResponse {
  fill_mode: "acroform" | "overlay" | "mixed";
  bucket_id: string;
  object_path: string;
  signed_url: string;
  layout_warnings?: Array<{
    placeholder_key: string;
    page: number;
    reason: "overflow";
    rendered_line_count: number;
    total_line_count: number;
    max_lines: number;
  }>;
  overflow_keys?: string[];
  filled_pages?: number[];
}

interface TemplateFieldRow {
  field_key: string;
  required: boolean;
  layout_json?: Record<string, unknown> | null;
}

interface GenerateDocxFunctionResponse {
  bucket_id: string;
  object_path: string;
  signed_url: string;
  filename: string;
  content_type: string;
  unresolved_placeholder_count?: number;
  unresolved_placeholders?: string[];
}

interface GenerateDocxTemplateHealthResponse {
  template_available: boolean;
  template_type: "iehp_fba";
  bucket_id: string;
  storage_object_path: string;
  byte_count: number;
}

const CALOPTIMA_TEMPLATE_PATH = resolve(process.cwd(), "CalOptima Health FBA Template (2).pdf");
const IEHP_DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const ASSESSMENT_GENERATION_SECRET_HEADER = "x-assessment-generation-secret";

const deriveFilledPagesFallback = (
  renderMap: Awaited<ReturnType<typeof loadCalOptimaPdfRenderMap>>,
  fieldValues: Record<string, string>,
): number[] =>
  Array.from(
    new Set(
      renderMap
        .filter((entry) => {
          const value = fieldValues[entry.placeholder_key];
          return typeof value === "string" ? value.trim().length > 0 : Boolean(value);
        })
        .map((entry) => entry.fallback.page),
    ),
  ).sort((left, right) => left - right);

export async function assessmentPlanPdfHandler(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: { ...CORS_HEADERS } });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const accessToken = getAccessToken(request);
  if (!accessToken) {
    return json({ error: "Missing authorization token" }, 401, { "WWW-Authenticate": "Bearer" });
  }

  const { organizationId, isTherapist, isAdmin, isSuperAdmin } = await resolveOrgAndRole(accessToken);
  if (!organizationId || (!isTherapist && !isAdmin && !isSuperAdmin)) {
    return json({ error: "Forbidden" }, 403);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = requestSchema.safeParse(payload);
  if (!parsed.success) {
    return json({ error: "Invalid request body" }, 400);
  }

  const { supabaseUrl, anonKey } = getSupabaseConfig();
  const headers = {
    "Content-Type": "application/json",
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
  };

  const documentResult = await fetchJson<AssessmentDocumentRow[]>(
    `${supabaseUrl}/rest/v1/assessment_documents?select=id,organization_id,client_id,status,template_type,template_version_id&id=eq.${encodeURIComponent(
      parsed.data.assessment_document_id,
    )}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`,
    { method: "GET", headers },
  );
  const assessmentDocument = Array.isArray(documentResult.data) ? documentResult.data[0] : null;
  if (!documentResult.ok || !assessmentDocument) {
    return json({ error: "assessment_document_id is not in scope for this organization" }, 403);
  }
  if (assessmentDocument.template_type !== "caloptima_fba" && assessmentDocument.template_type !== "iehp_fba") {
    return json({ error: "Generation is not supported for this assessment template." }, 409);
  }

  const [checklistResult, structuredSectionsResult, draftProgramsResult, draftGoalsResult, clientResult] = await Promise.all([
    fetchJson<ChecklistItemRow[]>(
      `${supabaseUrl}/rest/v1/assessment_checklist_items?select=placeholder_key,required,status,value_text,value_json&organization_id=eq.${encodeURIComponent(
        organizationId,
      )}&assessment_document_id=eq.${encodeURIComponent(assessmentDocument.id)}`,
      { method: "GET", headers },
    ),
    fetchJson<StructuredSectionRow[]>(
      `${supabaseUrl}/rest/v1/assessment_structured_sections?select=field_key,section_key,section_index,payload,status,required&organization_id=eq.${encodeURIComponent(
        organizationId,
      )}&assessment_document_id=eq.${encodeURIComponent(
        assessmentDocument.id,
      )}&order=section_key.asc,field_key.asc,section_index.asc`,
      { method: "GET", headers },
    ),
    fetchJson<DraftProgramRow[]>(
      `${supabaseUrl}/rest/v1/assessment_draft_programs?select=id,name,description,accept_state&organization_id=eq.${encodeURIComponent(
        organizationId,
      )}&assessment_document_id=eq.${encodeURIComponent(assessmentDocument.id)}&order=created_at.asc`,
      { method: "GET", headers },
    ),
    fetchJson<DraftGoalRow[]>(
      `${supabaseUrl}/rest/v1/assessment_draft_goals?select=id,title,description,original_text,goal_type,target_behavior,measurement_type,baseline_data,target_criteria,mastery_criteria,maintenance_criteria,generalization_criteria,objective_data_points,accept_state&organization_id=eq.${encodeURIComponent(
        organizationId,
      )}&assessment_document_id=eq.${encodeURIComponent(assessmentDocument.id)}&order=created_at.asc`,
      { method: "GET", headers },
    ),
    fetchJson<ClientRow[]>(
      `${supabaseUrl}/rest/v1/clients?select=full_name,first_name,last_name,date_of_birth,cin_number,client_id,phone,parent1_first_name,parent1_last_name,parent1_phone,diagnosis,preferred_language,address_line1,address_line2,city,state,zip_code,insurance_info&id=eq.${encodeURIComponent(
        assessmentDocument.client_id,
      )}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`,
      { method: "GET", headers },
    ),
  ]);

  if (!checklistResult.ok || !structuredSectionsResult.ok || !draftProgramsResult.ok || !draftGoalsResult.ok || !clientResult.ok) {
    return json({ error: "Failed to load assessment data for PDF generation" }, 500);
  }

  const checklistItems = checklistResult.data ?? [];
  const structuredSections = structuredSectionsResult.data ?? [];
  const requiredPending = [
    ...checklistItems.filter((item) => item.required && item.status !== "approved").map((item) => item.placeholder_key),
    ...structuredSections.filter((item) => item.required && item.status !== "approved").map((item) => item.field_key),
  ];

  const acceptedProgram =
    (draftProgramsResult.data ?? []).find((program) => program.accept_state === "accepted" || program.accept_state === "edited") ??
    null;
  const acceptedGoals = (draftGoalsResult.data ?? []).filter(
    (goal) => goal.accept_state === "accepted" || goal.accept_state === "edited",
  );

  const client = Array.isArray(clientResult.data) ? clientResult.data[0] : null;
  if (!client) {
    return json({ error: "Client is out of scope for this organization." }, 403);
  }

  if (assessmentDocument.template_type === "caloptima_fba") {
    if (requiredPending.length > 0) {
      return json(
        {
          error: "Required checklist and structured section items must be approved before generating the treatment plan PDF.",
          pending_required_count: requiredPending.length,
          pending_required_keys: requiredPending,
        },
        409,
      );
    }

    if (!acceptedProgram || acceptedGoals.length === 0) {
      return json({ error: "Accepted draft program and goals are required before PDF generation." }, 409);
    }
  }

  const actorId = getAccessTokenSubject(accessToken);
  let writer: TherapistRow = {};
  if (actorId) {
    const therapistResult = await fetchJson<TherapistRow[]>(
      `${supabaseUrl}/rest/v1/therapists?select=full_name,title,license_number,bcba_number,rbt_number,phone&id=eq.${encodeURIComponent(
        actorId,
      )}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`,
      { method: "GET", headers },
    );
    if (therapistResult.ok && Array.isArray(therapistResult.data) && therapistResult.data[0]) {
      writer = therapistResult.data[0];
    }
  }

  if (assessmentDocument.template_type === "iehp_fba") {
    if (!assessmentDocument.template_version_id) {
      return json({ error: "IEHP assessment template version is required for DOCX generation." }, 409);
    }

    const templateFieldsResult = await fetchJson<TemplateFieldRow[]>(
      `${supabaseUrl}/rest/v1/assessment_template_fields?select=field_key,required,layout_json&template_version_id=eq.${encodeURIComponent(
        assessmentDocument.template_version_id,
      )}&order=page_number.asc,field_key.asc`,
      { method: "GET", headers },
    );

    if (!templateFieldsResult.ok) {
      return json({ error: "Failed to load IEHP template fields for DOCX generation" }, 500);
    }

    const authorizationResult = await fetchJson<AuthorizationRow[]>(
      `${supabaseUrl}/rest/v1/authorizations?select=member_id,insurance_provider:insurance_providers(name)&organization_id=eq.${encodeURIComponent(
        organizationId,
      )}&client_id=eq.${encodeURIComponent(assessmentDocument.client_id)}&status=eq.active&order=start_date.desc`,
      { method: "GET", headers },
    );
    const activeAuthorizations =
      authorizationResult.ok && Array.isArray(authorizationResult.data)
        ? authorizationResult.data.filter((row) => typeof row.member_id === "string" && row.member_id.trim())
        : [];
    const authorizationMemberId =
      activeAuthorizations.find((row) => /iehp|inland\s+empire/i.test(row.insurance_provider?.name ?? ""))?.member_id?.trim() ??
      activeAuthorizations[0]?.member_id?.trim() ??
      null;

    const acceptedPrograms = (draftProgramsResult.data ?? []).filter(
      (program) => program.accept_state === "accepted" || program.accept_state === "edited",
    );
    const acceptedGoals = (draftGoalsResult.data ?? []).filter(
      (goal) => goal.accept_state === "accepted" || goal.accept_state === "edited",
    );
    const pendingDraftProgramCount = (draftProgramsResult.data ?? []).filter((program) => program.accept_state === "pending").length;
    const pendingDraftGoalCount = (draftGoalsResult.data ?? []).filter((goal) => goal.accept_state === "pending").length;

    const payloadResult = buildIehpDocxPayload({
      templateFields: templateFieldsResult.data ?? [],
      checklistItems,
      structuredSections,
      client,
      authorizationMemberId,
      writer,
      acceptedPrograms,
      acceptedGoals,
      pendingDraftProgramCount,
      pendingDraftGoalCount,
    });

    const generationSecret = process.env.ASSESSMENT_GENERATION_SECRET?.trim();
    const templatePreflight = payloadResult.preflight;
    if (!generationSecret) {
      templatePreflight.blockers.push({
        code: "template_unavailable",
        message: "IEHP DOCX generation credential is not configured.",
      });
      templatePreflight.ready = false;
    } else {
      const templateHealthResult = await fetchJson<GenerateDocxTemplateHealthResponse>(
        `${supabaseUrl}/functions/v1/generate-assessment-plan-docx`,
        {
          method: "POST",
          headers: {
            ...headers,
            [ASSESSMENT_GENERATION_SECRET_HEADER]: generationSecret,
          },
          body: JSON.stringify({
            assessment_document_id: assessmentDocument.id,
            template_type: "iehp_fba",
            template_health_check: true,
          }),
        },
      );
      if (!templateHealthResult.ok || !templateHealthResult.data?.template_available) {
        templatePreflight.blockers.push({
          code: "template_unavailable",
          message: "IEHP DOCX template is not available to the deployed generation function.",
        });
        templatePreflight.ready = false;
      }
    }

    if (parsed.data.preflight_only) {
      return json({
        assessment_document_id: assessmentDocument.id,
        generated_file_type: "docx",
        preflight: templatePreflight,
      });
    }

    if (!templatePreflight.ready) {
      return json(
        {
          error: "IEHP DOCX generation is blocked by review preflight.",
          assessment_document_id: assessmentDocument.id,
          generated_file_type: "docx",
          preflight: templatePreflight,
        },
        409,
      );
    }

    const timestamp = Date.now();
    const filename = `generated-iehp-fba-${assessmentDocument.id}-${timestamp}.docx`;
    const outputObjectPath = `clients/${assessmentDocument.client_id}/assessments/${filename}`;

    const functionResult = await fetchJson<GenerateDocxFunctionResponse>(
      `${supabaseUrl}/functions/v1/generate-assessment-plan-docx`,
      {
        method: "POST",
        headers: {
          ...headers,
          [ASSESSMENT_GENERATION_SECRET_HEADER]: generationSecret,
        },
        body: JSON.stringify({
          assessment_document_id: assessmentDocument.id,
          template_type: "iehp_fba",
          field_values: payloadResult.values,
          field_layouts: (templateFieldsResult.data ?? []).map((field) => ({
            field_key: field.field_key,
            layout_json: field.layout_json ?? null,
          })),
          output_bucket_id: "client-documents",
          output_object_path: outputObjectPath,
        }),
      },
    );

    if (!functionResult.ok || !functionResult.data) {
      return json({ error: "Failed to generate completed IEHP DOCX." }, functionResult.status || 500);
    }

    await fetchJson(`${supabaseUrl}/rest/v1/assessment_review_events`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        assessment_document_id: assessmentDocument.id,
        organization_id: organizationId,
        client_id: assessmentDocument.client_id,
        item_type: "document",
        item_id: assessmentDocument.id,
        action: "plan_docx_generated",
        actor_id: actorId,
        event_payload: {
          generated_bucket_id: functionResult.data.bucket_id,
          generated_object_path: functionResult.data.object_path,
          unresolved_placeholder_count: functionResult.data.unresolved_placeholder_count ?? 0,
          unresolved_placeholders: functionResult.data.unresolved_placeholders ?? [],
          preflight_warning_count: templatePreflight.warnings.length,
        },
      }),
    });

    return json({
      assessment_document_id: assessmentDocument.id,
      generated_file_type: "docx",
      content_type: functionResult.data.content_type || IEHP_DOCX_CONTENT_TYPE,
      filename: functionResult.data.filename,
      bucket_id: functionResult.data.bucket_id,
      object_path: functionResult.data.object_path,
      signed_url: functionResult.data.signed_url,
      preflight: templatePreflight,
    });
  }

  const renderMap = await loadCalOptimaPdfRenderMap();
  const payloadResult = await buildCalOptimaTemplatePayload({
    checklistItems,
    structuredSections,
    client,
    writer,
    acceptedProgram,
    acceptedGoals,
  });

  if (payloadResult.missing_required_keys.length > 0) {
    return json(
      {
        error: "Missing required values for final CalOptima PDF generation.",
        missing_required_keys: payloadResult.missing_required_keys,
      },
      409,
    );
  }

  const templateBytes = await readFile(CALOPTIMA_TEMPLATE_PATH);
  const templatePdfBase64 = Buffer.from(templateBytes).toString("base64");
  const outputObjectPath = `clients/${assessmentDocument.client_id}/assessments/generated-caloptima-plan-${assessmentDocument.id}-${Date.now()}.pdf`;

  const functionResult = await fetchJson<GeneratePdfFunctionResponse>(
    `${supabaseUrl}/functions/v1/generate-assessment-plan-pdf`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        assessment_document_id: assessmentDocument.id,
        template_type: "caloptima_fba",
        template_pdf_base64: templatePdfBase64,
        render_map_entries: renderMap,
        field_values: payloadResult.values,
        output_bucket_id: "client-documents",
        output_object_path: outputObjectPath,
      }),
    },
  );

  if (!functionResult.ok || !functionResult.data) {
    return json({ error: "Failed to generate completed treatment plan PDF." }, functionResult.status || 500);
  }

  await fetchJson(`${supabaseUrl}/rest/v1/assessment_review_events`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      assessment_document_id: assessmentDocument.id,
      organization_id: organizationId,
      client_id: assessmentDocument.client_id,
      item_type: "document",
      item_id: assessmentDocument.id,
      action: "plan_pdf_generated",
      actor_id: actorId,
      event_payload: {
        fill_mode: functionResult.data.fill_mode,
        generated_bucket_id: functionResult.data.bucket_id,
        generated_object_path: functionResult.data.object_path,
        missing_required_count: payloadResult.missing_required_keys.length,
        layout_warning_count: functionResult.data.layout_warnings?.length ?? 0,
        overflow_keys: functionResult.data.overflow_keys ?? [],
      },
    }),
  });

  const layoutWarnings = functionResult.data.layout_warnings ?? [];
  const filledPages = Array.isArray(functionResult.data.filled_pages)
    ? functionResult.data.filled_pages
    : deriveFilledPagesFallback(renderMap, payloadResult.values);

  return json({
    assessment_document_id: assessmentDocument.id,
    fill_mode: functionResult.data.fill_mode,
    bucket_id: functionResult.data.bucket_id,
    object_path: functionResult.data.object_path,
    signed_url: functionResult.data.signed_url,
    layout_warnings: layoutWarnings,
    overflow_keys: functionResult.data.overflow_keys ?? layoutWarnings.map((warning) => warning.placeholder_key),
    filled_pages: filledPages,
  });
}
