import { createClient } from "npm:@supabase/supabase-js@2.50.0";
import { createProtectedRoute, corsHeaders, logApiAccess, RouteOptions } from "../_shared/auth-middleware.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

export default createProtectedRoute(async (req: Request, userContext) => {
  if (req.method !== 'GET') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    // Parse query parameters
    const url = new URL(req.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
    const role = url.searchParams.get('role') as 'client' | 'therapist' | 'admin' | 'super_admin' | null;
    const active = url.searchParams.get('active');
    const search = url.searchParams.get('search');

    // Build query
    let query = supabase
      .from('profiles')
      .select('id, email, role, first_name, last_name, full_name, phone, is_active, last_login_at, created_at, updated_at');

    // Apply filters
    if (role) {
      query = query.eq('role', role);
    }

    if (active !== null) {
      query = query.eq('is_active', active === 'true');
    }

    if (search) {
      query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`);
    }

    // Apply pagination
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);

    // Order by creation date
    query = query.order('created_at', { ascending: false });

    const { data: users, error, count } = await query;

    if (error) {
      console.error('Users fetch error:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch users' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Get total count for pagination
    const { count: totalCount, error: countError } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      console.error('Count error:', countError);
    }

    // Calculate pagination info
    const totalPages = Math.ceil((totalCount || 0) / limit);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;

    logApiAccess('GET', '/admin/users', userContext, 200);

    return new Response(
      JSON.stringify({
        users: users || [],
        pagination: {
          currentPage: page,
          limit,
          totalPages,
          totalCount: totalCount || 0,
          hasNextPage,
          hasPreviousPage,
        },
        filters: {
          role,
          active: active !== null ? active === 'true' : null,
          search,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Admin users error:', error);
    logApiAccess('GET', '/admin/users', userContext, 500);
    
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
}, RouteOptions.admin);