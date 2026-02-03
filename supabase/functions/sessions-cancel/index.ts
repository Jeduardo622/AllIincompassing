import { createRequestClient, supabaseAdmin } from "../_shared/database.ts";
import {
  createSupabaseIdempotencyService,
  IdempotencyConflictError,
} from "../_shared/idempotency.ts";
import { evaluateTherapistAuthorization } from "../_shared/authorization.ts";
import {
  requireOrg,
  assertUserHasOrgRole,
  orgScopedQuery,
  MissingOrgContextError,
  ForbiddenError,
} from "../_shared/org.ts";
import { getLogger, type Logger } from "../_shared/logging.ts";
import { increment } from "../_shared/metrics.ts";
import { recordSessionAuditEvent } from "../_shared/audit.ts";
import { orchestrateScheduling } from "../_shared/scheduling-orchestrator.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface CancelPayload {
  hold_key?: unknown;
  session_ids?: unknown;
  date?: unknown;
  therapist_id?: unknown;
  reason?: unknown;
}

interface SessionRecord {
  id: string;
  status: string;
  therapist_id: string | null;
  start_time: string;
  end_time: string;
}

interface SessionCancellationSummary {
  cancelledCount: number;
  alreadyCancelledCount: number;
  totalCount: number;
  cancelledSessionIds: string[];
  alreadyCancelledSessionIds: string[];
}

class BadRequestError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
  extraHeaders: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
      ...extraHeaders,
    },
  });
}

async function ensureAuthenticated(db: SupabaseClient) {
  const { data, error } = await db.auth.getUser();
  if (error || !data?.user) {
    throw jsonResponse({ success: false, error: "Unauthorized" }, 401);
  }
  return data.user;
}

function normalizeRole(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeSessionIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      seen.add(candidate.trim());
    }
  }

  return Array.from(seen);
}

function buildDateRange(value: unknown): { start: string; end: string } | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return null;
  }

  const start = `${trimmed}T00:00:00`;
  const end = `${trimmed}T23:59:59.999`;
  return { start, end };
}

function parseCancelPayload(input: unknown): {
  holdKey: string | null;
  sessionIds: string[];
  dateRange: { start: string; end: string } | null;
  therapistId: string | null;
  reason: string | null;
} {
  if (typeof input !== "object" || input === null) {
    throw new BadRequestError("Invalid request payload");
  }

  const payload = input as CancelPayload;

  const holdKey =
    typeof payload.hold_key === "string" && payload.hold_key.trim().length > 0
      ? payload.hold_key.trim()
      : null;

  const sessionIds = normalizeSessionIds(payload.session_ids);
  const dateRange = buildDateRange(payload.date);
  const therapistId =
    typeof payload.therapist_id === "string" && payload.therapist_id.trim().length > 0
      ? payload.therapist_id.trim()
      : null;
  const reason =
    typeof payload.reason === "string" && payload.reason.trim().length > 0
      ? payload.reason.trim()
      : null;

  if (!holdKey && sessionIds.length === 0 && !dateRange) {
    throw new BadRequestError("Must provide hold_key, session_ids, or date");
  }

  return { holdKey, sessionIds, dateRange, therapistId, reason };
}

async function ensureRoleForCancellation(
  db: SupabaseClient,
  orgId: string,
  role: string | null,
  userId: string,
): Promise<boolean> {
  if (!role) {
    return false;
  }

  if (role === "super_admin") {
    if (await assertUserHasOrgRole(db, orgId, "super_admin")) {
      return true;
    }
    return assertUserHasOrgRole(db, orgId, "admin");
  }

  if (role === "admin") {
    return assertUserHasOrgRole(db, orgId, "admin");
  }

  if (role === "therapist") {
    return assertUserHasOrgRole(db, orgId, "therapist", { targetTherapistId: userId });
  }

  return false;
}

