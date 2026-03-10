import { z } from "npm:zod@3.23.8";
import { createRequestClient } from "../_shared/database.ts";
import { createProtectedRoute, RouteOptions } from "../_shared/auth-middleware.ts";
import { assertUserHasOrgRole, orgScopedQuery, requireOrg } from "../_shared/org.ts";

const noteSchema = z.object({
  program_id: z.string().uuid(),
  note_type: z.enum(["plan_update", "progress_summary", "other"]),
  content: z.record(z.unknown()),
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const hasAllowedRole = async (orgId: string, userId: string, db: ReturnType<typeof createRequestClient>) => {
  const [isTherapist, isAdmin, isSuperAdmin] = await Promise.all([
    assertUserHasOrgRole(db, orgId, "therapist", { targetTherapistId: userId }),
    assertUserHasOrgRole(db, orgId, "admin"),
    assertUserHasOrgRole(db, orgId, "super_admin"),
  ]);
  return isTherapist || isAdmin || isSuperAdmin;
};

export const handleProgramNotes = async (req: Request) => {
  const db = createRequestClient(req);
  const orgId = await requireOrg(db);
  const { data: authData, error: authError } = await db.auth.getUser();
  if (authError || !authData?.user) {
    return json({ error: "Missing authorization token" }, 401);
  }
  const userId = authData.user.id;
  const allowed = await hasAllowedRole(orgId, userId, db);
  if (!allowed) return json({ error: "Forbidden" }, 403);

  if (req.method === "GET") {
    const url = new URL(req.url);
    const programId = url.searchParams.get("program_id");
    if (!programId) return json({ error: "program_id is required" }, 400);
    if (!z.string().uuid().safeParse(programId).success) return json({ error: "program_id must be a valid UUID" }, 400);

    const { data, error } = await orgScopedQuery(db, "program_notes", orgId)
      .select("id,organization_id,program_id,author_id,note_type,content,created_at,updated_at")
      .eq("program_id", programId)
      .order("created_at", { ascending: false });
    if (error) return json({ error: "Failed to load program notes" }, 500);
    return json(data ?? []);
  }

  if (req.method === "POST") {
    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
    const parsed = noteSchema.safeParse(payload);
    if (!parsed.success) return json({ error: "Invalid request body" }, 400);

    const { data: programs, error: programError } = await orgScopedQuery(db, "programs", orgId)
      .select("id")
      .eq("id", parsed.data.program_id)
      .limit(1);
    if (programError || !programs || programs.length === 0) {
      return json({ error: "program_id is not in scope for this organization" }, 403);
    }

    const insertPayload = {
      ...parsed.data,
      organization_id: orgId,
      author_id: userId,
    };
    const { data, error } = await db
      .from("program_notes")
      .insert([insertPayload])
      .select("*")
      .limit(1);
    if (error) return json({ error: "Failed to create program note" }, 500);
    return json(data?.[0] ?? null, 201);
  }

  return json({ error: "Method not allowed" }, 405);
};

export default createProtectedRoute((req) => handleProgramNotes(req), RouteOptions.therapist);
