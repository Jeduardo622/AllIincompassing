import { createClient } from "npm:@supabase/supabase-js@2.50.0";
import { createPublicRoute, corsHeaders, logApiAccess } from "../_shared/auth-middleware.ts";
import { errorEnvelope, getRequestId, rateLimit } from "../lib/http/error.ts";

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
    const requestId = getRequestId(req);
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const emailKey = typeof email === "string" ? email.trim().toLowerCase() : "unknown";

    const ipGuard = rateLimit(`auth-signup:ip:${ip}`, 10, 60_000);
    if (!ipGuard.allowed) {
      logApiAccess("POST", "/auth/signup", userContext, 429);
      return errorEnvelope({
        requestId,
        code: "rate_limited",
        message: "Too many signup attempts from this network. Please try again shortly.",
        status: 429,
        headers: { ...corsHeaders, "Retry-After": String(ipGuard.retryAfter ?? 60) },
      });
    }

    const identityGuard = rateLimit(`auth-signup:identity:${emailKey}`, 4, 60_000);
    if (!identityGuard.allowed) {
      logApiAccess("POST", "/auth/signup", userContext, 429);
      return errorEnvelope({
        requestId,
        code: "rate_limited",
        message: "Too many signup attempts for this email. Please try again shortly.",
        status: 429,
        headers: { ...corsHeaders, "Retry-After": String(identityGuard.retryAfter ?? 60) },
      });
    }

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