import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubDenoEnv } from '../utils/stubDeno';

const envValues = new Map<string, string>([
  ['CORS_ALLOWED_ORIGINS', 'https://app.example.com'],
  ['APP_ENV', 'production'],
]);

stubDenoEnv((key) => envValues.get(key) ?? '');

describe('auth middleware org-scoped admin role resolution', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('does not elevate org-scoped alias rows when organization context is missing', async () => {
    const module = await import('../../supabase/functions/_shared/auth-middleware.ts');

    expect(
      module.__TESTING__.resolveRoleFromRoleRows([
        { is_active: true, roles: { name: 'org_admin' } },
      ]),
    ).toBe('client');
    expect(
      module.__TESTING__.resolveRoleFromRoleRows([
        { is_active: true, roles: { name: 'org_super_admin' } },
      ]),
    ).toBe('client');
  });

  it('treats org_admin as admin-equivalent for the current organization when canonical admin is false', async () => {
    const module = await import('../../supabase/functions/_shared/auth-middleware.ts');
    const rpc = vi.fn(async (fn: string, payload?: Record<string, unknown>) => {
      if (fn === 'current_user_is_super_admin') {
        return { data: false, error: null };
      }
      if (fn === 'user_has_role_for_org' && payload?.role_name === 'org_super_admin') {
        return { data: false, error: null };
      }
      if (fn === 'user_has_role_for_org' && payload?.role_name === 'org_admin') {
        return { data: true, error: null };
      }
      if (fn === 'user_has_role_for_org') {
        return { data: false, error: null };
      }
      return { data: null, error: null };
    });

    const role = await module.__TESTING__.resolveRoleForOrganization(
      { rpc } as never,
      'org-1',
      [{ is_active: true, roles: { name: 'org_admin' } }],
    );

    expect(role).toBe('admin');
    expect(rpc).toHaveBeenCalledWith('user_has_role_for_org', {
      role_name: 'org_admin',
      target_organization_id: 'org-1',
    });
  });

  it('does not treat org_super_admin as global super_admin for admin route resolution', async () => {
    const module = await import('../../supabase/functions/_shared/auth-middleware.ts');
    const rpc = vi.fn(async (fn: string, payload?: Record<string, unknown>) => {
      if (fn === 'current_user_is_super_admin') {
        return { data: false, error: null };
      }
      if (fn === 'user_has_role_for_org' && payload?.role_name === 'org_super_admin') {
        return { data: true, error: null };
      }
      if (fn === 'user_has_role_for_org') {
        return { data: false, error: null };
      }
      return { data: null, error: null };
    });

    const role = await module.__TESTING__.resolveRoleForOrganization(
      { rpc } as never,
      'org-1',
      [{ is_active: true, roles: { name: 'org_super_admin' } }],
    );

    expect(role).toBe('admin');
  });

  it('fails closed to client when org-scoped admin alias checks do not pass for the current org', async () => {
    const module = await import('../../supabase/functions/_shared/auth-middleware.ts');
    const rpc = vi.fn(async (fn: string) => {
      if (fn === 'current_user_is_super_admin') {
        return { data: false, error: null };
      }
      if (fn === 'user_has_role_for_org') {
        return { data: false, error: null };
      }
      return { data: null, error: null };
    });

    const role = await module.__TESTING__.resolveRoleForOrganization(
      { rpc } as never,
      'org-1',
      [{ is_active: true, roles: { name: 'org_admin' } }],
    );

    expect(role).toBe('client');
  });
});
