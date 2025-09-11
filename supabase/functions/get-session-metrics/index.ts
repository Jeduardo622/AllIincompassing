
import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from '../_shared/cors.ts'
import { errorEnvelope, getRequestId, rateLimit, IsoDateSchema } from '../lib/http/error.ts'
import { z } from 'zod'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

interface SessionMetrics {
  totalSessions: number;
  completedSessions: number;
  scheduledSessions: number;
  cancelledSessions: number;
  noShowSessions: number;
  completionRate: number;
  attendanceRate: number;
  averageSessionDuration: number;
  sessionsByDay: Array<{
    date: string;
    count: number;
    completed: number;
    cancelled: number;
  }>;
  sessionsByTherapist: Array<{
    therapist_id: string;
    therapist_name: string;
    total_sessions: number;
    completed_sessions: number;
    completion_rate: number;
  }>;
  sessionsByClient: Array<{
    client_id: string;
    client_name: string;
    total_sessions: number;
    completed_sessions: number;
    attendance_rate: number;
  }>;
  sessionsByStatus: Array<{
    status: string;
    count: number;
    percentage: number;
  }>;
  locationMetrics: Array<{
    location_type: string;
    count: number;
    percentage: number;
  }>;
  revenueMetrics: {
    totalRevenue: number;
    averageRevenuePerSession: number;
    unpaidSessions: number;
  };
}

