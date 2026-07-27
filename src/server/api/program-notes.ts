import { z } from "zod";
import {
  CORS_HEADERS,
  currentUserCanManageProgramsGoals,
  fetchJson,
  getAccessToken,
  getAccessTokenSubject,
  getSupabaseConfig,
  json,
  resolveOrgAndRole,
} from "./shared";

const programNoteSchema = z.object({
  program_id: z.string().uuid(),
  note_type: z.enum(["plan_update", "progress_summary", "other"]),
  content: z.record(z.unknown()),
});

const isUuid = (value: string): boolean => z.string().uuid().safeParse(value).success;

export async function programNotesHandler(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: { ...CORS_HEADERS } });
  }

  const accessToken = getAccessToken(request);
  if (!accessToken) {
    return json({ error: "Missing authorization token" }, 401, { "WWW-Authenticate": "Bearer" });
  }

  const { organizationId } = await resolveOrgAndRole(accessToken);
  if (!organizationId) {
    return json({ error: "Forbidden" }, 403);
  }

  const { supabaseUrl, anonKey } = getSupabaseConfig();
  const headers = {
    "Content-Type": "application/json",
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
  };
  const actorId = getAccessTokenSubject(accessToken);
  const loadVisibleProgram = async (programId: string): Promise<{ id: string; client_id: string | null } | null> => {
    const programLookupUrl = `${supabaseUrl}/rest/v1/programs?select=id,client_id&id=eq.${programId}&organization_id=eq.${organizationId}&limit=1`;
    const lookupResult = await fetchJson<Array<{ id: string }>>(programLookupUrl, { method: "GET", headers });
    if (!lookupResult.ok) {
      throw new Error("program_lookup_failed");
    }
    return Array.isArray(lookupResult.data) ? lookupResult.data[0] ?? null : null;
  };

  if (request.method === "GET") {
    const url = new URL(request.url);
    const programId = url.searchParams.get("program_id");
    if (!programId) {
      return json({ error: "program_id is required" }, 400);
    }
    if (!isUuid(programId)) {
      return json({ error: "program_id must be a valid UUID" }, 400);
    }

    let visibleProgram: { id: string; client_id: string | null } | null;
    try {
      visibleProgram = await loadVisibleProgram(programId);
    } catch {
      return json({ error: "Failed to validate program scope" }, 500);
    }
    if (!visibleProgram) {
      return json({ error: "program_id is not in scope for this organization" }, 403);
    }

    const notesUrl = `${supabaseUrl}/rest/v1/program_notes?select=id,organization_id,program_id,author_id,note_type,content,created_at,updated_at&program_id=eq.${programId}&order=created_at.desc`;
    const result = await fetchJson(notesUrl, { method: "GET", headers });
    if (!result.ok) {
      return json({ error: "Failed to load program notes" }, result.status || 500);
    }
    return json(result.data ?? []);
  }

  if (request.method === "POST") {
    const canManage = await currentUserCanManageProgramsGoals(accessToken, organizationId);
    if (canManage.upstreamError) {
      return json({ error: "Unable to validate program-goal access" }, 502);
    }
    if (!canManage.allowed) {
      return json({ error: "Forbidden" }, 403);
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const parsed = programNoteSchema.safeParse(payload);
    if (!parsed.success) {
      return json({ error: "Invalid request body" }, 400);
    }
    let visibleProgram: { id: string; client_id: string | null } | null;
    try {
      visibleProgram = await loadVisibleProgram(parsed.data.program_id);
    } catch {
      return json({ error: "Failed to validate program scope" }, 500);
    }
    if (!visibleProgram) {
      return json({ error: "program_id is not in scope for this organization" }, 403);
    }

    const createPayload = {
      ...parsed.data,
      organization_id: organizationId,
      ...(actorId ? { author_id: actorId } : {}),
    };

    const notesUrl = `${supabaseUrl}/rest/v1/program_notes`;
    const result = await fetchJson(notesUrl, {
      method: "POST",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify(createPayload),
    });

    if (!result.ok) {
      return json({ error: "Failed to create program note" }, result.status || 500);
    }

    return json(Array.isArray(result.data) ? result.data[0] : result.data, 201);
  }

  return json({ error: "Method not allowed" }, 405);
}
