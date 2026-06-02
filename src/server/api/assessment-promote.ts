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
  template_type?: string | null;
}

interface DraftProgramRow {
  id: string;
  name: string;
  description: string | null;
  accept_state: "pending" | "accepted" | "rejected" | "edited";
}

interface DraftGoalRow {
  id: string;
  draft_program_id: string | null;
  title: string;
  description: string;
  original_text: string;
  goal_type: "child" | "parent";
  target_behavior: string | null;
  measurement_type: string | null;
  baseline_data: string | null;
  target_criteria: string | null;
  mastery_criteria: string | null;
  maintenance_criteria: string | null;
  generalization_criteria: string | null;
  objective_data_points: Array<Record<string, unknown> | string> | null;
  accept_state: "pending" | "accepted" | "rejected" | "edited";
}

const normalizeTitle = (value: string): string => value.trim().replace(/\s+/g, " ").toLowerCase();

const isMinGoalQuality = (goal: DraftGoalRow): boolean =>
  goal.title.trim().length >= 3 && goal.description.trim().length >= 10 && goal.original_text.trim().length >= 10;

const buildInFilter = (ids: string[]): string => `in.(${ids.map((id) => encodeURIComponent(id)).join(",")})`;

const toNumberOrNull = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const toStringOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const normalizeGoalDataPoint = (point: Record<string, unknown> | string): Record<string, unknown> =>
  typeof point === "string" ? { label: point, raw_text: point } : point;

const PROMOTED_ASSESSMENT_STATUSES = new Set(["approved", "promoted"]);
const PROMOTION_READY_STATUS = "drafted";
const PROMOTION_LOCK_STATUS = "extracted";
const IEHP_ASSESSMENT_TEMPLATE_TYPE = "iehp_fba";

