import { createClient } from "npm:@supabase/supabase-js@2.50.0";
import { createPublicRoute, corsHeaders, logApiAccess } from "../_shared/auth-middleware.ts";
import { errorEnvelope, getRequestId, rateLimit } from "../lib/http/error.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_ANON_KEY") ?? ""
);

interface LoginRequest {
  email: string;
  password: string;
}

export default createPublicRoute(async (req: Request) => {
  const requestId = getRequestId(req);
  if (req.method !== 'POST') {
    return errorEnvelope({
      requestId,
      code: "validation_error",
      message: "Method not allowed",
      status: 405,
      headers: corsHeaders,
    });
  }

  try {
    const { email, password }: LoginRequest = await req.json();
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const emailKey = typeof email === "string" ? email.trim().toLowerCase() : "unknown";

    const ipGuard = rateLimit(`auth-login:ip:${ip}`, 20, 60_000);
    if (!ipGuard.allowed) {
      logApiAccess("POST", "/auth/login", null, 429);
      return errorEnvelope({
        requestId,
        code: "rate_limited",
        message: "Too many login attempts. Please try again shortly.",
        status: 429,
        headers: { ...corsHeaders, "Retry-After": String(ipGuard.retryAfter ?? 60) },
      });
    }

    const identityGuard = rateLimit(`auth-login:identity:${emailKey}`, 8, 60_000);
    if (!identityGuard.allowed) {
      logApiAccess("POST", "/auth/login", null, 429);
      return errorEnvelope({
        requestId,
        code: "rate_limited",
        message: "Too many login attempts for this account. Please try again shortly.",
        status: 429,
        headers: { ...corsHeaders, "Retry-After": String(identityGuard.retryAfter ?? 60) },
      });
    }

    // Validate required fields
    if (!email || !password) {
      return errorEnvelope({
        requestId,
        code: "validation_error",
        message: "Email and password are required",
        headers: corsHeaders,
      });
    }

    // Authenticate user
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error('Login error:', error);
      logApiAccess('POST', '/auth/login', null, 401);

      return errorEnvelope({
        requestId,
        code: "unauthorized",
        message: "Invalid credentials",
        headers: corsHeaders,
      });
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

      return errorEnvelope({
        requestId,
        code: "internal_error",
        message: "User profile not found",
        headers: corsHeaders,
      });
    }

    // Check if user is active
    if (!profile.is_active) {
      logApiAccess('POST', '/auth/login', null, 403);

      return errorEnvelope({
        requestId,
        code: "forbidden",
        message: "Account is inactive",
        headers: corsHeaders,
      });
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

    return errorEnvelope({
      requestId,
      code: "internal_error",
      message: "Internal server error",
      headers: corsHeaders,
    });
  }
});