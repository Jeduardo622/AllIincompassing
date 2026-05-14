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

const MIN_CHILD_GOALS = 20;
const MIN_PARENT_GOALS = 6;

const evidenceRefSchema = z.object({
  section_key: z.string().trim().min(1),
  source_span: z.string().trim().min(1),
});

const reviewFlagSchema = z.enum([
  "missing_baseline",
  "weak_measurement_definition",
  "unsupported_parent_goal",
  "ambiguous_mastery_threshold",
  "evidence_gap",
  "duplicate_risk",
  "clinician_confirmation_needed",
]);

const draftGoalSchema = z.object({
  program_name: z.string().trim().min(1),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  original_text: z.string().trim().min(1),
  goal_type: z.enum(["child", "parent"]),
  target_behavior: z.string().trim().min(1),
  measurement_type: z.string().trim().min(1),
  baseline_data: z.string().trim().min(1),
  target_criteria: z.string().trim().min(1),
  mastery_criteria: z.string().trim().min(1),
  maintenance_criteria: z.string().trim().min(1),
  generalization_criteria: z.string().trim().min(1),
  objective_data_points: z.array(z.string().trim().min(1)).min(1),
  rationale: z.string().trim().min(1),
  evidence_refs: z.array(evidenceRefSchema).min(1),
  review_flags: z.array(reviewFlagSchema),
});

const draftCreateSchema = z.object({
  assessment_document_id: z.string().uuid(),
  programs: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        description: z.string().trim().min(1),
        rationale: z.string().trim().min(1),
        evidence_refs: z.array(evidenceRefSchema).min(1),
        review_flags: z.array(reviewFlagSchema),
      }),
    )
    .min(1),
  summary_rationale: z.string().trim().min(1),
  confidence: z.enum(["low", "medium", "high"]),
  goals: z.array(draftGoalSchema).min(MIN_CHILD_GOALS + MIN_PARENT_GOALS),
});

const draftAutoGenerateSchema = z.object({
  assessment_document_id: z.string().uuid(),
  auto_generate: z.literal(true),
});

const draftUpdateSchema = z.object({
  draft_type: z.enum(["program", "goal"]),
  id: z.string().uuid(),
  accept_state: z.enum(["pending", "accepted", "rejected", "edited"]).optional(),
  review_notes: z.string().optional(),
  name: z.string().trim().optional(),
  description: z.string().trim().optional(),
  rationale: z.string().trim().optional(),
  title: z.string().trim().optional(),
  original_text: z.string().trim().optional(),
  goal_type: z.enum(["child", "parent"]).optional(),
  target_behavior: z.string().trim().optional(),
  measurement_type: z.string().trim().optional(),
  baseline_data: z.string().trim().optional(),
  target_criteria: z.string().trim().optional(),
  mastery_criteria: z.string().trim().optional(),
  maintenance_criteria: z.string().trim().optional(),
  generalization_criteria: z.string().trim().optional(),
  objective_data_points: z.array(z.record(z.unknown())).optional(),
  program_name: z.string().trim().optional(),
  evidence_refs: z.array(evidenceRefSchema).optional(),
  review_flags: z.array(reviewFlagSchema).optional(),
});

const isUuid = (value: string): boolean => z.string().uuid().safeParse(value).success;

interface AssessmentDocumentScopeRow {
  id: string;
  organization_id: string;
  client_id: string;
  status: string;
}

const AUTO_GENERATE_READY_DOCUMENT_STATUSES = new Set(["extracted", "extraction_failed"]);

interface AssessmentDraftProgramRow {
  id: string;
  assessment_document_id: string;
  organization_id: string;
  client_id: string;
  accept_state: "pending" | "accepted" | "rejected" | "edited";
}

interface AssessmentDraftGoalRow {
  id: string;
  assessment_document_id: string;
  organization_id: string;
  client_id: string;
  accept_state: "pending" | "accepted" | "rejected" | "edited";
}

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
    objective_data_points: Array<Record<string, unknown>>;
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

interface AssessmentStructuredSectionRow {
  id: string;
  section_key: string;
  field_key: string;
  section_index: number;
  payload: Record<string, unknown> | null;
  status: "not_started" | "drafted" | "verified" | "approved" | "rejected";
  required: boolean;
}

