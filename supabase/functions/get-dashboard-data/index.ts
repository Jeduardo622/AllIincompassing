import { z } from 'zod'
import { errorEnvelope, getRequestId, rateLimit, IsoDateSchema } from '../lib/http/error.ts'
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";
import { createRequestClient } from "../_shared/database.ts";
import { createProtectedRoute, RouteOptions } from "../_shared/auth-middleware.ts";
import { MissingOrgContextError, orgScopedQuery, requireOrg } from "../_shared/org.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
}

interface DashboardData {
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

export async function handleGetDashboardData({ req, db: providedDb }: HandlerOptions) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const requestId = getRequestId(req)

    const db = providedDb ?? createRequestClient(req);
    const orgId = await requireOrg(db);

    const ip = req.headers.get('x-forwarded-for') || 'unknown'
    const rl = rateLimit(`dashboard:${ip}`, 60, 60_000)
    if (!rl.allowed) {
      return errorEnvelope({ requestId, code: 'rate_limited', message: 'Too many requests', status: 429, headers: { 'Retry-After': String(rl.retryAfter ?? 60) } })
    }

    const url = new URL(req.url)
    const ParamsSchema = z.object({ start_date: IsoDateSchema.optional(), end_date: IsoDateSchema.optional() })
    const parsed = ParamsSchema.safeParse({
      start_date: url.searchParams.get('p_start_date') || url.searchParams.get('start_date') || undefined,
      end_date: url.searchParams.get('p_end_date') || url.searchParams.get('end_date') || undefined,
    })
    if (!parsed.success) {
      return errorEnvelope({ requestId, code: 'invalid_params', message: 'Invalid query parameters', status: 400 })
    }

    const { start_date: startDate, end_date: endDate } = parsed.data

    const today = new Date().toISOString().split('T')[0];
    const weekStart = startDate ? new Date(startDate) : new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
    const weekStartStr = weekStart.toISOString().split('T')[0];
    const monthStart = startDate ? new Date(startDate) : new Date();
    monthStart.setDate(1);
    const monthStartStr = monthStart.toISOString().split('T')[0];

    const { data: todaySessions, error: todayError, count: todaySessionsCount } = await orgScopedQuery(db, 'sessions', orgId)
      .select('id, status, start_time, end_time', { count: 'exact' })
      .gte('start_time', `${today}T00:00:00`)
      .lte('start_time', `${today}T23:59:59`)
      .returns<TodaySession[]>()
    if (todayError) throw todayError;

    const { data: weekSessions, error: weekError } = await orgScopedQuery(db, 'sessions', orgId)
      .select('id, status, client_id, therapist_id')
      .gte('start_time', `${weekStartStr}T00:00:00`).lte('start_time', `${(endDate ?? today)}T23:59:59`)
      .then(res => res);
    if (weekError) throw weekError;

    const { count: activeClientsCount, error: clientError } = await orgScopedQuery(db, 'clients', orgId)
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null)
      .eq('status', 'active');
    if (clientError) throw clientError;

    const { count: activeTherapistsCount, error: therapistError } = await orgScopedQuery(db, 'therapists', orgId)
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null)
      .eq('status', 'active');
    if (therapistError) throw therapistError;

    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    const { count: expiringAuthsCount, error: authError } = await orgScopedQuery(db, 'authorizations', orgId)
      .select('id', { count: 'exact', head: true })
      .eq('status', 'approved')
      .lte('end_date', thirtyDaysFromNow.toISOString().split('T')[0]);
    if (authError) throw authError;

    const { data: recentSessions, error: recentError } = await orgScopedQuery(db, 'sessions', orgId)
      .select(
        'id, status, start_time, created_at, created_by, updated_at, updated_by, client:clients(full_name), therapist:therapists(full_name)'
      )
      .order('created_at', { ascending: false }).limit(10);
    if (recentError) throw recentError;

    const { data: monthlyBilling, error: billingError } = await orgScopedQuery(db, 'billing_records', orgId)
      .select('amount_paid')
      .gte('created_at', `${monthStartStr}T00:00:00`);
    if (billingError) throw billingError;

    const todaysSessionsData = aggregateTodaysSessions(todaySessions, todaySessionsCount)

    const uniqueClients = new Set(weekSessions?.map(s => s.client_id)).size;
    const uniqueTherapists = new Set(weekSessions?.map(s => s.therapist_id)).size;
    const completedWeekSessions = weekSessions?.filter(s => s.status === 'completed').length || 0;
    const totalWeekSessions = weekSessions?.length || 0;
    const utilizationRate = totalWeekSessions > 0 ? (completedWeekSessions / totalWeekSessions) * 100 : 0;

    const thisMonthRevenue = monthlyBilling?.reduce((sum, record) => sum + (record.amount_paid || 0), 0) || 0;

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
      return errorEnvelope({ requestId, code: 'missing_org', message: error.message, status: 403 })
    }
    const requestId = getRequestId(new Request('http://local'))
    console.error('Dashboard data error:', error)
    return errorEnvelope({ requestId, code: 'internal_error', message: 'Unexpected error', status: 500 })
  }
}

export const __TESTING__ = {
  aggregateTodaysSessions,
}

export default createProtectedRoute((req: Request) => handleGetDashboardData({ req }), RouteOptions.admin)
