import { errorEnvelope, getRequestId, rateLimit } from '../lib/http/error.ts'
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";
import { createRequestClient } from "../_shared/database.ts";
import { createProtectedRoute, RouteOptions } from "../_shared/auth-middleware.ts";
import { MissingOrgContextError, resolveOrgId } from "../_shared/org.ts";
import { resolveAllowedOrigin } from "../_shared/cors.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': resolveAllowedOrigin(),
  // `supabase.functions.invoke()` sends POST plus auth/client headers.
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, X-Client-Info, apikey, content-type, x-request-id',
}

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
}

const parseDefaultOrganizationId = (): string | null => {
  const raw = Deno.env.get('DEFAULT_ORGANIZATION_ID');
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

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

export async function handleGetDashboardData({ req, db: providedDb }: HandlerOptions) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const requestId = getRequestId(req)

    const db = providedDb ?? createRequestClient(req);
    await resolveDashboardOrganizationId(db);

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

    const { data: rpcData, error: rpcError } = await db.rpc('get_dashboard_data');
    if (rpcError) {
      const code = typeof rpcError.code === 'string' ? rpcError.code : '';
      const status = code === '42501' ? 403 : 500;
      return errorEnvelope({
        requestId,
        code: status === 403 ? 'forbidden' : 'upstream_error',
        message: rpcError.message || 'Dashboard RPC failed',
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
    if (error instanceof MissingOrgContextError) {
      const requestId = getRequestId(new Request('http://local'))
      return errorEnvelope({ requestId, code: 'missing_org', message: error.message, status: 403, headers: corsHeaders })
    }
    const requestId = getRequestId(new Request('http://local'))
    console.error('Dashboard data error:', error)
    return errorEnvelope({ requestId, code: 'internal_error', message: 'Unexpected error', status: 500, headers: corsHeaders })
  }
}

export const __TESTING__ = {
  aggregateTodaysSessions,
  resolveDashboardOrganizationId,
}

export default createProtectedRoute((req: Request) => handleGetDashboardData({ req }), RouteOptions.admin)