const stringifyPayloadValue = (value: unknown): string => {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
};

const getPayloadString = (payload: Record<string, unknown>, keys: string[], fallback = ""): string => {
  for (const key of keys) {
    const value = stringifyPayloadValue(payload[key]);
    if (value.length > 0) {
      return value;
    }
  }
  return fallback;
};

const getPayloadRows = (payload: Record<string, unknown>, keys: string[]): Array<Record<string, unknown>> => {
  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item));
    }
  }
  return [];
};

const normalizeGoalTitleKey = (title: string): string => title.trim().replace(/\s+/g, " ").toLowerCase();

const splitGoalTitleSuffix = (title: string): { baseTitle: string; suffixIndex: number } => {
  const trimmedTitle = title.trim();
  const suffixMatch = trimmedTitle.match(/^(.*)\s+\((\d+)\)$/);
  if (!suffixMatch) {
    return { baseTitle: trimmedTitle, suffixIndex: 1 };
  }

  const parsedSuffix = Number.parseInt(suffixMatch[2] ?? "", 10);
  if (!Number.isFinite(parsedSuffix) || parsedSuffix < 2) {
    return { baseTitle: trimmedTitle, suffixIndex: 1 };
  }

  return { baseTitle: (suffixMatch[1] ?? trimmedTitle).trim(), suffixIndex: parsedSuffix };
};

const ensureUniqueGoalTitle = (title: string, seenTitles: Map<string, number>): string => {
  const { baseTitle, suffixIndex } = splitGoalTitleSuffix(title);
  const baseKey = `base:${normalizeGoalTitleKey(baseTitle)}`;
  const titleKeyFor = (candidate: string) => `title:${normalizeGoalTitleKey(candidate)}`;
  const formatTitle = (index: number) => (index === 1 ? baseTitle : `${baseTitle} (${index})`);

  let candidateIndex = suffixIndex;
  let candidateTitle = formatTitle(candidateIndex);
  if (seenTitles.has(titleKeyFor(candidateTitle))) {
    candidateIndex = Math.max((seenTitles.get(baseKey) ?? 1) + 1, suffixIndex + 1);
    candidateTitle = formatTitle(candidateIndex);
    while (seenTitles.has(titleKeyFor(candidateTitle))) {
      candidateIndex += 1;
      candidateTitle = formatTitle(candidateIndex);
    }
  }

  seenTitles.set(titleKeyFor(candidateTitle), candidateIndex);
  seenTitles.set(baseKey, Math.max(seenTitles.get(baseKey) ?? 0, candidateIndex));
  return candidateTitle;
};

