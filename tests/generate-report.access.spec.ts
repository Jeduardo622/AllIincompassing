import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../src/test/setup';
import { stubDenoEnv } from './utils/stubDeno';

const envValues = new Map<string, string>([
  ['SUPABASE_URL', 'http://localhost'],
  ['SUPABASE_SERVICE_ROLE_KEY', 'service-role-key'],
  ['SUPABASE_ANON_KEY', 'anon-key'],
]);

type TestRole = 'admin' | 'super_admin' | 'therapist' | 'client';

interface TestUser {
  id: string;
  email: string;
}

interface TestProfile extends TestUser {
  role: TestRole;
  is_active: boolean;
}

interface TestUserContext {
  user: TestUser;
  profile: TestProfile;
}

stubDenoEnv((key) => envValues.get(key) ?? '');

const logApiAccess = vi.fn();
const userContexts = new Map<string, TestUserContext>();
const recordedClientQueries: URL[] = [];
const recordedSessionQueries: URL[] = [];
let roleResponse: string[] = [];

const clientsData = [
  {
    id: 'client-1',
    full_name: 'Alpha Client',
    is_active: true,
    created_at: '2025-06-01T00:00:00Z',
    allowedTherapists: ['therapist-1'],
  },
  {
    id: 'client-2',
    full_name: 'Beta Client',
    is_active: false,
    created_at: '2025-06-05T00:00:00Z',
    allowedTherapists: ['therapist-2'],
  },
];

const sessionsData = [
  {
    id: 'session-1',
    therapist_id: 'therapist-1',
    client_id: 'client-1',
    start_time: '2025-06-02T15:00:00Z',
    end_time: '2025-06-02T16:00:00Z',
    status: 'completed',
  },
  {
    id: 'session-2',
    therapist_id: 'therapist-2',
    client_id: 'client-2',
    start_time: '2025-06-03T15:00:00Z',
    end_time: '2025-06-03T16:00:00Z',
    status: 'completed',
  },
];

const ORG_A_PLACEHOLDER_ID = 'org-a-placeholder-id';
const ORG_B_PLACEHOLDER_ID = 'org-b-placeholder-id';

const therapistsData = [
  {
    id: 'therapist-1',
    organization_id: ORG_A_PLACEHOLDER_ID,
    full_name: 'Therapist One',
  },
  {
    id: 'therapist-2',
    organization_id: ORG_A_PLACEHOLDER_ID,
    full_name: 'Therapist Two',
  },
];

function parseFilterValues(values: string[]): string[] {
  const parsed: string[] = [];
  for (const value of values) {
    if (!value) {
      continue;
    }
    if (value.startsWith('eq.')) {
      parsed.push(value.slice(3));
      continue;
    }
    if (value.startsWith('in.(') && value.endsWith(')')) {
      parsed.push(...value.slice(4, -1).split(',').filter(Boolean));
    }
  }
  return parsed;
}

function getRangeBounds(values: string[]): { gte?: string; lte?: string } {
  const bounds: { gte?: string; lte?: string } = {};
  for (const value of values) {
    if (!value) {
      continue;
    }
    if (value.startsWith('gte.')) {
      bounds.gte = value.slice(4);
    } else if (value.startsWith('lte.')) {
      bounds.lte = value.slice(4);
    }
  }
  return bounds;
}

