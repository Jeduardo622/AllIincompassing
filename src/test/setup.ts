import { vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import '@testing-library/jest-dom';
import { installConsoleGuard } from './utils/consoleGuard';
import { setRuntimeSupabaseConfig } from '../lib/runtimeConfig';

const isTestRuntime =
  process.env.VITEST === 'true' ||
  process.env.VITEST === '1' ||
  Boolean(process.env.VITEST_POOL_ID);

if (!isTestRuntime) {
  throw new Error('Test setup loaded outside the test runtime.');
}

if (typeof globalThis.PromiseRejectionEvent !== 'function') {
  class PromiseRejectionEventPolyfill extends Event {
    readonly promise: Promise<unknown>;
    readonly reason: unknown;

    constructor(type: string, init: PromiseRejectionEventInit) {
      super(type, init);
      this.promise = init.promise;
      this.reason = init.reason;
    }
  }

  Object.defineProperty(globalThis, 'PromiseRejectionEvent', {
    value: PromiseRejectionEventPolyfill,
    configurable: true,
    writable: true,
  });

  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'PromiseRejectionEvent', {
      value: PromiseRejectionEventPolyfill,
      configurable: true,
      writable: true,
    });
  }
}

const originalDispatchEvent =
  typeof globalThis.dispatchEvent === 'function'
    ? globalThis.dispatchEvent.bind(globalThis)
    : undefined;

if (originalDispatchEvent) {
  globalThis.dispatchEvent = ((event: Event) => {
    if (event instanceof Event) {
      return originalDispatchEvent(event);
    }

    const fallbackType =
      typeof (event as { type?: string }).type === 'string'
        ? (event as { type: string }).type
        : 'unhandledrejection';

    const fallback = new Event(fallbackType);
    if (event && typeof event === 'object') {
      for (const key in event as Record<string, unknown>) {
        try {
          (fallback as Record<string, unknown>)[key] = (event as Record<string, unknown>)[key];
        } catch {
          // Ignore read-only assignments
        }
      }
    }

    return originalDispatchEvent(fallback);
  }) as typeof globalThis.dispatchEvent;
}

process.on('unhandledRejection', (reason) => {
  throw reason instanceof Error ? reason : new Error(String(reason));
});

class TestWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  readonly protocol: string;
  readyState = TestWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(url: string, protocols?: string | string[]) {
    super();
    this.url = url;
    this.protocol = Array.isArray(protocols) ? protocols[0] ?? '' : protocols ?? '';

    queueMicrotask(() => {
      this.readyState = TestWebSocket.OPEN;
      const openEvent = new Event('open');
      this.dispatchEvent(openEvent);
    });
  }

  send(_data: unknown): void {
    // No-op stub
  }

  close(): void {
    if (this.readyState === TestWebSocket.CLOSED) return;
    this.readyState = TestWebSocket.CLOSING;
    const closeEvent = new Event('close') as CloseEvent;
    this.dispatchEvent(closeEvent);
    this.readyState = TestWebSocket.CLOSED;
  }

  override dispatchEvent(event: Event): boolean {
    const handled = super.dispatchEvent(event);
    const handler = (this as unknown as Record<string, ((ev: Event) => void) | null>)[`on${event.type}`];
    handler?.call(this, event);
    return handled;
  }
}

Object.defineProperty(globalThis, 'WebSocket', {
  configurable: true,
  writable: true,
  value: TestWebSocket,
});

if (!process.env.RUN_CLIENT_DOMAIN_TESTS) {
  process.env.RUN_CLIENT_DOMAIN_TESTS = 'true';
}

if (!process.env.DEFAULT_ORGANIZATION_ID) {
  process.env.DEFAULT_ORGANIZATION_ID = '5238e88b-6198-4862-80a2-dbe15bbeabdd';
}

const ORG_A_TEST_TOKEN = 'test-org-a-jwt-placeholder';
const ORG_B_TEST_TOKEN = 'test-org-b-jwt-placeholder';
const SUPER_ADMIN_TEST_TOKEN = 'test-super-admin-jwt-placeholder';
const ORG_A_PLACEHOLDER_ID = 'org-a-placeholder-id';
const ORG_B_PLACEHOLDER_ID = 'org-b-placeholder-id';
const ARCHIVE_TIMESTAMP = '2025-03-18T09:00:00Z';

const DEFAULT_THERAPIST_ID_ORG_A = 'therapist-1';
const DEFAULT_THERAPIST_ID_ORG_B = 'therapist-2';

if (!process.env.TEST_THERAPIST_ID_ORG_A) {
  process.env.TEST_THERAPIST_ID_ORG_A = DEFAULT_THERAPIST_ID_ORG_A;
}

if (!process.env.TEST_THERAPIST_ID_ORG_B) {
  process.env.TEST_THERAPIST_ID_ORG_B = DEFAULT_THERAPIST_ID_ORG_B;
}

if (!process.env.TEST_JWT_ORG_A) {
  process.env.TEST_JWT_ORG_A = ORG_A_TEST_TOKEN;
}

if (!process.env.TEST_JWT_ORG_B) {
  process.env.TEST_JWT_ORG_B = ORG_B_TEST_TOKEN;
}

if (!process.env.TEST_JWT_SUPER_ADMIN) {
  process.env.TEST_JWT_SUPER_ADMIN = SUPER_ADMIN_TEST_TOKEN;
}

if (!process.env.TEST_CLIENT_ID_ORG_A) {
  process.env.TEST_CLIENT_ID_ORG_A = 'client-1';
}

if (!process.env.TEST_CLIENT_ID_ORG_B) {
  process.env.TEST_CLIENT_ID_ORG_B = 'client-2';
}

