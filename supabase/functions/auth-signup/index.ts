import { z } from "npm:zod@3.23.8";
import {
  createPublicRoute,
  corsHeadersForRequest,
  createSupabaseClientForRequest,
  logApiAccess,
} from "../_shared/auth-middleware.ts";
import { errorEnvelope, getRequestId, rateLimit } from "../lib/http/error.ts";

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters long"),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  role: z.enum(["client", "therapist", "admin", "super_admin", "guardian"]).optional(),
});

export default createPublicRoute(async (req: Request) => {
  const responseHeaders = corsHeadersForRequest(req);
  const requestId = getRequestId(req);
  if (req.method !== 'POST') {
    return errorEnvelope({
      requestId,
      code: "validation_error",
      message: "Method not allowed",
      status: 405,
      headers: responseHeaders,
    });
  }

  try {
    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      return errorEnvelope({
        requestId,
        code: "validation_error",
        message: "Invalid JSON body",
        headers: responseHeaders,
      });
    }
    const parsed = signupSchema.safeParse(payload);
    if (!parsed.success) {
      const issues = parsed.error.issues;
      const passwordError = issues.find((issue) => issue.path.join(".") === "password");
      const emailError = issues.find((issue) => issue.path.join(".") === "email");
      const message = passwordError?.message
        ?? (emailError ? "Invalid email format" : "Email and password are required");
      return errorEnvelope({
        requestId,
        code: "validation_error",
        message,
        headers: responseHeaders,
      });
    }
    const { email, password, firstName, lastName, role } = parsed.data;
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const emailKey = email.trim().toLowerCase();

    const ipGuard = rateLimit(`auth-signup:ip:${ip}`, 10, 60_000);
    if (!ipGuard.allowed) {
      logApiAccess("POST", "/auth/signup", null, 429);
      return errorEnvelope({
        requestId,
        code: "rate_limited",
        message: "Too many signup attempts from this network. Please try again shortly.",
        status: 429,
        headers: { ...responseHeaders, "Retry-After": String(ipGuard.retryAfter ?? 60) },
      });
    }

    const identityGuard = rateLimit(`auth-signup:identity:${emailKey}`, 4, 60_000);
    if (!identityGuard.allowed) {
      logApiAccess("POST", "/auth/signup", null, 429);
      return errorEnvelope({
        requestId,
        code: "rate_limited",
        message: "Too many signup attempts for this email. Please try again shortly.",
        status: 429,
        headers: { ...responseHeaders, "Retry-After": String(identityGuard.retryAfter ?? 60) },
      });
    }

    // Public signup must remain least-privilege and metadata-safe.
    // Any untrusted role value downgrades to client.
    const assignedRole = role === 'therapist' ? 'therapist' : 'client';

    // Create user account
    const { supabase } = await createSupabaseClientForRequest(req);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          first_name: firstName,
          last_name: lastName,
          role: assignedRole,
          signup_role: assignedRole,
        },
      },
    });

    if (error) {
      console.error('Signup error:', error);
      return errorEnvelope({
        requestId,
        code: "validation_error",
        message: "Unable to complete signup",
        status: 400,
        headers: responseHeaders,
      });
    }

    // Log the signup
    logApiAccess('POST', '/auth/signup', null, 201);

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
        headers: { ...responseHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Signup error:', error);
    logApiAccess('POST', '/auth/signup', null, 500);
    
    return errorEnvelope({
      requestId,
      code: "internal_error",
      message: "Internal server error",
      headers: responseHeaders,
    });
  }
});