vi.mock('../supabase/functions/_shared/auth-middleware.ts', () => ({
  corsHeaders: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Client-Info, apikey',
    'Access-Control-Max-Age': '86400',
  },
  logApiAccess,
  RouteOptions: {
    therapist: {},
  },
  createProtectedRoute: (handler: (req: Request, userContext: TestUserContext) => Promise<Response>) => {
    return async (req: Request) => {
      const contextKey = req.headers.get('x-test-user') ?? 'default';
      const context = userContexts.get(contextKey);
      if (!context) {
        return new Response(
          JSON.stringify({ error: 'Authentication required' }),
          {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
      return handler(req, context);
    };
  },
}));

vi.mock('../supabase/functions/_shared/database.ts', () => {
  const baseUrl = 'http://localhost';

type QueryFilter = { column: string; operator: 'eq' | 'gte' | 'lte' | 'in'; value: string };
type QueryResponse = { data: unknown | unknown[] | null; error: { message: string } | null };

interface MockQueryBuilder extends PromiseLike<QueryResponse> {
  select(value: string): MockQueryBuilder;
  eq(column: string, value: string): MockQueryBuilder;
  gte(column: string, value: string): MockQueryBuilder;
  lte(column: string, value: string): MockQueryBuilder;
  in(column: string, values: string[] | string): MockQueryBuilder;
  returns(): MockQueryBuilder;
  order(): MockQueryBuilder;
  maybeSingle(): MockQueryBuilder;
}

  const createQuery = (table: string): MockQueryBuilder => {
    const filters: QueryFilter[] = [];
    let selection = '*';
    let singleResult = false;

    const builder: MockQueryBuilder = {
      select(value: string) {
        selection = value;
        return builder;
      },
      eq(column: string, value: string) {
        filters.push({ column, operator: 'eq', value });
        return builder;
      },
      gte(column: string, value: string) {
        filters.push({ column, operator: 'gte', value });
        return builder;
      },
      lte(column: string, value: string) {
        filters.push({ column, operator: 'lte', value });
        return builder;
      },
      in(column: string, values: string[] | string) {
        const list = Array.isArray(values) ? values : [values];
        filters.push({ column, operator: 'in', value: `(${list.join(',')})` });
        return builder;
      },
      returns() {
        return builder;
      },
      order() {
        return builder;
      },
      maybeSingle() {
        singleResult = true;
        return builder;
      },
      then<TResult1 = QueryResponse, TResult2 = never>(
        onFulfilled?: (result: QueryResponse) => TResult1 | PromiseLike<TResult1>,
        onRejected?: (error: unknown) => TResult2 | PromiseLike<TResult2>,
      ) {
        const promise = (async () => {
          const url = new URL(`${baseUrl}/rest/v1/${table}`);
          if (selection) {
            url.searchParams.set('select', selection);
          }
          for (const filter of filters) {
            const value = filter.operator === 'in'
              ? `in.${filter.value}`
              : `${filter.operator}.${filter.value}`;
            url.searchParams.append(filter.column, value);
          }
          const response = await fetch(url.toString(), { method: 'GET' });
          const payload = response.status === 204 ? null : await response.json();
          if (!response.ok) {
            return { data: null, error: { message: response.statusText } } satisfies QueryResponse;
          }
          const rows = (payload ?? []) as unknown[];
          if (singleResult) {
            singleResult = false;
            const first = Array.isArray(rows) ? rows.at(0) ?? null : null;
            return { data: first, error: null } satisfies QueryResponse;
          }
          return { data: rows, error: null } satisfies QueryResponse;
        })();

        return promise.then(onFulfilled, onRejected);
      },
    };

    return builder;
  };

  const createClient = () => ({
    from(table: string) {
      return createQuery(table);
    },
    rpc(functionName: string, params?: Record<string, unknown>) {
      return (async () => {
        const response = await fetch(`${baseUrl}/rest/v1/rpc/${functionName}`, {
          method: 'POST',
          headers: params ? { 'Content-Type': 'application/json' } : undefined,
          body: params ? JSON.stringify(params) : undefined,
        });
        const payload = response.status === 204 ? null : await response.json();
        if (!response.ok) {
          return { data: null, error: { message: response.statusText } };
        }
        return { data: payload?.data ?? payload, error: null };
      })();
    },
  });

  return {
    supabaseAdmin: createClient(),
    createRequestClient: () => createClient(),
  };
});

// Reuse the shared MSW server configured in src/test/setup.ts so that we
// respect the global onUnhandledRequest enforcement while layering
// generate-report specific handlers for each test run.
function registerAccessHandlers() {
  server.use(
    http.post('http://localhost/rest/v1/rpc/get_user_roles', () => {
      return HttpResponse.json({ data: [{ roles: roleResponse }] });
    }),
    http.get('http://localhost/rest/v1/user_therapist_links', ({ request }) => {
      const url = new URL(request.url);
      const users = parseFilterValues(url.searchParams.getAll('user_id'));
      if (users.includes('therapist-user-1')) {
        return HttpResponse.json([{ therapist_id: 'therapist-1' }]);
      }
      return HttpResponse.json([]);
    }),
    http.get('http://localhost/rest/v1/clients', ({ request }) => {
      const url = new URL(request.url);
      recordedClientQueries.push(url);

      const therapistFilters = parseFilterValues(url.searchParams.getAll('therapist_sessions.therapist_id'));
      const clientIdFilters = parseFilterValues(url.searchParams.getAll('id'));

      let filteredClients = clientsData;

      if (therapistFilters.length > 0) {
        filteredClients = filteredClients.filter(client =>
          therapistFilters.some(id => client.allowedTherapists.includes(id)),
        );

        return HttpResponse.json(filteredClients.map(client => ({
          id: client.id,
          full_name: client.full_name,
          is_active: client.is_active,
          created_at: client.created_at,
          therapist_sessions: client.allowedTherapists
            .filter(id => therapistFilters.includes(id))
            .map(id => ({ therapist_id: id })),
        })));
      }

      if (clientIdFilters.length > 0) {
        filteredClients = filteredClients.filter(client => clientIdFilters.includes(client.id));
      }

      return HttpResponse.json(filteredClients.map(client => ({
        id: client.id,
        full_name: client.full_name,
        is_active: client.is_active,
        created_at: client.created_at,
      })));
    }),
    http.get('http://localhost/rest/v1/sessions', ({ request }) => {
      const url = new URL(request.url);
      recordedSessionQueries.push(url);

      const therapistFilters = parseFilterValues(url.searchParams.getAll('therapist_id'));
      const clientFilters = parseFilterValues(url.searchParams.getAll('client_id'));
      const statusFilters = parseFilterValues(url.searchParams.getAll('status'));
      const timeBounds = getRangeBounds(url.searchParams.getAll('start_time'));

      let filteredSessions = sessionsData;

      if (therapistFilters.length > 0) {
        filteredSessions = filteredSessions.filter(session => therapistFilters.includes(session.therapist_id));
      }

      if (clientFilters.length > 0) {
        filteredSessions = filteredSessions.filter(session => clientFilters.includes(session.client_id));
      }

      if (statusFilters.length > 0) {
        filteredSessions = filteredSessions.filter(session => statusFilters.includes(session.status));
      }

      if (timeBounds.gte) {
        filteredSessions = filteredSessions.filter(session => session.start_time >= timeBounds.gte!);
      }

      if (timeBounds.lte) {
        filteredSessions = filteredSessions.filter(session => session.start_time <= timeBounds.lte!);
      }

      return HttpResponse.json(filteredSessions.map(session => ({
        ...session,
        therapists: { id: session.therapist_id, full_name: session.therapist_id === 'therapist-1' ? 'Therapist One' : 'Therapist Two' },
        clients: { id: session.client_id, full_name: session.client_id === 'client-1' ? 'Alpha Client' : 'Beta Client' },
      })));
    }),
    http.get('http://localhost/rest/v1/therapists', ({ request }) => {
      const url = new URL(request.url);
      const orgFilters = parseFilterValues(url.searchParams.getAll('organization_id'));
      const idFilters = parseFilterValues(url.searchParams.getAll('id'));

      let filtered = therapistsData;
      if (orgFilters.length > 0) {
        filtered = filtered.filter(record => orgFilters.includes(record.organization_id));
      }

      if (idFilters.length > 0) {
        filtered = filtered.filter(record => idFilters.includes(record.id));
      }

      return HttpResponse.json(filtered);
    }),
  );
}

beforeEach(() => {
  registerAccessHandlers();
});

afterEach(() => {
  recordedClientQueries.length = 0;
  recordedSessionQueries.length = 0;
  userContexts.clear();
  roleResponse = [];
  logApiAccess.mockClear();
});

function setUserContext(key: string, context: TestUserContext) {
  userContexts.set(key, context);
}

function buildRequest(body: Record<string, unknown>, userKey: string) {
  return new Request('http://localhost/functions/v1/generate-report', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-test-user': userKey,
    },
    body: JSON.stringify(body),
  });
}

