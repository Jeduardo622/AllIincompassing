import { describe, expect, it } from 'vitest';

import {
  findGuardForPath,
  hasRoleAccess,
  listGuardedPaths,
  requiresPermission,
  routeGuards,
} from '../guards';

const expectedPaths = [
  '/',
  '/schedule',
  '/clients',
  '/clients/:clientId',
  '/clients/new',
  '/therapists',
  '/therapists/:therapistId',
  '/therapists/new',
  '/authorizations',
  '/billing',
  '/monitoring',
  '/reports',
  '/settings',
  '/super-admin/prompts',
] as const;

describe('route guard matrix', () => {
  it('route guard matrix covers expected restricted paths', () => {
    expect(listGuardedPaths()).toEqual(expectedPaths);
  });

  it('route guard matrix enumerates supabase policies for each path', () => {
    routeGuards.forEach((guard) => {
      expect(guard.supabasePolicies.length).toBeGreaterThan(0);
      guard.supabasePolicies.forEach((policy) => {
        expect(policy).toMatch(/:/);
      });
    });
  });
});

describe('route guard matchers', () => {
  it('route guard matcher resolves dynamic client detail paths', () => {
    const match = findGuardForPath('/clients/9fda133f-8a57-4ab9-a33e-958c1b2f1d3b');
    expect(match?.path).toBe('/clients/:clientId');
  });

  it('route guard matcher resolves therapist detail paths', () => {
    const match = findGuardForPath('/therapists/abc123');
    expect(match?.path).toBe('/therapists/:therapistId');
  });
});

describe('route guard access controls', () => {
  it('route guard enforces explicit permission requirements', () => {
    expect(requiresPermission('/clients', 'view_clients')).toBe(true);
    expect(requiresPermission('/clients', 'manage_admin_users')).toBe(false);
  });

  it('route guard enforces role hierarchy for therapist routes', () => {
    expect(hasRoleAccess('/therapists', 'admin')).toBe(true);
    expect(hasRoleAccess('/therapists', 'therapist')).toBe(false);
    expect(hasRoleAccess('/therapists/new', 'super_admin')).toBe(true);
  });

  it('route guard allows elevated roles to inherit lower privileges', () => {
    expect(hasRoleAccess('/clients', 'super_admin')).toBe(true);
    expect(hasRoleAccess('/clients', 'client')).toBe(false);
  });
});
