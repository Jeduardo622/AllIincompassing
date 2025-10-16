import {
  createProtectedRoute,
  corsHeaders,
  logApiAccess,
  RouteOptions,
  UserContext,
  type Role,
} from "../_shared/auth-middleware.ts";
import { createRequestClient } from "../_shared/database.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";
import { getLogger, type Logger } from "../_shared/logging.ts";
import { increment } from "../_shared/metrics.ts";
import {
  requireOrg,
  assertUserHasOrgRole,
  orgScopedQuery,
  MissingOrgContextError,
  ForbiddenError,
} from "../_shared/org.ts";

interface ReportRequest {
  reportType: string;
  startDate: string;
  endDate: string;
  therapistId?: string;
  clientId?: string;
  status?: string;
}

type ReportParams = {
  db: SupabaseClient;
  orgId: string;
  reportType: string;
  dateRange: { startDate: string; endDate: string };
  therapistId?: string;
  clientId?: string;
  status?: string;
  therapistScope: string[];
  callerRole: Role;
  userContext: UserContext;
  logger: Logger;
};

const ALLOWED_REPORT_TYPES = new Set(["sessions", "clients", "therapists", "billing"]);

export default createProtectedRoute(async (req: Request, userContext) => {
  if (req.method !== "POST") {
    return jsonErrorResponse(405, "Method not allowed");
  }

  const baseLogger = getLogger(req, {
    functionName: "generate-report",
    userId: userContext.user.id,
  });
  let scopedLogger: Logger | null = null;

  try {
    const db = createRequestClient(req);
    const callerRole = userContext.profile.role;

    if (callerRole === "client") {
      logApiAccess("POST", "/generate-report", userContext, 403);
      baseLogger.warn("authorization.denied", { reason: "client-role" });
      increment("tenant_denial_total", { function: "generate-report", reason: "client-role" });
      return jsonErrorResponse(403, "Clients are not permitted to generate reports");
    }

    const orgId = await requireOrg(db);
    scopedLogger = baseLogger.with({ orgId });
    scopedLogger.info("request.received", { method: "POST" });

    const membershipOk = await ensureCallerOrgMembership(db, orgId, callerRole);
    if (!membershipOk) {
      logApiAccess("POST", "/generate-report", userContext, 403);
      scopedLogger.warn("authorization.denied", { reason: "insufficient_role" });
      increment("tenant_denial_total", {
        function: "generate-report",
        orgId,
        reason: "role-denied",
      });
      return jsonErrorResponse(403, "Forbidden");
    }

    const parsed = parseReportRequest(await req.json());
    if (!parsed.ok) {
      return jsonErrorResponse(400, parsed.error);
    }

    const { reportType, startDate, endDate, therapistId, clientId, status } = parsed.value;
    const therapistScope = await resolveTherapistScope(db, userContext, orgId);

    await ensureRequestedIdsWithinOrg(
      db,
      orgId,
      { therapistId, clientId },
      scopedLogger,
      callerRole as Role,
    );

    scopedLogger.info("report.requested", {
      reportType,
      startDate,
      endDate,
      therapistId: therapistId ?? undefined,
      clientId: clientId ?? undefined,
    });

    const reportData = await generateReportForType({
      db,
      orgId,
      reportType,
      dateRange: { startDate, endDate },
      therapistId,
      clientId,
      status,
      therapistScope,
      callerRole: callerRole as Role,
      userContext,
      logger: scopedLogger,
    });

    increment("org_scoped_query_total", {
      function: "generate-report",
      reportType,
      orgId,
    });
    increment("report_success_total", {
      function: "generate-report",
      reportType,
      orgId,
    });
    scopedLogger.info("report.generated", { reportType });
    logApiAccess("POST", "/generate-report", userContext, 200);
    return new Response(
      JSON.stringify({
        success: true,
        reportType,
        data: reportData,
        generatedAt: new Date().toISOString(),
        filters: { startDate, endDate, therapistId, clientId, status },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    const errorLogger = scopedLogger ?? baseLogger;
    if (error instanceof MissingOrgContextError) {
      logApiAccess("POST", "/generate-report", userContext, 403);
      errorLogger.warn("request.denied", { reason: "missing-org-context" });
      increment("tenant_denial_total", {
        function: "generate-report",
        reason: "missing-org",
      });
      return jsonErrorResponse(403, error.message);
    }

    if (error instanceof ForbiddenError) {
      logApiAccess("POST", "/generate-report", userContext, 403);
      errorLogger.warn("request.denied", { reason: "forbidden-error" });
      increment("tenant_denial_total", {
        function: "generate-report",
        reason: "forbidden-error",
      });
      return jsonErrorResponse(403, error.message);
    }

    errorLogger.error("request.failed", { error: (error as Error).message ?? "unknown" });
    logApiAccess("POST", "/generate-report", userContext, 500);
    return new Response(
      JSON.stringify({
        success: false,
        error: "Failed to generate report",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
}, RouteOptions.therapist);

function jsonErrorResponse(status: number, message: string): Response {
  return new Response(
    JSON.stringify({ error: message }),
    {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}

async function ensureCallerOrgMembership(
  db: SupabaseClient,
  orgId: string,
  role: string,
): Promise<boolean> {
  const candidates: Role[] = [];
  if (role === "super_admin") {
    candidates.push("super_admin", "admin");
  } else if (role === "admin") {
    candidates.push("admin", "super_admin");
  } else if (role === "therapist") {
    candidates.push("therapist");
  }

  if (candidates.length === 0) {
    return false;
  }

  for (const candidate of candidates) {
    const allowed = await assertUserHasOrgRole(db, orgId, candidate);
    if (allowed) {
      return true;
    }
  }

  return false;
}

function parseReportRequest(input: unknown):
  | { ok: true; value: ReportRequest }
  | { ok: false; error: string } {
  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "Invalid request payload" };
  }

  const value = input as Partial<Record<keyof ReportRequest, unknown>>;
  const { reportType, startDate, endDate, therapistId, clientId, status } = value;

  if (typeof reportType !== "string" || !ALLOWED_REPORT_TYPES.has(reportType)) {
    return { ok: false, error: "Unsupported report type" };
  }
  if (typeof startDate !== "string" || startDate.length === 0) {
    return { ok: false, error: "startDate is required" };
  }
  if (typeof endDate !== "string" || endDate.length === 0) {
    return { ok: false, error: "endDate is required" };
  }

  return {
    ok: true,
    value: {
      reportType,
      startDate,
      endDate,
      therapistId: typeof therapistId === "string" ? therapistId : undefined,
      clientId: typeof clientId === "string" ? clientId : undefined,
      status: typeof status === "string" ? status : undefined,
    },
  };
}

async function ensureRequestedIdsWithinOrg(
  db: SupabaseClient,
  orgId: string,
  options: { therapistId?: string; clientId?: string },
  logger: Logger,
  callerRole: Role,
): Promise<void> {
  if (options.therapistId) {
    const { data } = await orgScopedQuery(db, "therapists", orgId)
      .select("id")
      .eq("id", options.therapistId)
      .maybeSingle();
    if (!data) {
      logger.warn("scope.denied", { target: "therapist", targetId: options.therapistId });
      increment("tenant_denial_total", {
        function: "generate-report",
        orgId,
        reason: "therapist-out-of-scope",
      });
      throw new ForbiddenError("Therapist scope denied");
    }

    if (callerRole === "therapist") {
      const allowed = await assertUserHasOrgRole(db, orgId, "therapist", {
        targetTherapistId: options.therapistId,
      });
      if (!allowed) {
        logger.warn("scope.denied", { target: "therapist", targetId: options.therapistId, reason: "role" });
        increment("tenant_denial_total", {
          function: "generate-report",
          orgId,
          reason: "therapist-out-of-scope",
        });
        throw new ForbiddenError("Therapist scope denied");
      }
    }
  }

  if (options.clientId) {
    const { data } = await orgScopedQuery(db, "clients", orgId)
      .select("id")
      .eq("id", options.clientId)
      .maybeSingle();
    if (!data) {
      logger.warn("scope.denied", { target: "client", targetId: options.clientId });
      increment("tenant_denial_total", {
        function: "generate-report",
        orgId,
        reason: "client-out-of-scope",
      });
      throw new ForbiddenError("Client scope denied");
    }
  }
}

async function generateReportForType(params: ReportParams) {
  const {
    db,
    orgId,
    reportType,
    dateRange,
    therapistId,
    clientId,
    status,
    therapistScope,
    callerRole,
    userContext,
    logger,
  } = params;

  logger.info("report.generate.start", { reportType });

  let result: unknown;

  switch (reportType) {
    case "sessions":
      result = await generateSessionsReport(
        db,
        orgId,
        dateRange,
        therapistId,
        clientId,
        status,
        therapistScope,
        callerRole,
      );
      break;
    case "clients":
      result = await generateClientsReport(db, orgId, dateRange, therapistScope, callerRole);
      break;
    case "therapists":
      result = await generateTherapistsReport(db, orgId, dateRange);
      break;
    case "billing":
      result = await generateBillingReport(
        db,
        orgId,
        dateRange,
        therapistId,
        clientId,
        therapistScope,
        callerRole,
      );
      break;
    default:
      throw new ForbiddenError(`Unsupported report type: ${reportType}`);
  }

  logger.info("report.generate.complete", { reportType });
  return result;
}

async function generateSessionsReport(
  db: SupabaseClient,
  orgId: string,
  dateRange: { startDate: string; endDate: string },
  therapistId: string | undefined,
  clientId: string | undefined,
  status: string | undefined,
  therapistScope: string[],
  callerRole: Role,
) {
  const startIso = `${dateRange.startDate}T00:00:00`;
  const endIso = `${dateRange.endDate}T23:59:59`;

  let query = orgScopedQuery(db, "sessions", orgId)
    .select(
      `
        *,
        therapists (
          id,
          full_name
        ),
        clients (
          id,
          full_name
        )
      `,
    )
    .gte("start_time", startIso)
    .lte("start_time", endIso);

  if (callerRole === "therapist" && therapistScope.length > 0) {
    query = query.in("therapist_id", therapistScope);
  }

  if (therapistId) {
    query = query.eq("therapist_id", therapistId);
  }

  if (clientId) {
    query = query.eq("client_id", clientId);
  }

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Error fetching sessions: ${error.message}`);
  }

  increment("org_scoped_query_total", {
    function: "generate-report",
    orgId,
    reportType: "sessions",
  });

  const sessions = data ?? [];
  return {
    sessions,
    summary: {
      totalSessions: sessions.length,
      completedSessions: sessions.filter(session => session.status === "completed").length,
      cancelledSessions: sessions.filter(session => session.status === "cancelled").length,
      scheduledSessions: sessions.filter(session => session.status === "scheduled").length,
    },
  };
}

async function generateClientsReport(
  db: SupabaseClient,
  orgId: string,
  dateRange: { startDate: string; endDate: string },
  therapistScope: string[],
  callerRole: Role,
) {
  const startIso = `${dateRange.startDate}T00:00:00`;
  const endIso = `${dateRange.endDate}T23:59:59`;

  if (callerRole === "therapist" && therapistScope.length === 0) {
    return { clients: [], summary: { totalClients: 0, activeClients: 0, newClients: 0 } };
  }

  let query = orgScopedQuery(db, "clients", orgId)
    .select("*")
    .gte("created_at", startIso)
    .lte("created_at", endIso);

  if (callerRole === "therapist" && therapistScope.length > 0) {
    query = query.select(
      `
        *,
        therapist_sessions:sessions!inner (
          therapist_id
        )
      `,
    )
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .in("therapist_sessions.therapist_id", therapistScope);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Error fetching clients: ${error.message}`);
  }

  increment("org_scoped_query_total", {
    function: "generate-report",
    orgId,
    reportType: "clients",
  });

  const clients = callerRole === "therapist"
    ? Array.from(
      (data ?? []).reduce((acc, client) => {
        if (!client) return acc;
        const { therapist_sessions: _sessions, ...clientRecord } = client as Record<string, unknown>;
        const id = clientRecord.id as string | undefined;
        if (id && !acc.has(id)) {
          acc.set(id, clientRecord);
        }
        return acc;
      }, new Map<string, Record<string, unknown>>()).values(),
    )
    : data ?? [];

  return {
    clients,
    summary: {
      totalClients: clients.length,
      activeClients: clients.filter(client => (client as Record<string, unknown>).is_active === true).length,
      newClients: clients.length,
    },
  };
}

async function generateTherapistsReport(
  db: SupabaseClient,
  orgId: string,
  dateRange: { startDate: string; endDate: string },
) {
  const startIso = `${dateRange.startDate}T00:00:00`;
  const endIso = `${dateRange.endDate}T23:59:59`;

  const { data, error } = await orgScopedQuery(db, "therapists", orgId)
    .select("*")
    .gte("created_at", startIso)
    .lte("created_at", endIso);

  if (error) {
    throw new Error(`Error fetching therapists: ${error.message}`);
  }

  increment("org_scoped_query_total", {
    function: "generate-report",
    orgId,
    reportType: "therapists",
  });

  const therapists = data ?? [];
  return {
    therapists,
    summary: {
      totalTherapists: therapists.length,
      activeTherapists: therapists.filter(item => item?.is_active === true).length,
    },
  };
}

async function generateBillingReport(
  db: SupabaseClient,
  orgId: string,
  dateRange: { startDate: string; endDate: string },
  therapistId: string | undefined,
  clientId: string | undefined,
  therapistScope: string[],
  callerRole: Role,
) {
  const startIso = `${dateRange.startDate}T00:00:00`;
  const endIso = `${dateRange.endDate}T23:59:59`;

  let query = orgScopedQuery(db, "sessions", orgId)
    .select(
      `
        *,
        therapists (
          id,
          full_name,
          hourly_rate
        ),
        clients (
          id,
          full_name
        )
      `,
    )
    .eq("status", "completed")
    .gte("start_time", startIso)
    .lte("start_time", endIso);

  if (callerRole === "therapist" && therapistScope.length > 0) {
    query = query.in("therapist_id", therapistScope);
  }

  if (therapistId) {
    query = query.eq("therapist_id", therapistId);
  }

  if (clientId) {
    query = query.eq("client_id", clientId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Error fetching billing data: ${error.message}`);
  }

  increment("org_scoped_query_total", {
    function: "generate-report",
    orgId,
    reportType: "billing",
  });

  const sessions = data ?? [];
  const totalRevenue = sessions.reduce((sum, session) => {
    const therapist = (session as Record<string, unknown>).therapists as { hourly_rate?: number } | undefined;
    return sum + (therapist?.hourly_rate ?? 0);
  }, 0);

  return {
    sessions,
    summary: {
      totalSessions: sessions.length,
      totalRevenue,
      averageSessionValue: sessions.length > 0 ? totalRevenue / sessions.length : 0,
    },
  };
}

async function resolveTherapistScope(
  db: SupabaseClient,
  userContext: UserContext,
  orgId: string,
): Promise<string[]> {
  if (userContext.profile.role !== "therapist") {
    return [];
  }

  const scope = new Set<string>();
  if (userContext.user.id) {
    scope.add(userContext.user.id);
  }
  if (userContext.profile.id) {
    scope.add(userContext.profile.id);
  }

  const { data: therapistRecord } = await orgScopedQuery(db, "therapists", orgId)
    .select("id")
    .eq("id", userContext.user.id)
    .maybeSingle();
  if (therapistRecord?.id) {
    scope.add(therapistRecord.id);
  }

  const { data, error } = await db
    .from("user_therapist_links")
    .select("therapist_id")
    .eq("user_id", userContext.user.id);

  if (error) {
    console.warn("Error resolving therapist scope from user_therapist_links:", error);
  } else if (data) {
    for (const link of data) {
      if (link?.therapist_id) {
        scope.add(link.therapist_id);
      }
    }
  }

  return Array.from(scope);
}

export const __TESTING__ = {
  generateReportForType,
  generateSessionsReport,
  generateClientsReport,
  generateTherapistsReport,
  generateBillingReport,
  resolveTherapistScope,
};
