import { createRequestClient, supabaseAdmin } from "../_shared/database.ts";
import { corsHeadersForRequest, resolveAllowedOrigin } from "../_shared/cors.ts";
import {
  buildScopedIdempotencyKey,
  createSupabaseIdempotencyService,
  IdempotencyConflictError,
} from "../_shared/idempotency.ts";
import { evaluateTherapistAuthorization } from "../_shared/authorization.ts";
import {
  requireOrgForScheduling,
  assertUserHasOrgRole,
  orgScopedQuery,
  MissingOrgContextError,
  ForbiddenError,
  resolveOrgId,
} from "../_shared/org.ts";
import { getLogger, type Logger } from "../_shared/logging.ts";
import { increment } from "../_shared/metrics.ts";
import { recordSessionAuditEvent } from "../_shared/audit.ts";
import { orchestrateScheduling } from "../_shared/scheduling-orchestrator.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";
import { deriveOffsetFromTimeZone } from "../_shared/timezone.ts";

interface CancelPayload {
  hold_key?: unknown;
  session_ids?: unknown;
  date?: unknown;
  time_zone?: unknown;
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
  nonCancellableCount: number;
  totalCount: number;
  cancelledSessionIds: string[];
  alreadyCancelledSessionIds: string[];
  nonCancellableSessionIds: string[];
}

interface TraceMeta {
  requestId: string | null;
  correlationId: string | null;
  agentOperationId: string | null;
}

const CANCELLABLE_STATUSES = new Set(["scheduled", "in_progress"]);

class BadRequestError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}

function jsonResponse(
  req: Request,
  body: Record<string, unknown>,
  status = 200,
  extraHeaders: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeadersForRequest(req),
      ...extraHeaders,
    },
  });
}

const buildFallbackRequest = (): Request =>
  new Request("https://edge.internal.local", {
    headers: {
      origin: resolveAllowedOrigin(null),
    },
  });

async function ensureAuthenticated(req: Request, db: SupabaseClient) {
  const { data, error } = await db.auth.getUser();
  if (error || !data?.user) {
    throw jsonResponse(req, { success: false, error: "Unauthorized" }, 401);
  }
  return data.user;
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

function buildDateRange(value: unknown, timeZone: unknown): { start: string; end: string; timeZone: string } | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return null;
  }

  const resolvedTimeZone =
    typeof timeZone === "string" && timeZone.trim().length > 0
      ? timeZone.trim()
      : "UTC";

  const toUtcIso = (localClockTime: string) => {
    const utcGuess = new Date(`${trimmed}T${localClockTime}Z`);
    if (Number.isNaN(utcGuess.getTime())) {
      return null;
    }

    const firstOffset = deriveOffsetFromTimeZone(resolvedTimeZone, utcGuess.toISOString());
    if (firstOffset === null) {
      return null;
    }

    const firstCandidate = new Date(utcGuess.getTime() - firstOffset * 60_000);
    const secondOffset = deriveOffsetFromTimeZone(resolvedTimeZone, firstCandidate.toISOString());
    if (secondOffset === null) {
      return null;
    }

    const finalCandidate = secondOffset === firstOffset
      ? firstCandidate
      : new Date(utcGuess.getTime() - secondOffset * 60_000);
    return finalCandidate.toISOString();
  };

  const start = toUtcIso("00:00:00.000");
  const end = toUtcIso("23:59:59.999");
  if (!start || !end) {
    return null;
  }

  return { start, end, timeZone: resolvedTimeZone };
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
  const dateRange = buildDateRange(payload.date, payload.time_zone);
  const hasDateInput = typeof payload.date === "string" && payload.date.trim().length > 0;
  const hasTimeZoneInput = typeof payload.time_zone === "string" && payload.time_zone.trim().length > 0;
  const therapistId =
    typeof payload.therapist_id === "string" && payload.therapist_id.trim().length > 0
      ? payload.therapist_id.trim()
      : null;
  const reason =
    typeof payload.reason === "string" && payload.reason.trim().length > 0
      ? payload.reason.trim()
      : null;

  if (hasDateInput && hasTimeZoneInput && !dateRange) {
    throw new BadRequestError("Invalid date or time_zone for cancellation window");
  }

  if (!holdKey && sessionIds.length === 0 && !dateRange) {
    throw new BadRequestError("Must provide hold_key, session_ids, or date");
  }

  return { holdKey, sessionIds, dateRange, therapistId, reason };
}