if (!process.env.TEST_JWT_THERAPIST_ORG_A) {
  process.env.TEST_JWT_THERAPIST_ORG_A = process.env.TEST_THERAPIST_ID_ORG_A;
}

if (!process.env.TEST_JWT_THERAPIST_ORG_B) {
  process.env.TEST_JWT_THERAPIST_ORG_B = process.env.TEST_THERAPIST_ID_ORG_B;
}

const THERAPIST_ORG_A_TEST_TOKEN = process.env.TEST_JWT_THERAPIST_ORG_A!;
const THERAPIST_ORG_B_TEST_TOKEN = process.env.TEST_JWT_THERAPIST_ORG_B!;

type TherapistTokenContext = {
  token: string;
  therapistId: string;
  organizationId: string;
};

const therapistTokenContexts: TherapistTokenContext[] = [
  {
    token: THERAPIST_ORG_A_TEST_TOKEN,
    therapistId: process.env.TEST_THERAPIST_ID_ORG_A!,
    organizationId: ORG_A_PLACEHOLDER_ID,
  },
  {
    token: THERAPIST_ORG_B_TEST_TOKEN,
    therapistId: process.env.TEST_THERAPIST_ID_ORG_B!,
    organizationId: ORG_B_PLACEHOLDER_ID,
  },
];

const resolveTherapistContextForToken = (token: string): TherapistTokenContext | null => (
  therapistTokenContexts.find(context => context.token === token) ?? null
);

const resolveTherapistContextForId = (therapistId: string): TherapistTokenContext | null => (
  therapistTokenContexts.find(context => context.therapistId === therapistId) ?? null
);

const isOrgAToken = (token: string): boolean => (
  token === ORG_A_TEST_TOKEN
  || token === SUPER_ADMIN_TEST_TOKEN
  || token === THERAPIST_ORG_A_TEST_TOKEN
);

const isOrgBToken = (token: string): boolean => (
  token === ORG_B_TEST_TOKEN
  || token === THERAPIST_ORG_B_TEST_TOKEN
);

type TokenRole = 'admin' | 'super_admin' | 'therapist';

const resolveRoleForToken = (token: string): TokenRole | null => {
  if (token === SUPER_ADMIN_TEST_TOKEN) {
    return 'super_admin';
  }
  if (token === ORG_A_TEST_TOKEN || token === ORG_B_TEST_TOKEN) {
    return 'admin';
  }
  if (resolveTherapistContextForToken(token)) {
    return 'therapist';
  }
  return null;
};

const archiveState = {
  client: {
    id: 'client-1',
    organizationId: ORG_A_PLACEHOLDER_ID,
    deletedAt: null as string | null,
  },
  therapist: {
    id: 'therapist-1',
    organizationId: ORG_A_PLACEHOLDER_ID,
    deletedAt: null as string | null,
  },
};

const globalWithDeno = globalThis as typeof globalThis & { Deno?: { env: { get: (key: string) => string } } };
if (!globalWithDeno.Deno) {
  globalWithDeno.Deno = {
    env: {
      get(key: string) {
        return process.env[key] ?? '';
      },
    },
  };
}

import { setupServer } from 'msw/node';
import { graphql, http } from 'msw';
import type { Database } from '../lib/generated/database.types';

if (typeof globalWithDeno.Deno.serve !== 'function') {
  globalWithDeno.Deno.serve = () => undefined;
}

const resolveOrgIdForToken = (token: string): string | null => {
  if (!token) {
    return ORG_A_PLACEHOLDER_ID;
  }
  if (token === ORG_A_TEST_TOKEN || token === SUPER_ADMIN_TEST_TOKEN) {
    return ORG_A_PLACEHOLDER_ID;
  }
  if (token === ORG_B_TEST_TOKEN) {
    return ORG_B_PLACEHOLDER_ID;
  }

  const therapistContext = resolveTherapistContextForToken(token);
  if (therapistContext) {
    return therapistContext.organizationId;
  }

  // Default to org A when tests do not propagate a token through fetch.
  return ORG_A_PLACEHOLDER_ID;
};

const clientIdsByOrg: Record<string, string[]> = {
  [ORG_A_PLACEHOLDER_ID]: [process.env.TEST_CLIENT_ID_ORG_A ?? 'client-1'],
  [ORG_B_PLACEHOLDER_ID]: [process.env.TEST_CLIENT_ID_ORG_B ?? 'client-2'],
};

type PostgrestResult = { data: unknown; error: { message: string } | null };

const createPostgrestBuilder = (table: string, token: string | null) => {
  const filters: Array<{ column: string; value: unknown }> = [];

  const resolveResult = (): PostgrestResult => {
    const orgFilter = filters.find(filter => filter.column === 'organization_id');
    const idFilter = filters.find(filter => filter.column === 'id');

    if (table === 'therapists' && typeof idFilter?.value === 'string') {
      const orgId = typeof orgFilter?.value === 'string' ? orgFilter.value : resolveOrgIdForToken(token ?? '');
      const allowedIds = orgId ? therapistIdsByOrg[orgId] ?? [] : [];
      return allowedIds.includes(idFilter.value)
        ? { data: { id: idFilter.value }, error: null }
        : { data: null, error: null };
    }

    if (table === 'clients' && typeof idFilter?.value === 'string') {
      const orgId = typeof orgFilter?.value === 'string' ? orgFilter.value : resolveOrgIdForToken(token ?? '');
      const allowedIds = orgId ? clientIdsByOrg[orgId] ?? [] : [];
      return allowedIds.includes(idFilter.value)
        ? { data: { id: idFilter.value }, error: null }
        : { data: null, error: null };
    }

    if (table === 'user_therapist_links') {
      const orgId = resolveOrgIdForToken(token ?? '');
      const therapistIds = orgId ? therapistIdsByOrg[orgId] ?? [] : [];
      return {
        data: therapistIds.map(currentId => ({ therapist_id: currentId })),
        error: null,
      };
    }

    return { data: [], error: null };
  };

  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.insert = vi.fn(() => builder);
  builder.update = vi.fn(() => builder);
  builder.delete = vi.fn(() => builder);
  builder.eq = vi.fn((column: string, value: unknown) => {
    filters.push({ column, value });
    return builder;
  });
  builder.in = vi.fn(() => builder);
  builder.gte = vi.fn(() => builder);
  builder.lte = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.limit = vi.fn(() => builder);
  builder.returns = vi.fn(() => builder);
  builder.then = (resolve: (value: PostgrestResult) => unknown) => Promise.resolve(resolve(resolveResult()));
  builder.maybeSingle = vi.fn(async () => resolveResult());
  builder.single = vi.fn(async () => resolveResult());
  return builder;
};

