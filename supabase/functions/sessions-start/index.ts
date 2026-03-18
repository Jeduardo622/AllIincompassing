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

  const { data: rpcResult, error: rpcError } = await db.rpc("start_session_with_goals", {
    p_session_id: session_id,
    p_program_id: program_id,
    p_goal_id: goal_id,
    p_goal_ids: mergedGoalIds,
    p_started_at: started_at ?? null,
    p_actor_id: currentUserId,
  });
  if (rpcError) {
    return json({ error: rpcError.message ?? "Failed to start session" }, 500);
  }

  if (!rpcResult?.success) {
    const statusMap: Record<string, number> = {
      MISSING_FIELDS: 400,
      SESSION_NOT_FOUND: 404,
      ALREADY_STARTED: 409,
      INVALID_STATUS: 409,
      GOAL_NOT_FOUND: 404,
      INVALID_GOALS: 400,
      FORBIDDEN: 403,
      UNAUTHORIZED: 401,
    };
    const code = typeof rpcResult?.error_code === "string" ? rpcResult.error_code : "";
    const status = statusMap[code] ?? 409;
    return json({ error: rpcResult?.error_message ?? "Session could not be started" }, status);
  }

  return json(rpcResult.session ?? { id: session_id, started_at: started_at ?? new Date().toISOString() }, 200);
};

export default createProtectedRoute((req) => handleSessionsStart(req), RouteOptions.therapist);
