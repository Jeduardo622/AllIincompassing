import { z } from 'npm:zod@3.23.8'
import { errorEnvelope, getRequestId, rateLimit, IsoDateSchema } from '../lib/http/error.ts'
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";
import { createRequestClient } from "../_shared/database.ts";
import { createProtectedRoute, RouteOptions } from "../_shared/auth-middleware.ts";
import { MissingOrgContextError, orgScopedQuery, resolveOrgId } from "../_shared/org.ts";
import { resolveAllowedOrigin } from "../_shared/cors.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': resolveAllowedOrigin(),
  // `supabase.functions.invoke()` sends POST plus auth/client headers.
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, X-Client-Info, apikey, content-type, x-request-id',
}

interface DashboardData {
  todaySessions: Array<{
    id: string;
    status: string;
    start_time: string;
    end_time: string | null;
    therapist: { id: string; full_name: string | null } | null;
    client: { id: string; full_name: string | null } | null;
  }>;
  incompleteSessions: Array<{
    id: string;
    status: string;
    start_time: string;
    end_time: string | null;
    therapist: { id: string; full_name: string | null } | null;
    client: { id: string; full_name: string | null } | null;
  }>;
  billingAlerts: Array<{ id: string; amount: number | string | null; status: string | null; created_at: string | null }>;
  clientMetrics: { total: number; active: number; totalUnits: number };
  therapistMetrics: { total: number; active: number; totalHours: number };
  todaysSessions: { total: number; completed: number; pending: number; cancelled: number; };
  thisWeekStats: { totalSessions: number; totalClients: number; totalTherapists: number; utilizationRate: number; };
  upcomingAlerts: { expiring_authorizations: number; low_session_counts: number; pending_approvals: number; };
  recentActivity: Array<{ id: string; type: string; description: string; timestamp: string; status: string; }>;
  quickStats: { activeClients: number; activeTherapists: number; thisMonthRevenue: number; attendanceRate: number; };
}

type TodaySession = {
  id: string
  status: string
  start_time: string
  end_time: string | null
}

type LegacySessionRow = {
  id: string;
  status: string;
  start_time: string;
  end_time: string | null;
  therapist?: { id: string; full_name: string | null } | null;
  client?: { id: string; full_name: string | null } | null;
}

type BillingAlertRow = {
  id: string;
  amount: number | string | null;
  status: string | null;
  created_at: string | null;
}

type ClientUnitsRow = {
  one_to_one_units?: number | null;
  supervision_units?: number | null;
  parent_consult_units?: number | null;
}

type TherapistHoursRow = {
  weekly_hours_max?: number | null;
}