type CancellationRole = "super_admin" | "admin" | "therapist" | null;

async function resolveCancellationRole(
  db: SupabaseClient,
  orgId: string,
  userId: string,
) : Promise<CancellationRole> {
  if (await assertUserHasOrgRole(db, orgId, "super_admin")) {
    return "super_admin";
  }
  if (await assertUserHasOrgRole(db, orgId, "admin")) {
    return "admin";
  }
  if (await assertUserHasOrgRole(db, orgId, "therapist", { targetTherapistId: userId })) {
    return "therapist";
  }
  return null;
}

async function currentUserIsSuperAdmin(db: SupabaseClient): Promise<boolean> {
  const { data, error } = await db.rpc("current_user_is_super_admin");
  if (error) {
    console.error("currentUserIsSuperAdmin error", error);
    throw new MissingOrgContextError();
  }
  return data === true;
}

async function resolveOrgFromHoldKey(holdKey: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("session_holds")
    .select("organization_id")
    .eq("hold_key", holdKey)
    .maybeSingle();

  if (error) {
    console.error("resolveOrgFromHoldKey error", error);
    throw new MissingOrgContextError();
  }

  const organizationId =
    data && typeof (data as { organization_id?: unknown }).organization_id === "string"
      ? (data as { organization_id: string }).organization_id.trim()
      : "";

  if (organizationId.length === 0) {
    throw new ForbiddenError("Forbidden");
  }

  return organizationId;
}

async function resolveOrgFromSessionIds(sessionIds: string[]): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("sessions")
    .select("id, organization_id")
    .in("id", sessionIds);

  if (error) {
    console.error("resolveOrgFromSessionIds error", error);
    throw new MissingOrgContextError();
  }

  const rows = Array.isArray(data) ? data : [];
  if (rows.length !== sessionIds.length) {
    throw new ForbiddenError("Forbidden");
  }

  const uniqueOrganizationIds = new Set(
    rows
      .map((row) =>
        row && typeof (row as { organization_id?: unknown }).organization_id === "string"
          ? (row as { organization_id: string }).organization_id.trim()
          : ""
      )
      .filter((organizationId) => organizationId.length > 0),
  );

  if (uniqueOrganizationIds.size !== 1) {
    throw new ForbiddenError("Forbidden");
  }

  return Array.from(uniqueOrganizationIds)[0];
}

async function resolveOrgForCancellationRequest(
  db: SupabaseClient,
  payload: {
    holdKey: string | null;
    sessionIds: string[];
    therapistId: string | null;
  },
): Promise<string> {
  const directOrgId = await resolveOrgId(db);
  if (directOrgId) {
    return directOrgId;
  }

  if (!await currentUserIsSuperAdmin(db)) {
    throw new MissingOrgContextError();
  }

  if (payload.holdKey) {
    return resolveOrgFromHoldKey(payload.holdKey);
  }

  if (payload.sessionIds.length > 0) {
    return resolveOrgFromSessionIds(payload.sessionIds);
  }

  if (payload.therapistId) {
    return requireOrgForScheduling(db, payload.therapistId);
  }

  throw new MissingOrgContextError();
}

async function handleHoldRelease(
  req: Request,
  db: SupabaseClient,
  orgId: string,
  holdKey: string,
  userId: string,
  role: CancellationRole,
  logger: Logger,
  traceMeta: TraceMeta = { requestId: null, correlationId: null, agentOperationId: null },
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
      // Do not fail cancellation response on audit sink issues.
      required: false,
      payload: {
        holdKey,
        startTime: releasedHold.start_time,
        endTime: releasedHold.end_time,
        expiresAt: releasedHold.expires_at,
        agentOperationId: traceMeta.agentOperationId,
        trace: traceMeta,
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
      agentOperationId: traceMeta.agentOperationId,
    },
    authorization: { ok: true },
  });

  return respondSuccess(req, {
    released: true,
    hold: releasedHold,
    orchestration,
  });
}