describe('generate-report access control', () => {
  it('returns clients joined through sessions for therapist scope', async () => {
    setUserContext('therapist', {
      user: { id: 'therapist-user-1', email: 'therapist@example.com' },
      profile: { id: 'therapist-profile-1', email: 'therapist@example.com', role: 'therapist', is_active: true },
    });

    const handler = (await import('../supabase/functions/generate-report/index.ts')).default;
    const response = await handler(buildRequest({
      reportType: 'clients',
      startDate: '2025-06-01T00:00:00Z',
      endDate: '2025-06-30T23:59:59Z',
    }, 'therapist'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.clients).toHaveLength(1);
    expect(body.data.clients[0].id).toBe('client-1');

    expect(recordedClientQueries).toHaveLength(1);
    const selectParam = recordedClientQueries[0]?.searchParams.get('select') ?? '';
    expect(selectParam).toContain('sessions!inner');
    const therapistFilter = recordedClientQueries[0]?.searchParams.get('therapist_sessions.therapist_id') ?? '';
    expect(therapistFilter).toContain('therapist-1');
  });

  it('blocks therapists from requesting another therapist scope', async () => {
    setUserContext('therapist', {
      user: { id: 'therapist-user-1', email: 'therapist@example.com' },
      profile: { id: 'therapist-profile-1', email: 'therapist@example.com', role: 'therapist', is_active: true },
    });

    const handler = (await import('../supabase/functions/generate-report/index.ts')).default;
    const response = await handler(buildRequest({
      reportType: 'clients',
      startDate: '2025-06-01T00:00:00Z',
      endDate: '2025-06-30T23:59:59Z',
      therapistId: 'therapist-2',
    }, 'therapist'));
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toMatch(/therapist scope/i);
    expect(recordedClientQueries).toHaveLength(0);
  });

  it('denies non-therapist roles from generating reports', async () => {
    setUserContext('client', {
      user: { id: 'client-user-1', email: 'client@example.com' },
      profile: { id: 'client-user-1', email: 'client@example.com', role: 'client', is_active: true },
    });

    const handler = (await import('../supabase/functions/generate-report/index.ts')).default;
    const response = await handler(buildRequest({
      reportType: 'clients',
      startDate: '2025-06-01T00:00:00Z',
      endDate: '2025-06-30T23:59:59Z',
    }, 'client'));

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toMatch(/not permitted/i);
  });

  it('allows admins to access clients without therapist scoping', async () => {
    setUserContext('admin', {
      user: { id: 'admin-user-1', email: 'admin@example.com' },
      profile: { id: 'admin-profile-1', email: 'admin@example.com', role: 'admin', is_active: true },
    });
    roleResponse = ['admin'];

    const handler = (await import('../supabase/functions/generate-report/index.ts')).default;
    const response = await handler(buildRequest({
      reportType: 'clients',
      startDate: '2025-06-01T00:00:00Z',
      endDate: '2025-06-30T23:59:59Z',
    }, 'admin'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.clients).toHaveLength(2);
    expect(recordedClientQueries).toHaveLength(1);
    const therapistFilter = recordedClientQueries[0]?.searchParams.get('therapist_sessions.therapist_id') ?? '';
    expect(therapistFilter).toBe('');
  });

  it('allows admins to filter session reports by therapist ID', async () => {
    setUserContext('admin', {
      user: { id: 'admin-user-1', email: 'admin@example.com' },
      profile: { id: 'admin-profile-1', email: 'admin@example.com', role: 'admin', is_active: true },
    });
    roleResponse = ['admin'];

    const handler = (await import('../supabase/functions/generate-report/index.ts')).default;
    const response = await handler(buildRequest({
      reportType: 'sessions',
      startDate: '2025-06-01T00:00:00Z',
      endDate: '2025-06-30T23:59:59Z',
      therapistId: 'therapist-2',
    }, 'admin'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.sessions).toHaveLength(1);
    expect(body.data.sessions[0].therapist_id).toBe('therapist-2');
    expect(recordedSessionQueries).toHaveLength(1);
    const therapistFilters = recordedSessionQueries[0]?.searchParams.getAll('therapist_id') ?? [];
    expect(therapistFilters.join(',')).toContain('eq.therapist-2');
  });

  it('scopes therapist session reports to assigned therapists', async () => {
    setUserContext('therapist', {
      user: { id: 'therapist-user-1', email: 'therapist@example.com' },
      profile: { id: 'therapist-profile-1', email: 'therapist@example.com', role: 'therapist', is_active: true },
    });

    const handler = (await import('../supabase/functions/generate-report/index.ts')).default;
    const response = await handler(buildRequest({
      reportType: 'sessions',
      startDate: '2025-06-01T00:00:00Z',
      endDate: '2025-06-30T23:59:59Z',
    }, 'therapist'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.sessions).toHaveLength(1);
    expect(body.data.sessions[0].therapist_id).toBe('therapist-1');

    expect(recordedSessionQueries).toHaveLength(1);
    const therapistParamValues = recordedSessionQueries[0]?.searchParams.getAll('therapist_id') ?? [];
    expect(therapistParamValues.join(',')).toContain('therapist-1');
  });
});