async function handleHoldRelease(
  req: Request,
  db: SupabaseClient,
  orgId: string,
  holdKey: string,
  userId: string,
  role: string | null,
  logger: Logger,
) {
  logger.info("hold.release.requested", { holdKey });

  const { data: hold, error } = await supabaseAdmin
    .from("session_holds")
    .select("id, session_id, therapist_id, client_id, start_time, end_time, expires_at")
    .eq("organization_id", orgId)
    .eq("hold_key", holdKey)
    .maybeSingle();
  increment("org_scoped_query_total", {
    function: "sessions-cancel",
    orgId,
    target: "session_holds",
  });

  if (error) {
    logger.error("hold.lookup.error", { error: error.message ?? "unknown" });
    throw new Error("Failed to release session hold");
  }

  if (!hold) {
    logger.warn("hold.scope.denied", { holdKey });
    increment("tenant_denial_total", {
      function: "sessions-cancel",
      orgId,
      reason: "hold-not-found",
    });
    throw new ForbiddenError("Hold not found or scope denied");
  }

  if (role === "therapist" && hold.therapist_id !== userId) {
    logger.warn("hold.scope.denied", {
      holdKey,
      reason: "therapist-mismatch",
      owner: hold.therapist_id,
    });
    increment("tenant_denial_total", {
      function: "sessions-cancel",
      orgId,
      reason: "therapist-mismatch",
    });
    throw new ForbiddenError("Forbidden");
  }

  const { data: deleted, error: deleteError } = await supabaseAdmin
    .from("session_holds")
    .delete()
    .eq("id", hold.id)
    .eq("organization_id", orgId)
    .select("id, session_id, hold_key, therapist_id, client_id, start_time, end_time, expires_at")
    .maybeSingle();

  if (deleteError) {
    logger.error("hold.release.failed", { holdKey, error: deleteError.message ?? "unknown" });
    throw new Error(deleteError.message ?? "Failed to release hold");
  }

  const releasedHold = deleted ?? hold;

  if (releasedHold.session_id) {
    await recordSessionAuditEvent(db, {
      sessionId: releasedHold.session_id,
      eventType: "hold_released",
      actorId: userId,
      payload: {
        holdKey,
        startTime: releasedHold.start_time,
        endTime: releasedHold.end_time,
        expiresAt: releasedHold.expires_at,
      },
      logger,
    });
  }

  logger.info("hold.released", { holdKey });
  increment("session_cancel_success_total", {
    function: "sessions-cancel",
    orgId,
    mode: "hold-release",
  });

  const orchestration = await orchestrateScheduling({
    req,
    workflow: "cancel",
    actorId: userId,
    actorRole: role,
    request: {
      therapistId: releasedHold.therapist_id,
      clientId: releasedHold.client_id,
      startTime: releasedHold.start_time,
      endTime: releasedHold.end_time,
      holdKey,
    },
    authorization: { ok: true },
  });

  return respondSuccess({
    released: true,
    hold: releasedHold,
    orchestration,
  });
}

function respondSuccess(data: Record<string, unknown>) {
  return jsonResponse({ success: true, data });
}

