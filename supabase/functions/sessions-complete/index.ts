import { createRequestClient, supabaseAdmin } from "../_shared/database.ts";
import { corsHeadersForRequest, resolveAllowedOrigin } from "../_shared/cors.ts";
import {
  buildScopedIdempotencyKey,
  createSupabaseIdempotencyService,
  IdempotencyConflictError,
} from "../_shared/idempotency.ts";
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
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";

// Statuses from which a session may be moved to a terminal outcome.
// Symmetric with CANCELLABLE_STATUSES in sessions-cancel.
const COMPLETABLE_STATUSES = new Set(["scheduled", "in_progress"]);

// Already-terminal statuses that must be rejected explicitly.
const TERMINAL_STATUSES = new Set(["completed", "cancelled", "no-show"]);

type SessionOutcome = "completed" | "no-show";
type CompletionRole = "super_admin" | "admin" | "therapist" | null;

interface CompletionPayload {
  session_id: string;
  outcome: SessionOutcome;
  notes: string | null;
}

interface SessionRecord {
  id: string;
  status: string;
  therapist_id: string | null;
  start_time: string;
  end_time: string;
}

interface TraceMeta {
  requestId: string | null;
  correlationId: string | null;
  agentOperationId: string | null;
}

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

function respondSuccess(req: Request, data: Record<string, unknown>) {
  return jsonResponse(req, { success: true, data });
}

async function ensureAuthenticated(req: Request, db: SupabaseClient) {
  const { data, error } = await db.auth.getUser();
  if (error || !data?.user) {
    throw jsonResponse(req, { success: false, error: "Unauthorized" }, 401);
  }
  return data.user;
}

export function parseCompletionPayload(input: unknown): CompletionPayload {
  if (typeof input !== "object" || input === null) {
    throw new BadRequestError("Invalid request payload");
  }

  const payload = input as Record<string, unknown>;

  const sessionId =
    typeof payload.session_id === "string" && payload.session_id.trim().length > 0
      ? payload.session_id.trim()
      : null;

  if (!sessionId) {
    throw new BadRequestError("Missing required field: session_id");
  }

  const outcome = payload.outcome;
  if (outcome !== "completed" && outcome !== "no-show") {
    throw new BadRequestError('outcome must be "completed" or "no-show"');
  }

  const notes =
    typeof payload.notes === "string" && payload.notes.trim().length > 0
      ? payload.notes.trim()
      : null;

  return { session_id: sessionId, outcome, notes };
}

