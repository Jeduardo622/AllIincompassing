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
    await assertAdmin(caller);

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

    let reportData;

    switch (reportType) {
      case "sessions":
        reportData = await generateSessionsReport(startDate, endDate, therapistId, clientId, status, userContext);
        break;
      case "clients":
        reportData = await generateClientsReport(startDate, endDate, userContext);
        break;
      case "therapists":
        reportData = await generateTherapistsReport(startDate, endDate, userContext);
        break;
      case "billing":
        reportData = await generateBillingReport(startDate, endDate, therapistId, clientId, userContext);
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
}, RouteOptions.admin); // Require admin role for report generation

// Helper functions with role-based access control
async function generateSessionsReport(
  startDate: string,
  endDate: string,
  therapistId?: string,
  clientId?: string,
  status?: string,
  userContext: UserContext
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

  // Apply role-based filtering
  if (userContext.profile.role === 'therapist') {
    // Therapists can only see their own sessions
    query = query.eq('therapist_id', userContext.user.id);
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

async function generateClientsReport(startDate: string, endDate: string, userContext: UserContext) {
  let query = supabase
    .from("clients")
    .select("*")
    .gte("created_at", startDate)
    .lte("created_at", endDate);

  // Apply role-based filtering
  if (userContext.profile.role === 'therapist') {
    // Therapists can only see their assigned clients
    query = query.eq('therapist_id', userContext.user.id);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Error fetching clients: ${error.message}`);
  }

  return {
    clients: data,
    summary: {
      totalClients: data.length,
      activeClients: data.filter(c => c.is_active).length,
      newClients: data.length
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
  therapistId?: string,
  clientId?: string,
  userContext: UserContext
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
