import { createClient } from "npm:@supabase/supabase-js@2.50.0";

// Initialize Supabase client
export const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? '',
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? '',
);

// Database utility functions
export async function getSessionsReport(
  startDate: string,
  endDate: string,
  therapistId?: string,
  clientId?: string,
  status?: string
) {
  let query = supabase
    .from('sessions')
    .select(`
      *,
      therapist:therapists(id, full_name),
      client:clients(id, full_name)
    `)
    .gte('start_time', startDate)
    .lte('start_time', endDate);

  if (therapistId) {
    query = query.eq('therapist_id', therapistId);
  }
  
  if (clientId) {
    query = query.eq('client_id', clientId);
  }
  
  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  
  if (error) throw error;
  return data;
}

export async function getClientMetrics(startDate: string, endDate: string) {
  // Get client session counts and basic metrics
  const { data: sessions, error } = await supabase
    .from('sessions')
    .select(`
      client_id,
      status,
      start_time,
      clients(id, full_name, created_at)
    `)
    .gte('start_time', startDate)
    .lte('start_time', endDate);

  if (error) throw error;

  // Calculate metrics
  const clientMetrics = sessions.reduce((acc, session) => {
    const clientId = session.client_id;
    if (!acc[clientId]) {
      acc[clientId] = {
        client_id: clientId,
        client_name: session.clients?.full_name,
        total_sessions: 0,
        completed_sessions: 0,
        cancelled_sessions: 0,
        no_show_sessions: 0,
      };
    }
    
    acc[clientId].total_sessions++;
    if (session.status === 'completed') acc[clientId].completed_sessions++;
    if (session.status === 'cancelled') acc[clientId].cancelled_sessions++;
    if (session.status === 'no-show') acc[clientId].no_show_sessions++;
    
    return acc;
  }, {});

  return Object.values(clientMetrics);
}

export async function getTherapistMetrics(startDate: string, endDate: string) {
  const { data: sessions, error } = await supabase
    .from('sessions')
    .select(`
      therapist_id,
      status,
      start_time,
      therapists(id, full_name, service_type)
    `)
    .gte('start_time', startDate)
    .lte('start_time', endDate);

  if (error) throw error;

  const therapistMetrics = sessions.reduce((acc, session) => {
    const therapistId = session.therapist_id;
    if (!acc[therapistId]) {
      acc[therapistId] = {
        therapist_id: therapistId,
        therapist_name: session.therapists?.full_name,
        service_types: session.therapists?.service_type || [],
        total_sessions: 0,
        completed_sessions: 0,
        cancelled_sessions: 0,
        no_show_sessions: 0,
      };
    }
    
    acc[therapistId].total_sessions++;
    if (session.status === 'completed') acc[therapistId].completed_sessions++;
    if (session.status === 'cancelled') acc[therapistId].cancelled_sessions++;
    if (session.status === 'no-show') acc[therapistId].no_show_sessions++;
    
    return acc;
  }, {});

  return Object.values(therapistMetrics);
} 