async function handleSessionCancellation(
  db: SupabaseClient,
  orgId: string,
  payload: {
    sessionIds: string[];
    dateRange: { start: string; end: string } | null;
    therapistId: string | null;
    reason: string | null;
  },
  userId: string,
  role: string | null,
  logger: Logger,
) {
  let query = orgScopedQuery(db, "sessions", orgId)
    .select("id, status, therapist_id, start_time, end_time")
    .order("start_time", { ascending: true });

  if (payload.sessionIds.length > 0) {
    query = query.in("id", payload.sessionIds);
  }

  if (payload.dateRange) {
    query = query
      .gte("start_time", payload.dateRange.start)
      .lt("start_time", payload.dateRange.end);
  }

  if (payload.therapistId) {
    query = query.eq("therapist_id", payload.therapistId);
  }

  if (role === "therapist") {
    query = query.eq("therapist_id", userId);
  }

  const { data, error } = await query;
  increment("org_scoped_query_total", {
    function: "sessions-cancel",
    orgId,
    operation: "fetch-sessions",
  });
  if (error) {
    logger.error("session.fetch.error", { error: error.message ?? "unknown" });
    throw new Error(error.message ?? "Failed to load sessions");
  }

  const sessions = (data ?? []) as SessionRecord[];

  if (payload.sessionIds.length > 0) {
    const fetchedIds = new Set(sessions.map(session => session.id));
    if (fetchedIds.size !== payload.sessionIds.length) {
      logger.warn("session.scope.denied", {
        targetSessionIds: payload.sessionIds,
        reason: "session-scope-mismatch",
      });
      increment("tenant_denial_total", {
        function: "sessions-cancel",
        orgId,
        reason: "session-scope-mismatch",
      });
      throw new ForbiddenError("Forbidden");
    }
  }

  if (sessions.length === 0) {
    logger.info("session.cancel.noop", { reason: "no-sessions" });
    return respondSuccess({
      summary: {
        cancelledCount: 0,
        alreadyCancelledCount: 0,
        totalCount: 0,
        cancelledSessionIds: [],
        alreadyCancelledSessionIds: [],
      } satisfies SessionCancellationSummary,
    });
  }

  const cancellableIds = sessions
    .filter(session => session.status !== "cancelled")
    .map(session => session.id);

  if (cancellableIds.length > 0) {
    const updates: Record<string, unknown> = {
      status: "cancelled",
      updated_by: userId,
    };
    if (payload.reason) {
      updates.notes = payload.reason;
    }

    let updateQuery = db
      .from("sessions")
      .update(updates)
      .in("id", cancellableIds)
      .select("id");

    if (role === "therapist") {
      updateQuery = updateQuery.eq("therapist_id", userId);
    }

    const { error: updateError } = await updateQuery.eq("organization_id", orgId);
    if (updateError) {
      throw new Error(updateError.message ?? "Failed to cancel sessions");
    }

    await Promise.all(sessions
      .filter(session => cancellableIds.includes(session.id))
      .map(session => recordSessionAuditEvent(db, {
        sessionId: session.id,
        eventType: "session_cancelled",
        actorId: userId,
        payload: {
          reason: payload.reason,
          startTime: session.start_time,
          endTime: session.end_time,
        },
        logger,
      })));
  }

  const alreadyCancelledIds = sessions
    .filter(session => session.status === "cancelled")
    .map(session => session.id);

  const summary: SessionCancellationSummary = {
    cancelledCount: cancellableIds.length,
    alreadyCancelledCount: alreadyCancelledIds.length,
    totalCount: sessions.length,
    cancelledSessionIds: cancellableIds,
    alreadyCancelledSessionIds: alreadyCancelledIds,
  };

  logger.info("session.cancel.completed", {
    cancelledCount: summary.cancelledCount,
    alreadyCancelledCount: summary.alreadyCancelledCount,
  });
  increment("session_cancel_success_total", {
    function: "sessions-cancel",
    orgId,
    mode: "cancel",
    cancelled: summary.cancelledCount,
  });

  return respondSuccess({ summary });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  const db = createRequestClient(req);
  const baseLogger = getLogger(req, { functionName: "sessions-cancel" });
  let userLogger: Logger = baseLogger;
  let scopedLogger: Logger | null = null;
  let currentOrgId: string | null = null;

  try {
    const user = await ensureAuthenticated(db);
    userLogger = baseLogger.with({ userId: user.id });
    userLogger.info("request.authenticated");
    const idempotencyKey = req.headers.get("Idempotency-Key")?.trim() || "";
    const normalizedKey = idempotencyKey.length > 0 ? idempotencyKey : null;
    const idempotencyService = createSupabaseIdempotencyService(supabaseAdmin);

    if (normalizedKey) {
      const existing = await idempotencyService.find(normalizedKey, "sessions-cancel");
      if (existing) {
        return jsonResponse(
          existing.responseBody as Record<string, unknown>,
          existing.statusCode,
          { "Idempotent-Replay": "true", "Idempotency-Key": normalizedKey },
        );
      }
    }

    const orgId = await requireOrg(db);
    currentOrgId = orgId;
    scopedLogger = userLogger.with({ orgId });
    scopedLogger.info("request.org-scoped");

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      throw new Error(profileError.message ?? "Failed to resolve user role");
    }

    const role = normalizeRole(profile?.role);
    const roleAllowed = await ensureRoleForCancellation(db, orgId, role, user.id);
    if (!roleAllowed) {
      const denialLogger = scopedLogger ?? userLogger;
      denialLogger.warn("authorization.denied", { reason: "role-denied" });
      increment("tenant_denial_total", {
        function: "sessions-cancel",
        orgId,
        reason: "role-denied",
      });
      throw new ForbiddenError("Forbidden");
    }

    const payload = parseCancelPayload(await req.json());

    if (payload.therapistId) {
      const authorization = await evaluateTherapistAuthorization(db, payload.therapistId);
      if (!authorization.ok) {
        const denyLogger = scopedLogger ?? userLogger;
        denyLogger.warn("authorization.denied", {
          reason: "therapist-authorization-failed",
          therapistId: payload.therapistId,
        });
        increment("tenant_denial_total", {
          function: "sessions-cancel",
          orgId,
          reason: "therapist-authorization",
        });
        return jsonResponse(authorization.failure.body, authorization.failure.status);
      }
    }

    const activeLogger = scopedLogger ?? userLogger;

    let response: Response;
    if (payload.holdKey) {
      response = await handleHoldRelease(
        req,
        db,
        orgId,
        payload.holdKey,
        user.id,
        role,
        activeLogger,
      );
    } else {
      response = await handleSessionCancellation(
        db,
        orgId,
        {
          sessionIds: payload.sessionIds,
          dateRange: payload.dateRange,
          therapistId: payload.therapistId,
          reason: payload.reason,
        },
        user.id,
        role,
        activeLogger,
      );
    }

    if (normalizedKey) {
      try {
        const body = (await response.clone().json()) as Record<string, unknown>;
        await idempotencyService.persist(normalizedKey, "sessions-cancel", body, response.status);
      } catch (error) {
        if (error instanceof IdempotencyConflictError) {
          return jsonResponse({ success: false, error: error.message }, 409);
        }
        throw error;
      }
    }

    activeLogger.info("request.completed");
    return response;
  } catch (error) {
    const errorLogger = scopedLogger ?? userLogger ?? baseLogger;
    if (error instanceof MissingOrgContextError) {
      errorLogger.warn("request.denied", { reason: "missing-org-context" });
      increment("tenant_denial_total", {
        function: "sessions-cancel",
        reason: "missing-org",
      });
      return jsonResponse({ success: false, error: error.message }, 403);
    }

    if (error instanceof ForbiddenError) {
      errorLogger.warn("request.denied", { reason: error.message });
      increment("tenant_denial_total", {
        function: "sessions-cancel",
        orgId: currentOrgId ?? undefined,
        reason: "forbidden-error",
      });
      return jsonResponse({ success: false, error: error.message }, 403);
    }

    if (error instanceof BadRequestError) {
      return jsonResponse({ success: false, error: error.message }, error.status);
    }

    if (error instanceof Response) {
      return error;
    }

    errorLogger.error("request.failed", { error: (error as Error).message ?? "unknown" });
    return jsonResponse({ success: false, error: "Internal server error" }, 500);
  }
});

export const __TESTING__ = {
  handleSessionCancellation,
  handleHoldRelease,
  parseCancelPayload,
};
