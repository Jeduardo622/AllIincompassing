import { errorEnvelope, getRequestId, rateLimit } from '../lib/http/error.ts'
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";
import { createRequestClient, supabaseAdmin } from "../_shared/database.ts";
import { createProtectedRoute, RouteOptions, type UserContext } from "../_shared/auth-middleware.ts";
import { MissingOrgContextError, resolveOrgId } from "../_shared/org.ts";
import { resolveAllowedOrigin } from "../_shared/cors.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': resolveAllowedOrigin(),
  // `supabase.functions.invoke()` sends POST plus auth/client headers.
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, X-Client-Info, apikey, content-type, x-request-id',
}

const DASHBOARD_ROUTE_TIMEOUT_MS = 6_500;
const DASHBOARD_ORG_TIMEOUT_MS = 2_500;
const DASHBOARD_RPC_TIMEOUT_MS = 4_500;

type TodaySession = {
  id: string
  status: string
  start_time: string
  end_time: string | null
}

const aggregateTodaysSessions = (
  sessions: TodaySession[] | null | undefined,
  totalCount?: number | null,
): { total: number; completed: number; pending: number; cancelled: number } => {
  const list = Array.isArray(sessions) ? sessions : []
  const total = typeof totalCount === 'number' ? totalCount : list.length

  return {
    total,
    completed: list.filter(session => session.status === 'completed').length,
    pending: list.filter(session => session.status === 'scheduled').length,
    cancelled: list.filter(session => session.status === 'cancelled').length,
  }
}

interface HandlerOptions {
  req: Request;
  db?: SupabaseClient;
  adminDb?: SupabaseClient;
  userContext?: UserContext;
}