function respondSuccess(req: Request, data: Record<string, unknown>) {
  return jsonResponse(req, { success: true, data });
}

async function handleSessionCancellationForRequest(
  req: Request,
  db: SupabaseClient,
  orgId: string,
  payload: {
    sessionIds: string[];
    dateRange: { start: string; end: string } | null;
    therapistId: string | null;
    reason: string | null;
  },
  userId: string,
  role: CancellationRole,
  logger: Logger,
  traceMeta: TraceMeta = { requestId: null, correlationId: null, agentOperationId: null },
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
    return respondSuccess(req, {
      summary: {
        cancelledCount: 0,
        alreadyCancelledCount: 0,
        nonCancellableCount: 0,
        totalCount: 0,
        cancelledSessionIds: [],
        alreadyCancelledSessionIds: [],
        nonCancellableSessionIds: [],
      } satisfies SessionCancellationSummary,
    });
  }

  const cancellableIds = sessions
    .filter((session) => CANCELLABLE_STATUSES.has(session.status))
    .map(session => session.id);
  const updatedCancellableIds = new Set<string>();

  if (cancellableIds.length > 0) {
    const updates: Record<string, unknown> = {
      status: "cancelled",
      updated_by: userId,
    };
    if (payload.reason) {
      updates.notes = payload.reason;
    }

    let updateQuery = supabaseAdmin
      .from("sessions")
      .update(updates)
      .in("id", cancellableIds)
      .in("status", Array.from(CANCELLABLE_STATUSES))
      .eq("organization_id", orgId)
      .select("id");

    if (role === "therapist") {
      updateQuery = updateQuery.eq("therapist_id", userId);
    }

    const { data: updatedRows, error: updateError } = await updateQuery;
    if (updateError) {
      throw new Error(updateError.message ?? "Failed to cancel sessions");
    }
    for (const row of updatedRows ?? []) {
      if (row && typeof row.id === "string") {
        updatedCancellableIds.add(row.id);
      }
    }

    await Promise.all(sessions
      .filter(session => updatedCancellableIds.has(session.id))
      .map(session => recordSessionAuditEvent(db, {
        sessionId: session.id,
        eventType: "session_cancelled",
        actorId: userId,
        // Cancellation state change should succeed even when audit writes degrade.
        required: false,
        payload: {
          reason: payload.reason,
          startTime: session.start_time,
          endTime: session.end_time,
          agentOperationId: traceMeta.agentOperationId,
          trace: traceMeta,
        },
        logger,
      })));
  }

  const alreadyCancelledIds = sessions
    .filter(session => session.status === "cancelled")
    .map(session => session.id);
  const nonCancellableSessionIds = sessions
    .filter(
      (session) =>
        session.status !== "cancelled" &&
        !CANCELLABLE_STATUSES.has(session.status),
    )
    .map((session) => session.id);

  const summary: SessionCancellationSummary = {
    cancelledCount: updatedCancellableIds.size,
    alreadyCancelledCount: alreadyCancelledIds.length,
    nonCancellableCount: nonCancellableSessionIds.length,
    totalCount: sessions.length,
    cancelledSessionIds: Array.from(updatedCancellableIds),
    alreadyCancelledSessionIds: alreadyCancelledIds,
    nonCancellableSessionIds,
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

  return respondSuccess(req, { summary });
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
  role: CancellationRole,
  logger: Logger,
  traceMeta: TraceMeta = { requestId: null, correlationId: null, agentOperationId: null },
) {
  return handleSessionCancellationForRequest(
    buildFallbackRequest(),
    db,
    orgId,
    payload,
    userId,
    role,
    logger,
    traceMeta,
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeadersForRequest(req) });
  }

  if (req.method !== "POST") {
    return jsonResponse(req, { success: false, error: "Method not allowed" }, 405);
  }

  const db = createRequestClient(req);
  const baseLogger = getLogger(req, { functionName: "sessions-cancel" });
  let userLogger: Logger = baseLogger;
  let scopedLogger: Logger | null = null;
  let currentOrgId: string | null = null;

  try {
    const user = await ensureAuthenticated(req, db);
    userLogger = baseLogger.with({ userId: user.id });
    userLogger.info("request.authenticated");
    const idempotencyKey = req.headers.get("Idempotency-Key")?.trim() || "";
    const normalizedKey = idempotencyKey.length > 0 ? idempotencyKey : null;
    const traceMeta: TraceMeta = {
      requestId: req.headers.get("x-request-id") ?? null,
      correlationId: req.headers.get("x-correlation-id") ?? null,
      agentOperationId: req.headers.get("x-agent-operation-id") ?? null,
    };
    const idempotencyService = createSupabaseIdempotencyService(supabaseAdmin);

    const payload = parseCancelPayload(await req.json());

    const orgId = await resolveOrgForCancellationRequest(db, {
      holdKey: payload.holdKey,
      sessionIds: payload.sessionIds,
      therapistId: payload.therapistId,
    });
    currentOrgId = orgId;
    scopedLogger = userLogger.with({ orgId });
    scopedLogger.info("request.org-scoped");

    const role = await resolveCancellationRole(db, orgId, user.id);
    if (!role) {
      const denialLogger = scopedLogger ?? userLogger;
      denialLogger.warn("authorization.denied", { reason: "role-denied" });
      increment("tenant_denial_total", {
        function: "sessions-cancel",
        orgId,
        reason: "role-denied",
      });
      throw new ForbiddenError("Forbidden");
    }

    const storageIdempotencyKey = normalizedKey
      ? buildScopedIdempotencyKey(normalizedKey, { organizationId: orgId, userId: user.id })
      : null;
    if (storageIdempotencyKey) {
      const existing = await idempotencyService.find(storageIdempotencyKey, "sessions-cancel");
      if (existing) {
        return jsonResponse(
          req,
          existing.responseBody as Record<string, unknown>,
          existing.statusCode,
          { "Idempotent-Replay": "true", "Idempotency-Key": normalizedKey },
        );
      }
    }

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
        return jsonResponse(req, authorization.failure.body, authorization.failure.status);
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
        traceMeta,
      );
    } else {
      response = await handleSessionCancellationForRequest(
        req,
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
        traceMeta,
      );
    }

    if (storageIdempotencyKey) {
      try {
        const body = (await response.clone().json()) as Record<string, unknown>;
        await idempotencyService.persist(storageIdempotencyKey, "sessions-cancel", body, response.status);
      } catch (error) {
        if (error instanceof IdempotencyConflictError) {
          return jsonResponse(req, { success: false, error: error.message }, 409);
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
      return jsonResponse(req, { success: false, error: error.message }, 403);
    }

    if (error instanceof ForbiddenError) {
      errorLogger.warn("request.denied", { reason: error.message });
      increment("tenant_denial_total", {
        function: "sessions-cancel",
        orgId: currentOrgId ?? undefined,
        reason: "forbidden-error",
      });
      return jsonResponse(req, { success: false, error: error.message }, 403);
    }

    if (error instanceof BadRequestError) {
      return jsonResponse(req, { success: false, error: error.message }, error.status);
    }

    if (error instanceof Response) {
      return error;
    }

    errorLogger.error("request.failed", { error: (error as Error).message ?? "unknown" });
    return jsonResponse(req, { success: false, error: "Internal server error" }, 500);
  }
});

export const __TESTING__ = {
  handleSessionCancellation,
  handleHoldRelease,
  parseCancelPayload,
  buildDateRange,
  resolveCancellationRole,
  resolveOrgForCancellationRequest,
  resolveOrgFromSessionIds,
  resolveOrgFromHoldKey,
};
