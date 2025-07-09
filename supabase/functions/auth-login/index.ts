import { createClient } from "npm:@supabase/supabase-js@2.50.0";
import { createPublicRoute, corsHeaders, logApiAccess } from "../_shared/auth-middleware.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_ANON_KEY") ?? ""
);

interface LoginRequest {
  email: string;
  password: string;
}

export default createPublicRoute(async (req: Request, userContext) => {
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
    const { email, password }: LoginRequest = await req.json();

    // Validate required fields
    if (!email || !password) {
      return new Response(
        JSON.stringify({ error: 'Email and password are required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Authenticate user
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error('Login error:', error);
      logApiAccess('POST', '/auth/login', null, 401);
      
      return new Response(
        JSON.stringify({ error: 'Invalid credentials' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Get user profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, email, role, first_name, last_name, is_active')
      .eq('id', data.user.id)
      .single();

    if (profileError || !profile) {
      console.error('Profile lookup error:', profileError);
      logApiAccess('POST', '/auth/login', null, 500);
      
      return new Response(
        JSON.stringify({ error: 'User profile not found' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Check if user is active
    if (!profile.is_active) {
      logApiAccess('POST', '/auth/login', null, 403);
      
      return new Response(
        JSON.stringify({ error: 'Account is inactive' }),
        {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Update last login timestamp
    await supabase
      .from('profiles')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', data.user.id);

    // Log successful login
    logApiAccess('POST', '/auth/login', { 
      user: { id: data.user.id, email: data.user.email },
      profile 
    }, 200);

    return new Response(
      JSON.stringify({
        message: 'Login successful',
        user: {
          id: data.user.id,
          email: data.user.email,
        },
        profile: {
          id: profile.id,
          email: profile.email,
          role: profile.role,
          first_name: profile.first_name,
          last_name: profile.last_name,
        },
        session: {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_at: data.session.expires_at,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Login error:', error);
    logApiAccess('POST', '/auth/login', null, 500);
    
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});