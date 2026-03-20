import type { UserProfile } from './authContext';

export const STAFF_DASHBOARD_ROLES: ReadonlyArray<UserProfile['role']> = ['admin', 'super_admin'];

export const canAccessStaffDashboard = (role: UserProfile['role'] | null | undefined): boolean => {
  if (!role) {
    return false;
  }
  return STAFF_DASHBOARD_ROLES.includes(role);
};