const createClientStub = (token: string | null) => {
  const client = {
    auth: {
      getUser: vi.fn(async () => ({
        data: token
          ? { user: { id: token, email: `${token}@example.com` } }
          : { user: null },
        error: null,
      })),
    },
    from: vi.fn((table: string) => createPostgrestBuilder(table, token)),
    rpc: vi.fn(async (functionName: string, params: Record<string, unknown> = {}) => {
      if (functionName === 'current_user_organization_id') {
        return { data: token ? resolveOrgIdForToken(token) : null, error: null };
      }

      if (functionName === 'user_has_role_for_org') {
        const roleName = typeof params.role_name === 'string' ? params.role_name : '';
        const targetOrgId = typeof params.target_organization_id === 'string' ? params.target_organization_id : undefined;
        const orgForToken = token ? resolveOrgIdForToken(token) : null;

        if (!orgForToken || (targetOrgId && targetOrgId !== orgForToken)) {
          return { data: false, error: null };
        }

        if (roleName === 'admin' || roleName === 'super_admin') {
          return { data: true, error: null };
        }

        if (roleName === 'therapist') {
          const requestedTherapist = typeof params.target_therapist_id === 'string'
            ? params.target_therapist_id
            : undefined;

          if (!requestedTherapist) {
            return { data: true, error: null };
          }

          const orgToCheck = targetOrgId ?? orgForToken;
          const allowedTherapists = orgToCheck ? therapistIdsByOrg[orgToCheck] ?? [] : [];
          return { data: allowedTherapists.includes(requestedTherapist), error: null };
        }

        return { data: false, error: null };
      }

      return { data: null, error: null };
    }),
  } as const;

  return client;
};

vi.doMock('npm:@supabase/supabase-js@2.50.0', () => {
  const createClient = vi.fn((_: string, __: string, options?: { global?: { headers?: Record<string, string> } }) => {
    const authHeader = options?.global?.headers?.Authorization ?? '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : null;

    return createClientStub(token);
  });

  return {
    createClient,
    default: { createClient },
  };
});

const consoleGuard = installConsoleGuard({ passthrough: false });

setRuntimeSupabaseConfig({
  supabaseUrl: 'https://test-project.supabase.co',
  supabaseAnonKey: 'test-anon-key',
      defaultOrganizationId: '5238e88b-6198-4862-80a2-dbe15bbeabdd',
});

beforeEach(() => {
  consoleGuard.resetCapturedLogs();
});

// Global, deterministic time for tests (fake Date only; keep real timers)
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date('2025-06-30T12:00:00Z'));

