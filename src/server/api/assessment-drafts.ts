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

const draftGoalSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  original_text: z.string().trim().min(1),
  target_behavior: z.string().trim().optional(),
  measurement_type: z.string().trim().optional(),
  baseline_data: z.string().trim().optional(),
  target_criteria: z.string().trim().optional(),
});

const draftCreateSchema = z.object({
  assessment_document_id: z.string().uuid(),
  program: z.object({
    name: z.string().trim().min(1),
    description: z.string().trim().optional(),
  }),
  rationale: z.string().trim().optional(),
  goals: z.array(draftGoalSchema).min(1),
});

const draftUpdateSchema = z.object({
  draft_type: z.enum(["program", "goal"]),
  id: z.string().uuid(),
  accept_state: z.enum(["pending", "accepted", "rejected", "edited"]).optional(),
  review_notes: z.string().optional(),
  name: z.string().trim().optional(),
  description: z.string().trim().optional(),
  title: z.string().trim().optional(),
  original_text: z.string().trim().optional(),
  target_behavior: z.string().trim().optional(),
  measurement_type: z.string().trim().optional(),
  baseline_data: z.string().trim().optional(),
  target_criteria: z.string().trim().optional(),
});

const isUuid = (value: string): boolean => z.string().uuid().safeParse(value).success;

interface AssessmentDocumentScopeRow {
  id: string;
  organization_id: string;
  client_id: string;
}

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

const getAssessmentDocument = async (
  supabaseUrl: string,
  headers: Record<string, string>,
  organizationId: string,
  assessmentDocumentId: string,
): Promise<AssessmentDocumentScopeRow | null> => {
  const lookupUrl = `${supabaseUrl}/rest/v1/assessment_documents?select=id,organization_id,client_id&id=eq.${encodeURIComponent(
    assessmentDocumentId,
  )}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`;
  const lookup = await fetchJson<AssessmentDocumentScopeRow[]>(lookupUrl, { method: "GET", headers });
  if (!lookup.ok || !Array.isArray(lookup.data) || !lookup.data[0]) {
    return null;
  }
  return lookup.data[0];
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
      return json({ error: "assessment_document_id is not in scope for this organization" }, 403);
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

    const parsed = draftCreateSchema.safeParse(payload);
    if (!parsed.success) {
      return json({ error: "Invalid request body" }, 400);
    }

    const document = await getAssessmentDocument(supabaseUrl, headers, organizationId, parsed.data.assessment_document_id);
    if (!document) {
      return json({ error: "assessment_document_id is not in scope for this organization" }, 403);
    }

    const actorId = getAccessTokenSubject(accessToken);
    const createProgramPayload = {
      assessment_document_id: parsed.data.assessment_document_id,
      organization_id: organizationId,
      client_id: document.client_id,
      name: parsed.data.program.name,
      description: parsed.data.program.description ?? null,
      rationale: parsed.data.rationale ?? null,
      accept_state: "pending",
    };

    const createProgramResult = await fetchJson<Array<{ id: string }>>(
      `${supabaseUrl}/rest/v1/assessment_draft_programs`,
      {
        method: "POST",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify(createProgramPayload),
      },
    );

    if (!createProgramResult.ok || !Array.isArray(createProgramResult.data) || !createProgramResult.data[0]) {
      return json({ error: "Failed to create draft program" }, createProgramResult.status || 500);
    }

    const createdProgramId = createProgramResult.data[0].id;
    const createGoalsPayload = parsed.data.goals.map((goal) => ({
      assessment_document_id: parsed.data.assessment_document_id,
      draft_program_id: createdProgramId,
      organization_id: organizationId,
      client_id: document.client_id,
      title: goal.title,
      description: goal.description,
      original_text: goal.original_text,
      target_behavior: goal.target_behavior ?? null,
      measurement_type: goal.measurement_type ?? null,
      baseline_data: goal.baseline_data ?? null,
      target_criteria: goal.target_criteria ?? null,
      accept_state: "pending",
    }));

    const createGoalsResult = await fetchJson(`${supabaseUrl}/rest/v1/assessment_draft_goals`, {
      method: "POST",
      headers,
      body: JSON.stringify(createGoalsPayload),
    });

    if (!createGoalsResult.ok) {
      return json({ error: "Failed to create draft goals" }, createGoalsResult.status || 500);
    }

    await fetchJson(`${supabaseUrl}/rest/v1/assessment_documents?id=eq.${encodeURIComponent(document.id)}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        status: "drafted",
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
        from_status: "uploaded",
        to_status: "drafted",
        actor_id: actorId,
      }),
    });

    return json({ draft_program_id: createdProgramId }, 201);
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
