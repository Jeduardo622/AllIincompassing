import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('edgeInvoke', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('attaches Authorization from session when not provided', async () => {
    vi.mock('../supabaseClient', () => ({
      supabase: {
        auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'session-token' } } }) },
        functions: { invoke: vi.fn().mockResolvedValue({ data: {}, error: null }) },
      },
    }));
    const { edgeInvoke } = await import('../edgeInvoke');
    const { data, error, status } = await edgeInvoke('test');
    expect(error).toBeNull();
    expect(status).toBe(200);
    expect(data).toEqual({});
  });

  it('returns status from error shape when present', async () => {
    vi.mock('../supabaseClient', () => ({
      supabase: {
        auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'session-token' } } }) },
        functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: Object.assign(new Error('Forbidden'), { status: 403 }) }) },
      },
    }));
    const { edgeInvoke } = await import('../edgeInvoke');
    const result = await edgeInvoke('test');
    expect(result.status).toBe(403);
    expect(result.error).toBeInstanceOf(Error);
  });
});