// Mock Supabase with more realistic implementations
vi.doMock('../lib/supabase', () => {
  const chain: any = {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(async () => ({ data: [], error: null })),
    single: vi.fn(async () => ({ data: null, error: null })),
    // Realistic helpers to match Supabase Postgrest API surface
    maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    returns: vi.fn(() => chain),
  };

  const supabaseMock: any = {
    supabase: {
      from: vi.fn((table: string) => {
        if (table === 'sessions') {
          let lastInserted: any[] | null = null;
          const sessionsChain: any = {
            select: vi.fn(() => sessionsChain),
            insert: vi.fn((rows: any[]) => {
              lastInserted = Array.isArray(rows) ? rows : [rows];
              // Trigger MSW handler for tests that intercept REST
              try { fetch('http://localhost/rest/v1/sessions', { method: 'POST', body: JSON.stringify(rows) }); } catch { /* noop */ }
              return sessionsChain;
            }),
            update: vi.fn(() => sessionsChain),
            delete: vi.fn(() => sessionsChain),
            eq: vi.fn(() => sessionsChain),
            order: vi.fn(() => sessionsChain),
            limit: vi.fn(async () => ({ data: [], error: null })),
            returns: vi.fn(() => sessionsChain),
            single: vi.fn(async () => ({ data: lastInserted ? { id: 'new-session-id', ...lastInserted[0] } : null, error: null })),
            maybeSingle: vi.fn(async () => ({ data: lastInserted ? { id: 'new-session-id', ...lastInserted[0] } : null, error: null })),
          };
          return sessionsChain;
        }
        return chain;
      }),
      rpc: vi.fn(async (functionName: string) => {
        if (functionName === 'get_schedule_data_batch') {
          return {
            data: {
              sessions: [
                {
                  id: 'test-session-1',
                  client: { id: 'client-1', full_name: 'Test Client' },
                  therapist: { id: 'therapist-1', full_name: 'Test Therapist' },
                  start_time: '2025-03-18T10:00:00Z',
                  end_time: '2025-03-18T11:00:00Z',
                  status: 'scheduled',
                },
              ],
              therapists: [
                {
                  id: 'therapist-1',
                  organization_id: ORG_A_PLACEHOLDER_ID,
                  full_name: 'Test Therapist',
                  email: 'therapist@example.com',
                  status: 'active',
                  specialties: ['ABA'],
                  availability_hours: {
                    monday: { start: '09:00', end: '17:00' },
                    tuesday: { start: '09:00', end: '17:00' },
                    wednesday: { start: '09:00', end: '17:00' },
                    thursday: { start: '09:00', end: '17:00' },
                    friday: { start: '09:00', end: '17:00' },
                    saturday: { start: '10:00', end: '14:00' },
                    sunday: { start: '10:00', end: '14:00' },
                  },
                },
              ],
              clients: [
                {
                  id: 'client-1',
                  full_name: 'Test Client',
                  email: 'client@example.com',
                  availability_hours: {
                    monday: { start: '09:00', end: '17:00' },
                    tuesday: { start: '09:00', end: '17:00' },
                    wednesday: { start: '09:00', end: '17:00' },
                    thursday: { start: '09:00', end: '17:00' },
                    friday: { start: '09:00', end: '17:00' },
                    saturday: { start: '10:00', end: '14:00' },
                    sunday: { start: '10:00', end: '14:00' },
                  },
                },
              ],
            },
            error: null,
          };
        }
        if (functionName === 'get_sessions_optimized') {
          return {
            data: [
              {
                session_data: {
                  id: 'test-session-1',
                  client: { id: 'client-1', full_name: 'Test Client' },
                  therapist: { id: 'therapist-1', full_name: 'Test Therapist' },
                  start_time: '2025-03-18T10:00:00Z',
                  end_time: '2025-03-18T11:00:00Z',
                  status: 'scheduled',
                },
              },
            ],
            error: null,
          };
        }
        if (functionName === 'get_dropdown_data') {
          return {
            data: {
              therapists: [
                {
                  id: 'therapist-1',
                  organization_id: ORG_A_PLACEHOLDER_ID,
                  full_name: 'Test Therapist',
                  email: 'therapist@example.com',
                  status: 'active',
                  availability_hours: {
                    monday: { start: '09:00', end: '17:00' },
                    tuesday: { start: '09:00', end: '17:00' },
                    wednesday: { start: '09:00', end: '17:00' },
                    thursday: { start: '09:00', end: '17:00' },
                    friday: { start: '09:00', end: '17:00' },
                    saturday: { start: '10:00', end: '14:00' },
                    sunday: { start: '10:00', end: '14:00' },
                  },
                },
              ],
              clients: [
                {
                  id: 'client-1',
                  full_name: 'Test Client',
                  email: 'client@example.com',
                  availability_hours: {
                    monday: { start: '09:00', end: '17:00' },
                    tuesday: { start: '09:00', end: '17:00' },
                    wednesday: { start: '09:00', end: '17:00' },
                    thursday: { start: '09:00', end: '17:00' },
                    friday: { start: '09:00', end: '17:00' },
                    saturday: { start: '10:00', end: '14:00' },
                    sunday: { start: '10:00', end: '14:00' },
                  },
                },
              ],
            },
            error: null,
          };
        }
        return { data: null, error: null };
      }),
      functions: {
        invoke: vi.fn(async (functionName: string, opts?: { body?: any }) => {
          if (functionName === 'suggest-alternative-times') {
            return {
              data: {
                alternatives: [
                  {
                    startTime: '2024-03-18T10:00:00Z',
                    endTime: '2024-03-18T11:00:00Z',
                    score: 0.95,
                    reason: 'No conflicts and within availability'
                  },
                  {
                    startTime: '2024-03-18T09:00:00Z',
                    endTime: '2024-03-18T10:00:00Z',
                    score: 0.88,
                    reason: 'Early slot available for both parties'
                  }
                ]
              },
              error: null
            };
          }
          return { data: { alternatives: [] }, error: null };
        }),
      },
      auth: {
        getUser: vi.fn(() =>
          Promise.resolve({
            data: { user: { id: 'test-user', email: 'test@example.com' } },
            error: null,
          }),
        ),
        getSession: vi.fn(() =>
          Promise.resolve({
            data: { session: { access_token: 'test-access-token' } },
            error: null,
          }),
        ),
      },
    },
  };

  supabaseMock.callEdge = vi.fn(async (
    path: string,
    init: RequestInit = {},
    options: { accessToken?: string; anonKey?: string } = {},
  ) => {
    const headers = new Headers(init?.headers ?? {});

    const providedToken = typeof options.accessToken === 'string' ? options.accessToken.trim() : '';
    if (providedToken.length > 0) {
      headers.set('Authorization', `Bearer ${providedToken}`);
    } else if (!headers.has('Authorization')) {
      const { data: { session } = { session: null } } = await supabaseMock.supabase.auth.getSession();
      if (session?.access_token) {
        headers.set('Authorization', `Bearer ${session.access_token}`);
      }
    }

    const anonKey = typeof options.anonKey === 'string' ? options.anonKey.trim() : '';
    if (anonKey.length > 0) {
      headers.set('apikey', anonKey);
    }

    const url = `http://localhost/functions/v1/${path}`;
    return fetch(url, { ...init, headers });
  });

  return supabaseMock;
});

/**
 * Test Supabase mock usage:
 * const { data, error } = await supabase.from('table').select('*').eq('id', '1').maybeSingle();
 * const { data, error } = await supabase.from('table').select('*').returns<MyType>().limit(10);
 */

// Note: date-fns mocking removed for simplicity

const getBearerToken = (headers: Headers): string => {
  const authorization = headers.get('authorization');
  return authorization ? authorization.replace(/^Bearer\s+/i, '').trim() : '';
};

const parseEqFilter = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const [operator, ...rest] = value.split('.');
  if (operator !== 'eq') {
    return null;
  }

  return rest.join('.');
};

