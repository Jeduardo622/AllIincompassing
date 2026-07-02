import type { UserProfile } from './authContext';
import { roleHasCapability } from './roles';

export const STAFF_DASHBOARD_ROLES: ReadonlyArray<UserProfile['role']> = [
  'admin_schedule',
  'admin',
  'bcba',
  'super_admin',
];

export const canAccessStaffDashboard = (role: UserProfile['role'] | null | undefined): boolean => {
  if (!role) {
    return false;
  }
  return roleHasCapability(role, 'staffDashboard');
};