const buildDeterministicDraftPayload = (
  structuredSections: AssessmentStructuredSectionRow[],
): GeneratedDraftPayload | null => {
  const approvedGoalSections = structuredSections.filter(
    (section) =>
      section.status === "approved" &&
      section.payload &&
      [
        "CALOPTIMA_FBA_TARGET_REPLACEMENT_GOALS",
        "CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS",
        "CALOPTIMA_FBA_PARENT_GOALS",
      ].includes(section.field_key),
  );
  if (approvedGoalSections.length === 0) {
    return null;
  }

  const programNames = new Set<string>();
  const seenGoalTitles = new Map<string, number>();
  const goals = approvedGoalSections.map((section, index) => {
    const payload = section.payload ?? {};
    const isParentGoal =
      section.field_key === "CALOPTIMA_FBA_PARENT_GOALS" ||
      getPayloadString(payload, ["goal_type"]).toLowerCase() === "parent";
    const programName = getPayloadString(payload, ["program_name", "program", "domain"], isParentGoal ? "Parent Training" : "Behavior Treatment");
    programNames.add(programName);
    const title = ensureUniqueGoalTitle(
      getPayloadString(payload, ["title", "goal", "goal_title"], `${isParentGoal ? "Parent" : "Child"} Goal ${index + 1}`),
      seenGoalTitles,
    );
    const description = getPayloadString(payload, ["description", "goal_description", "objective"], title);
    const originalText = getPayloadString(payload, ["original_text", "source_text", "raw_text"], description);
    return {
      program_name: programName,
      title,
      description,
      original_text: originalText,
      goal_type: isParentGoal ? ("parent" as const) : ("child" as const),
      target_behavior: getPayloadString(payload, ["target_behavior", "behavior", "skill"], title),
      measurement_type: getPayloadString(payload, ["measurement_type", "measure", "data_collection"], "frequency"),
      baseline_data: getPayloadString(payload, ["baseline_data", "baseline"], "Baseline pending staff review"),
      target_criteria: getPayloadString(payload, ["target_criteria", "criteria", "objective"], description),
      mastery_criteria: getPayloadString(payload, ["mastery_criteria", "mastery"], "Mastery criteria pending staff review"),
      maintenance_criteria: getPayloadString(payload, ["maintenance_criteria", "maintenance"], "Maintenance criteria pending staff review"),
      generalization_criteria: getPayloadString(payload, ["generalization_criteria", "generalization"], "Generalization criteria pending staff review"),
      objective_data_points: getPayloadRows(payload, ["objective_data_points", "measurement_rows", "data_points"]),
      rationale: getPayloadString(payload, ["rationale"], "Derived deterministically from approved CalOptima structured section."),
      evidence_refs: [
        {
          section_key: section.section_key,
          source_span: `${section.field_key}#${section.section_index}`,
        },
      ],
      review_flags: [] as GeneratedDraftPayload["goals"][number]["review_flags"],
    };
  });

  return {
    programs: Array.from(programNames).map((name) => ({
      name,
      description: `Program derived from approved CalOptima structured goal sections for ${name}.`,
      rationale: "Deterministic conversion from staff-approved CalOptima FBA sections.",
      evidence_refs: [{ section_key: "caloptima_structured_sections", source_span: name }],
      review_flags: [],
    })),
    goals,
    summary_rationale: "Drafts were created from approved CalOptima structured sections without AI generation.",
    confidence: "high",
  };
};

const validateGoalMinimums = (
  goals: Array<{ goal_type: "child" | "parent" }>,
): { valid: true } | { valid: false; childCount: number; parentCount: number } => {
  const childCount = goals.filter((goal) => goal.goal_type === "child").length;
  const parentCount = goals.filter((goal) => goal.goal_type === "parent").length;
  if (childCount < MIN_CHILD_GOALS || parentCount < MIN_PARENT_GOALS) {
    return { valid: false, childCount, parentCount };
  }
  return { valid: true };
};

const getAssessmentDocument = async (
  supabaseUrl: string,
  headers: Record<string, string>,
  organizationId: string,
  assessmentDocumentId: string,
): Promise<AssessmentDocumentScopeRow | null> => {
  const lookupUrl = `${supabaseUrl}/rest/v1/assessment_documents?select=id,organization_id,client_id,status&id=eq.${encodeURIComponent(
    assessmentDocumentId,
  )}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`;
  const lookup = await fetchJson<AssessmentDocumentScopeRow[]>(lookupUrl, { method: "GET", headers });
  if (!lookup.ok || !Array.isArray(lookup.data) || !lookup.data[0]) {
    return null;
  }
  return lookup.data[0];
};

const draftsAlreadyExistForDocument = async (args: {
  supabaseUrl: string;
  headers: Record<string, string>;
  organizationId: string;
  assessmentDocumentId: string;
}): Promise<boolean> => {
  const { supabaseUrl, headers, organizationId, assessmentDocumentId } = args;
  const [programsLookup, goalsLookup] = await Promise.all([
    fetchJson<Array<{ id: string }>>(
      `${supabaseUrl}/rest/v1/assessment_draft_programs?select=id&organization_id=eq.${encodeURIComponent(
        organizationId,
      )}&assessment_document_id=eq.${encodeURIComponent(assessmentDocumentId)}&limit=1`,
      { method: "GET", headers },
    ),
    fetchJson<Array<{ id: string }>>(
      `${supabaseUrl}/rest/v1/assessment_draft_goals?select=id&organization_id=eq.${encodeURIComponent(
        organizationId,
      )}&assessment_document_id=eq.${encodeURIComponent(assessmentDocumentId)}&limit=1`,
      { method: "GET", headers },
    ),
  ]);

  const hasPrograms = programsLookup.ok && Array.isArray(programsLookup.data) && programsLookup.data.length > 0;
  const hasGoals = goalsLookup.ok && Array.isArray(goalsLookup.data) && goalsLookup.data.length > 0;
  return hasPrograms || hasGoals;
};

