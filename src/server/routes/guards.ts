export type AppRole = 'client' | 'therapist' | 'admin' | 'super_admin';

export type RouteGuardDefinition = {
  readonly path: string;
  readonly allowedRoles: readonly AppRole[];
  readonly requiredPermissions: readonly string[];
  readonly supabasePolicies: readonly string[];
};

type GuardWithMatcher = RouteGuardDefinition & { readonly matcher: RegExp };

const toMatcher = (path: string): RegExp => {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped.replace(/:[^/]+/g, '[^/]+');
  return new RegExp(`^${pattern}$`);
};

const createGuard = (definition: RouteGuardDefinition): GuardWithMatcher => ({
  ...definition,
  matcher: toMatcher(definition.path),
});

const guardDefinitions: readonly GuardWithMatcher[] = [
  createGuard({
    path: '/',
    allowedRoles: ['client', 'therapist', 'admin', 'super_admin'],
    requiredPermissions: [],
    supabasePolicies: ['public.sessions: sessions_scoped_access'],
  }),
  createGuard({
    path: '/schedule',
    allowedRoles: ['therapist', 'admin', 'super_admin'],
    requiredPermissions: [],
    supabasePolicies: ['public.sessions: sessions_scoped_access'],
  }),
  createGuard({
    path: '/clients',
    allowedRoles: ['therapist', 'admin', 'super_admin'],
    requiredPermissions: ['view_clients'],
    supabasePolicies: ['public.clients: role_scoped_select'],
  }),
  createGuard({
    path: '/clients/:clientId',
    allowedRoles: ['therapist', 'admin', 'super_admin'],
    requiredPermissions: ['view_clients'],
    supabasePolicies: [
      'public.clients: role_scoped_select',
      'public.sessions: sessions_scoped_access',
    ],
  }),
  createGuard({
    path: '/clients/new',
    allowedRoles: ['therapist', 'admin', 'super_admin'],
    requiredPermissions: [],
    supabasePolicies: ['app.set_client_archive_state: admin_super_admin_execute'],
  }),
  createGuard({
    path: '/therapists',
    allowedRoles: ['admin', 'super_admin'],
    requiredPermissions: [],
    supabasePolicies: ['public.therapists: role_scoped_select'],
  }),
  createGuard({
    path: '/therapists/:therapistId',
    allowedRoles: ['therapist', 'admin', 'super_admin'],
    requiredPermissions: [],
    supabasePolicies: ['public.therapists: role_scoped_select'],
  }),
  createGuard({
    path: '/therapists/new',
    allowedRoles: ['admin', 'super_admin'],
    requiredPermissions: [],
    supabasePolicies: ['public.therapists: role_scoped_select'],
  }),
  createGuard({
    path: '/authorizations',
    allowedRoles: ['therapist', 'admin', 'super_admin'],
    requiredPermissions: [],
    supabasePolicies: ['public.authorizations: authorizations_org_read'],
  }),
  createGuard({
    path: '/billing',
    allowedRoles: ['admin', 'super_admin'],
    requiredPermissions: [],
    supabasePolicies: ['public.billing_records: scoped_access'],
  }),
  createGuard({
    path: '/monitoring',
    allowedRoles: ['admin', 'super_admin'],
    requiredPermissions: [],
    supabasePolicies: ['app.get_session_metrics: admin_super_admin_execute'],
  }),
  createGuard({
    path: '/reports',
    allowedRoles: ['admin', 'super_admin'],
    requiredPermissions: [],
    supabasePolicies: ['supabase.functions.generate_report: admin_super_admin_execute'],
  }),
  createGuard({
    path: '/settings',
    allowedRoles: ['admin', 'super_admin'],
    requiredPermissions: [],
    supabasePolicies: [
      'supabase.functions.admin_users: admin_super_admin_execute',
      'public.profiles: role_scoped_update',
    ],
  }),
  createGuard({
    path: '/super-admin/prompts',
    allowedRoles: ['super_admin'],
    requiredPermissions: [],
    supabasePolicies: ['public.agent_prompt_tool_versions: admin_read'],
  }),
] as const;

export const routeGuards: readonly RouteGuardDefinition[] = guardDefinitions;

export const findGuardForPath = (pathname: string): RouteGuardDefinition | undefined => {
  return guardDefinitions.find((guard) => guard.matcher.test(pathname));
};

const roleHierarchy: Record<AppRole, number> = {
  client: 1,
  therapist: 2,
  admin: 3,
  super_admin: 4,
};

export const hasRoleAccess = (pathname: string, role: AppRole): boolean => {
  const guard = findGuardForPath(pathname);
  if (!guard) {
    return false;
  }
  if (guard.allowedRoles.includes(role)) {
    return true;
  }
  const roleRank = roleHierarchy[role];
  return guard.allowedRoles.some((allowed) => roleRank >= roleHierarchy[allowed]);
};

export const requiresPermission = (pathname: string, permission: string): boolean => {
  const guard = findGuardForPath(pathname);
  return guard?.requiredPermissions.includes(permission) ?? false;
};

export const listGuardedPaths = (): readonly string[] => guardDefinitions.map((guard) => guard.path);
