// deno-lint-ignore-file no-import-prefix
type SupabaseModule = typeof import("npm:@supabase/supabase-js@2.50.0");

let supabaseModulePromise: Promise<SupabaseModule> | null = null;

const loadSupabaseModule = (): Promise<SupabaseModule> => {
  if (!supabaseModulePromise) {
    supabaseModulePromise = import("npm:@supabase/supabase-js@2.50.0");
  }
  return supabaseModulePromise;
};

export type Role = 'client' | 'therapist' | 'admin' | 'super_admin';

export interface UserContext {
  user: { id: string; email: string | null };
  profile: { id: string; email: string | null; role: Role; is_active: boolean };
}

export interface AuthMiddlewareOptions {
  allowedRoles?: Role[];
  requireAuth?: boolean;
  requireActiveUser?: boolean;
}

export class AuthorizationError extends Error {
  constructor(message: string, public statusCode: number = 403) { super(message); this.name = 'AuthorizationError'; }
}

export class AuthenticationError extends Error {
  constructor(message: string, public statusCode: number = 401) { super(message); this.name = 'AuthenticationError'; }
}

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Client-Info, apikey",
  "Access-Control-Max-Age": "86400",
};

export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') { return new Response(null, { status: 204, headers: corsHeaders }); }
  return null;
}

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.substring(7);
}

export async function getUserContext(req: Request): Promise<UserContext | null> {
  const token = extractBearerToken(req);
  if (!token) return null;

  const { createClient } = await loadSupabaseModule();
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, role, is_active')
    .eq('id', user.id)
    .single();
  if (!profile) return null;

  return { user: { id: user.id, email: user.email ?? null }, profile: { ...profile, email: profile.email ?? null } };
}

function hasRequiredRole(userRole: Role, allowedRoles: Role[]): boolean {
  const roleHierarchy: Record<Role, number> = { 'super_admin': 4, 'admin': 3, 'therapist': 2, 'client': 1 };
  const userLevel = roleHierarchy[userRole];
  return allowedRoles.some(role => userLevel >= roleHierarchy[role]);
}

export async function withAuth(
  req: Request,
  options: AuthMiddlewareOptions = {}
): Promise<{ userContext: UserContext | null; error: Response | null }> {
  const { allowedRoles = [], requireAuth = false, requireActiveUser = true } = options;
  const userContext = await getUserContext(req);

  if (requireAuth && !userContext) {
    return { userContext: null, error: new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }) };
  }
  if (userContext && requireActiveUser && !userContext.profile.is_active) {
    return { userContext: null, error: new Response(JSON.stringify({ error: 'User account is inactive' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }) };
  }
  if (allowedRoles.length > 0 && userContext && !hasRequiredRole(userContext.profile.role, allowedRoles)) {
    return { userContext, error: new Response(JSON.stringify({ error: 'Insufficient permissions', required_roles: allowedRoles, user_role: userContext.profile.role }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }) };
  }

  return { userContext, error: null };
}

export function createProtectedRoute(
  handler: (req: Request, userContext: UserContext) => Promise<Response>,
  options: AuthMiddlewareOptions = {}
) {
  return async (req: Request): Promise<Response> => {
    const corsResponse = handleCors(req);
    if (corsResponse) return corsResponse;

    const { userContext, error } = await withAuth(req, { requireAuth: true, ...options });
    if (error) return error;
    if (!userContext) return new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    try { return await handler(req, userContext); } catch {
      return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  };
}

export const RouteOptions = {
  public: {},
  authenticated: { requireAuth: true },
  client: { requireAuth: true, allowedRoles: ['client','therapist','admin','super_admin'] as Role[] },
  therapist: { requireAuth: true, allowedRoles: ['therapist','admin','super_admin'] as Role[] },
  admin: { requireAuth: true, allowedRoles: ['admin','super_admin'] as Role[] },
  superAdmin: { requireAuth: true, allowedRoles: ['super_admin'] as Role[] },
};

export function logApiAccess(method: string, path: string, userContext: UserContext | null, status: number) {
  const timestamp = new Date().toISOString();
  const userId = userContext?.user?.id ?? 'anonymous';
  const userRole = userContext?.profile?.role ?? 'none';
  console.log(`[${timestamp}] ${method} ${path} - User: ${userId} (${userRole}) - Status: ${status}`);
}