const aggregateTodaysSessions = (
  sessions: TodaySession[] | null | undefined,
  totalCount?: number | null,
): DashboardData['todaysSessions'] => {
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

const resolveDashboardOrganizationId = async (db: SupabaseClient): Promise<string> => {
  const resolvedOrg = await resolveOrgId(db);
  if (resolvedOrg) {
    return resolvedOrg;
  }

  const { data: isSuperAdmin } = await db.rpc('current_user_is_super_admin');
  if (isSuperAdmin === true) {
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
    const orgId = await resolveDashboardOrganizationId(db);

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

    const url = new URL(req.url)
    const ParamsSchema = z.object({ start_date: IsoDateSchema.optional(), end_date: IsoDateSchema.optional() })
    const parsed = ParamsSchema.safeParse({
      start_date: url.searchParams.get('p_start_date') || url.searchParams.get('start_date') || undefined,
      end_date: url.searchParams.get('p_end_date') || url.searchParams.get('end_date') || undefined,
    })
    if (!parsed.success) {
      return errorEnvelope({
        requestId,
        code: 'invalid_params',
        message: 'Invalid query parameters',
        status: 400,
        headers: corsHeaders,
      })
    }

    const { start_date: startDate, end_date: endDate } = parsed.data

    const today = new Date().toISOString().split('T')[0];
    const weekStart = startDate ? new Date(startDate) : new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
    const weekStartStr = weekStart.toISOString().split('T')[0];
    const monthStart = startDate ? new Date(startDate) : new Date();
    monthStart.setDate(1);
    const monthStartStr = monthStart.toISOString().split('T')[0];

    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    const [
      { data: todaySessions, error: todayError },
      { data: todaySessionsLegacy, error: todayLegacyError },
      { data: pendingDocumentationSessionsLegacy, error: pendingDocumentationLegacyError },
      { data: billingAlertsLegacy, error: billingAlertsLegacyError },
      { data: weekSessions, error: weekError },
      { count: totalClientsCount, error: totalClientsCountError },
      { count: activeClientsCount, error: clientError },
      { data: clientUnitsRows, error: clientUnitsError },
      { count: totalTherapistsCount, error: totalTherapistsCountError },
      { count: activeTherapistsCount, error: therapistError },
      { data: therapistHoursRows, error: therapistHoursError },
      { count: expiringAuthsCount, error: authError },
      { data: recentSessions, error: recentError },
      { data: monthlyBilling, error: billingError },
    ] = await Promise.all([
      orgScopedQuery(db, 'sessions', orgId)
        .select('id, status, start_time, end_time', { count: 'exact' })
        .gte('start_time', `${today}T00:00:00`)
        .lte('start_time', `${today}T23:59:59`)
        .returns<TodaySession[]>(),
      orgScopedQuery(db, 'sessions', orgId)
        .select('id, status, start_time, end_time, therapist:therapists(id, full_name), client:clients(id, full_name)')
        .gte('start_time', `${today}T00:00:00`)
        .lte('start_time', `${today}T23:59:59`)
        .returns<LegacySessionRow[]>(),
      orgScopedQuery(db, 'sessions', orgId)
        .select('id, status, start_time, end_time, therapist:therapists(id, full_name), client:clients(id, full_name)')
        // "incompleteSessions" means completed sessions still missing required notes.
        .eq('status', 'completed')
        .or('notes.is.null,notes.eq.\"\"')
        .order('start_time', { ascending: false })
        .limit(50)
        .returns<LegacySessionRow[]>(),
      orgScopedQuery(db, 'billing_records', orgId)
        .select('id, amount, status, created_at')
        .in('status', ['pending', 'rejected'])
        .order('created_at', { ascending: false })
        .limit(50)
        .returns<BillingAlertRow[]>(),
      orgScopedQuery(db, 'sessions', orgId)
        .select('id, status, client_id, therapist_id')
        .gte('start_time', `${weekStartStr}T00:00:00`)
        .lte('start_time', `${(endDate ?? today)}T23:59:59`),
      orgScopedQuery(db, 'clients', orgId)
        .select('id', { count: 'planned', head: true })
        .is('deleted_at', null),
      orgScopedQuery(db, 'clients', orgId)
        .select('id', { count: 'planned', head: true })
        .is('deleted_at', null)
        .eq('status', 'active'),
      orgScopedQuery(db, 'clients', orgId)
        .select('one_to_one_units, supervision_units, parent_consult_units')
        .is('deleted_at', null)
        .returns<ClientUnitsRow[]>(),
      orgScopedQuery(db, 'therapists', orgId)
        .select('id', { count: 'planned', head: true })
        .is('deleted_at', null),
      orgScopedQuery(db, 'therapists', orgId)
        .select('id', { count: 'planned', head: true })
        .is('deleted_at', null)
        .eq('status', 'active'),
      orgScopedQuery(db, 'therapists', orgId)
        .select('weekly_hours_max')
        .is('deleted_at', null)
        .returns<TherapistHoursRow[]>(),
      orgScopedQuery(db, 'authorizations', orgId)
        .select('id', { count: 'planned', head: true })
        .eq('status', 'approved')
        .lte('end_date', thirtyDaysFromNow.toISOString().split('T')[0]),
      orgScopedQuery(db, 'sessions', orgId)
        .select(
          'id, status, start_time, created_at, created_by, updated_at, updated_by, client:clients(full_name), therapist:therapists(full_name)'
        )
        .order('created_at', { ascending: false })
        .limit(10),
      orgScopedQuery(db, 'billing_records', orgId)
        .select('amount_paid')
        .gte('created_at', `${monthStartStr}T00:00:00`),
    ]);

    if (todayError) throw todayError;
    if (todayLegacyError) throw todayLegacyError;
    if (pendingDocumentationLegacyError) throw pendingDocumentationLegacyError;
    if (billingAlertsLegacyError) throw billingAlertsLegacyError;
    if (weekError) throw weekError;
    if (totalClientsCountError) throw totalClientsCountError;
    if (clientError) throw clientError;
    if (clientUnitsError) throw clientUnitsError;
    if (totalTherapistsCountError) throw totalTherapistsCountError;
    if (therapistError) throw therapistError;
    if (therapistHoursError) throw therapistHoursError;
    if (authError) throw authError;
    if (recentError) throw recentError;
    if (billingError) throw billingError;

    const todaysSessionsData = aggregateTodaysSessions(todaySessions)

    const uniqueClients = new Set(weekSessions?.map(s => s.client_id)).size;
    const uniqueTherapists = new Set(weekSessions?.map(s => s.therapist_id)).size;
    const completedWeekSessions = weekSessions?.filter(s => s.status === 'completed').length || 0;
    const totalWeekSessions = weekSessions?.length || 0;
    const utilizationRate = totalWeekSessions > 0 ? (completedWeekSessions / totalWeekSessions) * 100 : 0;

    const thisMonthRevenue = monthlyBilling?.reduce((sum, record) => sum + (record.amount_paid || 0), 0) || 0;
    const totalUnits = (clientUnitsRows ?? []).reduce(
      (sum, row) =>
        sum +
        (row.one_to_one_units || 0) +
        (row.supervision_units || 0) +
        (row.parent_consult_units || 0),
      0,
    );
    const therapistHours = (therapistHoursRows ?? []).reduce(
      (sum, row) => sum + (row.weekly_hours_max || 0),
      0,
    );

    const allCompletedSessions = weekSessions?.filter(s => s.status === 'completed').length || 0;
    const allScheduledSessions = weekSessions?.filter(s => ['completed', 'no_show'].includes(s.status)).length || 0;
    const attendanceRate = allScheduledSessions > 0 ? (allCompletedSessions / allScheduledSessions) * 100 : 0;

    const recentActivity = recentSessions?.map(session => ({
      id: session.id,
      type: 'session',
      description: `${session.status === 'completed' ? 'Completed' : 'Scheduled'} session: ${session.client?.full_name} with ${session.therapist?.full_name}`,
      timestamp: session.created_at,
      status: session.status,
      createdBy: session.created_by,
      updatedAt: session.updated_at,
      updatedBy: session.updated_by
    })) || [];

    const dashboardData: DashboardData = {
      todaySessions: (todaySessionsLegacy ?? []).map((session) => ({
        id: session.id,
        status: session.status,
        start_time: session.start_time,
        end_time: session.end_time,
        therapist: session.therapist ?? null,
        client: session.client ?? null,
      })),
      incompleteSessions: (pendingDocumentationSessionsLegacy ?? []).map((session) => ({
        id: session.id,
        status: session.status,
        start_time: session.start_time,
        end_time: session.end_time,
        therapist: session.therapist ?? null,
        client: session.client ?? null,
      })),
      billingAlerts: (billingAlertsLegacy ?? []).map((record) => ({
        id: record.id,
        amount: record.amount,
        status: record.status,
        created_at: record.created_at,
      })),
      clientMetrics: {
        total: totalClientsCount || 0,
        active: activeClientsCount || 0,
        totalUnits,
      },
      therapistMetrics: {
        total: totalTherapistsCount || 0,
        active: activeTherapistsCount || 0,
        totalHours: therapistHours,
      },
      todaysSessions: todaysSessionsData,
      thisWeekStats: { totalSessions: totalWeekSessions, totalClients: uniqueClients, totalTherapists: uniqueTherapists, utilizationRate: Math.round(utilizationRate * 100) / 100 },
      upcomingAlerts: { expiring_authorizations: expiringAuthsCount || 0, low_session_counts: 0, pending_approvals: 0 },
      recentActivity,
      quickStats: { activeClients: activeClientsCount || 0, activeTherapists: activeTherapistsCount || 0, thisMonthRevenue: Math.round(thisMonthRevenue * 100) / 100, attendanceRate: Math.round(attendanceRate * 100) / 100 }
    };

    return new Response(JSON.stringify({ success: true, data: dashboardData, parameters: { start_date: startDate ?? weekStartStr, end_date: endDate ?? today }, lastUpdated: new Date().toISOString(), requestId }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
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
