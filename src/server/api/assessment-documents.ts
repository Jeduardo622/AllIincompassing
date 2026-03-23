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
import {
  composeAssessmentTextFromChecklist,
  type AssessmentChecklistValueRow,
} from "./assessment-text-composer";
import {
  buildGenerateProgramGoalsPayload,
  type AssessmentExtractionGenerationRow,
} from "./assessment-generation-payload";
import { serverLogger } from "../../lib/logger/server";

const SUPPORTED_TEMPLATE_TYPES = ["caloptima_fba", "iehp_fba"] as const;
const MAX_GENERATION_ASSESSMENT_TEXT_CHARS = 12000;

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
  fields: ExtractionFieldResult[];
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

interface GeneratedDraftPayload {
  programs: Array<{
    name: string;
    description: string;
    rationale: string;
    evidence_refs: Array<{ section_key: string; source_span: string }>;
    review_flags: Array<
      | "missing_baseline"
      | "weak_measurement_definition"
      | "unsupported_parent_goal"
      | "ambiguous_mastery_threshold"
      | "evidence_gap"
      | "duplicate_risk"
      | "clinician_confirmation_needed"
    >;
  }>;
  goals: Array<{
    program_name: string;
    title: string;
    description: string;
    original_text: string;
    goal_type: "child" | "parent";
    target_behavior: string;
    measurement_type: string;
    baseline_data: string;
    target_criteria: string;
    mastery_criteria: string;
    maintenance_criteria: string;
    generalization_criteria: string;
    objective_data_points: string[];
    rationale: string;
    evidence_refs: Array<{ section_key: string; source_span: string }>;
    review_flags: Array<
      | "missing_baseline"
      | "weak_measurement_definition"
      | "unsupported_parent_goal"
      | "ambiguous_mastery_threshold"
      | "evidence_gap"
      | "duplicate_risk"
      | "clinician_confirmation_needed"
    >;
  }>;
  summary_rationale: string;
  confidence: "low" | "medium" | "high";
}

interface GeneratedDraftErrorPayload {
  error?: string;
}

const validateGoalMinimums = (
  goals: Array<{ goal_type: "child" | "parent" }>,
): { valid: true } | { valid: false; childCount: number; parentCount: number } => {
  const childCount = goals.filter((goal) => goal.goal_type === "child").length;
  const parentCount = goals.filter((goal) => goal.goal_type === "parent").length;
  if (childCount < 20 || parentCount < 6) {
    return { valid: false, childCount, parentCount };
  }
  return { valid: true };
};