export async function resolveCompletionRole(
  db: SupabaseClient,
  orgId: string,
  userId: string,
): Promise<CompletionRole> {
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

// ---------------------------------------------------------------------------
// Session notes guard
//
// Checks that every goal worked in this session (session_goals rows) has a
// non-empty note entry in the goal_notes jsonb column of the linked
// client_session_notes row(s).  Uses supabaseAdmin with explicit org scoping
// so the check is not affected by the caller's RLS context.
//
// Returns null when the check passes (or is not applicable).
// Returns a 409 Response when the check fails.
// ---------------------------------------------------------------------------

async function checkSessionNotesPresentForRequest(
  req: Request,
  sessionId: string,
  orgId: string,
  logger: Logger,
): Promise<Response | null> {
  // 1. Fetch session_goals for this session within the org.
  const { data: sessionGoals, error: sgError } = await supabaseAdmin
    .from("session_goals")
    .select("goal_id")
    .eq("session_id", sessionId)
    .eq("organization_id", orgId);

  if (sgError) {
    logger.error("session.notes-check.goals-fetch-error", { error: sgError.message ?? "unknown" });
    throw new Error(sgError.message ?? "Failed to load session goals for notes check");
  }

  if (!sessionGoals || sessionGoals.length === 0) {
    // No goals were recorded for this session — notes guard does not apply.
    return null;
  }

  const requiredGoalIds = (sessionGoals as Array<{ goal_id: string }>).map((sg) => sg.goal_id);

  // 2. Fetch all note rows linked to this session within the org.
  const { data: notes, error: notesError } = await supabaseAdmin
    .from("client_session_notes")
    .select("goal_notes")
    .eq("session_id", sessionId)
    .eq("organization_id", orgId);

  if (notesError) {
    logger.error("session.notes-check.notes-fetch-error", { error: notesError.message ?? "unknown" });
    throw new Error(notesError.message ?? "Failed to load session notes for notes check");
  }

  // 3. Build the union of all goal_notes entries across every linked note row.
  //    A goal counts as "covered" only if its note text is a non-empty string.
  const covered = new Set<string>();
  for (const row of (notes ?? []) as Array<{ goal_notes: Record<string, unknown> | null }>) {
    const gn = row.goal_notes;
    if (gn && typeof gn === "object") {
      for (const [goalId, text] of Object.entries(gn)) {
        if (typeof text === "string" && text.trim().length > 0) {
          covered.add(goalId);
        }
      }
    }
  }

  // 4. Every session_goal must be covered.
  const missing = requiredGoalIds.filter((id) => !covered.has(id));
  if (missing.length > 0) {
    logger.warn("session.notes-required", {
      sessionId,
      missingGoalCount: missing.length,
    });
    increment("session_notes_required_rejection_total", {
      function: "sessions-complete",
      orgId,
    });
    return jsonResponse(
      req,
      {
        success: false,
        error: "Session notes with goal progress are required before closing this session.",
        code: "SESSION_NOTES_REQUIRED",
        missing_goal_count: missing.length,
      },
      409,
    );
  }

  return null;
}

export async function checkSessionNotesPresent(
  sessionId: string,
  orgId: string,
  logger: Logger,
): Promise<Response | null> {
  return checkSessionNotesPresentForRequest(buildFallbackRequest(), sessionId, orgId, logger);
}

async function handleSessionCompletionForRequest(
  req: Request,
  db: SupabaseClient,
  orgId: string,
  payload: CompletionPayload,
  userId: string,
  role: CompletionRole,
  logger: Logger,
  traceMeta: TraceMeta = { requestId: null, correlationId: null, agentOperationId: null },
): Promise<Response> {
  const { session_id: sessionId, outcome, notes } = payload;

  // Fetch session scoped to the caller's org (uses request-auth client for RLS read)
  const { data: sessions, error: fetchError } = await orgScopedQuery(db, "sessions", orgId)
    .select("id, status, therapist_id, start_time, end_time")
    .eq("id", sessionId)
    .limit(1);

  increment("org_scoped_query_total", {
    function: "sessions-complete",
    orgId,
    operation: "fetch-session",
  });

  if (fetchError) {
    logger.error("session.fetch.error", { error: fetchError.message ?? "unknown" });
    throw new Error(fetchError.message ?? "Failed to load session");
  }

  const session = ((sessions ?? []) as SessionRecord[])[0] ?? null;

  if (!session) {
    logger.warn("session.not-found", { sessionId, reason: "not-in-org-scope" });
    increment("tenant_denial_total", {
      function: "sessions-complete",
      orgId,
      reason: "session-not-found",
    });
    return jsonResponse(
      req,
      { success: false, error: "Session not found", code: "SESSION_NOT_FOUND" },
      404,
    );
  }

  // Therapist self-ownership: a therapist may only complete their own sessions.
  // Admins and super_admins may complete any session in their org.
  if (role === "therapist" && session.therapist_id !== userId) {
    logger.warn("session.scope.denied", {
      sessionId,
      reason: "therapist-mismatch",
      owner: session.therapist_id,
    });
    increment("tenant_denial_total", {
      function: "sessions-complete",
      orgId,
      reason: "therapist-mismatch",
    });
    return jsonResponse(req, { success: false, error: "Forbidden", code: "FORBIDDEN" }, 403);
  }

  // Already-terminal sessions must be rejected with a clear error — do not silently skip.
  if (TERMINAL_STATUSES.has(session.status)) {
    logger.info("session.already-terminal", { sessionId, status: session.status });
    return jsonResponse(
      req,
      {
        success: false,
        error: `Session is already in a terminal state: ${session.status}`,
        code: "ALREADY_TERMINAL",
      },
      409,
    );
  }

  if (!COMPLETABLE_STATUSES.has(session.status)) {
    logger.warn("session.invalid-status", { sessionId, status: session.status });
    return jsonResponse(
      req,
      {
        success: false,
        error: `Session status '${session.status}' cannot be transitioned to ${outcome}`,
        code: "INVALID_STATUS",
      },
      409,
    );
  }

  // Notes guard — only for in_progress sessions.  A session that is still
  // "scheduled" has not started, so no notes can exist yet; the guard is
  // skipped.  For in_progress sessions the therapist must have filed a note
  // row with non-empty goal_notes covering every session_goal before the
  // session can be closed.
  if (session.status === "in_progress") {
    const notesCheckFailure = await checkSessionNotesPresentForRequest(req, sessionId, orgId, logger);
    if (notesCheckFailure) {
      return notesCheckFailure;
    }
  }

  // Service-role UPDATE with all three scoping guards present:
  //   1. exact id = sessionId
  //   2. status IN COMPLETABLE_STATUSES  (optimistic guard — catches concurrent modifications)
  //   3. organization_id = orgId
  const updates: Record<string, unknown> = {
    status: outcome,
    updated_by: userId,
  };
  if (notes) {
    updates.notes = notes;
  }

  const { data: updatedRows, error: updateError } = await supabaseAdmin
    .from("sessions")
    .update(updates)
    .eq("id", sessionId)
    .in("status", Array.from(COMPLETABLE_STATUSES))
    .eq("organization_id", orgId)
    .select("id, status, updated_at");

  if (updateError) {
    const normalizedMessage = (updateError.message ?? "").toUpperCase();
    const normalizedDetails = (updateError.details ?? "").toUpperCase();
    if (normalizedMessage.includes("SESSION_NOTES_REQUIRED") || normalizedDetails.includes("SESSION_NOTES_REQUIRED")) {
      logger.warn("session.notes-required.db-guard", { sessionId });
      increment("session_notes_required_rejection_total", {
        function: "sessions-complete",
        orgId,
      });
      return jsonResponse(
        req,
        {
          success: false,
          error: "Session notes with goal progress are required before closing this session.",
          code: "SESSION_NOTES_REQUIRED",
        },
        409,
      );
    }
    logger.error("session.update.error", { error: updateError.message ?? "unknown" });
    throw new Error(updateError.message ?? "Failed to update session");
  }

  const updatedSession = (updatedRows ?? [])[0] ?? null;

  if (!updatedSession) {
    // Zero rows affected: status changed between fetch and update (race condition).
    logger.warn("session.concurrent-modification", { sessionId });
    increment("session_complete_concurrent_total", {
      function: "sessions-complete",
      orgId,
    });
    return jsonResponse(
      req,
      {
        success: false,
        error: "Session was modified concurrently. Refresh and try again.",
        code: "CONCURRENT_MODIFICATION",
      },
      409,
    );
  }

  // Audit event fires after the write succeeds.
  // required: false — audit degradation must not block the user-visible outcome.
  const eventType = outcome === "completed" ? "session_completed" : "session_no_show";

  await recordSessionAuditEvent(db, {
    sessionId,
    eventType,
    actorId: userId,
    required: false,
    payload: {
      outcome,
      startTime: session.start_time,
      endTime: session.end_time,
      notes: notes ?? null,
      agentOperationId: traceMeta.agentOperationId,
      trace: traceMeta,
    },
    logger,
  });

  increment("session_complete_success_total", {
    function: "sessions-complete",
    orgId,
    outcome,
  });

  logger.info("session.complete.success", { sessionId, outcome });

  return respondSuccess(req, { session: updatedSession, outcome });
}

export async function handleSessionCompletion(
  db: SupabaseClient,
  orgId: string,
  payload: CompletionPayload,
  userId: string,
  role: CompletionRole,
  logger: Logger,
  traceMeta: TraceMeta = { requestId: null, correlationId: null, agentOperationId: null },
): Promise<Response> {
  return handleSessionCompletionForRequest(
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
  const baseLogger = getLogger(req, { functionName: "sessions-complete" });
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

    const orgId = await requireOrg(db);
    currentOrgId = orgId;
    scopedLogger = userLogger.with({ orgId });
    scopedLogger.info("request.org-scoped");

    const role = await resolveCompletionRole(db, orgId, user.id);
    if (!role) {
      const denialLogger = scopedLogger ?? userLogger;
      denialLogger.warn("authorization.denied", { reason: "role-denied" });
      increment("tenant_denial_total", {
        function: "sessions-complete",
        orgId,
        reason: "role-denied",
      });
      throw new ForbiddenError("Forbidden");
    }

    const storageIdempotencyKey = normalizedKey
      ? buildScopedIdempotencyKey(normalizedKey, { organizationId: orgId, userId: user.id })
      : null;

    if (storageIdempotencyKey) {
      const existing = await idempotencyService.find(storageIdempotencyKey, "sessions-complete");
      if (existing) {
          return jsonResponse(
            req,
          existing.responseBody as Record<string, unknown>,
          existing.statusCode,
          { "Idempotent-Replay": "true", "Idempotency-Key": normalizedKey! },
        );
      }
    }

    const payload = parseCompletionPayload(await req.json());
    const activeLogger = scopedLogger ?? userLogger;

    const response = await handleSessionCompletionForRequest(
      req,
      db,
      orgId,
      payload,
      user.id,
      role,
      activeLogger,
      traceMeta,
    );

    if (storageIdempotencyKey) {
      try {
        const body = (await response.clone().json()) as Record<string, unknown>;
        await idempotencyService.persist(
          storageIdempotencyKey,
          "sessions-complete",
          body,
          response.status,
        );
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
        function: "sessions-complete",
        reason: "missing-org",
      });
      return jsonResponse(req, { success: false, error: error.message }, 403);
    }

    if (error instanceof ForbiddenError) {
      errorLogger.warn("request.denied", { reason: error.message });
      increment("tenant_denial_total", {
        function: "sessions-complete",
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
  handleSessionCompletion,
  parseCompletionPayload,
  resolveCompletionRole,
  checkSessionNotesPresent,
};
