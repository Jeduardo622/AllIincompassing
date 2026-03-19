// deno-lint-ignore-file no-import-prefix
/**
 * Production-Ready Authentication Middleware for Edge Functions
 *
 * Enforces role-based access control according to the route matrix:
 * - Public routes: /auth/signup, /auth/login
 * - Authenticated routes: /profiles/me (all authenticated users)
 * - Admin routes: /admin/users (admin, super_admin)
 * - Super admin routes: /admin/users/:id/roles (super_admin only)
 */
import { errorEnvelope, getRequestId } from "../lib/http/error.ts";
import { resolveOrgId } from "./org.ts";
import { corsHeadersForRequest as sharedCorsHeadersForRequest } from "./cors.ts";

type SupabaseModule = typeof import("npm:@supabase/supabase-js@2.50.0");

let supabaseModulePromise: Promise<SupabaseModule> | null = null;

const loadSupabaseModule = (): Promise<SupabaseModule> => {
  if (!supabaseModulePromise) {
    supabaseModulePromise = import("npm:@supabase/supabase-js@2.50.0");
  }
  return supabaseModulePromise;
};

// Role hierarchy for authorization
export type Role = 'client' | 'therapist' | 'admin' | 'super_admin';

export interface UserContext {
  user: {
    id: string;
    email: string | null;
  };
  profile: {
    id: string;
    email: string | null;
    role: Role;
    is_active: boolean;
  };
}

export interface AuthMiddlewareOptions {
  allowedRoles?: Role[];
  requireAuth?: boolean;
  requireActiveUser?: boolean;
}

export class AuthorizationError extends Error {
  constructor(message: string, public statusCode: number = 403) {
    super(message);
    this.name = 'AuthorizationError';
  }
}

export class AuthenticationError extends Error {
  constructor(message: string, public statusCode: number = 401) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

const resolveLegacyFallbackOrigin = (): string => {
  const configuredOrigins = Deno.env.get("CORS_ALLOWED_ORIGINS");
  if (configuredOrigins && configuredOrigins.trim().length > 0) {
    return configuredOrigins.split(",")[0].trim();
  }

  const appEnv = (Deno.env.get("APP_ENV") ?? Deno.env.get("DENO_ENV") ?? "production").toLowerCase();
  if (appEnv === "development" || appEnv === "local") {
    return "http://localhost:5173";
  }

  return "https://velvety-cendol-dae4d6.netlify.app";
};

const resolveLegacyStaticOrigin = (): string => {
  const configuredOrigins = Deno.env.get("CORS_ALLOWED_ORIGINS");
  if (!configuredOrigins || configuredOrigins.trim().length === 0) {
    return resolveLegacyFallbackOrigin();
  }
  const firstConfigured = configuredOrigins
    .split(",")
    .map((origin) => origin.trim())
    .find((origin) => origin.length > 0);
  return firstConfigured ?? resolveLegacyFallbackOrigin();
};

export const tokenResponseCacheHeaders = {
  "Cache-Control": "no-store, no-cache, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

/**
 * Backward-compatible static CORS headers for handlers that do not yet pass req.
 */
export const corsHeaders: Record<string, string> = {
  ...sharedCorsHeadersForRequest(
    new Request("https://edge.internal.local", {
      headers: {
        origin: resolveLegacyStaticOrigin(),
      },
    }),
  ),
  "Access-Control-Allow-Origin": resolveLegacyStaticOrigin(),
};

export function corsHeadersForRequest(req: Request): Record<string, string> {
  return sharedCorsHeadersForRequest(req);
}

/**
 * Handle CORS preflight requests
 */
export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeadersForRequest(req),
    });
  }
  return null;
}

/**
 * Extract Bearer token from Authorization header
 */
export function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}

export async function createSupabaseClientForRequest(req: Request): Promise<{
  supabase: ReturnType<SupabaseModule["createClient"]>;
  token: string | null;
}> {
  const token = extractBearerToken(req);
  const { createClient } = await loadSupabaseModule();
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    token
      ? {
          global: {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        }
      : undefined
  );
  return { supabase, token };
}

/**
 * Get authenticated user context
 */
export async function getUserContext(req: Request): Promise<UserContext | null> {
  const token = extractBearerToken(req);
  if (!token) {
    return null;
  }
  const { supabase } = await createSupabaseClientForRequest(req);

  try {
    // Get user from token
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return null;
    }

    // Get user profile shell (identity + active flag)
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, email, role, is_active')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return null;
    }

    const { data: roleRows, error: roleRowsError } = await supabase
      .from('user_roles')
      .select('is_active, expires_at, roles(name)')
      .eq('user_id', user.id);

    if (roleRowsError || !Array.isArray(roleRows)) {
      return null;
    }

    const orgId = await resolveOrgId(supabase);
    const role = await resolveRoleForOrganization(
      supabase,
      orgId,
      roleRows as Array<{ is_active?: unknown; expires_at?: unknown; roles?: { name?: unknown } | null }>,
    );

    return {
      user: {
        id: user.id,
        email: user.email ?? null,
      },
      profile: {
        ...profile,
        email: profile.email ?? null,
        role,
      },
    };
  } catch (error) {
    console.error('Error getting user context:', error);
    return null;
  }
}

