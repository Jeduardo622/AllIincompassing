import { z } from "npm:zod@3.23.8";
import { corsHeadersForRequest } from "../_shared/cors.ts";
import { createRequestClient, supabaseAdmin } from "../_shared/database.ts";
import {
  assertUserHasOrgRole,
  resolveOrgId,
} from "../_shared/org.ts";
import {
  buildScopedIdempotencyKey,
  createSupabaseIdempotencyService,
  IdempotencyConflictError,
  type Json,
} from "../_shared/idempotency.ts";

const requestSchema = z.object({
  session_id: z.string().uuid(),
  start_time: z.string().datetime({ offset: true }).optional(),
  end_time: z.string().datetime({ offset: true }).optional(),
}).superRefine((payload, ctx) => {
  const hasStart = typeof payload.start_time === "string";
  const hasEnd = typeof payload.end_time === "string";

  if (hasStart !== hasEnd) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "start_time and end_time must be provided together",
      path: hasStart ? ["end_time"] : ["start_time"],
    });
    return;
  }

  if (hasStart && hasEnd) {
    const start = Date.parse(payload.start_time!);
    const end = Date.parse(payload.end_time!);
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "end_time must be after start_time",
        path: ["end_time"],
      });
    }
  }
});

const REACTIVATION_ROLES = [
  "super_admin",
  "admin",
  "admin_schedule",
  "midtier",
  "bcba",
] as const;

type ReactivationSuccessEnvelope = {
  success: true;
  data: {
    outcome: "reactivated" | "already_reactivated";
    sessionId: string;
  };
  _request_session_id?: string;
  _request_start_time?: string | null;
  _request_end_time?: string | null;
};

type ReactivationErrorEnvelope = {
  success: false;
  code?: string;
  error: string;
  _request_session_id?: string;
  _request_start_time?: string | null;
  _request_end_time?: string | null;
};

type ReactivationEnvelope = ReactivationSuccessEnvelope | ReactivationErrorEnvelope;

const jsonResponse = (
  req: Request,
  body: ReactivationEnvelope | Record<string, unknown>,
  status = 200,
  extraHeaders: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeadersForRequest(req),
      ...extraHeaders,
    },
  });

async function ensureAuthenticated(req: Request, db: ReturnType<typeof createRequestClient>) {
  const { data, error } = await db.auth.getUser();
  if (error || !data?.user) {
    return jsonResponse(req, { success: false, error: "Unauthorized" }, 401);
  }
  return data.user;
}

async function resolveOrgForSession(
  db: ReturnType<typeof createRequestClient>,
  sessionId: string,
): Promise<string | null> {
  const directOrgId = await resolveOrgId(db);
  if (directOrgId) {
    return directOrgId;
  }

  const { data: isSuperAdmin, error } = await db.rpc("current_user_is_super_admin");
  if (error || isSuperAdmin !== true) {
    return null;
  }

  const { data, error: sessionError } = await supabaseAdmin
    .from("sessions")
    .select("organization_id")
    .eq("id", sessionId)
    .limit(1);

  if (sessionError) {
    throw new Error(sessionError.message ?? "Failed to resolve organization");
  }

  const orgId = Array.isArray(data) && typeof data[0]?.organization_id === "string"
    ? data[0].organization_id.trim()
    : "";

  return orgId.length > 0 ? orgId : null;
}

async function userCanReactivate(
  db: ReturnType<typeof createRequestClient>,
  orgId: string,
): Promise<boolean> {
  for (const role of REACTIVATION_ROLES) {
    if (await assertUserHasOrgRole(db, orgId, role)) {
      return true;
    }
  }
  return false;
}

function sanitizeEnvelope(body: Json): Json {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return body;
  }

  const record = { ...(body as Record<string, Json>) };
  delete record._request_session_id;
  delete record._request_start_time;
  delete record._request_end_time;
  return record;
}

function withRequestSessionId(
  body: Omit<ReactivationEnvelope, "_request_session_id">,
  sessionId: string,
  startTime: string | null,
  endTime: string | null,
): ReactivationEnvelope {
  return {
    ...body,
    _request_session_id: sessionId,
    _request_start_time: startTime,
    _request_end_time: endTime,
  };
}

function normalizeRequestWindow(startTime?: string, endTime?: string): { startTime: string | null; endTime: string | null } {
  return {
    startTime: typeof startTime === "string" ? startTime : null,
    endTime: typeof endTime === "string" ? endTime : null,
  };
}

