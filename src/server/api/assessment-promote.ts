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

const promoteSchema = z.object({
  assessment_document_id: z.string().uuid(),
});

interface AssessmentDocumentRow {
  id: string;
  organization_id: string;
  client_id: string;
  status: string;
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
  target_behavior: string | null;
  measurement_type: string | null;
  baseline_data: string | null;
  target_criteria: string | null;
  mastery_criteria: string | null;
  maintenance_criteria: string | null;
  generalization_criteria: string | null;
  objective_data_points: Array<Record<string, unknown>> | null;
  accept_state: "pending" | "accepted" | "rejected" | "edited";
}

const normalizeTitle = (value: string): string => value.trim().replace(/\s+/g, " ").toLowerCase();

const isMinGoalQuality = (goal: DraftGoalRow): boolean =>
  goal.title.trim().length >= 3 && goal.description.trim().length >= 10 && goal.original_text.trim().length >= 10;

export async function assessmentPromoteHandler(request: Request): Promise<Response> {
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

  const parsed = promoteSchema.safeParse(payload);
  if (!parsed.success) {
    return json({ error: "Invalid request body" }, 400);
  }

  const { supabaseUrl, anonKey } = getSupabaseConfig();
  const headers = {
    "Content-Type": "application/json",
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
  };

  const docLookup = await fetchJson<AssessmentDocumentRow[]>(
    `${supabaseUrl}/rest/v1/assessment_documents?select=id,organization_id,client_id,status&id=eq.${encodeURIComponent(
      parsed.data.assessment_document_id,
    )}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`,
    { method: "GET", headers },
  );
  const document = Array.isArray(docLookup.data) ? docLookup.data[0] : null;
  if (!docLookup.ok || !document) {
    return json({ error: "assessment_document_id is not in scope for this organization" }, 403);
  }

  const [draftProgramsResult, draftGoalsResult] = await Promise.all([
    fetchJson<DraftProgramRow[]>(
      `${supabaseUrl}/rest/v1/assessment_draft_programs?select=id,name,description,accept_state&organization_id=eq.${encodeURIComponent(
        organizationId,
      )}&assessment_document_id=eq.${encodeURIComponent(parsed.data.assessment_document_id)}&order=created_at.asc`,
      { method: "GET", headers },
    ),
    fetchJson<DraftGoalRow[]>(
      `${supabaseUrl}/rest/v1/assessment_draft_goals?select=id,title,description,original_text,target_behavior,measurement_type,baseline_data,target_criteria,mastery_criteria,maintenance_criteria,generalization_criteria,objective_data_points,accept_state&organization_id=eq.${encodeURIComponent(
        organizationId,
      )}&assessment_document_id=eq.${encodeURIComponent(parsed.data.assessment_document_id)}&order=created_at.asc`,
      { method: "GET", headers },
    ),
  ]);

  if (!draftProgramsResult.ok || !draftGoalsResult.ok) {
    return json({ error: "Failed to evaluate promote preconditions" }, 500);
  }

  const acceptedPrograms = (draftProgramsResult.data ?? []).filter(
    (program) => program.accept_state === "accepted" || program.accept_state === "edited",
  );
  const acceptedGoals = (draftGoalsResult.data ?? []).filter(
    (goal) => goal.accept_state === "accepted" || goal.accept_state === "edited",
  );

  if (acceptedPrograms.length === 0) {
    return json({ error: "At least one accepted draft program is required before promotion." }, 409);
  }
  if (acceptedGoals.length === 0) {
    return json({ error: "At least one accepted draft goal is required before promotion." }, 409);
  }

  const lowQualityGoals = acceptedGoals.filter((goal) => !isMinGoalQuality(goal));
  if (lowQualityGoals.length > 0) {
    return json(
      {
        error: "Accepted goals must include minimally complete title, description, and original text before promotion.",
        invalid_goal_count: lowQualityGoals.length,
      },
      409,
    );
  }

  const seenGoalTitles = new Set<string>();
  const duplicateGoalTitles = new Set<string>();
  acceptedGoals.forEach((goal) => {
    const normalized = normalizeTitle(goal.title);
    if (!normalized) {
      return;
    }
    if (seenGoalTitles.has(normalized)) {
      duplicateGoalTitles.add(goal.title.trim());
      return;
    }
    seenGoalTitles.add(normalized);
  });
  if (duplicateGoalTitles.size > 0) {
    return json(
      {
        error: "Duplicate accepted goal titles detected. Resolve duplicates before promotion.",
        duplicate_goal_titles: Array.from(duplicateGoalTitles.values()),
      },
      409,
    );
  }

  const selectedProgram = acceptedPrograms[0];
  const createProgramResult = await fetchJson<Array<{ id: string }>>(`${supabaseUrl}/rest/v1/programs`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify({
      organization_id: organizationId,
      client_id: document.client_id,
      name: selectedProgram.name,
      description: selectedProgram.description ?? null,
      status: "active",
    }),
  });

  if (!createProgramResult.ok || !Array.isArray(createProgramResult.data) || !createProgramResult.data[0]) {
    return json({ error: "Failed to create production program" }, createProgramResult.status || 500);
  }

  const createdProgramId = createProgramResult.data[0].id;
  const createGoalsPayload = acceptedGoals.map((goal) => ({
    organization_id: organizationId,
    client_id: document.client_id,
    program_id: createdProgramId,
    title: goal.title,
    description: goal.description,
    original_text: goal.original_text,
    target_behavior: goal.target_behavior,
    measurement_type: goal.measurement_type,
    baseline_data: goal.baseline_data,
    target_criteria: goal.target_criteria,
    mastery_criteria: goal.mastery_criteria,
    maintenance_criteria: goal.maintenance_criteria,
    generalization_criteria: goal.generalization_criteria,
    objective_data_points: goal.objective_data_points ?? [],
    status: "active",
  }));

  const createGoalsResult = await fetchJson<Array<{ id: string }>>(`${supabaseUrl}/rest/v1/goals`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify(createGoalsPayload),
  });

  if (!createGoalsResult.ok) {
    return json({ error: "Failed to create production goals" }, createGoalsResult.status || 500);
  }

  const actorId = getAccessTokenSubject(accessToken);
  const now = new Date().toISOString();
  await Promise.all([
    fetchJson(`${supabaseUrl}/rest/v1/assessment_documents?id=eq.${encodeURIComponent(document.id)}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        status: "approved",
        approved_at: now,
        updated_at: now,
      }),
    }),
    fetchJson(`${supabaseUrl}/rest/v1/assessment_review_events`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        assessment_document_id: document.id,
        organization_id: organizationId,
        client_id: document.client_id,
        item_type: "document",
        item_id: document.id,
        action: "promoted_to_production",
        from_status: document.status,
        to_status: "approved",
        actor_id: actorId,
        event_payload: {
          created_program_id: createdProgramId,
          created_goal_count: Array.isArray(createGoalsResult.data) ? createGoalsResult.data.length : 0,
        },
      }),
    }),
  ]);

  return json({
    assessment_document_id: document.id,
    created_program_id: createdProgramId,
    created_goal_count: Array.isArray(createGoalsResult.data) ? createGoalsResult.data.length : 0,
  });
}