export const authMiddlewareDeps = {
  getUserContext,
};

/**
 * Check if user has required role
 */
function hasRequiredRole(userRole: Role, allowedRoles: Role[]): boolean {
  // Role hierarchy: super_admin > admin > therapist > client
  const roleHierarchy: Record<Role, number> = {
    'super_admin': 4,
    'admin': 3,
    'therapist': 2,
    'client': 1,
  };

  const userLevel = roleHierarchy[userRole];
  
  // Check if user has exact role or higher level role
  return allowedRoles.some(role => {
    const requiredLevel = roleHierarchy[role];
    return userLevel >= requiredLevel;
  });
}

const roleOrder: ReadonlyArray<Role> = ['super_admin', 'admin', 'therapist', 'client'];

function parseRole(value: unknown): Role | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'client' || normalized === 'therapist' || normalized === 'admin' || normalized === 'super_admin') {
    return normalized;
  }

  return null;
}

function roleRowIsActive(isActive: unknown, expiresAt: unknown): boolean {
  if (isActive === false) {
    return false;
  }

  if (typeof expiresAt !== 'string' || expiresAt.trim().length === 0) {
    return true;
  }

  const parsed = new Date(expiresAt);
  if (Number.isNaN(parsed.getTime())) {
    return true;
  }

  return parsed.getTime() > Date.now();
}

function resolveRoleFromRoleRows(
  rows: Array<{ is_active?: unknown; expires_at?: unknown; roles?: { name?: unknown } | null }>
): Role {
  const granted = new Set<Role>();

  for (const row of rows) {
    if (!roleRowIsActive(row.is_active, row.expires_at)) {
      continue;
    }
    const parsed = parseRole(row.roles?.name);
    if (parsed) {
      granted.add(parsed);
    }
  }

  for (const role of roleOrder) {
    if (granted.has(role)) {
      return role;
    }
  }

  return 'client';
}

async function rpcBoolean(
  supabase: ReturnType<SupabaseModule["createClient"]>,
  fn: string,
  payload?: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await supabase.rpc(fn, payload);
  if (error) {
    return false;
  }
  return data === true;
}

async function resolveRoleForOrganization(
  supabase: ReturnType<SupabaseModule["createClient"]>,
  orgId: string | null,
  roleRows: Array<{ is_active?: unknown; expires_at?: unknown; roles?: { name?: unknown } | null }>,
): Promise<Role> {
  if (!orgId) {
    return resolveRoleFromRoleRows(roleRows);
  }

  if (await rpcBoolean(supabase, "current_user_is_super_admin")) {
    return "super_admin";
  }

  if (
    await rpcBoolean(supabase, "user_has_role_for_org", {
      role_name: "admin",
      target_organization_id: orgId,
    })
  ) {
    return "admin";
  }

  if (
    await rpcBoolean(supabase, "user_has_role_for_org", {
      role_name: "therapist",
      target_organization_id: orgId,
    })
  ) {
    return "therapist";
  }

  if (
    await rpcBoolean(supabase, "user_has_role_for_org", {
      role_name: "client",
      target_organization_id: orgId,
    })
  ) {
    return "client";
  }

  return resolveRoleFromRoleRows(roleRows);
}

/**
 * Main authentication middleware
 */
export async function withAuth(
  req: Request,
  options: AuthMiddlewareOptions = {}
): Promise<{ userContext: UserContext | null; error: Response | null }> {
  const {
    allowedRoles = [],
    requireAuth = false,
    requireActiveUser = true,
  } = options;

  const responseHeaders = corsHeadersForRequest(req);
  const requestId = getRequestId(req);

  try {
    // Get user context
    const userContext = await authMiddlewareDeps.getUserContext(req);

    // Check if authentication is required
    if (requireAuth && !userContext) {
      const token = extractBearerToken(req);
      const message = token ? "Invalid or expired token" : "Authentication required";
      return {
        userContext: null,
        error: errorEnvelope({
          requestId,
          code: "unauthorized",
          message,
          headers: responseHeaders,
        }),
      };
    }

    // Check if user is active
    if (userContext && requireActiveUser && !userContext.profile.is_active) {
      return {
        userContext: null,
        error: errorEnvelope({
          requestId,
          code: "forbidden",
          message: "User account is inactive",
          status: 403,
          headers: responseHeaders,
        }),
      };
    }

    // Check role-based authorization
    if (allowedRoles.length > 0 && userContext) {
      if (!hasRequiredRole(userContext.profile.role, allowedRoles)) {
        return {
          userContext,
          error: errorEnvelope({
            requestId,
            code: "forbidden",
            message: "Insufficient permissions",
            status: 403,
            headers: responseHeaders,
          }),
        };
      }
    }

    return { userContext, error: null };
  } catch (error) {
    console.error('Authentication middleware error:', error);
    return {
      userContext: null,
      error: new Response(
        JSON.stringify({ error: 'Internal authentication error' }),
        {
          status: 500,
          headers: { ...responseHeaders, 'Content-Type': 'application/json' },
        }
      ),
    };
  }
}

