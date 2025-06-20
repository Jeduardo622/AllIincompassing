import { createClient } from "npm:@supabase/supabase-js@2.50.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);

Deno.serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  try {
    // Get the JWT token from the request
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing Authorization header");
    }

    // Verify the JWT token
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      throw new Error("Invalid token or user not found");
    }

    // Parse the request body
    const { 
      reportType,
      startDate,
      endDate,
      therapistId,
      clientId,
      status
    } = await req.json();

    if (!reportType || !startDate || !endDate) {
      throw new Error("Report type, start date, and end date are required");
    }

    let reportData;

    switch (reportType) {
      case 'sessions':
        reportData = await generateSessionsReport(startDate, endDate, therapistId, clientId, status);
        break;
      case 'clients':
        reportData = await generateClientsReport(startDate, endDate);
        break;
      case 'therapists':
        reportData = await generateTherapistsReport(startDate, endDate);
        break;
      case 'authorizations':
        reportData = await generateAuthorizationsReport(startDate, endDate);
        break;
      case 'billing':
        reportData = await generateBillingReport(startDate, endDate);
        break;
      default:
        throw new Error(`Invalid report type: ${reportType}`);
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        data: reportData
      }),
      {
        headers: { 
          ...corsHeaders,
          "Content-Type": "application/json" 
        },
      }
    );
  } catch (error) {
    console.error("Error generating report:", error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error.message || "An error occurred while generating the report"
      }),
      {
        status: 400,
        headers: { 
          ...corsHeaders,
          "Content-Type": "application/json" 
        },
      }
    );
  }
});

// Generate sessions report
async function generateSessionsReport(
  startDate: string, 
  endDate: string, 
  therapistId?: string, 
  clientId?: string, 
  status?: string
) {
  const { data, error } = await supabase.rpc(
    'get_sessions_report',
    {
      p_start_date: startDate,
      p_end_date: endDate,
      p_therapist_id: therapistId,
      p_client_id: clientId,
      p_status: status
    }
  );

  if (error) throw error;

  // Process data for report
  const sessions = data || [];
  
  // Calculate metrics
  const totalSessions = sessions.length;
  const completedSessions = sessions.filter(s => s.status === 'completed').length;
  const cancelledSessions = sessions.filter(s => s.status === 'cancelled').length;
  const noShowSessions = sessions.filter(s => s.status === 'no-show').length;
  const completionRate = totalSessions > 0 ? (completedSessions / totalSessions) * 100 : 0;
  
  // Group by therapist
  const sessionsByTherapist = sessions.reduce((acc, session) => {
    const therapistName = session.therapist_name || 'Unknown';
    acc[therapistName] = (acc[therapistName] || 0) + 1;
    return acc;
  }, {});
  
  // Group by client
  const sessionsByClient = sessions.reduce((acc, session) => {
    const clientName = session.client_name || 'Unknown';
    acc[clientName] = (acc[clientName] || 0) + 1;
    return acc;
  }, {});
  
  // Group by day of week
  const sessionsByDayOfWeek = sessions.reduce((acc, session) => {
    const date = new Date(session.start_time);
    const dayOfWeek = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(date);
    acc[dayOfWeek] = (acc[dayOfWeek] || 0) + 1;
    return acc;
  }, {});

  return {
    totalSessions,
    completedSessions,
    cancelledSessions,
    noShowSessions,
    completionRate,
    sessionsByTherapist,
    sessionsByClient,
    sessionsByDayOfWeek,
    rawData: sessions
  };
}

// Generate clients report
async function generateClientsReport(startDate: string, endDate: string) {
  // Get client metrics
  const { data: metrics, error: metricsError } = await supabase.rpc(
    'get_client_metrics',
    {
      p_start_date: startDate,
      p_end_date: endDate
    }
  );

  if (metricsError) throw metricsError;

  // Get all clients
  const { data: clients, error: clientsError } = await supabase
    .from('clients')
    .select('*');

  if (clientsError) throw clientsError;

  // Get sessions in date range
  const { data: sessions, error: sessionsError } = await supabase.rpc(
    'get_sessions_report',
    {
      p_start_date: startDate,
      p_end_date: endDate,
      p_therapist_id: null,
      p_client_id: null,
      p_status: null
    }
  );

  if (sessionsError) throw sessionsError;

  return {
    ...metrics[0],
    rawData: clients
  };
}

// Generate therapists report
async function generateTherapistsReport(startDate: string, endDate: string) {
  // Get therapist metrics
  const { data: metrics, error: metricsError } = await supabase.rpc(
    'get_therapist_metrics',
    {
      p_start_date: startDate,
      p_end_date: endDate
    }
  );

  if (metricsError) throw metricsError;

  // Get all therapists
  const { data: therapists, error: therapistsError } = await supabase
    .from('therapists')
    .select('*');

  if (therapistsError) throw therapistsError;

  // Get sessions in date range
  const { data: sessions, error: sessionsError } = await supabase.rpc(
    'get_sessions_report',
    {
      p_start_date: startDate,
      p_end_date: endDate,
      p_therapist_id: null,
      p_client_id: null,
      p_status: null
    }
  );

  if (sessionsError) throw sessionsError;

  return {
    ...metrics[0],
    rawData: therapists
  };
}

// Generate authorizations report
async function generateAuthorizationsReport(startDate: string, endDate: string) {
  // Get authorization metrics
  const { data: metrics, error: metricsError } = await supabase.rpc(
    'get_authorization_metrics',
    {
      p_start_date: startDate,
      p_end_date: endDate
    }
  );

  if (metricsError) throw metricsError;

  // Get authorizations in date range
  const { data: authorizations, error: authError } = await supabase
    .from('authorizations')
    .select(`
      *,
      client:clients(id, full_name),
      provider:therapists(id, full_name),
      services:authorization_services(*)
    `)
    .gte('start_date', startDate)
    .lte('end_date', endDate);

  if (authError) throw authError;

  return {
    ...metrics[0],
    rawData: authorizations
  };
}

// Generate billing report
async function generateBillingReport(startDate: string, endDate: string) {
  // Get billing metrics
  const { data: metrics, error: metricsError } = await supabase.rpc(
    'get_billing_metrics',
    {
      p_start_date: startDate,
      p_end_date: endDate
    }
  );

  if (metricsError) throw metricsError;

  // Get billing records in date range
  const { data: billingRecords, error: billingError } = await supabase
    .from('billing_records')
    .select(`
      *,
      session:sessions(
        id,
        start_time,
        end_time,
        client_id,
        therapist_id,
        client:clients(id, full_name),
        therapist:therapists(id, full_name)
      )
    `)
    .gte('created_at', `${startDate}T00:00:00`)
    .lte('created_at', `${endDate}T23:59:59`);

  if (billingError) throw billingError;

  return {
    ...metrics[0],
    rawData: billingRecords
  };
}