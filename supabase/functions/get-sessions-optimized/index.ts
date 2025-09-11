
import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from '../_shared/cors.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

interface SessionFilters {
  therapist_id?: string;
  client_id?: string;
  status?: string;
  start_date?: string;
  end_date?: string;
  location_type?: string;
  page?: number;
  limit?: number;
}

interface OptimizedSessionResponse {
  sessions: Array<{
    id: string;
    start_time: string;
    end_time: string;
    status: string;
    location_type: string;
    notes?: string;
    therapist: {
      id: string;
      full_name: string;
      email: string;
    };
    client: {
      id: string;
      full_name: string;
      email: string;
    };
    authorization?: {
      id: string;
      sessions_remaining: number;
    };
  }>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  summary: {
    totalSessions: number;
    completedSessions: number;
    upcomingSessions: number;
    cancelledSessions: number;
  };
}

Deno.serve(async (req: Request) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Parse query parameters
    const url = new URL(req.url);
    const filters: SessionFilters = {
      therapist_id: url.searchParams.get('therapist_id') || undefined,
      client_id: url.searchParams.get('client_id') || undefined,
      status: url.searchParams.get('status') || undefined,
      start_date: url.searchParams.get('start_date') || undefined,
      end_date: url.searchParams.get('end_date') || undefined,
      location_type: url.searchParams.get('location_type') || undefined,
      page: parseInt(url.searchParams.get('page') || '1'),
      limit: Math.min(parseInt(url.searchParams.get('limit') || '50'), 100)
    };

    // Build base query with optimized joins
    let query = supabase
      .from('sessions')
      .select(`
        id,
        start_time,
        end_time,
        status,
        location_type,
        notes,
        therapist_id,
        client_id,
        authorization_id,
        therapist:therapists!inner(
          id,
          full_name,
          email
        ),
        client:clients!inner(
          id,
          full_name,
          email
        ),
        authorization:authorizations(
          id,
          authorized_sessions,
          sessions_used
        )
      `, { count: 'exact' });

    // Apply filters
    if (filters.therapist_id) {
      query = query.eq('therapist_id', filters.therapist_id);
    }

    if (filters.client_id) {
      query = query.eq('client_id', filters.client_id);
    }

    if (filters.status) {
      query = query.eq('status', filters.status);
    }

    if (filters.location_type) {
      query = query.eq('location_type', filters.location_type);
    }

    if (filters.start_date) {
      query = query.gte('start_time', `${filters.start_date}T00:00:00`);
    }

    if (filters.end_date) {
      query = query.lte('start_time', `${filters.end_date}T23:59:59`);
    }

    // Apply pagination
    const offset = ((filters.page || 1) - 1) * (filters.limit || 50);
    query = query.range(offset, offset + (filters.limit || 50) - 1);

    // Order by start time
    query = query.order('start_time', { ascending: false });

    const { data: sessions, error, count } = await query;

    if (error) throw error;

    // Calculate summary statistics
    let summaryQuery = supabase
      .from('sessions')
      .select('status', { count: 'exact' });

    // Apply same filters for summary (excluding pagination)
    if (filters.therapist_id) {
      summaryQuery = summaryQuery.eq('therapist_id', filters.therapist_id);
    }
    if (filters.client_id) {
      summaryQuery = summaryQuery.eq('client_id', filters.client_id);
    }
    if (filters.start_date) {
      summaryQuery = summaryQuery.gte('start_time', `${filters.start_date}T00:00:00`);
    }
    if (filters.end_date) {
      summaryQuery = summaryQuery.lte('start_time', `${filters.end_date}T23:59:59`);
    }

    const { data: allFilteredSessions, error: summaryError } = await summaryQuery;

    if (summaryError) throw summaryError;

    // Calculate summary metrics
    const totalSessions = count || 0;
    const completedSessions = allFilteredSessions?.filter(s => s.status === 'completed').length || 0;
    const upcomingSessions = allFilteredSessions?.filter(s => s.status === 'scheduled').length || 0;
    const cancelledSessions = allFilteredSessions?.filter(s => s.status === 'cancelled').length || 0;

    // Format sessions with calculated fields
    const formattedSessions = sessions?.map(session => ({
      id: session.id,
      start_time: session.start_time,
      end_time: session.end_time,
      status: session.status,
      location_type: session.location_type,
      notes: session.notes,
      therapist: session.therapist,
      client: session.client,
      authorization: session.authorization ? {
        id: session.authorization.id,
        sessions_remaining: (session.authorization.authorized_sessions || 0) - (session.authorization.sessions_used || 0)
      } : undefined
    })) || [];

    // Calculate pagination info
    const totalPages = Math.ceil(totalSessions / (filters.limit || 50));
    const currentPage = filters.page || 1;

    const response: OptimizedSessionResponse = {
      sessions: formattedSessions,
      pagination: {
        page: currentPage,
        limit: filters.limit || 50,
        total: totalSessions,
        totalPages,
        hasNextPage: currentPage < totalPages,
        hasPreviousPage: currentPage > 1
      },
      summary: {
        totalSessions,
        completedSessions,
        upcomingSessions,
        cancelledSessions
      }
    };

    return new Response(
      JSON.stringify({ 
        success: true, 
        data: response,
        filters: filters,
        performance: {
          cached: false,
          queryTime: new Date().toISOString()
        }
      }),
      { 
        headers: { 
          ...corsHeaders,
          'Content-Type': 'application/json' 
        } 
      }
    )
  } catch (error) {
    console.error('Optimized sessions error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message 
      }),
      { 
        headers: { 
          ...corsHeaders,
          'Content-Type': 'application/json' 
        },
        status: 500
      }
    )
  }
})