const therapistIdsByOrg: Record<string, string[]> = {
  [ORG_A_PLACEHOLDER_ID]: [process.env.TEST_THERAPIST_ID_ORG_A ?? 'therapist-1'],
  [ORG_B_PLACEHOLDER_ID]: [process.env.TEST_THERAPIST_ID_ORG_B ?? 'therapist-2'],
};

// Setup MSW server for mocking API calls (for integration tests or when Supabase mocks are bypassed)
export const server = setupServer(
  http.post('*/rest/v1/rpc/current_user_organization_id', async ({ request }) => {
    const token = getBearerToken(request.headers);
    const orgId = resolveOrgIdForToken(token);

    if (!orgId) {
      return HttpResponse.json(null, { status: 403 });
    }

    return HttpResponse.json(orgId);
  }),
  http.post('*/rest/v1/rpc/user_has_role_for_org', async ({ request }) => {
    const token = getBearerToken(request.headers);
    const orgIdForToken = resolveOrgIdForToken(token);
    const payload = await request.json().catch(() => ({} as Record<string, unknown>));
    const roleName = typeof payload.role_name === 'string' ? payload.role_name : '';
    const requestedOrgId = typeof payload.target_organization_id === 'string'
      ? payload.target_organization_id
      : undefined;

    const orgMatches = requestedOrgId ? requestedOrgId === orgIdForToken : Boolean(orgIdForToken);
    if (!orgMatches) {
      return HttpResponse.json(false);
    }

    if (roleName === 'admin' || roleName === 'super_admin') {
      return HttpResponse.json(true);
    }

    if (roleName === 'therapist') {
      const requestedTherapistId = typeof payload.target_therapist_id === 'string'
        ? payload.target_therapist_id
        : undefined;

      if (!requestedTherapistId) {
        return HttpResponse.json(true);
      }

      const allowedTherapists = requestedOrgId
        ? therapistIdsByOrg[requestedOrgId] ?? []
        : orgIdForToken
          ? therapistIdsByOrg[orgIdForToken] ?? []
          : [];

      return HttpResponse.json(allowedTherapists.includes(requestedTherapistId));
    }

    return HttpResponse.json(false);
  }),
  http.post('*/rest/v1/rpc/get_admin_users', async ({ request }) => {
    const token = getBearerToken(request.headers);
    const body = await request.json().catch(() => ({}));
    const requestedOrganizationIdRaw = (body as Record<string, unknown>).organization_id;
    const requestedOrganizationId = typeof requestedOrganizationIdRaw === 'string'
      ? requestedOrganizationIdRaw
      : requestedOrganizationIdRaw === null
        ? null
        : undefined;

    if (requestedOrganizationId === null) {
      return HttpResponse.json([
        {
          id: 'admin-org-a-1',
          email: 'admin-a@example.com',
          organization_id: ORG_A_PLACEHOLDER_ID,
          full_name: 'Org A Admin',
        },
        {
          id: 'admin-org-b-1',
          email: 'admin-b@example.com',
          organization_id: ORG_B_PLACEHOLDER_ID,
          full_name: 'Org B Admin',
        },
      ]);
    }

    if (token === ORG_A_TEST_TOKEN && requestedOrganizationId === ORG_A_PLACEHOLDER_ID) {
      return HttpResponse.json([
        {
          id: 'admin-org-a-1',
          email: 'admin-a@example.com',
          organization_id: ORG_A_PLACEHOLDER_ID,
          full_name: 'Org A Admin',
        },
      ]);
    }

    if (token === ORG_B_TEST_TOKEN && requestedOrganizationId === ORG_A_PLACEHOLDER_ID) {
      return HttpResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    return HttpResponse.json([], { status: 200 });
  }),
  http.post('*/rest/v1/rpc/insert_session_with_billing', async ({ request }) => {
    const token = getBearerToken(request.headers);
    const payload = await request.json().catch(() => ({}));

    if (token === ORG_A_TEST_TOKEN) {
      return HttpResponse.json({
        success: true,
        session: {
          id: 'session-org-a-1',
          client_id: process.env.TEST_CLIENT_ID_ORG_A,
          therapist_id: process.env.TEST_THERAPIST_ID_ORG_A,
          organization_id: ORG_A_PLACEHOLDER_ID,
        },
        cpt: {
          code: (payload as Record<string, unknown>).p_cpt_code ?? '97153',
          modifiers: (payload as Record<string, unknown>).p_modifiers ?? ['HN'],
        },
      });
    }

    if (token === ORG_B_TEST_TOKEN) {
      return HttpResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    return HttpResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }),
  // Mock RPC endpoints with proper test data
  http.post('*/rest/v1/rpc/get_schedule_data_batch', async ({ request }) => {
    const token = getBearerToken(request.headers);

    if (isOrgAToken(token)) {
      return HttpResponse.json({
        sessions: [
          {
            id: 'test-session-1',
            client: { id: 'client-1', full_name: 'Test Client' },
            therapist: { id: 'therapist-1', full_name: 'Test Therapist' },
            start_time: '2025-03-18T10:00:00Z',
            end_time: '2025-03-18T11:00:00Z',
            status: 'scheduled',
          }
        ],
        therapists: [
          {
            id: 'therapist-1',
            organization_id: ORG_A_PLACEHOLDER_ID,
            full_name: 'Test Therapist',
            email: 'therapist@example.com',
            status: 'active',
            specialties: ['ABA'],
            availability_hours: {
              monday: { start: '09:00', end: '17:00' },
              tuesday: { start: '09:00', end: '17:00' },
              wednesday: { start: '09:00', end: '17:00' },
              thursday: { start: '09:00', end: '17:00' },
              friday: { start: '09:00', end: '17:00' },
              saturday: { start: '10:00', end: '14:00' },
              sunday: { start: '10:00', end: '14:00' }
            }
          }
        ],
        clients: [
          {
            id: 'client-1',
            full_name: 'Test Client',
            email: 'client@example.com',
            availability_hours: {
              monday: { start: '09:00', end: '17:00' },
              tuesday: { start: '09:00', end: '17:00' },
              wednesday: { start: '09:00', end: '17:00' },
              thursday: { start: '09:00', end: '17:00' },
              friday: { start: '09:00', end: '17:00' },
              saturday: { start: '10:00', end: '14:00' },
              sunday: { start: '10:00', end: '14:00' }
            }
          }
        ]
      });
    }

    if (isOrgBToken(token)) {
      return HttpResponse.json({ sessions: [], therapists: [], clients: [] });
    }

    return HttpResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }),
  http.post('*/rest/v1/rpc/get_sessions_optimized', async ({ request }) => {
    const token = getBearerToken(request.headers);

    if (isOrgAToken(token)) {
      return HttpResponse.json([
        {
          session_data: {
            id: 'test-session-1',
            client: { id: 'client-1', full_name: 'Test Client' },
            therapist: { id: 'therapist-1', full_name: 'Test Therapist' },
            start_time: '2025-03-18T10:00:00Z',
            end_time: '2025-03-18T11:00:00Z',
            status: 'scheduled',
          }
        }
      ]);
    }

    if (isOrgBToken(token)) {
      return HttpResponse.json([]);
    }

    return HttpResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }),
  http.post('*/rest/v1/rpc/get_dropdown_data', async ({ request }) => {
    const token = getBearerToken(request.headers);

    if (isOrgAToken(token)) {
      return HttpResponse.json({
        therapists: [
          {
            id: 'therapist-1',
            organization_id: ORG_A_PLACEHOLDER_ID,
            full_name: 'Test Therapist',
            email: 'therapist@example.com',
            status: 'active',
            availability_hours: {
              monday: { start: '09:00', end: '17:00' },
              tuesday: { start: '09:00', end: '17:00' },
              wednesday: { start: '09:00', end: '17:00' },
              thursday: { start: '09:00', end: '17:00' },
              friday: { start: '09:00', end: '17:00' },
              saturday: { start: '10:00', end: '14:00' },
              sunday: { start: '10:00', end: '14:00' }
            }
          }
        ],
        clients: [
          {
            id: 'client-1',
            full_name: 'Test Client',
            email: 'client@example.com',
            availability_hours: {
              monday: { start: '09:00', end: '17:00' },
              tuesday: { start: '09:00', end: '17:00' },
              wednesday: { start: '09:00', end: '17:00' },
              thursday: { start: '09:00', end: '17:00' },
              friday: { start: '09:00', end: '17:00' },
              saturday: { start: '10:00', end: '14:00' },
              sunday: { start: '10:00', end: '14:00' }
            }
          }
        ]
      });
    }

    if (isOrgBToken(token)) {
      return HttpResponse.json({ therapists: [], clients: [] });
    }

    return HttpResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }),
  http.post('*/rest/v1/rpc/get_session_metrics', async ({ request }) => {
    const token = getBearerToken(request.headers);

    if (isOrgAToken(token)) {
      return HttpResponse.json({
        totalSessions: 12,
        completedSessions: 10,
        cancelledSessions: 1,
        noShowSessions: 1,
        sessionsByTherapist: { 'therapist-1': 12 },
        sessionsByClient: { 'client-1': 12 },
        sessionsByDayOfWeek: { monday: 4, tuesday: 4, wednesday: 4 },
      });
    }

    if (isOrgBToken(token)) {
      return HttpResponse.json({
        totalSessions: 0,
        completedSessions: 0,
        cancelledSessions: 0,
        noShowSessions: 0,
        sessionsByTherapist: {},
        sessionsByClient: {},
        sessionsByDayOfWeek: {},
      });
    }

    return HttpResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }),
  http.post('*/rest/v1/rpc/set_client_archive_state', async ({ request }) => {
    const token = getBearerToken(request.headers);
    const body = await request.json().catch(() => ({}));
    const restore = Boolean((body as Record<string, unknown>).p_restore);

    if (!isOrgAToken(token)) {
      return HttpResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    archiveState.client.deletedAt = restore ? null : ARCHIVE_TIMESTAMP;

    return HttpResponse.json({
      id: archiveState.client.id,
      organization_id: archiveState.client.organizationId,
      deleted_at: archiveState.client.deletedAt,
    });
  }),
  http.post('*/rest/v1/rpc/set_therapist_archive_state', async ({ request }) => {
    const token = getBearerToken(request.headers);
    const body = await request.json().catch(() => ({}));
    const restore = Boolean((body as Record<string, unknown>).p_restore);

    if (!isOrgAToken(token)) {
      return HttpResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    archiveState.therapist.deletedAt = restore ? null : ARCHIVE_TIMESTAMP;

    return HttpResponse.json({
      id: archiveState.therapist.id,
      organization_id: archiveState.therapist.organizationId,
      deleted_at: archiveState.therapist.deletedAt,
    });
  }),
  // AI Edge Functions
  http.post('https://wnnjeqheqxxyrgsjmygy.supabase.co/functions/v1/ai-transcription', async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    // Echo back what tests might expect if they set specific payloads
    return HttpResponse.json({
      text: body?.audio ? 'Test transcription' : 'Test transcription',
      confidence: 0.85,
      processing_time: 1000,
    });
  }),
  http.post('https://wnnjeqheqxxyrgsjmygy.supabase.co/functions/v1/ai-session-note-generator', () => {
    // Return compliant payload by default to satisfy strict tests
    return HttpResponse.json({
      content: JSON.stringify({
        clinical_status: 'Client demonstrates emerging receptive language skills with measured progress across structured tasks and consistent performance in targeted programs.',
        goals: [{
          goal_id: 'goal_1',
          description: 'Follow one-step instructions',
          target_behavior: 'compliance',
          measurement_type: 'percentage',
          baseline_data: 60,
          target_criteria: 80,
          session_performance: 75,
          progress_status: 'improving'
        }],
        interventions: [{
          type: 'DTT',
          aba_technique: 'Discrete Trial Training',
          description: 'Presented visual prompts with verbal instructions',
          implementation_fidelity: 95,
          client_response: 'Positive engagement with minimal prompting',
          effectiveness_rating: 4
        }],
        observations: [{
          behavior_type: 'positive_behavior',
          description: 'Client followed instructions independently',
          frequency: 12,
          duration: 300,
          intensity: 'medium',
          antecedent: 'Therapist presented instruction',
          consequence: 'Praise and preferred item'
        }],
        data_summary: [{
          program_name: 'Following Instructions',
          trials_presented: 20,
          correct_responses: 16,
          incorrect_responses: 4,
          no_responses: 0,
          percentage_correct: 80,
          trend: 'increasing'
        }],
        summary: 'Objective summary with quantified outcomes and professional language.',
        confidence: 0.9
      }),
      california_compliant: true,
      insurance_ready: true,
    });
  }),
  // Legacy REST endpoints for backward compatibility
  http.get('*/rest/v1/programs*', ({ request }) => {
    const url = new URL(request.url);
    const clientId = parseEqFilter(url.searchParams.get('client_id')) ?? 'client-1';
    return HttpResponse.json([
      {
        id: 'program-1',
        organization_id: ORG_A_PLACEHOLDER_ID,
        client_id: clientId,
        name: 'Default Program',
        description: 'Default program for tests',
        status: 'active',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ]);
  }),
  http.get('*/rest/v1/goals*', ({ request }) => {
    const url = new URL(request.url);
    const programId = parseEqFilter(url.searchParams.get('program_id')) ?? 'program-1';
    const clientId = parseEqFilter(url.searchParams.get('client_id')) ?? 'client-1';
    return HttpResponse.json([
      {
        id: 'goal-1',
        organization_id: ORG_A_PLACEHOLDER_ID,
        client_id: clientId,
        program_id: programId,
        title: 'Default Goal',
        description: 'Default goal for tests',
        original_text: 'Default clinical wording',
        status: 'active',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ]);
  }),
  http.get('*/rest/v1/session_goals*', () => {
    return HttpResponse.json([]);
  }),
  http.get('*/rest/v1/sessions*', () => {
    return HttpResponse.json([
      {
        id: 'test-session-1',
        client: { id: 'client-1', full_name: 'Test Client' },
        therapist: { id: 'therapist-1', full_name: 'Test Therapist' },
        start_time: '2025-03-18T10:00:00Z',
        end_time: '2025-03-18T11:00:00Z',
        status: 'scheduled',
      }
    ]);
  }),
  http.get('*/rest/v1/therapists*', ({ request }) => {
    const token = getBearerToken(request.headers);

    if (isOrgBToken(token)) {
      return HttpResponse.json([]);
    }

    if (!isOrgAToken(token)) {
      return HttpResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const deletedFilter = url.searchParams.get('deleted_at');
    const idFilter = url.searchParams.get('id');

    const therapistRow = {
      id: archiveState.therapist.id,
      organization_id: archiveState.therapist.organizationId,
      deleted_at: archiveState.therapist.deletedAt,
      full_name: 'Test Therapist',
      email: 'therapist@example.com',
      status: 'active',
      availability_hours: {
        monday: { start: '09:00', end: '17:00' },
        tuesday: { start: '09:00', end: '17:00' },
        wednesday: { start: '09:00', end: '17:00' },
        thursday: { start: '09:00', end: '17:00' },
        friday: { start: '09:00', end: '17:00' },
        saturday: { start: '10:00', end: '14:00' },
        sunday: { start: '10:00', end: '14:00' }
      },
    };

    if (deletedFilter === 'is.null' && therapistRow.deleted_at !== null) {
      return HttpResponse.json([]);
    }

    if (idFilter) {
      const [, value] = idFilter.split('.');
      if (value && value !== therapistRow.id) {
        return HttpResponse.json([]);
      }
    }

    return HttpResponse.json([therapistRow]);
  }),
  http.get('*/rest/v1/clients*', ({ request }) => {
    const token = getBearerToken(request.headers);

    if (isOrgBToken(token)) {
      return HttpResponse.json([]);
    }

    if (!isOrgAToken(token)) {
      return HttpResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const deletedFilter = url.searchParams.get('deleted_at');
    const idFilter = url.searchParams.get('id');

    const clientRow = {
      id: archiveState.client.id,
      organization_id: archiveState.client.organizationId,
      deleted_at: archiveState.client.deletedAt,
      full_name: 'Test Client',
      email: 'client@example.com',
      availability_hours: {
        monday: { start: '09:00', end: '17:00' },
        tuesday: { start: '09:00', end: '17:00' },
        wednesday: { start: '09:00', end: '17:00' },
        thursday: { start: '09:00', end: '17:00' },
        friday: { start: '09:00', end: '17:00' },
        saturday: { start: '10:00', end: '14:00' },
        sunday: { start: '10:00', end: '14:00' }
      },
    };

    if (deletedFilter === 'is.null' && clientRow.deleted_at !== null) {
      return HttpResponse.json([]);
    }

    if (idFilter) {
      const [, value] = idFilter.split('.');
      if (value && value !== clientRow.id) {
        return HttpResponse.json([]);
      }
    }

    return HttpResponse.json([clientRow]);
  }),
  http.get('*/rest/v1/storage.objects*', ({ request }) => {
    const token = getBearerToken(request.headers);
    if (!token) {
      return HttpResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const orgId = resolveOrgIdForToken(token);
    if (!orgId) {
      return HttpResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const bucketId = parseEqFilter(url.searchParams.get('bucket_id'));
    const objectName = parseEqFilter(url.searchParams.get('name'));

    if (bucketId !== 'therapist-documents' || !objectName) {
      return HttpResponse.json([]);
    }

    const pathSegments = objectName.split('/');
    if (pathSegments.length < 2 || pathSegments[0] !== 'therapists') {
      return HttpResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const therapistId = pathSegments[1];
    const therapistContext = resolveTherapistContextForId(therapistId);
    if (!therapistContext) {
      return HttpResponse.json([], { status: 404 });
    }

    const callerRole = resolveRoleForToken(token);
    const callerTherapistContext = resolveTherapistContextForToken(token) ?? null;
    const sharesOrganization = therapistContext.organizationId === orgId;
    const callerIsTherapistOwner = Boolean(
      callerTherapistContext && callerTherapistContext.therapistId === therapistId,
    );

    const isAuthorized = sharesOrganization && (
      callerRole === 'admin'
      || callerRole === 'super_admin'
      || (callerRole === 'therapist' && callerIsTherapistOwner)
    );

    if (!isAuthorized) {
      return HttpResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return HttpResponse.json([
      {
        id: 'mock-object-id',
        bucket_id: 'therapist-documents',
        name: objectName,
        owner: therapistId,
      },
    ]);
  }),
  http.post('*/api/book', async ({ request }) => {
    let body: { session?: Record<string, unknown> } | null = null;
    try {
      body = await request.json();
    } catch (error) {
      console.error('Failed to parse book API payload in tests', error);
    }

    const sessionPayload = (body?.session ?? {}) as Record<string, unknown>;
    const startTime = typeof sessionPayload.start_time === 'string'
      ? sessionPayload.start_time
      : '2025-03-18T10:00:00Z';
    const endTime = typeof sessionPayload.end_time === 'string'
      ? sessionPayload.end_time
      : '2025-03-18T11:00:00Z';

    const responseSession = {
      id: (sessionPayload.id as string) ?? 'new-session-id',
      client_id: (sessionPayload.client_id as string) ?? 'client-1',
      therapist_id: (sessionPayload.therapist_id as string) ?? 'therapist-1',
      start_time: startTime,
      end_time: endTime,
      status: (sessionPayload.status as string) ?? 'scheduled',
      notes: (sessionPayload.notes as string) ?? 'Test session',
      created_at: '2025-03-18T09:00:00Z',
      created_by: 'user-1',
      updated_at: '2025-03-18T09:00:00Z',
      updated_by: 'user-1',
      duration_minutes: 60,
      location_type: (sessionPayload.location_type as string) ?? null,
      session_type: (sessionPayload.session_type as string) ?? null,
      rate_per_hour: null,
      total_cost: null,
    };

    return HttpResponse.json({
      success: true,
      data: {
        session: responseSession,
        hold: {
          holdKey: 'test-hold',
          holdId: 'hold-1',
          expiresAt: '2025-01-01T00:05:00Z',
        },
        cpt: {
          code: '97153',
          description: 'Adaptive behavior treatment by protocol',
          modifiers: [],
          source: 'fallback',
          durationMinutes: 60,
        },
      },
    });
  }),
  // Mock session hold + confirmation flow
  http.post('*/functions/v1/sessions-hold*', () => {
    return HttpResponse.json({
      success: true,
      data: {
        holdKey: 'test-hold',
        holdId: 'hold-1',
        expiresAt: '2025-01-01T00:05:00Z',
      },
    });
  }),
  http.post('*/functions/v1/sessions-confirm*', () => {
    return HttpResponse.json({
      success: true,
      data: {
        session: {
          id: 'new-session-id',
          client_id: 'client-1',
          therapist_id: 'therapist-1',
          start_time: '2025-03-18T10:00:00Z',
          end_time: '2025-03-18T11:00:00Z',
          status: 'scheduled',
          notes: 'Test session',
          created_at: '2025-03-18T09:00:00Z',
          duration_minutes: 60,
          location_type: null,
          session_type: null,
          rate_per_hour: null,
          total_cost: null,
        },
        roundedDurationMinutes: 60,
      },
    });
  }),
);

// Determine if we're running integration tests
const argvContainsIntegration = Array.isArray(process.argv)
  ? process.argv.some(arg => String(arg).includes('Integration'))
  : false;

const isIntegrationTest = Boolean(process.env.VITEST_POOL_ID?.includes('Integration') || argvContainsIntegration);

// Start server before all tests
beforeAll(() => {
  // Always error on unhandled to force explicit handlers per-domain.
  // Integration tests should also declare handlers; avoid bypass to catch gaps.
  server.listen({ onUnhandledRequest: 'error' });
});

// Reset handlers after each test
afterEach(() => server.resetHandlers());

// Close server after all tests
afterAll(() => server.close());

afterAll(() => {
  consoleGuard.restore();
});

if (typeof window !== 'undefined') {
  // Mock window.matchMedia for responsive design tests
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(), // deprecated
      removeListener: vi.fn(), // deprecated
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  // Mock IntersectionObserver for virtual scrolling tests
  const mockIntersectionObserver = vi.fn();
  mockIntersectionObserver.mockReturnValue({
    observe: () => null,
    unobserve: () => null,
    disconnect: () => null,
  });
  window.IntersectionObserver = mockIntersectionObserver;

  // Stub browser dialogs for jsdom environment
  Object.defineProperty(window, 'alert', {
    writable: true,
    value: vi.fn(),
  });
  Object.defineProperty(window, 'confirm', {
    writable: true,
    value: vi.fn(() => true),
  });
}