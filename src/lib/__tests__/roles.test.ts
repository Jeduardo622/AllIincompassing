import { describe, expect, it } from 'vitest';

import { normalizeRole, roleHasCapability, roleMeetsOrExceeds, rolesForCapability } from '../roles';

describe('role capability matrix', () => {
  it('keeps super-admin tooling exclusive to super_admin', () => {
    expect(rolesForCapability('accessSuperAdminTools')).toEqual(['super_admin']);
    expect(roleHasCapability('bcba', 'accessSuperAdminTools')).toBe(false);
    expect(roleMeetsOrExceeds('bcba', 'super_admin')).toBe(false);
    expect(roleMeetsOrExceeds('super_admin', 'bcba')).toBe(true);
  });

  it('defines BCBA as clinical and operational admin without super-admin bypass', () => {
    expect(roleHasCapability('bcba', 'manageProgramsGoals')).toBe(true);
    expect(roleHasCapability('bcba', 'manageStaff')).toBe(true);
    expect(roleHasCapability('bcba', 'manageAuthorizations')).toBe(true);
    expect(roleHasCapability('bcba', 'dataTaking')).toBe(true);
    expect(roleHasCapability('bcba', 'viewMonitoring')).toBe(false);
    expect(roleHasCapability('bcba', 'viewSettings')).toBe(false);
  });

  it('reserves hard-delete of goal targets for BCBA and super-admin', () => {
    expect(rolesForCapability('deleteGoalTargets')).toEqual(['bcba', 'super_admin']);
    expect(roleHasCapability('bcba', 'deleteGoalTargets')).toBe(true);
    expect(roleHasCapability('super_admin', 'deleteGoalTargets')).toBe(true);
    expect(roleHasCapability('midtier', 'deleteGoalTargets')).toBe(false);
    expect(roleHasCapability('admin', 'deleteGoalTargets')).toBe(false);
    expect(roleHasCapability('therapist', 'deleteGoalTargets')).toBe(false);
  });

  it('keeps admin_schedule and BT scoped to their exact capabilities', () => {
    expect(roleHasCapability('admin_schedule', 'manageClients')).toBe(true);
    expect(roleHasCapability('admin_schedule', 'manageProgramsGoals')).toBe(false);
    expect(roleHasCapability('admin_schedule', 'viewBilling')).toBe(false);
    expect(roleHasCapability('admin_schedule', 'dataTaking')).toBe(false);

    expect(roleHasCapability('bt', 'dataTaking')).toBe(true);
    expect(roleHasCapability('bt', 'viewClients')).toBe(true);
    expect(roleHasCapability('bt', 'viewFillDocs')).toBe(true);
    expect(roleHasCapability('bt', 'viewSchedule')).toBe(true);
    expect(roleHasCapability('bt', 'manageClients')).toBe(false);
    expect(roleHasCapability('bt', 'manageProgramsGoals')).toBe(false);
  });

  it('normalizes the legacy therapist role to Behavioral Therapist', () => {
    expect(normalizeRole('therapist')).toBe('bt');
    expect(normalizeRole('Therapist')).toBe('bt');
    expect(normalizeRole('bt')).toBe('bt');
  });
});
