import type { UserProfile } from './authContext';

export const DASHBOARD_ROUTE_ROLES: ReadonlyArray<UserProfile['role']> = [
  'admin',
  'bcba',
  'super_admin',
];

export const canAccessDashboardRoute = (role: UserProfile['role'] | null | undefined): boolean => {
  if (!role) {
    return false;
  }
  return DASHBOARD_ROUTE_ROLES.includes(role);
};