const buildAssessmentRequiredApprovalLookups = (args: {
  supabaseUrl: string;
  organizationId: string;
  assessmentDocumentId: string;
  headers: Record<string, string>;
}) => {
  const { supabaseUrl, organizationId, assessmentDocumentId, headers } = args;
  return Promise.all([
    fetchJson<Array<{ id: string }>>(
      `${supabaseUrl}/rest/v1/assessment_checklist_items?select=id&organization_id=eq.${encodeURIComponent(
        organizationId,
      )}&assessment_document_id=eq.${encodeURIComponent(assessmentDocumentId)}&required=is.true&status=neq.approved`,
      { method: "GET", headers },
    ),
    fetchJson<Array<{ id: string }>>(
      `${supabaseUrl}/rest/v1/assessment_structured_sections?select=id&organization_id=eq.${encodeURIComponent(
        organizationId,
      )}&assessment_document_id=eq.${encodeURIComponent(assessmentDocumentId)}&required=is.true&status=neq.approved`,
      { method: "GET", headers },
    ),
  ]);
};

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
    `${supabaseUrl}/rest/v1/assessment_documents?select=id,organization_id,client_id,status,template_type&id=eq.${encodeURIComponent(
      parsed.data.assessment_document_id,
    )}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`,
    { method: "GET", headers },
  );
  const document = Array.isArray(docLookup.data) ? docLookup.data[0] : null;
  if (!docLookup.ok || !document) {
    return json({ error: "assessment_document_id is not in scope for this organization" }, 403);
  }
  if (PROMOTED_ASSESSMENT_STATUSES.has(document.status)) {
    return json({ error: "Assessment has already been approved and promoted to live records." }, 409);
  }
  if (document.template_type === IEHP_ASSESSMENT_TEMPLATE_TYPE) {
    const [unapprovedChecklistResult, unapprovedStructuredResult] = await buildAssessmentRequiredApprovalLookups({
      supabaseUrl,
      organizationId,
      assessmentDocumentId: parsed.data.assessment_document_id,
      headers,
    });
    if (!unapprovedChecklistResult.ok || !unapprovedStructuredResult.ok) {
      return json({ error: "Failed to evaluate IEHP review completion preconditions" }, 500);
    }

    const unapprovedChecklistCount = Array.isArray(unapprovedChecklistResult.data) ? unapprovedChecklistResult.data.length : 0;
    const unapprovedStructuredCount = Array.isArray(unapprovedStructuredResult.data) ? unapprovedStructuredResult.data.length : 0;
    const unresolvedRequiredCount = unapprovedChecklistCount + unapprovedStructuredCount;
    if (unresolvedRequiredCount > 0) {
      return json(
        {
          error: `Required checklist and structured review rows must be approved before publishing this IEHP assessment.`,
          unresolved_required_count: unresolvedRequiredCount,
        },
        409,
      );
    }

    const now = new Date().toISOString();
    const actorId = getAccessTokenSubject(accessToken);
    const finalizeReviewedAssessmentResult = await fetchJson<AssessmentDocumentRow[]>(
      `${supabaseUrl}/rest/v1/assessment_documents?id=eq.${encodeURIComponent(document.id)}&status=eq.${encodeURIComponent(document.status)}`,
      {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify({
          status: "approved",
          approved_at: now,
          updated_at: now,
        }),
      },
    );
    const finalizedDocument = Array.isArray(finalizeReviewedAssessmentResult.data)
      ? finalizeReviewedAssessmentResult.data[0]
      : null;
    if (!finalizeReviewedAssessmentResult.ok) {
      return json({ error: "Failed to finalize reviewed assessment." }, finalizeReviewedAssessmentResult.status || 500);
    }
    if (!finalizedDocument) {
      return json({ error: "Assessment review state changed before publish completed. Refresh and retry." }, 409);
    }

    const createReviewedEventResult = await fetchJson(`${supabaseUrl}/rest/v1/assessment_review_events`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        assessment_document_id: document.id,
        organization_id: organizationId,
        client_id: document.client_id,
        item_type: "document",
        item_id: document.id,
        action: "reviewed_assessment_published",
        from_status: document.status,
        to_status: "approved",
        actor_id: actorId,
        event_payload: {
          completion_mode: "assessment_only",
          created_program_count: 0,
          created_goal_count: 0,
          promoted_program_count: 0,
          promoted_goal_count: 0,
        },
      }),
    });
    if (!createReviewedEventResult.ok) {
      await fetchJson(
        `${supabaseUrl}/rest/v1/assessment_documents?id=eq.${encodeURIComponent(document.id)}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({
            status: document.status,
            approved_at: null,
            updated_at: new Date().toISOString(),
          }),
        },
      );
      return json({ error: "Failed to record reviewed assessment publish event." }, createReviewedEventResult.status || 500);
    }

    return json({
      assessment_document_id: document.id,
      completion_mode: "assessment_only",
      created_program_count: 0,
      created_goal_count: 0,
      promoted_program_count: 0,
      promoted_goal_count: 0,
    });
  }
  if (document.status !== PROMOTION_READY_STATUS) {
    return json({ error: "Assessment drafts must be ready before promotion. Refresh and retry after draft generation completes." }, 409);
  }

  const [draftProgramsResult, draftGoalsResult] = await Promise.all([
    fetchJson<DraftProgramRow[]>(
      `${supabaseUrl}/rest/v1/assessment_draft_programs?select=id,name,description,accept_state&organization_id=eq.${encodeURIComponent(
        organizationId,
      )}&assessment_document_id=eq.${encodeURIComponent(parsed.data.assessment_document_id)}&order=created_at.asc`,
      { method: "GET", headers },
    ),
    fetchJson<DraftGoalRow[]>(
      `${supabaseUrl}/rest/v1/assessment_draft_goals?select=id,draft_program_id,title,description,original_text,goal_type,target_behavior,measurement_type,baseline_data,target_criteria,mastery_criteria,maintenance_criteria,generalization_criteria,objective_data_points,accept_state&organization_id=eq.${encodeURIComponent(
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
  const promotedProgramCount = acceptedPrograms.length;
  const promotedGoalCount = acceptedGoals.length;

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

  const acceptedProgramByDraftId = new Map(acceptedPrograms.map((program) => [program.id, program]));
  const acceptedGoalsMappedToRejectedPrograms = acceptedGoals.filter(
    (goal) => goal.draft_program_id && !acceptedProgramByDraftId.has(goal.draft_program_id),
  );
  if (acceptedGoalsMappedToRejectedPrograms.length > 0) {
    return json({ error: "Accepted goals must belong to an accepted draft program before promotion." }, 409);
  }

  const acceptedGoalsWithoutProgramLink = acceptedGoals.filter((goal) => !goal.draft_program_id);
  if (acceptedPrograms.length > 1 && acceptedGoalsWithoutProgramLink.length > 0) {
    return json({ error: "Accepted goals must keep their draft program link when promoting multiple programs." }, 409);
  }

  const actorId = getAccessTokenSubject(accessToken);
  const now = new Date().toISOString();
  const promotionLockResult = await fetchJson<AssessmentDocumentRow[]>(
    `${supabaseUrl}/rest/v1/assessment_documents?id=eq.${encodeURIComponent(document.id)}&status=eq.${encodeURIComponent(
      document.status,
    )}`,
    {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify({
        status: PROMOTION_LOCK_STATUS,
        approved_at: null,
        updated_at: now,
      }),
    },
  );
  const lockedDocument = Array.isArray(promotionLockResult.data) ? promotionLockResult.data[0] : null;
  if (!promotionLockResult.ok) {
    return json({ error: "Failed to lock assessment for promotion." }, promotionLockResult.status || 500);
  }
  if (!lockedDocument) {
    return json({ error: "Assessment is already being promoted or has been approved. Refresh before trying again." }, 409);
  }

  const rollbackLivePromotion = async (args: { createdProgramIds: string[]; restoreDocumentStatus: boolean }) => {
    const { createdProgramIds, restoreDocumentStatus } = args;
    const failedSteps: string[] = [];

    if (createdProgramIds.length > 0) {
      const programIdFilter = buildInFilter(createdProgramIds);
      const deleteGoalsResult = await fetchJson(
        `${supabaseUrl}/rest/v1/goals?program_id=${programIdFilter}&organization_id=eq.${encodeURIComponent(
          organizationId,
        )}&client_id=eq.${encodeURIComponent(document.client_id)}`,
        { method: "DELETE", headers },
      );
      if (!deleteGoalsResult.ok) {
        failedSteps.push("delete_goals");
      }

      const deleteProgramsResult = await fetchJson(
        `${supabaseUrl}/rest/v1/programs?id=${programIdFilter}&organization_id=eq.${encodeURIComponent(
          organizationId,
        )}&client_id=eq.${encodeURIComponent(document.client_id)}`,
        { method: "DELETE", headers },
      );
      if (!deleteProgramsResult.ok) {
        failedSteps.push("delete_programs");
      }
    }

    const liveRollbackFailed = failedSteps.includes("delete_goals") || failedSteps.includes("delete_programs");
    if (restoreDocumentStatus && !liveRollbackFailed) {
      const restoreDocumentResult = await fetchJson(
        `${supabaseUrl}/rest/v1/assessment_documents?id=eq.${encodeURIComponent(document.id)}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({
            status: document.status,
            approved_at: null,
            updated_at: new Date().toISOString(),
          }),
        },
      );
      if (!restoreDocumentResult.ok) {
        failedSteps.push("restore_document_status");
      }
    }

    return { ok: failedSteps.length === 0, failedSteps };
  };

  const createdProgramIds: string[] = [];
  const createdProgramIdByDraftProgramId = new Map<string, string>();
  for (const program of acceptedPrograms) {
    const createProgramResult = await fetchJson<Array<{ id: string }>>(`${supabaseUrl}/rest/v1/programs`, {
      method: "POST",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify({
        organization_id: organizationId,
        client_id: document.client_id,
        name: program.name,
        description: program.description ?? null,
        status: "active",
      }),
    });
    if (!createProgramResult.ok || !Array.isArray(createProgramResult.data) || !createProgramResult.data[0]?.id) {
      const rollback = await rollbackLivePromotion({ createdProgramIds, restoreDocumentStatus: true });
      return json(
        {
          error: rollback.ok
            ? "Failed to create production programs. Promotion rolled back safely."
            : "Failed to create production programs, and rollback did not complete cleanly.",
          rollback_failed_steps: rollback.ok ? undefined : rollback.failedSteps,
        },
        createProgramResult.status || 500,
      );
    }
    const createdProgramId = createProgramResult.data[0].id;
    createdProgramIds.push(createdProgramId);
    createdProgramIdByDraftProgramId.set(program.id, createdProgramId);
  }

  const fallbackProgramId = acceptedPrograms.length === 1 ? createdProgramIds[0] ?? null : null;
  const createGoalsPayload = acceptedGoals.map((goal) => ({
    organization_id: organizationId,
    client_id: document.client_id,
    program_id: goal.draft_program_id
      ? createdProgramIdByDraftProgramId.get(goal.draft_program_id) ?? null
      : fallbackProgramId,
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
    objective_data_points: goal.objective_data_points ?? [],
    status: "active",
  }));

  if (createGoalsPayload.some((goal) => !goal.program_id)) {
    const rollback = await rollbackLivePromotion({ createdProgramIds, restoreDocumentStatus: true });
    return json(
      {
        error: rollback.ok
          ? "Accepted goals could not be matched to the promoted programs. Promotion rolled back safely."
          : "Accepted goals could not be matched to the promoted programs, and rollback did not complete cleanly.",
        rollback_failed_steps: rollback.ok ? undefined : rollback.failedSteps,
      },
      409,
    );
  }

  const createGoalsResult = await fetchJson<Array<{ id: string; title: string }>>(`${supabaseUrl}/rest/v1/goals`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify(createGoalsPayload),
  });

  if (!createGoalsResult.ok) {
    const rollback = await rollbackLivePromotion({ createdProgramIds, restoreDocumentStatus: true });
    return json(
      {
        error: rollback.ok
          ? "Failed to create production goals. Promotion rolled back safely."
          : "Failed to create production goals, and rollback did not complete cleanly.",
        rollback_failed_steps: rollback.ok ? undefined : rollback.failedSteps,
      },
      createGoalsResult.status || 500,
    );
  }

  const createdGoals = Array.isArray(createGoalsResult.data) ? createGoalsResult.data : [];
  const createdGoalByTitle = new Map(createdGoals.map((goal) => [normalizeTitle(goal.title), goal]));
  const missingCreatedGoal = acceptedGoals.find((goal) => !createdGoalByTitle.has(normalizeTitle(goal.title)));
  if (missingCreatedGoal) {
    const rollback = await rollbackLivePromotion({ createdProgramIds, restoreDocumentStatus: true });
    return json(
      {
        error: rollback.ok
          ? "Created production goals could not be correlated to accepted draft goals. Promotion rolled back safely."
          : "Created production goals could not be correlated, and rollback did not complete cleanly.",
        rollback_failed_steps: rollback.ok ? undefined : rollback.failedSteps,
      },
      500,
    );
  }
  const goalDataPointPayload = acceptedGoals.flatMap((draftGoal) => {
    const createdGoal = createdGoalByTitle.get(normalizeTitle(draftGoal.title));
    if (!createdGoal?.id || !Array.isArray(draftGoal.objective_data_points)) {
      return [];
    }
    return draftGoal.objective_data_points
      .filter((point): point is Record<string, unknown> | string =>
        (typeof point === "string" && point.trim().length > 0) ||
        (!!point && typeof point === "object" && !Array.isArray(point)),
      )
      .map((rawPoint) => {
        const point = normalizeGoalDataPoint(rawPoint);
        return {
        organization_id: organizationId,
        client_id: document.client_id,
        goal_id: createdGoal.id,
        assessment_document_id: document.id,
        source: "assessment_extraction",
        metric_name: toStringOrNull(point.metric_name) ?? toStringOrNull(point.label) ?? toStringOrNull(point.name) ?? "objective_data_point",
        metric_value: toNumberOrNull(point.metric_value ?? point.value ?? point.baseline_value),
        metric_unit: toStringOrNull(point.metric_unit ?? point.unit),
        metric_payload: point,
        observed_at: toStringOrNull(point.observed_at ?? point.date) ?? now,
        created_by: actorId,
      };
      });
  });
  if (goalDataPointPayload.length > 0) {
    const createGoalDataPointsResult = await fetchJson(`${supabaseUrl}/rest/v1/goal_data_points`, {
      method: "POST",
      headers,
      body: JSON.stringify(goalDataPointPayload),
    });
    if (!createGoalDataPointsResult.ok) {
      const rollback = await rollbackLivePromotion({ createdProgramIds, restoreDocumentStatus: true });
      return json(
        {
          error: rollback.ok
            ? "Failed to create production goal data points. Promotion rolled back safely."
            : "Failed to create production goal data points, and rollback did not complete cleanly.",
          rollback_failed_steps: rollback.ok ? undefined : rollback.failedSteps,
        },
        createGoalDataPointsResult.status || 500,
      );
    }
  }
  const updateDocumentResult = await fetchJson(`${supabaseUrl}/rest/v1/assessment_documents?id=eq.${encodeURIComponent(document.id)}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      status: "approved",
      approved_at: now,
      updated_at: now,
    }),
  });
  if (!updateDocumentResult.ok) {
    const rollback = await rollbackLivePromotion({ createdProgramIds, restoreDocumentStatus: true });
    return json(
      {
        error: rollback.ok
          ? "Failed to finalize assessment status. Promotion rolled back safely."
          : "Failed to finalize assessment status, and rollback did not complete cleanly.",
        rollback_failed_steps: rollback.ok ? undefined : rollback.failedSteps,
      },
      updateDocumentResult.status || 500,
    );
  }

  const createEventResult = await fetchJson(`${supabaseUrl}/rest/v1/assessment_review_events`, {
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
        created_program_count: createdProgramIds.length,
        created_program_ids: createdProgramIds,
        created_goal_count: createdGoals.length || acceptedGoals.length,
        promoted_program_count: promotedProgramCount,
        promoted_goal_count: promotedGoalCount,
        created_goal_data_point_count: goalDataPointPayload.length,
      },
    }),
  });
  if (!createEventResult.ok) {
    const rollback = await rollbackLivePromotion({ createdProgramIds, restoreDocumentStatus: true });
    return json(
      {
        error: rollback.ok
          ? "Failed to record promotion event. Promotion rolled back safely."
          : "Failed to record promotion event, and rollback did not complete cleanly.",
        rollback_failed_steps: rollback.ok ? undefined : rollback.failedSteps,
      },
      createEventResult.status || 500,
    );
  }

  return json({
    assessment_document_id: document.id,
    created_program_count: createdProgramIds.length,
    created_program_ids: createdProgramIds,
    created_goal_count: createdGoals.length || acceptedGoals.length,
    promoted_program_count: promotedProgramCount,
    promoted_goal_count: promotedGoalCount,
    created_goal_data_point_count: goalDataPointPayload.length,
  });
}
