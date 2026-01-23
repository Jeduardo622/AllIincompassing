import { describe, expect, it } from 'vitest';
import { buildAdminMetadata, resolveMissingAuthProfileRole } from '../scripts/sync-profile-only-admins';

describe('buildAdminMetadata', () => {
  it('sets admin metadata flags', () => {
    const result = buildAdminMetadata('admin', { foo: 'bar' });

    expect(result).toEqual({
      foo: 'bar',
      role: 'admin',
      signup_role: 'admin',
      is_admin: true,
      is_super_admin: false,
    });
  });

  it('sets super admin metadata flags', () => {
    const result = buildAdminMetadata('super_admin', null);

    expect(result).toEqual({
      role: 'super_admin',
      signup_role: 'super_admin',
      is_admin: true,
      is_super_admin: true,
    });
  });

  it('downgrades missing auth profiles to client', () => {
    expect(resolveMissingAuthProfileRole()).toEqual({
      role: 'client',
      reason: 'missing-auth-user-downgraded',
    });
  });
});
