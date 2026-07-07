import { describe, expect, it, vi } from 'vitest';

import {
  handleUnhandledMswRequest,
  shouldBypassUnhandledMswRequest,
} from '../mswUnhandledRequest';

describe('MSW unhandled request routing', () => {
  it('bypasses configured Supabase live requests when DB integration tests are enabled', () => {
    const request = new Request('https://db.example.supabase.co/auth/v1/admin/users', {
      method: 'POST',
    });

    expect(shouldBypassUnhandledMswRequest(request, {
      RUN_DB_IT: '1',
      SUPABASE_URL: 'https://db.example.supabase.co',
    })).toBe(true);
  });

  it('bypasses configured Supabase RPC and token requests for live DB integration tests', () => {
    const env = {
      RUN_DB_IT: '1',
      SUPABASE_URL: 'https://db.example.supabase.co',
    };

    expect(shouldBypassUnhandledMswRequest(
      new Request('https://db.example.supabase.co/rest/v1/rpc/assign_admin_role', {
        method: 'POST',
      }),
      env,
    )).toBe(true);
    expect(shouldBypassUnhandledMswRequest(
      new Request('https://db.example.supabase.co/auth/v1/token?grant_type=password', {
        method: 'POST',
      }),
      env,
    )).toBe(true);
  });

  it('keeps strict unhandled request errors for non-DB integration tests', () => {
    const request = new Request('https://db.example.supabase.co/auth/v1/admin/users', {
      method: 'POST',
    });

    expect(shouldBypassUnhandledMswRequest(request, {
      RUN_DB_IT: '0',
      SUPABASE_URL: 'https://db.example.supabase.co',
    })).toBe(false);
  });

  it('keeps strict unhandled request errors for unrelated hosts', () => {
    const request = new Request('https://api.example.com/auth/v1/admin/users', {
      method: 'POST',
    });

    expect(shouldBypassUnhandledMswRequest(request, {
      RUN_DB_IT: '1',
      SUPABASE_URL: 'https://db.example.supabase.co',
    })).toBe(false);
  });

  it('prints an MSW error for requests that are not explicitly bypassed', () => {
    const request = new Request('https://api.example.com/rest/v1/widgets');
    const print = {
      error: vi.fn(),
      warning: vi.fn(),
    };

    handleUnhandledMswRequest(request, print, {
      RUN_DB_IT: '1',
      SUPABASE_URL: 'https://db.example.supabase.co',
    });

    expect(print.error).toHaveBeenCalledTimes(1);
    expect(print.warning).not.toHaveBeenCalled();
  });
});
