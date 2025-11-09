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

/**
 * CORS headers for all API responses
 */
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Client-Info, apikey",
  "Access-Control-Max-Age": "86400",
};

/**
 * Handle CORS preflight requests
 */
export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }
  return null;
}

/**
 * Extract Bearer token from Authorization header
 */
function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}

/**
 * Get authenticated user context
 */
export async function getUserContext(req: Request): Promise<UserContext | null> {
  const token = extractBearerToken(req);
  if (!token) {
    return null;
  }

  const { createClient } = await loadSupabaseModule();
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    }
  );

  try {
    // Get user from token
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return null;
    }

    // Get user profile with role
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, email, role, is_active')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return null;
    }

    return {
      user: {
        id: user.id,
        email: user.email ?? null,
      },
      profile: { ...profile, email: profile.email ?? null },
    };
  } catch (error) {
    console.error('Error getting user context:', error);
    return null;
  }
}

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

  try {
    // Get user context
    const userContext = await getUserContext(req);

    // Check if authentication is required
    if (requireAuth && !userContext) {
      return {
        userContext: null,
        error: new Response(
          JSON.stringify({ error: 'Authentication required' }),
          {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        ),
      };
    }

    // Check if user is active
    if (userContext && requireActiveUser && !userContext.profile.is_active) {
      return {
        userContext: null,
        error: new Response(
          JSON.stringify({ error: 'User account is inactive' }),
          {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        ),
      };
    }

    // Check role-based authorization
    if (allowedRoles.length > 0 && userContext) {
      if (!hasRequiredRole(userContext.profile.role, allowedRoles)) {
        return {
          userContext,
          error: new Response(
            JSON.stringify({ 
              error: 'Insufficient permissions',
              required_roles: allowedRoles,
              user_role: userContext.profile.role,
            }),
            {
              status: 403,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          ),
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
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    try {
      return await handler(req, userContext);
    } catch (error) {
      console.error('Protected route error:', error);
      
      if (error instanceof AuthenticationError) {
        return new Response(
          JSON.stringify({ error: error.message }),
          {
            status: error.statusCode,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      if (error instanceof AuthorizationError) {
        return new Response(
          JSON.stringify({ error: error.message }),
          {
            status: error.statusCode,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      return new Response(
        JSON.stringify({ error: 'Internal server error' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
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
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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