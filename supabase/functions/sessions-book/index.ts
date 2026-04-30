import { z } from "npm:zod@3.23.8";
import { resolveAllowedOriginForRequest, corsHeadersForRequest } from "../_shared/cors.ts";

const isoDateTime = z.string().datetime({ offset: true });

const sessionSchema = z.object({
  therapist_id: z.string().uuid(),
  client_id: z.string().uuid(),
  start_time: isoDateTime,
  end_time: isoDateTime,
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
  occurrences: z.array(z.object({
    startTime: isoDateTime,
    endTime: isoDateTime,
    startOffsetMinutes: z.number(),
    endOffsetMinutes: z.number(),
  })).optional(),
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

const occurrenceKey = (startTime: string, endTime: string): string =>
  `${new Date(startTime).toISOString()}::${new Date(endTime).toISOString()}`;

/** Plain objects for bookSessionEnvelopeSchema (z.record); never null — matches legacy bookSession shape. */
const asBookingRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

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
  const occurrencePayloads = Array.isArray(payload.occurrences) && payload.occurrences.length > 0
    ? payload.occurrences
    : [{
        startTime: payload.session.start_time,
        endTime: payload.session.end_time,
        startOffsetMinutes: payload.startTimeOffsetMinutes,
        endOffsetMinutes: payload.endTimeOffsetMinutes,
      }];

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
      occurrences: occurrencePayloads.map((occurrence) => ({
        start_time: occurrence.startTime,
        end_time: occurrence.endTime,
        start_time_offset_minutes: occurrence.startOffsetMinutes,
        end_time_offset_minutes: occurrence.endOffsetMinutes,
      })),
    }),
  });

  const holdBody = await parseEdgeJson(holdResponse);
  if (!holdResponse.ok || holdBody?.success !== true) {
    const status = holdResponse.status > 0 ? holdResponse.status : 502;
    const retryAfter = holdResponse.headers.get("Retry-After");
    return json(
      req,
      status,
      holdBody ?? { success: false, error: "Failed to acquire hold" },
      retryAfter ? { "Retry-After": retryAfter } : {},
    );
  }

  const holdData = holdBody.data as { holdKey?: string } | undefined;
  const holdKey = typeof holdData?.holdKey === "string" ? holdData.holdKey : null;
  if (!holdKey) {
    return json(req, 500, { success: false, error: "Hold response missing hold key" });
  }

  const holdOccurrences = Array.isArray((holdBody.data as { holds?: unknown[] } | undefined)?.holds)
    ? ((holdBody.data as { holds: Array<Record<string, unknown>> }).holds)
    : [];
  const confirmOccurrences = holdOccurrences.length > 0
    ? (() => {
        const occurrenceByWindow = new Map(
          occurrencePayloads.map((occurrence) => [occurrenceKey(occurrence.startTime, occurrence.endTime), occurrence] as const),
        );

        return holdOccurrences.map((heldOccurrence) => {
          const holdStartTime = typeof heldOccurrence.startTime === "string" ? heldOccurrence.startTime : null;
          const holdEndTime = typeof heldOccurrence.endTime === "string" ? heldOccurrence.endTime : null;
          const holdKey = typeof heldOccurrence.holdKey === "string" ? heldOccurrence.holdKey : null;
          if (!holdStartTime || !holdEndTime || !holdKey) {
            throw new Error("Hold response missing occurrence window metadata");
          }

          const occurrence = occurrenceByWindow.get(occurrenceKey(holdStartTime, holdEndTime));
          if (!occurrence) {
            throw new Error("Hold occurrences did not align with requested booking windows");
          }

          return {
            hold_key: holdKey,
            session: {
              ...payload.session,
              start_time: occurrence.startTime,
              end_time: occurrence.endTime,
            },
            cpt: payload.overrides ?? null,
            goal_ids: Array.isArray(payload.session.goal_ids)
              ? payload.session.goal_ids
              : [payload.session.goal_id].filter(Boolean),
            start_time_offset_minutes: occurrence.startOffsetMinutes,
            end_time_offset_minutes: occurrence.endOffsetMinutes,
            time_zone: payload.timeZone,
          };
        });
      })()
    : undefined;

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
      ...(confirmOccurrences ? { occurrences: confirmOccurrences } : {}),
    }),
  });

  const confirmBody = await parseEdgeJson(confirmResponse);
  if (!confirmResponse.ok || confirmBody?.success !== true) {
    const status = confirmResponse.status > 0 ? confirmResponse.status : 502;
    const retryAfter = confirmResponse.headers.get("Retry-After");
    return json(
      req,
      status,
      confirmBody ?? { success: false, error: "Failed to confirm booking" },
      retryAfter ? { "Retry-After": retryAfter } : {},
    );
  }

  const confirmData = (confirmBody.data as Record<string, unknown> | undefined) ?? {};
  const sessionsRaw = confirmData["sessions"];
  const sessionsNormalized = Array.isArray(sessionsRaw)
    ? sessionsRaw.map((row) => asBookingRecord(row))
    : [];

  return json(req, 200, {
    success: true,
    data: {
      session: asBookingRecord(confirmData["session"]),
      sessions: sessionsNormalized,
      hold: asBookingRecord(holdBody.data),
      cpt: asBookingRecord(payload.overrides),
    },
  });
});

