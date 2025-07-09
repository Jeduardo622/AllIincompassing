import { createClient } from "npm:@supabase/supabase-js@2.50.0";
import { createPublicRoute, corsHeaders, logApiAccess } from "../_shared/auth-middleware.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_ANON_KEY") ?? ""
);

interface SignupRequest {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  role?: 'client' | 'therapist' | 'admin' | 'super_admin';
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
    const { email, password, firstName, lastName, role }: SignupRequest = await req.json();

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

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(
        JSON.stringify({ error: 'Invalid email format' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Validate password strength
    if (password.length < 8) {
      return new Response(
        JSON.stringify({ error: 'Password must be at least 8 characters long' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Default role is client, only admins can create admin/super_admin accounts
    const assignedRole = role || 'client';
    if (['admin', 'super_admin'].includes(assignedRole)) {
      if (!userContext || !['admin', 'super_admin'].includes(userContext.profile.role)) {
        return new Response(
          JSON.stringify({ error: 'Insufficient permissions to create admin accounts' }),
          {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // Create user account
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          first_name: firstName,
          last_name: lastName,
          role: assignedRole,
        },
      },
    });

    if (error) {
      console.error('Signup error:', error);
      return new Response(
        JSON.stringify({ error: error.message }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Log the signup
    logApiAccess('POST', '/auth/signup', userContext, 201);

    return new Response(
      JSON.stringify({
        message: 'User created successfully',
        user: {
          id: data.user?.id,
          email: data.user?.email,
        },
        needsEmailConfirmation: !data.session,
      }),
      {
        status: 201,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Signup error:', error);
    logApiAccess('POST', '/auth/signup', userContext, 500);
    
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});