const persistDraftRows = async (args: {
  supabaseUrl: string;
  headers: Record<string, string>;
  organizationId: string;
  actorId: string | null;
  document: AssessmentDocumentScopeRow;
  assessmentDocumentId: string;
  payload: GeneratedDraftPayload;
}) => {
  const { supabaseUrl, headers, organizationId, actorId, document, assessmentDocumentId, payload } = args;
  const createProgramPayload = payload.programs.map((program) => ({
    assessment_document_id: assessmentDocumentId,
    organization_id: organizationId,
    client_id: document.client_id,
    name: program.name,
    description: program.description,
    rationale: program.rationale,
    summary_rationale: payload.summary_rationale,
    confidence: payload.confidence,
    evidence_refs: program.evidence_refs,
    review_flags: program.review_flags,
    accept_state: "pending",
  }));

  const createProgramResult = await fetchJson<Array<{ id: string; name: string }>>(
    `${supabaseUrl}/rest/v1/assessment_draft_programs`,
    {
      method: "POST",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify(createProgramPayload),
    },
  );

  if (!createProgramResult.ok || !Array.isArray(createProgramResult.data) || !createProgramResult.data[0]) {
    return { ok: false as const, status: createProgramResult.status || 500, error: "Failed to create draft program" };
  }

  const createdProgramByName = new Map(
    createProgramResult.data.map((row) => [row.name.trim().toLowerCase(), row.id]),
  );
  const missingProgramReference = payload.goals.find(
    (goal) => !createdProgramByName.has(goal.program_name.trim().toLowerCase()),
  );
  if (missingProgramReference) {
    const insertedProgramIds = createProgramResult.data.map((row) => row.id);
    if (insertedProgramIds.length > 0) {
      await fetchJson(
        `${supabaseUrl}/rest/v1/assessment_draft_programs?id=in.(${insertedProgramIds.join(",")})&organization_id=eq.${encodeURIComponent(
          organizationId,
        )}`,
        { method: "DELETE", headers },
      );
    }
    return {
      ok: false as const,
      status: 409,
      error: `missing_program_match: Generated goal references missing program_name: ${missingProgramReference.program_name}`,
    };
  }

  const createGoalsPayload = payload.goals.map((goal) => ({
    draft_program_id: createdProgramByName.get(goal.program_name.trim().toLowerCase()) ?? null,
    assessment_document_id: assessmentDocumentId,
    organization_id: organizationId,
    client_id: document.client_id,
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

  const createGoalsResult = await fetchJson(`${supabaseUrl}/rest/v1/assessment_draft_goals`, {
    method: "POST",
    headers,
    body: JSON.stringify(createGoalsPayload),
  });

  if (!createGoalsResult.ok) {
    const insertedProgramIds = createProgramResult.data.map((row) => row.id);
    if (insertedProgramIds.length > 0) {
      await fetchJson(
        `${supabaseUrl}/rest/v1/assessment_draft_programs?id=in.(${insertedProgramIds.join(",")})&organization_id=eq.${encodeURIComponent(
          organizationId,
        )}`,
        { method: "DELETE", headers },
      );
    }
    return { ok: false as const, status: createGoalsResult.status || 500, error: "Failed to create draft goals" };
  }

  await fetchJson(`${supabaseUrl}/rest/v1/assessment_documents?id=eq.${encodeURIComponent(document.id)}`, {
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
      assessment_document_id: document.id,
      organization_id: organizationId,
      client_id: document.client_id,
      item_type: "document",
      item_id: document.id,
      action: "drafts_generated",
      from_status: document.status,
      to_status: "drafted",
      actor_id: actorId,
    }),
  });

  return { ok: true as const, draftProgramId: createProgramResult.data[0].id };
};

export async function assessmentDraftsHandler(request: Request): Promise<Response> {
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

  if (request.method === "GET") {
    const url = new URL(request.url);
    const assessmentDocumentId = url.searchParams.get("assessment_document_id");
    if (!assessmentDocumentId) {
      return json({ error: "assessment_document_id is required" }, 400);
    }
    if (!isUuid(assessmentDocumentId)) {
      return json({ error: "assessment_document_id must be a valid UUID" }, 400);
    }

    const document = await getAssessmentDocument(supabaseUrl, headers, organizationId, assessmentDocumentId);
    if (!document) {
      // If the document was just deleted (or is otherwise unavailable), return an empty
      // payload so the UI can converge without surfacing transient auth/scope errors.
      return json({
        assessment_document_id: assessmentDocumentId,
        programs: [],
        goals: [],
      });
    }

    const [programsResult, goalsResult] = await Promise.all([
      fetchJson(
        `${supabaseUrl}/rest/v1/assessment_draft_programs?select=*&organization_id=eq.${encodeURIComponent(
          organizationId,
        )}&assessment_document_id=eq.${encodeURIComponent(assessmentDocumentId)}&order=created_at.asc`,
        { method: "GET", headers },
      ),
      fetchJson(
        `${supabaseUrl}/rest/v1/assessment_draft_goals?select=*&organization_id=eq.${encodeURIComponent(
          organizationId,
        )}&assessment_document_id=eq.${encodeURIComponent(assessmentDocumentId)}&order=created_at.asc`,
        { method: "GET", headers },
      ),
    ]);

    if (!programsResult.ok || !goalsResult.ok) {
      return json({ error: "Failed to load assessment drafts" }, 500);
    }

    return json({
      assessment_document_id: assessmentDocumentId,
      programs: programsResult.data ?? [],
      goals: goalsResult.data ?? [],
    });
  }

  if (request.method === "POST") {
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const parsedManual = draftCreateSchema.safeParse(payload);
    const parsedAuto = draftAutoGenerateSchema.safeParse(payload);
    if (!parsedManual.success && !parsedAuto.success) {
      return json({ error: "Invalid request body" }, 400);
    }

    const assessmentDocumentId = parsedManual.success
      ? parsedManual.data.assessment_document_id
      : parsedAuto.data.assessment_document_id;
    const document = await getAssessmentDocument(supabaseUrl, headers, organizationId, assessmentDocumentId);
    if (!document) {
      return json({ error: "assessment_document_id is not in scope for this organization" }, 403);
    }

    const actorId = getAccessTokenSubject(accessToken);
    if (parsedManual.success) {
      const minimumValidation = validateGoalMinimums(parsedManual.data.goals);
      if (!minimumValidation.valid) {
        return json(
          {
            error: `Draft must include at least ${MIN_CHILD_GOALS} child goals and ${MIN_PARENT_GOALS} parent goals.`,
            child_goal_count: minimumValidation.childCount,
            parent_goal_count: minimumValidation.parentCount,
          },
          409,
        );
      }
      const result = await persistDraftRows({
        supabaseUrl,
        headers,
        organizationId,
        actorId,
        document,
        assessmentDocumentId,
        payload: {
          programs: parsedManual.data.programs,
          goals: parsedManual.data.goals,
          summary_rationale: parsedManual.data.summary_rationale,
          confidence: parsedManual.data.confidence,
        },
      });
      if (!result.ok) {
        return json({ error: result.error }, result.status);
      }
      return json({ draft_program_id: result.draftProgramId }, 201);
    }

    const hasExistingDrafts = await draftsAlreadyExistForDocument({
      supabaseUrl,
      headers,
      organizationId,
      assessmentDocumentId,
    });
    if (hasExistingDrafts) {
      return json({ error: "Drafts already exist for this assessment. Review existing drafts instead of regenerating." }, 409);
    }

    if (!AUTO_GENERATE_READY_DOCUMENT_STATUSES.has(document.status)) {
      return json({ error: "Assessment extraction must complete before deterministic drafts can be generated." }, 409);
    }

    const structuredResult = await fetchJson<AssessmentStructuredSectionRow[]>(
      `${supabaseUrl}/rest/v1/assessment_structured_sections?select=id,section_key,field_key,section_index,payload,status,required&organization_id=eq.${encodeURIComponent(
        organizationId,
      )}&assessment_document_id=eq.${encodeURIComponent(
        assessmentDocumentId,
      )}&order=section_key.asc,field_key.asc,section_index.asc`,
      { method: "GET", headers },
    );
    if (!structuredResult.ok) {
      return json({ error: "Failed to load structured assessment sections for deterministic draft generation." }, structuredResult.status || 500);
    }
    const generatedPayload = buildDeterministicDraftPayload(structuredResult.data ?? []);
    if (!generatedPayload) {
      return json({ error: "No approved structured CalOptima goal sections are available for deterministic draft generation." }, 409);
    }
    const minimumValidation = validateGoalMinimums(generatedPayload.goals);
    if (!minimumValidation.valid) {
      return json(
        {
          error: `Deterministic draft must include at least ${MIN_CHILD_GOALS} child goals and ${MIN_PARENT_GOALS} parent goals.`,
          child_goal_count: minimumValidation.childCount,
          parent_goal_count: minimumValidation.parentCount,
        },
        409,
      );
    }

    const persisted = await persistDraftRows({
      supabaseUrl,
      headers,
      organizationId,
      actorId,
      document,
      assessmentDocumentId,
      payload: generatedPayload,
    });
    if (!persisted.ok) {
      return json({ error: persisted.error }, persisted.status);
    }

    return json({ draft_program_id: persisted.draftProgramId, auto_generated: false, deterministic: true }, 201);
  }

  if (request.method === "PATCH") {
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const parsed = draftUpdateSchema.safeParse(payload);
    if (!parsed.success) {
      return json({ error: "Invalid request body" }, 400);
    }

    const actorId = getAccessTokenSubject(accessToken);
    const now = new Date().toISOString();

    if (parsed.data.draft_type === "program") {
      const lookup = await fetchJson<AssessmentDraftProgramRow[]>(
        `${supabaseUrl}/rest/v1/assessment_draft_programs?select=id,assessment_document_id,organization_id,client_id,accept_state&id=eq.${encodeURIComponent(
          parsed.data.id,
        )}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`,
        { method: "GET", headers },
      );
      const existing = Array.isArray(lookup.data) ? lookup.data[0] : null;
      if (!lookup.ok || !existing) {
        return json({ error: "Draft program not found in organization scope" }, 404);
      }

      const updatePayload: Record<string, unknown> = {
        updated_at: now,
        reviewed_by: actorId,
        reviewed_at: now,
      };
      if (parsed.data.accept_state !== undefined) {
        updatePayload.accept_state = parsed.data.accept_state;
      }
      if (parsed.data.review_notes !== undefined) {
        updatePayload.review_notes = parsed.data.review_notes;
      }
      if (parsed.data.name !== undefined) {
        updatePayload.name = parsed.data.name;
      }
      if (parsed.data.description !== undefined) {
        updatePayload.description = parsed.data.description;
      }
      if (parsed.data.rationale !== undefined) {
        updatePayload.rationale = parsed.data.rationale;
      }
      if (parsed.data.evidence_refs !== undefined) {
        updatePayload.evidence_refs = parsed.data.evidence_refs;
      }
      if (parsed.data.review_flags !== undefined) {
        updatePayload.review_flags = parsed.data.review_flags;
      }

      const update = await fetchJson<Array<Record<string, unknown>>>(
        `${supabaseUrl}/rest/v1/assessment_draft_programs?id=eq.${encodeURIComponent(existing.id)}`,
        {
          method: "PATCH",
          headers: { ...headers, Prefer: "return=representation" },
          body: JSON.stringify(updatePayload),
        },
      );
      if (!update.ok || !Array.isArray(update.data) || !update.data[0]) {
        return json({ error: "Failed to update draft program" }, update.status || 500);
      }

      await fetchJson(`${supabaseUrl}/rest/v1/assessment_review_events`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          assessment_document_id: existing.assessment_document_id,
          organization_id: organizationId,
          client_id: existing.client_id,
          item_type: "draft_program",
          item_id: existing.id,
          action: "draft_program_updated",
          from_status: existing.accept_state,
          to_status: parsed.data.accept_state ?? existing.accept_state,
          notes: parsed.data.review_notes ?? null,
          actor_id: actorId,
        }),
      });

      return json(update.data[0]);
    }

    const lookup = await fetchJson<AssessmentDraftGoalRow[]>(
      `${supabaseUrl}/rest/v1/assessment_draft_goals?select=id,assessment_document_id,organization_id,client_id,accept_state&id=eq.${encodeURIComponent(
        parsed.data.id,
      )}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`,
      { method: "GET", headers },
    );
    const existing = Array.isArray(lookup.data) ? lookup.data[0] : null;
    if (!lookup.ok || !existing) {
      return json({ error: "Draft goal not found in organization scope" }, 404);
    }

    const updatePayload: Record<string, unknown> = {
      updated_at: now,
      reviewed_by: actorId,
      reviewed_at: now,
    };
    if (parsed.data.accept_state !== undefined) {
      updatePayload.accept_state = parsed.data.accept_state;
    }
    if (parsed.data.review_notes !== undefined) {
      updatePayload.review_notes = parsed.data.review_notes;
    }
    if (parsed.data.title !== undefined) {
      updatePayload.title = parsed.data.title;
    }
    if (parsed.data.description !== undefined) {
      updatePayload.description = parsed.data.description;
    }
    if (parsed.data.original_text !== undefined) {
      updatePayload.original_text = parsed.data.original_text;
    }
    if (parsed.data.goal_type !== undefined) {
      updatePayload.goal_type = parsed.data.goal_type;
    }
    if (parsed.data.target_behavior !== undefined) {
      updatePayload.target_behavior = parsed.data.target_behavior;
    }
    if (parsed.data.measurement_type !== undefined) {
      updatePayload.measurement_type = parsed.data.measurement_type;
    }
    if (parsed.data.baseline_data !== undefined) {
      updatePayload.baseline_data = parsed.data.baseline_data;
    }
    if (parsed.data.target_criteria !== undefined) {
      updatePayload.target_criteria = parsed.data.target_criteria;
    }
    if (parsed.data.mastery_criteria !== undefined) {
      updatePayload.mastery_criteria = parsed.data.mastery_criteria;
    }
    if (parsed.data.maintenance_criteria !== undefined) {
      updatePayload.maintenance_criteria = parsed.data.maintenance_criteria;
    }
    if (parsed.data.generalization_criteria !== undefined) {
      updatePayload.generalization_criteria = parsed.data.generalization_criteria;
    }
    if (parsed.data.objective_data_points !== undefined) {
      updatePayload.objective_data_points = parsed.data.objective_data_points;
    }
    if (parsed.data.program_name !== undefined) {
      updatePayload.program_name = parsed.data.program_name;
    }
    if (parsed.data.rationale !== undefined) {
      updatePayload.rationale = parsed.data.rationale;
    }
    if (parsed.data.evidence_refs !== undefined) {
      updatePayload.evidence_refs = parsed.data.evidence_refs;
    }
    if (parsed.data.review_flags !== undefined) {
      updatePayload.review_flags = parsed.data.review_flags;
    }

    const update = await fetchJson<Array<Record<string, unknown>>>(
      `${supabaseUrl}/rest/v1/assessment_draft_goals?id=eq.${encodeURIComponent(existing.id)}`,
      {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify(updatePayload),
      },
    );
    if (!update.ok || !Array.isArray(update.data) || !update.data[0]) {
      return json({ error: "Failed to update draft goal" }, update.status || 500);
    }

    await fetchJson(`${supabaseUrl}/rest/v1/assessment_review_events`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        assessment_document_id: existing.assessment_document_id,
        organization_id: organizationId,
        client_id: existing.client_id,
        item_type: "draft_goal",
        item_id: existing.id,
        action: "draft_goal_updated",
        from_status: existing.accept_state,
        to_status: parsed.data.accept_state ?? existing.accept_state,
        notes: parsed.data.review_notes ?? null,
        actor_id: actorId,
      }),
    });

    return json(update.data[0]);
  }

  return json({ error: "Method not allowed" }, 405);
}
