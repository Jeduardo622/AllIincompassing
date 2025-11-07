import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AdminRpcError,
  assignAdminRole,
  listAdminUsers,
  removeAdminUser,
  resetAdminPassword,
} from '../admin';

const ORIGINAL_SUPABASE_URL = process.env.SUPABASE_URL;
const ORIGINAL_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const mockFetch = () => vi.spyOn(globalThis, 'fetch');

describe('admin RPC helpers', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (typeof ORIGINAL_SUPABASE_URL === 'string') {
      process.env.SUPABASE_URL = ORIGINAL_SUPABASE_URL;
    } else {
      delete process.env.SUPABASE_URL;
    }

    if (typeof ORIGINAL_SERVICE_ROLE_KEY === 'string') {
      process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_SERVICE_ROLE_KEY;
    } else {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    }
  });

  it('lists admin users with sanitized payload and returns an array', async () => {
    const fetchSpy = mockFetch();
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify([{ id: '1', email: 'admin@example.com' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const result = await listAdminUsers({ organizationId: ' org-123 ' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://example.supabase.co/rest/v1/rpc/get_admin_users');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      apikey: 'service-role',
      Authorization: 'Bearer service-role',
    });
    expect(init?.body).toBe(JSON.stringify({ organization_id: 'org-123' }));
    expect(result).toEqual([{ id: '1', email: 'admin@example.com' }]);
  });

  it('allows super admins to omit the organization filter', async () => {
    const fetchSpy = mockFetch();
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify([{ id: '2', email: 'super@example.com' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const result = await listAdminUsers({ organizationId: undefined });

    const [, init] = fetchSpy.mock.calls[0];
    expect(init?.body).toBe(JSON.stringify({ organization_id: null }));
    expect(result).toEqual([{ id: '2', email: 'super@example.com' }]);
  });

  it('falls back to empty array when RPC returns null', async () => {
    const fetchSpy = mockFetch();
    fetchSpy.mockResolvedValue(
      new Response('null', { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    const result = await listAdminUsers({ organizationId: 'org-123' });

    expect(result).toEqual([]);
  });

  it('assigns admin role with lowercase email and trimmed reason', async () => {
    const fetchSpy = mockFetch();
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));

    await assignAdminRole({
      userEmail: ' ADMIN@Example.com ',
      organizationId: 'org-456',
      reason: '  escalation  ',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    expect(init?.body).toBe(JSON.stringify({
      user_email: 'admin@example.com',
      organization_id: 'org-456',
      reason: 'escalation',
    }));
  });

  it('removes admin users and keeps metadata when provided', async () => {
    const fetchSpy = mockFetch();
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));

    await removeAdminUser({
      targetUserId: ' user-789 ',
      metadata: { actor: 'auditor' },
    });

    const [, init] = fetchSpy.mock.calls[0];
    expect(init?.body).toBe(JSON.stringify({
      operation: 'remove',
      target_user_id: 'user-789',
      metadata: { actor: 'auditor' },
    }));
  });

  it('falls back to admin_reset_user_password when reset_user_password is missing', async () => {
    const fetchSpy = mockFetch();
    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'not found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await resetAdminPassword({
      userEmail: 'user@example.com',
      newPassword: 'Secret123!',
      createIfNotExists: true,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toBe('https://example.supabase.co/rest/v1/rpc/reset_user_password');
    expect(fetchSpy.mock.calls[1][0]).toBe('https://example.supabase.co/rest/v1/rpc/admin_reset_user_password');
    const secondBody = (fetchSpy.mock.calls[1][1]?.body ?? '') as string;
    expect(secondBody).toBe(JSON.stringify({
      user_email: 'user@example.com',
      new_password: 'Secret123!',
      create_if_not_exists: true,
    }));
  });

  it('wraps RPC errors with AdminRpcError metadata', async () => {
    const fetchSpy = mockFetch();
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ message: 'Forbidden', code: '42501', details: { scope: 'org' } }), {
        status: 403,
        headers: { 'content-type': 'application/json', 'x-request-id': 'abc-123' },
      }),
    );

    await expect(() => assignAdminRole({
      userEmail: 'admin@example.com',
      organizationId: 'org-1',
    })).rejects.toMatchObject<Partial<AdminRpcError>>({
      name: 'AdminRpcError',
      status: 403,
      code: '42501',
      requestId: 'abc-123',
    });
  });
});