const parseDefaultOrganizationId = (): string | null => {
  const raw = Deno.env.get('DEFAULT_ORGANIZATION_ID');
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

class DashboardStepTimeoutError extends Error {
  constructor(
    public readonly step: string,
    public readonly timeoutMs: number,
  ) {
    super(`Dashboard step timed out: ${step}`);
    this.name = "DashboardStepTimeoutError";
  }
}

const elapsedMsSince = (startedAt: number): number => Date.now() - startedAt;

const logDashboardStep = (
  level: "info" | "warn" | "error",
  message: string,
  fields: Record<string, unknown>,
) => {
  console[level](message, fields);
};

const withDashboardStepTimeout = async <T>(
  operation: Promise<T>,
  step: string,
  timeoutMs: number,
): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new DashboardStepTimeoutError(step, timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const pickOrganizationId = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const getOrganizationIdFromMetadata = (metadata: unknown): string | null => {
  const record = asRecord(metadata);
  if (!record) {
    return null;
  }
  return pickOrganizationId(record.organization_id) ?? pickOrganizationId(record.organizationId);
};

const getOrganizationIdFromPreferences = (preferences: unknown): string | null => {
  const record = asRecord(preferences);
  if (!record) {
    return null;
  }
  return pickOrganizationId(record.organization_id) ?? pickOrganizationId(record.organizationId);
};

const resolveDashboardOrganizationId = async (db: SupabaseClient): Promise<string> => {
  const resolvedOrg = await resolveOrgId(db);
  if (resolvedOrg) {
    return resolvedOrg;
  }

  const { data: isSuperAdmin } = await db.rpc('current_user_is_super_admin');
  if (isSuperAdmin === true) {
    const { data: authData, error: authError } = await db.auth.getUser();
    if (!authError && authData?.user) {
      const metadataOrg = getOrganizationIdFromMetadata(authData.user.user_metadata);
      if (metadataOrg) {
        return metadataOrg;
      }

      const { data: profileRow, error: profileError } = await db
        .from("profiles")
        .select("organization_id, preferences")
        .eq("id", authData.user.id)
        .maybeSingle();

      if (!profileError && profileRow) {
        const profileOrg = pickOrganizationId((profileRow as { organization_id?: unknown }).organization_id);
        if (profileOrg) {
          return profileOrg;
        }
        const preferenceOrg = getOrganizationIdFromPreferences((profileRow as { preferences?: unknown }).preferences);
        if (preferenceOrg) {
          return preferenceOrg;
        }
      }
    }

    const fallbackOrg = parseDefaultOrganizationId();
    if (fallbackOrg) {
      return fallbackOrg;
    }
  }

  throw new MissingOrgContextError();
}

const resolveDashboardActorId = async (
  db: SupabaseClient,
  userContext?: UserContext,
): Promise<string> => {
  const contextUserId = typeof userContext?.user?.id === "string" ? userContext.user.id.trim() : "";
  if (contextUserId.length > 0) {
    return contextUserId;
  }

  const { data: authData, error: authError } = await db.auth.getUser();
  const userId = typeof authData?.user?.id === "string" ? authData.user.id.trim() : "";
  if (authError || userId.length === 0) {
    throw new MissingOrgContextError("Authenticated dashboard actor required");
  }
  return userId;
};

export async function handleGetDashboardData({
  req,
  db: providedDb,
  adminDb: providedAdminDb,
  userContext,
}: HandlerOptions) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const requestId = getRequestId(req)
  const startedAt = Date.now()

  try {
    logDashboardStep("info", "get-dashboard-data request started", {
      requestId,
      method: req.method,
    });

    const db = providedDb ?? createRequestClient(req);
    const orgStartedAt = Date.now();
    const orgId = await withDashboardStepTimeout(
      resolveDashboardOrganizationId(db),
      "org_resolution",
      DASHBOARD_ORG_TIMEOUT_MS,
    );
    logDashboardStep("info", "get-dashboard-data step completed", {
      requestId,
      step: "org_resolution",
      elapsedMs: elapsedMsSince(orgStartedAt),
    });

    const ip = req.headers.get('x-forwarded-for') || 'unknown'
    const rl = rateLimit(`dashboard:${ip}`, 60, 60_000)
    if (!rl.allowed) {
      return errorEnvelope({
        requestId,
        code: 'rate_limited',
        message: 'Too many requests',
        status: 429,
        headers: { ...corsHeaders, 'Retry-After': String(rl.retryAfter ?? 60) },
      })
    }

    const actorStartedAt = Date.now();
    const actorUserId = await withDashboardStepTimeout(
      resolveDashboardActorId(db, userContext),
      "actor_resolution",
      DASHBOARD_ORG_TIMEOUT_MS,
    );
    logDashboardStep("info", "get-dashboard-data step completed", {
      requestId,
      step: "actor_resolution",
      elapsedMs: elapsedMsSince(actorStartedAt),
    });

    const dashboardDb = providedAdminDb ?? supabaseAdmin;
    const rpcStartedAt = Date.now();
    const { data: rpcData, error: rpcError } = await withDashboardStepTimeout(
      dashboardDb.rpc('get_dashboard_data_for_org', {
        actor_user_id: actorUserId,
        target_organization_id: orgId,
      }),
      "dashboard_rpc",
      DASHBOARD_RPC_TIMEOUT_MS,
    );
    logDashboardStep("info", "get-dashboard-data step completed", {
      requestId,
      step: "dashboard_rpc",
      elapsedMs: elapsedMsSince(rpcStartedAt),
      hasError: Boolean(rpcError),
    });
    if (rpcError) {
      const code = typeof rpcError.code === 'string' ? rpcError.code : '';
      const status = code === '42501' ? 403 : 500;
      logDashboardStep("warn", "get-dashboard-data rpc failed", {
        requestId,
        step: "dashboard_rpc",
        status,
        elapsedMs: elapsedMsSince(rpcStartedAt),
        rpcCode: code || "unknown",
      });
      return errorEnvelope({
        requestId,
        code: status === 403 ? 'forbidden' : 'upstream_error',
        message: status === 403 ? 'Dashboard access denied' : 'Dashboard RPC failed',
        status,
        headers: corsHeaders,
      });
    }

    const dashboardData = (rpcData && typeof rpcData === 'object' ? rpcData : {}) as Record<string, unknown>;
    const todaySessions = Array.isArray(dashboardData.todaySessions)
      ? (dashboardData.todaySessions as TodaySession[])
      : [];

    if (!dashboardData.todaysSessions) {
      dashboardData.todaysSessions = aggregateTodaysSessions(todaySessions);
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: dashboardData,
        lastUpdated: new Date().toISOString(),
        requestId,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (error) {
    if (error instanceof DashboardStepTimeoutError) {
      // The timed operation may eventually reject with an authz error, but after this deadline
      // the only safe observable state is "no dashboard data returned in time".
      logDashboardStep("warn", "get-dashboard-data step timed out", {
        requestId,
        step: error.step,
        timeoutMs: error.timeoutMs,
        elapsedMs: elapsedMsSince(startedAt),
      });
      return errorEnvelope({
        requestId,
        code: 'upstream_timeout',
        message: 'Dashboard data request timed out',
        status: 504,
        headers: corsHeaders,
      })
    }
    if (error instanceof MissingOrgContextError) {
      return errorEnvelope({ requestId, code: 'missing_org', message: error.message, status: 403, headers: corsHeaders })
    }
    logDashboardStep("error", "Dashboard data error", {
      requestId,
      elapsedMs: elapsedMsSince(startedAt),
      errorName: error instanceof Error ? error.name : typeof error,
    })
    return errorEnvelope({ requestId, code: 'internal_error', message: 'Unexpected error', status: 500, headers: corsHeaders })
  }
}

export const __TESTING__ = {
  aggregateTodaysSessions,
  resolveDashboardOrganizationId,
  withDashboardStepTimeout,
  resolveDashboardActorId,
}

const dashboardRoute = createProtectedRoute(
  (req: Request, userContext: UserContext) => handleGetDashboardData({ req, userContext }),
  RouteOptions.admin,
)

const servedDashboardRoute = async (req: Request): Promise<Response> => {
  const requestId = getRequestId(req)
  const startedAt = Date.now()
  try {
    logDashboardStep("info", "get-dashboard-data edge route received", {
      requestId,
      method: req.method,
      timeoutMs: DASHBOARD_ROUTE_TIMEOUT_MS,
    })
    const response = await withDashboardStepTimeout(
      dashboardRoute(req),
      "edge_route",
      DASHBOARD_ROUTE_TIMEOUT_MS,
    )
    logDashboardStep("info", "get-dashboard-data edge route completed", {
      requestId,
      status: response.status,
      elapsedMs: elapsedMsSince(startedAt),
    })
    return response
  } catch (error) {
    if (error instanceof DashboardStepTimeoutError) {
      // Fail closed before the /api/dashboard proxy timeout; never infer success or tenant scope
      // from a route that did not complete.
      logDashboardStep("warn", "get-dashboard-data edge route timed out", {
        requestId,
        step: error.step,
        timeoutMs: error.timeoutMs,
        elapsedMs: elapsedMsSince(startedAt),
      })
      return errorEnvelope({
        requestId,
        code: 'upstream_timeout',
        message: 'Dashboard data request timed out',
        status: 504,
        headers: corsHeaders,
      })
    }
    throw error
  }
}

if (typeof Deno !== "undefined" && typeof Deno.serve === "function") {
  Deno.serve(servedDashboardRoute)
}

export default servedDashboardRoute
