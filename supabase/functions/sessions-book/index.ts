import { z } from "npm:zod@3.23.8";
import { resolveAllowedOriginForRequest, corsHeadersForRequest } from "../_shared/cors.ts";

const sessionSchema = z.object({
  therapist_id: z.string().uuid(),
  client_id: z.string().uuid(),
  start_time: z.string(),
  end_time: z.string(),
  id: z.string().uuid().optional(),
  program_id: z.string().uuid(),
  goal_id: z.string().uuid(),
  goal_ids: z.array(z.string().uuid()).optional(),
  status: z.string().optional(),
  recurrence: z.unknown().optional(),
}).passthrough();

const requestSchema = z.object({
  session: sessionSchema,
  startTimeOffsetMinutes: z.number(),
  endTimeOffsetMinutes: z.number(),
  timeZone: z.string().min(1),
  holdSeconds: z.number().int().positive().optional(),
  overrides: z.record(z.unknown()).optional(),
  recurrence: z.unknown().optional(),
}).passthrough();

const json = (req: Request, status: number, body: Record<string, unknown>, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeadersForRequest(req),
      ...extra,
    },
  });

const normalizeEdgeBase = (): string => {
  const configured =
    Deno.env.get("SUPABASE_EDGE_URL") ??
    Deno.env.get("VITE_SUPABASE_EDGE_URL");
  if (configured && configured.trim().length > 0) {
    return configured.replace(/\/+$/, "");
  }
  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  return `${supabaseUrl}/functions/v1`;
};

const forwardHeaders = (req: Request, idempotencyKey: string | null): Headers => {
  const headers = new Headers({
    "Content-Type": "application/json",
  });
  const auth = req.headers.get("Authorization");
  if (auth) headers.set("Authorization", auth);
  const apikey = req.headers.get("apikey") ?? Deno.env.get("SUPABASE_ANON_KEY");
  if (apikey) headers.set("apikey", apikey);

  const traceHeaders = ["x-request-id", "x-correlation-id", "x-agent-operation-id"];
  for (const header of traceHeaders) {
    const value = req.headers.get(header);
    if (value && value.trim().length > 0) {
      headers.set(header, value);
    }
  }

  if (idempotencyKey) {
    headers.set("Idempotency-Key", idempotencyKey);
  }
  return headers;
};

const parseEdgeJson = async (response: Response): Promise<Record<string, unknown> | null> => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeadersForRequest(req) });
  }
  if (req.method !== "POST") {
    return json(req, 405, { success: false, error: "Method not allowed" });
  }

  const origin = resolveAllowedOriginForRequest(req);
  if (!origin) {
    return json(req, 403, { success: false, error: "Origin not allowed" });
  }

  const auth = req.headers.get("Authorization");
  if (!auth || !auth.toLowerCase().startsWith("bearer ")) {
    return json(req, 401, { success: false, error: "Missing authorization token" }, { "WWW-Authenticate": "Bearer" });
  }

  let rawPayload: unknown;
  try {
    rawPayload = await req.json();
  } catch {
    return json(req, 400, { success: false, error: "Invalid JSON body" });
  }

  const parsed = requestSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return json(req, 400, { success: false, error: "Invalid request body" });
  }

  const payload = parsed.data;
  const baseUrl = normalizeEdgeBase();
  const idempotencyKey = req.headers.get("Idempotency-Key")?.trim() || null;
  const headers = forwardHeaders(req, idempotencyKey);

  const holdResponse = await fetch(`${baseUrl}/sessions-hold`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      therapist_id: payload.session.therapist_id,
      client_id: payload.session.client_id,
      session_id: payload.session.id ?? null,
      start_time: payload.session.start_time,
      end_time: payload.session.end_time,
      hold_seconds: payload.holdSeconds ?? 300,
      start_time_offset_minutes: payload.startTimeOffsetMinutes,
      end_time_offset_minutes: payload.endTimeOffsetMinutes,
      time_zone: payload.timeZone,
    }),
  });

  const holdBody = await parseEdgeJson(holdResponse);
  if (!holdResponse.ok || holdBody?.success !== true) {
    const status = holdResponse.status > 0 ? holdResponse.status : 502;
    return json(req, status, holdBody ?? { success: false, error: "Failed to acquire hold" });
  }

  const holdData = holdBody.data as { holdKey?: string } | undefined;
  const holdKey = typeof holdData?.holdKey === "string" ? holdData.holdKey : null;
  if (!holdKey) {
    return json(req, 500, { success: false, error: "Hold response missing hold key" });
  }

  const confirmResponse = await fetch(`${baseUrl}/sessions-confirm`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      hold_key: holdKey,
      session: payload.session,
      cpt: payload.overrides ?? null,
      goal_ids: Array.isArray(payload.session.goal_ids)
        ? payload.session.goal_ids
        : [payload.session.goal_id].filter(Boolean),
      start_time_offset_minutes: payload.startTimeOffsetMinutes,
      end_time_offset_minutes: payload.endTimeOffsetMinutes,
      time_zone: payload.timeZone,
    }),
  });

  const confirmBody = await parseEdgeJson(confirmResponse);
  if (!confirmResponse.ok || confirmBody?.success !== true) {
    const status = confirmResponse.status > 0 ? confirmResponse.status : 502;
    return json(req, status, confirmBody ?? { success: false, error: "Failed to confirm booking" });
  }

  const confirmData = (confirmBody.data as Record<string, unknown> | undefined) ?? {};
  return json(req, 200, {
    success: true,
    data: {
      session: confirmData.session ?? null,
      sessions: confirmData.sessions ?? [],
      hold: holdBody.data ?? null,
      cpt: payload.overrides ?? null,
    },
  });
});

