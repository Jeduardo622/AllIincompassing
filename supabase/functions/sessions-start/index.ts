import { z } from "npm:zod@3.23.8";
import { createRequestClient } from "../_shared/database.ts";
import { createProtectedRoute, RouteOptions } from "../_shared/auth-middleware.ts";
import { assertUserHasOrgRole, orgScopedQuery, requireOrg } from "../_shared/org.ts";

const requestSchema = z.object({
  session_id: z.string().uuid(),
  program_id: z.string().uuid(),
  goal_id: z.string().uuid(),
  goal_ids: z.array(z.string().uuid()).optional(),
  started_at: z.string().optional(),
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const handleSessionsStart = async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const db = createRequestClient(req);
  const orgId = await requireOrg(db);

  const { data: authData, error: authError } = await db.auth.getUser();
  if (authError || !authData?.user) {
    return json({ error: "Missing authorization token" }, 401);
  }
  const currentUserId = authData.user.id;

  const [isTherapist, isAdmin, isSuperAdmin] = await Promise.all([
    assertUserHasOrgRole(db, orgId, "therapist", { targetTherapistId: currentUserId }),
    assertUserHasOrgRole(db, orgId, "admin"),
    assertUserHasOrgRole(db, orgId, "super_admin"),
  ]);

  if (!isTherapist && !isAdmin && !isSuperAdmin) {
    return json({ error: "Forbidden" }, 403);
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = requestSchema.safeParse(payload);
  if (!parsed.success) {
    return json({ error: "Invalid request body" }, 400);
  }

  const { session_id, program_id, goal_id, goal_ids, started_at } = parsed.data;
  const mergedGoalIds = Array.from(new Set([goal_id, ...(goal_ids ?? [])]));

  const { data: sessions, error: sessionError } = await orgScopedQuery(db, "sessions", orgId)
    .select("id,client_id,therapist_id,started_at,status")
    .eq("id", session_id)
    .limit(1);
  if (sessionError || !sessions || sessions.length === 0) {
    return json({ error: "Session not found" }, 404);
  }
  const session = sessions[0] as {
    id: string;
    client_id: string;
    therapist_id: string;
    started_at: string | null;
    status: string | null;
  };

  if (isTherapist && !isAdmin && !isSuperAdmin && session.therapist_id !== currentUserId) {
    return json({ error: "Forbidden" }, 403);
  }
  if (session.started_at) {
    return json({ error: "Session already started" }, 409);
  }
  if (session.status !== "scheduled") {
    return json({ error: "Session is not in a schedulable state" }, 409);
  }

  const { data: goals, error: goalsError } = await orgScopedQuery(db, "goals", orgId)
    .select("id,program_id,client_id")
    .eq("program_id", program_id)
    .eq("client_id", session.client_id)
    .in("id", mergedGoalIds);
  if (goalsError || !goals || goals.length !== mergedGoalIds.length) {
    return json({ error: "One or more goals are invalid for this session" }, 400);
  }

  const effectiveStartedAt = started_at ?? new Date().toISOString();
  const { data: updated, error: updateError } = await orgScopedQuery(db, "sessions", orgId)
    .update({
      program_id,
      goal_id,
      started_at: effectiveStartedAt,
    })
    .eq("id", session_id)
    .eq("status", "scheduled")
    .is("started_at", null)
    .select("id,program_id,goal_id,started_at")
    .limit(1);

  if (updateError) {
    return json({ error: "Failed to start session" }, 500);
  }
  if (!updated || updated.length === 0) {
    return json({ error: "Session already started" }, 409);
  }

  const links = mergedGoalIds.map((goal) => ({
    session_id,
    goal_id: goal,
    organization_id: orgId,
    client_id: session.client_id,
    program_id,
  }));
  const { error: linkError } = await db
    .from("session_goals")
    .upsert(links, { onConflict: "session_id,goal_id", ignoreDuplicates: false });
  if (linkError) {
    return json({ error: "Failed to attach goals to session" }, 500);
  }

  return json(updated[0], 200);
};

export default createProtectedRoute((req) => handleSessionsStart(req), RouteOptions.therapist);
