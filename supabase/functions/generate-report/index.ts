import { createProtectedRoute, corsHeaders, logApiAccess, RouteOptions, UserContext } from "../_shared/auth-middleware.ts";
import { supabaseAdmin, createRequestClient } from "../_shared/database.ts";
import { assertAdmin } from "../_shared/auth.ts";

const supabase = supabaseAdmin;

interface ReportRequest {
  reportType: string;
  startDate: string;
  endDate: string;
  therapistId?: string;
  clientId?: string;
  status?: string;
}

export default createProtectedRoute(async (req: Request, userContext) => {
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    const caller = createRequestClient(req);

    const callerRole = userContext.profile.role;
    if (callerRole === 'admin' || callerRole === 'super_admin') {
      await assertAdmin(caller);
    }

    if (callerRole === 'client') {
      logApiAccess('POST', '/generate-report', userContext, 403);
      return new Response(
        JSON.stringify({ error: 'Clients are not permitted to generate reports' }),
        {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const {
      reportType,
      startDate,
      endDate,
      therapistId,
      clientId,
      status
    }: ReportRequest = await req.json();

    if (!reportType || !startDate || !endDate) {
      return new Response(
        JSON.stringify({ error: 'Report type, start date, and end date are required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const therapistScope = await resolveTherapistScope(userContext);

    if (userContext.profile.role === 'therapist' && therapistScope.length === 0) {
      logApiAccess('POST', '/generate-report', userContext, 403);
      return new Response(
        JSON.stringify({ error: 'Therapist account is not linked to any therapist profile' }),
        {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (
      therapistId &&
      therapistScope.length > 0 &&
      !therapistScope.includes(therapistId)
    ) {
      logApiAccess('POST', '/generate-report', userContext, 403);
      return new Response(
        JSON.stringify({ error: 'Access to the requested therapist scope is not allowed' }),
        {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    let reportData;

    switch (reportType) {
      case "sessions":
        reportData = await generateSessionsReport(startDate, endDate, therapistId, clientId, status, userContext, therapistScope);
        break;
      case "clients":
        reportData = await generateClientsReport(startDate, endDate, userContext, therapistScope);
        break;
      case "therapists":
        reportData = await generateTherapistsReport(startDate, endDate, userContext);
        break;
      case "billing":
        reportData = await generateBillingReport(startDate, endDate, therapistId, clientId, userContext, therapistScope);
        break;
      default:
        return new Response(
          JSON.stringify({ error: `Unsupported report type: ${reportType}` }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
    }

    logApiAccess('POST', '/generate-report', userContext, 200);
    return new Response(
      JSON.stringify({
        success: true,
        reportType,
        data: reportData,
        generatedAt: new Date().toISOString(),
        filters: { startDate, endDate, therapistId, clientId, status }
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error("Error generating report:", error);
    logApiAccess('POST', '/generate-report', userContext, 500);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Failed to generate report'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
}, RouteOptions.therapist); // Allow therapists and admins with scoped access

// Helper functions with role-based access control
async function generateSessionsReport(
  startDate: string,
  endDate: string,
  therapistId: string | undefined,
  clientId: string | undefined,
  status: string | undefined,
  userContext: UserContext,
  therapistScope: string[]
) {
  let query = supabase
    .from("sessions")
    .select(`
      *,
      therapists!inner (id, full_name),
      clients!inner (id, full_name)
    `)
    .gte("start_time", startDate)
    .lte("start_time", endDate);

  if (therapistScope.length > 0) {
    query = query.in('therapist_id', therapistScope);
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

  return {
    sessions: data,
    summary: {
      totalSessions: data.length,
      completedSessions: data.filter(s => s.status === "completed").length,
      cancelledSessions: data.filter(s => s.status === "cancelled").length,
      scheduledSessions: data.filter(s => s.status === "scheduled").length,
    }
  };
}

async function generateClientsReport(startDate: string, endDate: string, userContext: UserContext, therapistScope: string[]) {
  let query = supabase
    .from("clients")
    .select("*")
    .gte("created_at", startDate)
    .lte("created_at", endDate);

  if (therapistScope.length > 0) {
    // Therapists do not have a direct foreign key on the clients table. Instead,
    // we join through sessions to ensure we only return clients that are
    // associated with the therapist via scheduled work.
    query = supabase
      .from("clients")
      .select(`
        *,
        therapist_sessions:sessions!inner (
          therapist_id
        )
      `)
      .gte("created_at", startDate)
      .lte("created_at", endDate)
      .in("therapist_sessions.therapist_id", therapistScope);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Error fetching clients: ${error.message}`);
  }

  const normalizedClients = therapistScope.length > 0
    ? Array.from(
      (data ?? []).reduce((map: Map<string, any>, client: any) => {
        if (!client) {
          return map;
        }

        const { therapist_sessions: _therapistSessions, ...clientRecord } = client;
        if (clientRecord?.id && !map.has(clientRecord.id)) {
          map.set(clientRecord.id, clientRecord);
        }
        return map;
      }, new Map<string, any>()).values()
    )
    : data ?? [];

  return {
    clients: normalizedClients,
    summary: {
      totalClients: normalizedClients.length,
      activeClients: normalizedClients.filter((c: any) => c.is_active).length,
      newClients: normalizedClients.length
    }
  };
}

async function generateTherapistsReport(startDate: string, endDate: string, userContext: UserContext) {
  // Only admins can generate therapist reports (enforced by assertAdmin)
  const { data, error } = await supabase
    .from("therapists")
    .select("*")
    .gte("created_at", startDate)
    .lte("created_at", endDate);

  if (error) {
    throw new Error(`Error fetching therapists: ${error.message}`);
  }

  return {
    therapists: data,
    summary: {
      totalTherapists: data.length,
      activeTherapists: data.filter(t => t.is_active).length,
    }
  };
}

async function generateBillingReport(
  startDate: string,
  endDate: string,
  therapistId: string | undefined,
  clientId: string | undefined,
  userContext: UserContext,
  therapistScope: string[]
) {
  // Only admins can generate billing reports (enforced by assertAdmin)
  let query = supabase
    .from("sessions")
    .select(`
      *,
      therapists!inner (id, full_name, hourly_rate),
      clients!inner (id, full_name)
    `)
    .gte("start_time", startDate)
    .lte("start_time", endDate)
    .eq("status", "completed");

  if (therapistScope.length > 0) {
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

  const totalRevenue = data.reduce((sum: number, session: any) => {
    return sum + (session.therapists.hourly_rate || 0);
  }, 0);

  return {
    sessions: data,
    summary: {
      totalSessions: data.length,
      totalRevenue,
      averageSessionValue: data.length > 0 ? totalRevenue / data.length : 0,
    }
  };
}

async function resolveTherapistScope(userContext: UserContext): Promise<string[]> {
  if (userContext.profile.role !== 'therapist') {
    return [];
  }

  const scope = new Set<string>();
  if (userContext.user.id) {
    scope.add(userContext.user.id);
  }
  if (userContext.profile.id) {
    scope.add(userContext.profile.id);
  }

  const { data, error } = await supabase
    .from('user_therapist_links')
    .select('therapist_id')
    .eq('user_id', userContext.user.id);

  if (error) {
    console.warn('Error resolving therapist scope from user_therapist_links:', error);
  } else if (data) {
    for (const link of data) {
      if (link?.therapist_id) {
        scope.add(link.therapist_id);
      }
    }
  }

  return Array.from(scope);
}