function matchesStoredRequest(
  body: Record<string, Json>,
  sessionId: string,
  startTime: string | null,
  endTime: string | null,
): boolean {
  const storedSessionId = typeof body._request_session_id === "string" ? body._request_session_id : null;
  const storedStartTime = typeof body._request_start_time === "string" ? body._request_start_time : body._request_start_time === null ? null : null;
  const storedEndTime = typeof body._request_end_time === "string" ? body._request_end_time : body._request_end_time === null ? null : null;

  return storedSessionId === sessionId && storedStartTime === startTime && storedEndTime === endTime;
}

function mapRpcResult(
  req: Request,
  sessionId: string,
  startTime: string | null,
  endTime: string | null,
  rpcResult: Record<string, unknown>,
): Response {
  const success = rpcResult.success === true;
  const code = typeof rpcResult.error_code === "string" ? rpcResult.error_code : "";
  const rpcSessionId = typeof rpcResult.session_id === "string" ? rpcResult.session_id : sessionId;
  const alreadyReactivated = rpcResult.already_reactivated === true;

  if (success) {
    return jsonResponse(
      req,
      withRequestSessionId({
        success: true,
        data: {
          outcome: alreadyReactivated ? "already_reactivated" : "reactivated",
          sessionId: rpcSessionId,
        },
      }, sessionId, startTime, endTime),
      200,
    );
  }

  if (code === "THERAPIST_CONFLICT" || code === "CLIENT_CONFLICT" || code === "HOLD_CONFLICT") {
    return jsonResponse(
      req,
      withRequestSessionId({
        success: false,
        code,
        error: "The original appointment time is no longer available.",
      }, sessionId, startTime, endTime),
      409,
    );
  }

  if (code === "SESSION_NOT_FOUND") {
    return jsonResponse(
      req,
      withRequestSessionId({
        success: false,
        code,
        error: "Appointment not found.",
      }, sessionId, startTime, endTime),
      404,
    );
  }

  if (code === "AUTHORIZATION_INVALID" || code === "INVALID_STATUS") {
    return jsonResponse(
      req,
      withRequestSessionId({
        success: false,
        code,
        error: code === "AUTHORIZATION_INVALID"
          ? "Linked authorization is no longer valid."
          : "Appointment could not be reactivated.",
      }, sessionId, startTime, endTime),
      409,
    );
  }

  if (code === "FORBIDDEN") {
    return jsonResponse(
      req,
      withRequestSessionId({
        success: false,
        code,
        error: "Forbidden",
      }, sessionId, startTime, endTime),
      403,
    );
  }

  return jsonResponse(
    req,
    withRequestSessionId({
      success: false,
      code: code || "UNKNOWN",
      error: "Appointment could not be reactivated.",
    }, sessionId, startTime, endTime),
    409,
  );
}

async function persistIdempotencyResponse(
  key: string | null,
  body: ReactivationEnvelope,
  status: number,
) {
  if (!key) {
    return;
  }

  const idempotencyService = createSupabaseIdempotencyService(supabaseAdmin);
  await idempotencyService.persist(key, "sessions-reactivate", body, status);
}

async function replayPersistRace(
  req: Request,
  normalizedIdempotencyKey: string,
  scopedIdempotencyKey: string,
  requestSessionId: string,
  requestStartTime: string | null,
  requestEndTime: string | null,
): Promise<Response | null> {
  const idempotencyService = createSupabaseIdempotencyService(supabaseAdmin);
  const existing = await idempotencyService.find(scopedIdempotencyKey, "sessions-reactivate");
  if (!existing) {
    return null;
  }

  const existingBody = existing.responseBody as Record<string, Json>;
  if (!matchesStoredRequest(existingBody, requestSessionId, requestStartTime, requestEndTime)) {
    return null;
  }

  return jsonResponse(
    req,
    sanitizeEnvelope(existing.responseBody),
    existing.statusCode,
    {
      "Idempotent-Replay": "true",
      "Idempotency-Key": normalizedIdempotencyKey,
    },
  );
}

