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

const requestSchema = z.object({
  assessment_document_id: z.string().uuid(),
});

interface AssessmentDocumentRow {
  id: string;
  organization_id: string;
  client_id: string;
  status: string;
  template_type: string;
}

interface ChecklistItemRow {
  placeholder_key: string;
  required: boolean;
  status: "not_started" | "drafted" | "verified" | "approved";
  value_text: string | null;
  value_json: unknown | null;
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

interface GeneratePdfFunctionResponse {
  fill_mode: "acroform" | "overlay";
  bucket_id: string;
  object_path: string;
  signed_url: string;
}

const CALOPTIMA_TEMPLATE_PATH = resolve(process.cwd(), "CalOptima Health FBA Template (2).pdf");

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
    `${supabaseUrl}/rest/v1/assessment_documents?select=id,organization_id,client_id,status,template_type&id=eq.${encodeURIComponent(
      parsed.data.assessment_document_id,
    )}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`,
    { method: "GET", headers },
  );
  const assessmentDocument = Array.isArray(documentResult.data) ? documentResult.data[0] : null;
  if (!documentResult.ok || !assessmentDocument) {
    return json({ error: "assessment_document_id is not in scope for this organization" }, 403);
  }
  if (assessmentDocument.template_type !== "caloptima_fba") {
    return json({ error: "PDF generation is currently supported only for CalOptima template assessments." }, 409);
  }

  const [checklistResult, draftProgramsResult, draftGoalsResult, clientResult] = await Promise.all([
    fetchJson<ChecklistItemRow[]>(
      `${supabaseUrl}/rest/v1/assessment_checklist_items?select=placeholder_key,required,status,value_text,value_json&organization_id=eq.${encodeURIComponent(
        organizationId,
      )}&assessment_document_id=eq.${encodeURIComponent(assessmentDocument.id)}`,
      { method: "GET", headers },
    ),
    fetchJson<DraftProgramRow[]>(
      `${supabaseUrl}/rest/v1/assessment_draft_programs?select=id,name,description,accept_state&organization_id=eq.${encodeURIComponent(
        organizationId,
      )}&assessment_document_id=eq.${encodeURIComponent(assessmentDocument.id)}&order=created_at.asc`,
      { method: "GET", headers },
    ),
    fetchJson<DraftGoalRow[]>(
      `${supabaseUrl}/rest/v1/assessment_draft_goals?select=id,title,description,original_text,accept_state&organization_id=eq.${encodeURIComponent(
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

  if (!checklistResult.ok || !draftProgramsResult.ok || !draftGoalsResult.ok || !clientResult.ok) {
    return json({ error: "Failed to load assessment data for PDF generation" }, 500);
  }

  const checklistItems = checklistResult.data ?? [];
  const requiredPending = checklistItems.filter((item) => item.required && item.status !== "approved");
  if (requiredPending.length > 0) {
    return json(
      {
        error: "Required checklist items must be approved before generating the treatment plan PDF.",
        pending_required_count: requiredPending.length,
        pending_required_keys: requiredPending.map((item) => item.placeholder_key),
      },
      409,
    );
  }

  const acceptedProgram =
    (draftProgramsResult.data ?? []).find((program) => program.accept_state === "accepted" || program.accept_state === "edited") ??
    null;
  const acceptedGoals = (draftGoalsResult.data ?? []).filter(
    (goal) => goal.accept_state === "accepted" || goal.accept_state === "edited",
  );

  if (!acceptedProgram || acceptedGoals.length === 0) {
    return json({ error: "Accepted draft program and goals are required before PDF generation." }, 409);
  }

  const client = Array.isArray(clientResult.data) ? clientResult.data[0] : null;
  if (!client) {
    return json({ error: "Client is out of scope for this organization." }, 403);
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

  const renderMap = await loadCalOptimaPdfRenderMap();
  const payloadResult = await buildCalOptimaTemplatePayload({
    checklistItems,
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
      },
    }),
  });

  return json({
    assessment_document_id: assessmentDocument.id,
    fill_mode: functionResult.data.fill_mode,
    bucket_id: functionResult.data.bucket_id,
    object_path: functionResult.data.object_path,
    signed_url: functionResult.data.signed_url,
  });
}
