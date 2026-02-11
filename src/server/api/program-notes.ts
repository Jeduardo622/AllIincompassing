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
  const actorId = getAccessTokenSubject(accessToken);
  const programExistsInOrg = async (programId: string): Promise<boolean> => {
    const programLookupUrl = `${supabaseUrl}/rest/v1/programs?select=id&id=eq.${programId}&organization_id=eq.${organizationId}&limit=1`;
    const lookupResult = await fetchJson<Array<{ id: string }>>(programLookupUrl, { method: "GET", headers });
    return lookupResult.ok && Array.isArray(lookupResult.data) && lookupResult.data.length > 0;
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

    const notesUrl = `${supabaseUrl}/rest/v1/program_notes?select=id,organization_id,program_id,author_id,note_type,content,created_at,updated_at&organization_id=eq.${organizationId}&program_id=eq.${programId}&order=created_at.desc`;
    const result = await fetchJson(notesUrl, { method: "GET", headers });
    if (!result.ok) {
      return json({ error: "Failed to load program notes" }, result.status || 500);
    }
    return json(result.data ?? []);
  }

  if (request.method === "POST") {
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
    const programExists = await programExistsInOrg(parsed.data.program_id);
    if (!programExists) {
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