export const handleSessionsReactivate = async (req: Request): Promise<Response> => {
  try {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeadersForRequest(req) });
    }

    if (req.method !== "POST") {
      return jsonResponse(req, { success: false, error: "Method not allowed" }, 405);
    }

    const db = createRequestClient(req);
    const user = await ensureAuthenticated(req, db);
    if (user instanceof Response) {
      return user;
    }

    let payload: z.infer<typeof requestSchema>;
    try {
      payload = requestSchema.parse(await req.json());
    } catch {
      return jsonResponse(req, { success: false, error: "Invalid request body" }, 400);
    }

    const orgId = await resolveOrgForSession(db, payload.session_id);
    if (!orgId) {
      return jsonResponse(req, { success: false, error: "Forbidden" }, 403);
    }

    if (!await userCanReactivate(db, orgId)) {
      return jsonResponse(req, { success: false, error: "Forbidden" }, 403);
    }

    const { data: scopedSessions, error: scopedSessionError } = await supabaseAdmin
      .from("sessions")
      .select("id, organization_id")
      .eq("organization_id", orgId)
      .eq("id", payload.session_id)
      .limit(1);

    if (scopedSessionError) {
      return jsonResponse(req, { success: false, error: "Internal server error" }, 500);
    }

    if (!Array.isArray(scopedSessions) || scopedSessions.length === 0) {
      return jsonResponse(req, { success: false, error: "Appointment not found." }, 404);
    }

    const requestWindow = normalizeRequestWindow(payload.start_time, payload.end_time);

    const rawIdempotencyKey = req.headers.get("Idempotency-Key")?.trim() || "";
    const normalizedIdempotencyKey = rawIdempotencyKey.length > 0 ? rawIdempotencyKey : null;
    const scopedIdempotencyKey = normalizedIdempotencyKey
      ? buildScopedIdempotencyKey(normalizedIdempotencyKey, {
        organizationId: orgId,
        userId: user.id,
      })
      : null;

    const idempotencyService = createSupabaseIdempotencyService(supabaseAdmin);
    if (scopedIdempotencyKey) {
      const existing = await idempotencyService.find(scopedIdempotencyKey, "sessions-reactivate");
      if (existing) {
        const existingBody = existing.responseBody as Record<string, Json>;
        if (!matchesStoredRequest(existingBody, payload.session_id, requestWindow.startTime, requestWindow.endTime)) {
          return jsonResponse(req, { success: false, error: "Idempotency key already used for another session." }, 409);
        }

        return jsonResponse(
          req,
          sanitizeEnvelope(existing.responseBody),
          existing.statusCode,
          {
            "Idempotent-Replay": "true",
            ...(normalizedIdempotencyKey ? { "Idempotency-Key": normalizedIdempotencyKey } : {}),
          },
        );
      }
    }

    const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc("reactivate_cancelled_session", {
      p_session_id: payload.session_id,
      p_actor_id: user.id,
      p_start_time: payload.start_time ?? null,
      p_end_time: payload.end_time ?? null,
    });

    if (rpcError) {
      return jsonResponse(req, { success: false, error: rpcError.message ?? "Internal server error" }, 500);
    }

    const response = mapRpcResult(
      req,
      payload.session_id,
      requestWindow.startTime,
      requestWindow.endTime,
      (rpcResult ?? {}) as Record<string, unknown>,
    );
    if (scopedIdempotencyKey) {
      try {
        await persistIdempotencyResponse(
          scopedIdempotencyKey,
          await response.clone().json() as ReactivationEnvelope,
          response.status,
        );
      } catch (error) {
        if (error instanceof IdempotencyConflictError) {
          const replay = normalizedIdempotencyKey
            ? await replayPersistRace(
              req,
              normalizedIdempotencyKey,
              scopedIdempotencyKey,
              payload.session_id,
              requestWindow.startTime,
              requestWindow.endTime,
            )
            : null;
          if (replay) {
            return replay;
          }
          return jsonResponse(req, { success: false, error: error.message }, 409);
        }
        throw error;
      }
    }

    const outwardBody = sanitizeEnvelope(await response.clone().json() as ReactivationEnvelope);

    if (!normalizedIdempotencyKey) {
      return jsonResponse(req, outwardBody as Record<string, unknown>, response.status);
    }

    return jsonResponse(req, outwardBody as Record<string, unknown>, response.status, { "Idempotency-Key": normalizedIdempotencyKey });
  } catch {
    return jsonResponse(req, { success: false, error: "Internal server error" }, 500);
  }
};

Deno.serve(handleSessionsReactivate);
