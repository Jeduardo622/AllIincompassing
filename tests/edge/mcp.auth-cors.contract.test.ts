import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubDenoEnv } from '../utils/stubDeno';

const createClientMock = vi.fn();
const adminGetUserMock = vi.fn();
const rpcMock = vi.fn();

const baseEnv = new Map<string, string>([
  ['SUPABASE_URL', 'https://project.supabase.co'],
  ['SUPABASE_ANON_KEY', 'anon-key'],
  ['MCP_ALLOWED_ORIGINS', 'https://preview.example.com'],
]);

type LoadOptions = {
  envOverrides?: Record<string, string>;
  getUserResult?: {
    data: { user: { id: string } | null };
    error: { message: string } | null;
  };
};

async function loadMcpHandler(options: LoadOptions = {}) {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllGlobals();

  const envValues = new Map(baseEnv);
  for (const [key, value] of Object.entries(options.envOverrides ?? {})) {
    envValues.set(key, value);
  }

  let serveHandler: ((req: Request) => Promise<Response>) | null = null;

  stubDenoEnv((key) => envValues.get(key) ?? '');
  const globalWithDeno = globalThis as typeof globalThis & {
    Deno: {
      env: { get: (key: string) => string };
      serve: (handler: (req: Request) => Promise<Response>) => unknown;
    };
  };
  globalWithDeno.Deno.serve = vi.fn((handler: (req: Request) => Promise<Response>) => {
    serveHandler = handler;
    return {};
  });

  adminGetUserMock.mockResolvedValue(
    options.getUserResult ?? {
      data: { user: { id: 'user-1' } },
      error: null,
    },
  );

  createClientMock.mockImplementation(
    (_url: string, _key: string, config?: { global?: { headers?: Record<string, string> } }) => {
      if (config?.global?.headers?.Authorization) {
        return {
          rpc: rpcMock,
        };
      }

      return {
        auth: {
          getUser: adminGetUserMock,
        },
      };
    },
  );

  vi.doMock('https://esm.sh/@supabase/supabase-js@2', () => ({
    createClient: createClientMock,
  }));

  await import('../../supabase/functions/mcp/index.ts');

  if (!serveHandler) {
    throw new Error('Failed to capture MCP Deno.serve handler');
  }

  return serveHandler;
}

describe('mcp edge auth and cors contract', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps OPTIONS preflight CORS-observable for allowlisted origins', async () => {
    const handler = await loadMcpHandler();

    const response = await handler(
      new Request('https://edge.example.com/rpc', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://preview.example.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization,content-type',
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://preview.example.com');
    expect(response.headers.get('access-control-allow-methods')).toBe('GET,POST,OPTIONS');
    expect(response.headers.get('access-control-allow-headers')).toBe('authorization,content-type');
    expect(response.headers.get('vary')).toBe('origin');
  });

  it('fails closed with fallback CORS headers for disallowed origins', async () => {
    const handler = await loadMcpHandler();

    const response = await handler(
      new Request('https://edge.example.com/health', {
        method: 'GET',
        headers: {
          Origin: 'https://evil.example.com',
        },
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'origin_not_allowed' });
    expect(response.headers.get('access-control-allow-origin')).toBe('https://app.allincompassing.ai');
    expect(response.headers.get('vary')).toBe('origin');
  });

  it('returns 401 with CORS-visible JSON error when bearer token is missing', async () => {
    const handler = await loadMcpHandler();

    const response = await handler(
      new Request('https://edge.example.com/rpc', {
        method: 'POST',
        headers: {
          Origin: 'https://preview.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'get_client_metrics', args: {} }),
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
    expect(response.headers.get('access-control-allow-origin')).toBe('https://preview.example.com');
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(adminGetUserMock).not.toHaveBeenCalled();
  });

  it('returns 401 with CORS-visible JSON error when bearer token is invalid', async () => {
    const handler = await loadMcpHandler({
      getUserResult: {
        data: { user: null },
        error: { message: 'invalid token' },
      },
    });

    const response = await handler(
      new Request('https://edge.example.com/rpc', {
        method: 'POST',
        headers: {
          Origin: 'https://preview.example.com',
          Authorization: 'Bearer invalid-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'get_client_metrics', args: {} }),
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
    expect(response.headers.get('access-control-allow-origin')).toBe('https://preview.example.com');
    expect(adminGetUserMock).toHaveBeenCalledWith('invalid-token');
  });

  it('keeps GET /health unauthenticated and CORS-observable', async () => {
    const handler = await loadMcpHandler();

    const response = await handler(
      new Request('https://edge.example.com/health', {
        method: 'GET',
        headers: {
          Origin: 'https://preview.example.com',
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      project: 'https://project.supabase.co',
    });
    expect(response.headers.get('access-control-allow-origin')).toBe('https://preview.example.com');
    expect(adminGetUserMock).not.toHaveBeenCalled();
  });

  it('blocks non-allowlisted RPC names with 403 before request RPC execution', async () => {
    const handler = await loadMcpHandler();

    const response = await handler(
      new Request('https://edge.example.com/rpc', {
        method: 'POST',
        headers: {
          Origin: 'https://preview.example.com',
          Authorization: 'Bearer token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'dangerous_rpc', args: {} }),
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'rpc_not_allowed' });
    expect(response.headers.get('access-control-allow-origin')).toBe('https://preview.example.com');
    expect(rpcMock).not.toHaveBeenCalled();
    expect(createClientMock).toHaveBeenCalledTimes(1);
  });

  it('blocks generic table access with 403', async () => {
    const handler = await loadMcpHandler();

    const response = await handler(
      new Request('https://edge.example.com/table/profiles', {
        method: 'POST',
        headers: {
          Origin: 'https://preview.example.com',
          Authorization: 'Bearer token',
        },
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'table_access_blocked' });
    expect(response.headers.get('access-control-allow-origin')).toBe('https://preview.example.com');
  });
});
