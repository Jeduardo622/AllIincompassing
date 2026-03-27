import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubDenoEnv } from '../utils/stubDeno';

const envValues = new Map<string, string>([
  ['CORS_ALLOWED_ORIGINS', 'https://app.example.com,https://preview.example.com'],
  ['APP_ENV', 'production'],
]);

stubDenoEnv((key) => envValues.get(key) ?? '');

const createRequestClientMock = vi.fn();
const requireOrgMock = vi.fn();
const assertUserHasOrgRoleMock = vi.fn();
const orgScopedQueryMock = vi.fn();

async function loadProgramsModule() {
  vi.doMock('../../supabase/functions/_shared/database.ts', () => ({
    createRequestClient: createRequestClientMock,
  }));
  vi.doMock('../../supabase/functions/_shared/org.ts', () => ({
    requireOrg: requireOrgMock,
    assertUserHasOrgRole: assertUserHasOrgRoleMock,
    orgScopedQuery: orgScopedQueryMock,
  }));
  return import('../../supabase/functions/programs/index.ts');
}

function configureProgramsGetSuccessDb() {
  createRequestClientMock.mockReturnValue({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: 'therapist-1' } }, error: null })),
    },
  });
  requireOrgMock.mockResolvedValue('org-1');
  assertUserHasOrgRoleMock.mockImplementation(async (_db: unknown, _orgId: string, role: string) => role === 'therapist');
  orgScopedQueryMock.mockReturnValue({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        order: vi.fn(async () => ({ data: [{ id: 'program-1' }], error: null })),
      })),
    })),
  });
}

describe('programs route CORS contract', () => {
  beforeEach(() => {
    vi.resetModules();
    createRequestClientMock.mockReset();
    requireOrgMock.mockReset();
    assertUserHasOrgRoleMock.mockReset();
    orgScopedQueryMock.mockReset();
  });

  it('includes request-scoped CORS headers on allowed-origin GET success', async () => {
    configureProgramsGetSuccessDb();
    const module = await loadProgramsModule();

    const response = await module.handlePrograms(
      new Request('https://edge.example.com/functions/v1/programs?client_id=11111111-1111-4111-8111-111111111111', {
        method: 'GET',
        headers: {
          Origin: 'https://preview.example.com',
          Authorization: 'Bearer token',
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://preview.example.com');
    expect(response.headers.get('Vary')).toBe('Origin');
    expect(response.headers.get('Content-Type')).toContain('application/json');
  });

  it('uses current fallback-origin contract for disallowed-origin GET success', async () => {
    configureProgramsGetSuccessDb();
    const module = await loadProgramsModule();

    const response = await module.handlePrograms(
      new Request('https://edge.example.com/functions/v1/programs?client_id=11111111-1111-4111-8111-111111111111', {
        method: 'GET',
        headers: {
          Origin: 'https://evil.example.com',
          Authorization: 'Bearer token',
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');
    expect(response.headers.get('Vary')).toBe('Origin');
  });

  it('includes request-scoped CORS headers on handler-level auth failure', async () => {
    createRequestClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: null }, error: { message: 'invalid token' } })),
      },
    });
    requireOrgMock.mockResolvedValue('org-1');
    const module = await loadProgramsModule();

    const response = await module.handlePrograms(
      new Request('https://edge.example.com/functions/v1/programs?client_id=11111111-1111-4111-8111-111111111111', {
        method: 'GET',
        headers: {
          Origin: 'https://preview.example.com',
          Authorization: 'Bearer token',
        },
      }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://preview.example.com');
    expect(response.headers.get('Content-Type')).toContain('application/json');
  });

  it('keeps protected-route auth errors CORS-observable for browser callers', async () => {
    const module = await loadProgramsModule();

    const response = await module.default(
      new Request('https://edge.example.com/functions/v1/programs?client_id=11111111-1111-4111-8111-111111111111', {
        method: 'GET',
        headers: {
          Origin: 'https://preview.example.com',
        },
      }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://preview.example.com');
    expect(response.headers.get('Vary')).toBe('Origin');
  });

  it('keeps protected-route auth errors aligned to current fallback-origin contract for disallowed origins', async () => {
    const module = await loadProgramsModule();

    const response = await module.default(
      new Request('https://edge.example.com/functions/v1/programs?client_id=11111111-1111-4111-8111-111111111111', {
        method: 'GET',
        headers: {
          Origin: 'https://evil.example.com',
        },
      }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');
    expect(response.headers.get('Vary')).toBe('Origin');
  });

  it('keeps OPTIONS preflight behavior unchanged for programs route', async () => {
    const module = await loadProgramsModule();

    const response = await module.default(
      new Request('https://edge.example.com/functions/v1/programs?client_id=11111111-1111-4111-8111-111111111111', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://preview.example.com',
          'Access-Control-Request-Method': 'GET',
        },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://preview.example.com');
  });
});

describe('programs route org-scope deny matrix', () => {
  beforeEach(() => {
    vi.resetModules();
    createRequestClientMock.mockReset();
    requireOrgMock.mockReset();
    assertUserHasOrgRoleMock.mockReset();
    orgScopedQueryMock.mockReset();
  });

  const roleMatrix = [
    ['therapist'],
    ['admin'],
    ['super_admin'],
  ] as const;

  it.each(roleMatrix)('denies out-of-scope client_id on POST for %s role', async (activeRole) => {
    createRequestClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })),
      },
    });
    requireOrgMock.mockResolvedValue('org-1');
    assertUserHasOrgRoleMock.mockImplementation(async (_db: unknown, _orgId: string, role: string) => role === activeRole);
    orgScopedQueryMock.mockImplementation((_db: unknown, table: string) => {
      if (table !== 'clients') {
        throw new Error(`Unexpected table lookup: ${table}`);
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            limit: vi.fn(async () => ({ data: [], error: null })),
          })),
        })),
      };
    });
    const module = await loadProgramsModule();

    const response = await module.handlePrograms(
      new Request('https://edge.example.com/functions/v1/programs', {
        method: 'POST',
        headers: {
          Origin: 'https://preview.example.com',
          Authorization: 'Bearer token',
        },
        body: JSON.stringify({
          client_id: '11111111-1111-4111-8111-111111111111',
          name: 'Parity Program',
        }),
      }),
    );

    expect(response.status).toBe(403);
  });

  it.each(roleMatrix)('denies out-of-org program_id on PATCH for %s role', async (activeRole) => {
    createRequestClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })),
      },
    });
    requireOrgMock.mockResolvedValue('org-1');
    assertUserHasOrgRoleMock.mockImplementation(async (_db: unknown, _orgId: string, role: string) => role === activeRole);
    orgScopedQueryMock.mockImplementation((_db: unknown, table: string) => {
      if (table !== 'programs') {
        throw new Error(`Unexpected table lookup: ${table}`);
      }
      return {
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              limit: vi.fn(async () => ({ data: [], error: null })),
            })),
          })),
        })),
      };
    });
    const module = await loadProgramsModule();

    const response = await module.handlePrograms(
      new Request(
        'https://edge.example.com/functions/v1/programs?program_id=11111111-1111-4111-8111-111111111111',
        {
          method: 'PATCH',
          headers: {
            Origin: 'https://preview.example.com',
            Authorization: 'Bearer token',
          },
          body: JSON.stringify({ name: 'Updated name' }),
        },
      ),
    );

    expect(response.status).toBe(403);
  });
});
