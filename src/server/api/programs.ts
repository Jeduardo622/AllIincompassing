import { z } from "zod";
import { CORS_HEADERS, fetchJson, getAccessToken, getSupabaseConfig, json, resolveOrgAndRole } from "./shared";

const programSchema = z.object({
  client_id: z.string().uuid(),
  name: z.string().trim().min(1),
  description: z.string().trim().optional(),
  status: z.enum(["active", "inactive", "archived"]).optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
});

const programUpdateSchema = programSchema.partial().extend({
  client_id: z.string().uuid().optional(),
});

export async function programsHandler(request: Request): Promise<Response> {
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
    const clientId = url.searchParams.get("client_id");
    if (!clientId) {
      return json({ error: "client_id is required" }, 400);
    }

    const programsUrl = `${supabaseUrl}/rest/v1/programs?select=id,organization_id,client_id,name,description,status,start_date,end_date,created_at,updated_at&organization_id=eq.${organizationId}&client_id=eq.${clientId}&order=created_at.desc`;
    const result = await fetchJson(programsUrl, { method: "GET", headers });
    if (!result.ok) {
      return json({ error: "Failed to load programs" }, result.status || 500);
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

    const parsed = programSchema.safeParse(payload);
    if (!parsed.success) {
      return json({ error: "Invalid request body" }, 400);
    }

    const createPayload = {
      ...parsed.data,
      organization_id: organizationId,
    };

    const programsUrl = `${supabaseUrl}/rest/v1/programs`;
    const result = await fetchJson(programsUrl, {
      method: "POST",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify(createPayload),
    });

    if (!result.ok) {
      return json({ error: "Failed to create program" }, result.status || 500);
    }

    return json(Array.isArray(result.data) ? result.data[0] : result.data, 201);
  }

  if (request.method === "PATCH") {
    const url = new URL(request.url);
    const programId = url.searchParams.get("program_id");
    if (!programId) {
      return json({ error: "program_id is required" }, 400);
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const parsed = programUpdateSchema.safeParse(payload);
    if (!parsed.success || Object.keys(parsed.data).length === 0) {
      return json({ error: "Invalid request body" }, 400);
    }

    const programsUrl = `${supabaseUrl}/rest/v1/programs?id=eq.${programId}&organization_id=eq.${organizationId}`;
    const result = await fetchJson(programsUrl, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify(parsed.data),
    });

    if (!result.ok) {
      return json({ error: "Failed to update program" }, result.status || 500);
    }

    return json(Array.isArray(result.data) ? result.data[0] : result.data);
  }

  return json({ error: "Method not allowed" }, 405);
}