Deno.serve(async (req: Request) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const requestId = getRequestId(req);

    // Simple rate limit: 60 req/min per IP
    const ip = req.headers.get('x-forwarded-for') || 'unknown';
    const rl = rateLimit(`metrics:${ip}`, 60, 60_000);
    if (!rl.allowed) {
      return errorEnvelope({ requestId, code: 'rate_limited', message: 'Too many requests', status: 429, headers: { 'Retry-After': String(rl.retryAfter ?? 60) } });
    }

    // Parse and validate query parameters
    const url = new URL(req.url);
    const ParamsSchema = z.object({
      start_date: IsoDateSchema.optional(),
      end_date: IsoDateSchema.optional(),
      therapist_id: z.string().optional(),
      client_id: z.string().optional(),
      status: z.string().optional(),
    });
    const parsed = ParamsSchema.safeParse({
      start_date: url.searchParams.get('p_start_date') || url.searchParams.get('start_date') || undefined,
      end_date: url.searchParams.get('p_end_date') || url.searchParams.get('end_date') || undefined,
      therapist_id: url.searchParams.get('p_therapist_id') || url.searchParams.get('therapist_id') || undefined,
      client_id: url.searchParams.get('p_client_id') || url.searchParams.get('client_id') || undefined,
      status: url.searchParams.get('p_status') || url.searchParams.get('status') || undefined,
    });
    if (!parsed.success) {
      return errorEnvelope({ requestId, code: 'invalid_params', message: 'Invalid query parameters', status: 400 });
    }
    const { start_date: startDate, end_date: endDate, therapist_id: therapistId, client_id: clientId, status } = parsed.data;

    // Default to last 30 days if no date range provided
    const defaultEndDate = new Date().toISOString().split('T')[0];
    const defaultStartDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const queryStartDate = startDate || defaultStartDate;
    const queryEndDate = endDate || defaultEndDate;

    // Build base query for sessions
    let sessionsQuery = supabase
      .from('sessions')
      .select(`
        id,
        start_time,
        end_time,
        status,
        location_type,
        therapist_id,
        client_id,
        therapist:therapists(id, full_name),
        client:clients(id, full_name),
        billing_records(amount_due, amount_paid, status)
      `)
      .gte('start_time', `${queryStartDate}T00:00:00`)
      .lte('start_time', `${queryEndDate}T23:59:59`);

    // Apply filters
    if (therapistId) {
      sessionsQuery = sessionsQuery.eq('therapist_id', therapistId);
    }
    if (clientId) {
      sessionsQuery = sessionsQuery.eq('client_id', clientId);
    }
    if (status) {
      sessionsQuery = sessionsQuery.eq('status', status);
    }

    const { data: sessions, error: sessionsError } = await sessionsQuery;

    if (sessionsError) throw sessionsError;

    const totalSessions = sessions?.length || 0;
    const completedSessions = sessions?.filter(s => s.status === 'completed').length || 0;
    const scheduledSessions = sessions?.filter(s => s.status === 'scheduled').length || 0;
    const cancelledSessions = sessions?.filter(s => s.status === 'cancelled').length || 0;
    const noShowSessions = sessions?.filter(s => s.status === 'no_show').length || 0;

    // Calculate rates
    const completionRate = totalSessions > 0 ? (completedSessions / totalSessions) * 100 : 0;
    const attendedSessions = completedSessions;
    const scheduledOrCompleted = attendedSessions + noShowSessions;
    const attendanceRate = scheduledOrCompleted > 0 ? (attendedSessions / scheduledOrCompleted) * 100 : 0;

    // Calculate average session duration
    const sessionsWithDuration = sessions?.filter(s => s.start_time && s.end_time) || [];
    const totalDuration = sessionsWithDuration.reduce((sum, session) => {
      const duration = new Date(session.end_time).getTime() - new Date(session.start_time).getTime();
      return sum + (duration / (1000 * 60)); // Convert to minutes
    }, 0);
    const averageSessionDuration = sessionsWithDuration.length > 0 ? totalDuration / sessionsWithDuration.length : 0;

    // Group sessions by day
    const sessionsByDay = sessions?.reduce((acc, session) => {
      const date = new Date(session.start_time).toISOString().split('T')[0];
      if (!acc[date]) {
        acc[date] = { total: 0, completed: 0, cancelled: 0 };
      }
      acc[date].total++;
      if (session.status === 'completed') acc[date].completed++;
      if (session.status === 'cancelled') acc[date].cancelled++;
      return acc;
    }, {} as Record<string, { total: number; completed: number; cancelled: number }>);

    const sessionsByDayArray = Object.entries(sessionsByDay || {}).map(([date, data]) => ({
      date,
      count: data.total,
      completed: data.completed,
      cancelled: data.cancelled
    })).sort((a, b) => a.date.localeCompare(b.date));

    // Group sessions by therapist
    const therapistGroups = sessions?.reduce((acc, session) => {
      const therapistId = session.therapist_id;
      if (!acc[therapistId]) {
        acc[therapistId] = {
          therapist_name: session.therapist?.full_name || 'Unknown',
          total: 0,
          completed: 0
        };
      }
      acc[therapistId].total++;
      if (session.status === 'completed') acc[therapistId].completed++;
      return acc;
    }, {} as Record<string, { therapist_name: string; total: number; completed: number }>);

    const sessionsByTherapist = Object.entries(therapistGroups || {}).map(([therapist_id, data]) => ({
      therapist_id,
      therapist_name: data.therapist_name,
      total_sessions: data.total,
      completed_sessions: data.completed,
      completion_rate: data.total > 0 ? (data.completed / data.total) * 100 : 0
    }));

    // Group sessions by client
    const clientGroups = sessions?.reduce((acc, session) => {
      const clientId = session.client_id;
      if (!acc[clientId]) {
        acc[clientId] = {
          client_name: session.client?.full_name || 'Unknown',
          total: 0,
          completed: 0
        };
      }
      acc[clientId].total++;
      if (session.status === 'completed') acc[clientId].completed++;
      return acc;
    }, {} as Record<string, { client_name: string; total: number; completed: number }>);

    const sessionsByClient = Object.entries(clientGroups || {}).map(([client_id, data]) => ({
      client_id,
      client_name: data.client_name,
      total_sessions: data.total,
      completed_sessions: data.completed,
      attendance_rate: data.total > 0 ? (data.completed / data.total) * 100 : 0
    }));

    // Group sessions by status
    const statusGroups = sessions?.reduce((acc, session) => {
      const status = session.status;
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const sessionsByStatus = Object.entries(statusGroups || {}).map(([status, count]) => ({
      status,
      count,
      percentage: totalSessions > 0 ? (count / totalSessions) * 100 : 0
    }));

    // Group sessions by location
    const locationGroups = sessions?.reduce((acc, session) => {
      const location = session.location_type || 'unknown';
      acc[location] = (acc[location] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const locationMetrics = Object.entries(locationGroups || {}).map(([location_type, count]) => ({
      location_type,
      count,
      percentage: totalSessions > 0 ? (count / totalSessions) * 100 : 0
    }));

    // Calculate revenue metrics
    const billingRecords = sessions?.flatMap(s => s.billing_records || []) || [];
    const totalRevenue = billingRecords.reduce((sum, record) => sum + (record.amount_paid || 0), 0);
    const averageRevenuePerSession = totalSessions > 0 ? totalRevenue / totalSessions : 0;
    const unpaidSessions = billingRecords.filter(record => 
      (record.amount_due || 0) > (record.amount_paid || 0)
    ).length;

    const metrics: SessionMetrics = {
      totalSessions,
      completedSessions,
      scheduledSessions,
      cancelledSessions,
      noShowSessions,
      completionRate: Math.round(completionRate * 100) / 100,
      attendanceRate: Math.round(attendanceRate * 100) / 100,
      averageSessionDuration: Math.round(averageSessionDuration * 100) / 100,
      sessionsByDay: sessionsByDayArray,
      sessionsByTherapist,
      sessionsByClient,
      sessionsByStatus,
      locationMetrics,
      revenueMetrics: {
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        averageRevenuePerSession: Math.round(averageRevenuePerSession * 100) / 100,
        unpaidSessions
      }
    };

    return new Response(JSON.stringify({ success: true, data: metrics, parameters: { start_date: queryStartDate, end_date: queryEndDate, therapist_id: therapistId, client_id: clientId, status }, lastUpdated: new Date().toISOString(), requestId }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (error) {
    const requestId = getRequestId(new Request('http://local'));
    console.error('Session metrics error:', error);
    return errorEnvelope({ requestId, code: 'internal_error', message: 'Unexpected error', status: 500 });
  }
})