const markAutoGenerationFailure = async (args: {
  supabaseUrl: string;
  headers: Record<string, string>;
  createdDocumentId: string;
  organizationId: string;
  clientId: string;
  actorId: string | null;
  message: string;
}) => {
  const { supabaseUrl, headers, createdDocumentId, organizationId, clientId, actorId, message } = args;
  const now = new Date().toISOString();
  await fetchJson(`${supabaseUrl}/rest/v1/assessment_documents?id=eq.${encodeURIComponent(createdDocumentId)}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      // Keep extracted status; extraction succeeded, only draft generation failed.
      status: "extracted",
      extraction_error: message,
      updated_at: now,
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
      action: "draft_generation_failed",
      from_status: "extracted",
      to_status: "extracted",
      notes: message,
      actor_id: actorId,
    }),
  });
};

const autoGenerateDraftsFromExtractedChecklist = async (args: {
  supabaseUrl: string;
  headers: Record<string, string>;
  organizationId: string;
  actorId: string | null;
  createdDocumentId: string;
  clientId: string;
}): Promise<void> => {
  const { supabaseUrl, headers, organizationId, actorId, createdDocumentId, clientId } = args;

  const existingDraftProgramLookup = await fetchJson<Array<{ id: string }>>(
    `${supabaseUrl}/rest/v1/assessment_draft_programs?select=id&assessment_document_id=eq.${encodeURIComponent(
      createdDocumentId,
    )}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`,
    { method: "GET", headers },
  );
  if (existingDraftProgramLookup.ok && Array.isArray(existingDraftProgramLookup.data) && existingDraftProgramLookup.data.length > 0) {
    return;
  }

  const checklistResult = await fetchJson<
    Array<
      AssessmentChecklistValueRow & {
        status: "not_started" | "drafted" | "verified" | "approved";
      }
    >
  >(
    `${supabaseUrl}/rest/v1/assessment_checklist_items?select=section_key,label,placeholder_key,value_text,value_json,status&organization_id=eq.${encodeURIComponent(
      organizationId,
    )}&assessment_document_id=eq.${encodeURIComponent(createdDocumentId)}&order=section_key.asc,created_at.asc`,
    { method: "GET", headers },
  );
  if (!checklistResult.ok) {
    return;
  }

  const checklistRows = checklistResult.data ?? [];
  const assessmentText = composeAssessmentTextFromChecklist(checklistRows).slice(0, MAX_GENERATION_ASSESSMENT_TEXT_CHARS);
  if (assessmentText.length < 20) {
    return;
  }

  const extractionResult = await fetchJson<AssessmentExtractionGenerationRow[]>(
    `${supabaseUrl}/rest/v1/assessment_extractions?select=section_key,field_key,label,value_text,value_json,source_span,status&organization_id=eq.${encodeURIComponent(
      organizationId,
    )}&assessment_document_id=eq.${encodeURIComponent(createdDocumentId)}&order=section_key.asc,created_at.asc`,
    { method: "GET", headers },
  );
  if (!extractionResult.ok) {
    return;
  }

  const clientResult = await fetchJson<Array<{ full_name: string | null }>>(
    `${supabaseUrl}/rest/v1/clients?select=full_name&id=eq.${encodeURIComponent(clientId)}&organization_id=eq.${encodeURIComponent(
      organizationId,
    )}&limit=1`,
    { method: "GET", headers },
  );
  const clientName = Array.isArray(clientResult.data) ? clientResult.data[0]?.full_name ?? undefined : undefined;

  const guidanceResult = await fetchJson<Array<{ guidance_text: string | null }>>(
    `${supabaseUrl}/rest/v1/ai_guidance_documents?select=guidance_text&guidance_key=eq.white_bible_core&is_active=eq.true&order=updated_at.desc&limit=1`,
    { method: "GET", headers },
  );
  const organizationGuidance = Array.isArray(guidanceResult.data) ? guidanceResult.data[0]?.guidance_text ?? "" : "";

  const generationPayload = buildGenerateProgramGoalsPayload({
    assessmentDocumentId: createdDocumentId,
    clientId,
    organizationId,
    clientDisplayName: clientName,
    organizationGuidance,
    checklistRows,
    extractionRows: extractionResult.data ?? [],
  });

  const generatedResult = await fetchJson<GeneratedDraftPayload>(`${supabaseUrl}/functions/v1/generate-program-goals`, {
    method: "POST",
    headers,
    body: JSON.stringify(generationPayload),
  });
  if (
    !generatedResult.ok ||
    !generatedResult.data ||
    !Array.isArray(generatedResult.data.programs) ||
    generatedResult.data.programs.length === 0 ||
    !Array.isArray(generatedResult.data.goals) ||
    generatedResult.data.goals.length === 0
  ) {
    const generatedError = (generatedResult.data as unknown as GeneratedDraftErrorPayload | null)?.error;
    await markAutoGenerationFailure({
      supabaseUrl,
      headers,
      createdDocumentId,
      organizationId,
      clientId,
      actorId,
      message:
        typeof generatedError === "string" && generatedError.trim().length > 0
          ? generatedError
          : "Automatic draft generation failed. You can retry with 'Generate with AI from Uploaded FBA'.",
    });
    return;
  }

  const minimumValidation = validateGoalMinimums(generatedResult.data.goals);
  if (!minimumValidation.valid) {
    await markAutoGenerationFailure({
      supabaseUrl,
      headers,
      createdDocumentId,
      organizationId,
      clientId,
      actorId,
      message:
        `Automatic draft generation failed minimum goal mix requirements: ` +
        `${minimumValidation.childCount} child, ${minimumValidation.parentCount} parent.`,
    });
    return;
  }

  const createdProgramResult = await fetchJson<Array<{ id: string; name: string }>>(`${supabaseUrl}/rest/v1/assessment_draft_programs`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify(generatedResult.data.programs.map((program) => ({
      assessment_document_id: createdDocumentId,
      organization_id: organizationId,
      client_id: clientId,
      name: program.name,
      description: program.description,
      rationale: program.rationale,
      summary_rationale: generatedResult.data.summary_rationale,
      confidence: generatedResult.data.confidence,
      evidence_refs: program.evidence_refs,
      review_flags: program.review_flags,
      accept_state: "pending",
    }))),
  });
  if (!createdProgramResult.ok || !Array.isArray(createdProgramResult.data) || !createdProgramResult.data[0]) {
    await markAutoGenerationFailure({
      supabaseUrl,
      headers,
      createdDocumentId,
      organizationId,
      clientId,
      actorId,
      message: "Automatic draft generation failed while creating draft program. Please retry manually.",
    });
    return;
  }

  const draftProgramByName = new Map(createdProgramResult.data.map((row) => [row.name.trim().toLowerCase(), row.id]));
  const goalWithoutProgram = generatedResult.data.goals.find(
    (goal) => !draftProgramByName.has(goal.program_name.trim().toLowerCase()),
  );
  if (goalWithoutProgram) {
    const insertedProgramIds = createdProgramResult.data.map((row) => row.id);
    if (insertedProgramIds.length > 0) {
      await fetchJson(
        `${supabaseUrl}/rest/v1/assessment_draft_programs?id=in.(${insertedProgramIds.join(",")})&organization_id=eq.${encodeURIComponent(
          organizationId,
        )}`,
        { method: "DELETE", headers },
      );
    }
    await markAutoGenerationFailure({
      supabaseUrl,
      headers,
      createdDocumentId,
      organizationId,
      clientId,
      actorId,
      message: `Automatic draft generation failed (missing_program_match): goal references unknown program '${goalWithoutProgram.program_name}'.`,
    });
    return;
  }

  const draftGoalsPayload = generatedResult.data.goals.map((goal) => ({
    assessment_document_id: createdDocumentId,
    draft_program_id: draftProgramByName.get(goal.program_name.trim().toLowerCase()) ?? null,
    organization_id: organizationId,
    client_id: clientId,
    program_name: goal.program_name,
    title: goal.title,
    description: goal.description,
    original_text: goal.original_text,
    goal_type: goal.goal_type,
    target_behavior: goal.target_behavior,
    measurement_type: goal.measurement_type,
    baseline_data: goal.baseline_data,
    target_criteria: goal.target_criteria,
    mastery_criteria: goal.mastery_criteria,
    maintenance_criteria: goal.maintenance_criteria,
    generalization_criteria: goal.generalization_criteria,
    objective_data_points: goal.objective_data_points,
    rationale: goal.rationale,
    evidence_refs: goal.evidence_refs,
    review_flags: goal.review_flags,
    accept_state: "pending",
  }));

  const createdGoalsResult = await fetchJson(`${supabaseUrl}/rest/v1/assessment_draft_goals`, {
    method: "POST",
    headers,
    body: JSON.stringify(draftGoalsPayload),
  });
  if (!createdGoalsResult.ok) {
    const insertedProgramIds = createdProgramResult.data.map((row) => row.id);
    if (insertedProgramIds.length > 0) {
      await fetchJson(
        `${supabaseUrl}/rest/v1/assessment_draft_programs?id=in.(${insertedProgramIds
          .map((id) => id)
          .join(",")})&organization_id=eq.${encodeURIComponent(organizationId)}`,
        { method: "DELETE", headers },
      );
    }
    await markAutoGenerationFailure({
      supabaseUrl,
      headers,
      createdDocumentId,
      organizationId,
      clientId,
      actorId,
      message: "Automatic draft generation failed while creating draft goals. Please retry manually.",
    });
    return;
  }

  await fetchJson(`${supabaseUrl}/rest/v1/assessment_documents?id=eq.${encodeURIComponent(createdDocumentId)}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      status: "drafted",
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
      action: "drafts_generated",
      from_status: "extracted",
      to_status: "drafted",
      actor_id: actorId,
    }),
  });
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
          },
        }),
      });
      void autoGenerateDraftsFromExtractedChecklist({
        supabaseUrl,
        headers,
        organizationId,
        actorId,
        createdDocumentId,
        clientId,
      }).catch((error) => {
        serverLogger.error("assessment-documents auto-generate workflow failed", { error });
      });
      return;
    }

    const extractionError = "Field extraction failed. Review checklist manually.";
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
      return jsonForRequest(request, Array.isArray(result.data) ? result.data[0] ?? null : null);
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