/**
 * Create protected route handler
 */
export function createProtectedRoute(
  handler: (req: Request, userContext: UserContext) => Promise<Response>,
  options: AuthMiddlewareOptions = {}
) {
  return async (req: Request): Promise<Response> => {
    // Handle CORS preflight
    const corsResponse = handleCors(req);
    if (corsResponse) {
      return corsResponse;
    }

    // Apply authentication middleware
    const { userContext, error } = await withAuth(req, {
      requireAuth: true,
      ...options,
    });

    if (error) {
      return error;
    }

    if (!userContext) {
      return errorEnvelope({
        requestId: getRequestId(req),
        code: "unauthorized",
        message: "Authentication required",
        headers: corsHeadersForRequest(req),
      });
    }

    try {
      return await handler(req, userContext);
    } catch (error) {
      console.error('Protected route error:', error);
      const requestId = getRequestId(req);
      const responseHeaders = corsHeadersForRequest(req);
      
      if (error instanceof AuthenticationError) {
        return errorEnvelope({
          requestId,
          code: "unauthorized",
          message: error.message,
          status: error.statusCode,
          headers: responseHeaders,
        });
      }

      if (error instanceof AuthorizationError) {
        return errorEnvelope({
          requestId,
          code: "forbidden",
          message: error.message,
          status: error.statusCode,
          headers: responseHeaders,
        });
      }

      return errorEnvelope({
        requestId,
        code: "internal_error",
        message: "Internal server error",
        status: 500,
        headers: responseHeaders,
      });
    }
  };
}

/**
 * Create public route handler (no authentication required)
 */
export function createPublicRoute(
  handler: (req: Request, userContext: UserContext | null) => Promise<Response>
) {
  return async (req: Request): Promise<Response> => {
    // Handle CORS preflight
    const corsResponse = handleCors(req);
    if (corsResponse) {
      return corsResponse;
    }

    // Get user context (optional for public routes)
    const { userContext } = await withAuth(req, { requireAuth: false });

    try {
      return await handler(req, userContext);
    } catch (error) {
      console.error('Public route error:', error);
      return new Response(
        JSON.stringify({ error: 'Internal server error' }),
        {
          status: 500,
          headers: { ...corsHeadersForRequest(req), 'Content-Type': 'application/json' },
        }
      );
    }
  };
}

/**
 * Role-based route decorators
 */
export const requireClient = (allowedRoles: Role[] = ['client']) => 
  ({ allowedRoles });

export const requireTherapist = (allowedRoles: Role[] = ['therapist']) => 
  ({ allowedRoles });

export const requireAdmin = (allowedRoles: Role[] = ['admin', 'super_admin']) => 
  ({ allowedRoles });

export const requireSuperAdmin = (allowedRoles: Role[] = ['super_admin']) => 
  ({ allowedRoles });

/**
 * Common route options
 */
export const RouteOptions = {
  public: {},
  authenticated: { requireAuth: true },
  client: { requireAuth: true, allowedRoles: ['client', 'therapist', 'admin', 'super_admin'] as Role[] },
  therapist: { requireAuth: true, allowedRoles: ['therapist', 'admin', 'super_admin'] as Role[] },
  admin: { requireAuth: true, allowedRoles: ['admin', 'super_admin'] as Role[] },
  superAdmin: { requireAuth: true, allowedRoles: ['super_admin'] as Role[] },
};

/**
 * Utility function to log API access
 */
export function logApiAccess(
  method: string,
  path: string,
  userContext: UserContext | null,
  status: number
) {
  const timestamp = new Date().toISOString();
  const userId = userContext?.user?.id ?? 'anonymous';
  const userRole = userContext?.profile?.role ?? 'none';
  
  console.log(`[${timestamp}] ${method} ${path} - User: ${userId} (${userRole}) - Status: ${status}`);
}
