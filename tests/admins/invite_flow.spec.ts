import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubDenoEnv } from '../utils/stubDeno';

type TestRole = 'client' | 'therapist' | 'admin' | 'super_admin';

type TestUser = {
  id: string;
  email: string;
};

type TestProfile = TestUser & {
  role: TestRole;
  is_active: boolean;
};

type TestUserContext = {
  user: TestUser;
  profile: TestProfile;
};

interface StoredInviteToken {
  id: string;
  email: string;
  organization_id: string;
  token_hash: string;
  expires_at: string;
  created_by: string;
  created_at: string;
  role: string;
}

const envValues = new Map<string, string>([
  ['SUPABASE_URL', 'http://localhost'],
  ['SUPABASE_ANON_KEY', 'anon'],
  ['ADMIN_INVITE_EMAIL_URL', 'https://mailer.example.com'],
  ['ADMIN_PORTAL_URL', 'https://admin.example.com'],
]);

stubDenoEnv((key) => envValues.get(key) ?? '');

const logApiAccess = vi.fn();
const assertAdminOrSuperAdmin = vi.fn(async () => {});
const createRequestClient = vi.fn();

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Client-Info, apikey',
  'Access-Control-Max-Age': '86400',
};

let currentUserContext: TestUserContext = {
  user: { id: 'admin-1', email: 'admin@example.com' },
  profile: { id: 'profile-1', email: 'admin@example.com', role: 'admin', is_active: true },
};

let currentUserMetadata: Record<string, unknown> = { organization_id: 'org-123' };

const inviteTokens: StoredInviteToken[] = [];
const adminActionRows: Array<Record<string, unknown>> = [];

const createInviteTableClient = () => {
  const state: { email?: string; organizationId?: string } = {};
  const builder: any = {
    select: vi.fn(() => builder),
    eq: vi.fn((column: string, value: string) => {
      if (column === 'email') state.email = value;
      if (column === 'organization_id') state.organizationId = value;
      return builder;
    }),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => {
      const filtered = inviteTokens
        .filter(token =>
          (state.email ? token.email === state.email : true)
          && (state.organizationId ? token.organization_id === state.organizationId : true),
        )
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      const record = filtered[0];
      return { data: record ? { id: record.id, expires_at: record.expires_at } : null, error: null };
    }),
    insert: (value: Record<string, unknown>) => {
      const record = Array.isArray(value) ? value[0] : value;
      const id = (record.id as string) ?? crypto.randomUUID();
      const stored: StoredInviteToken = {
        id,
        email: record.email as string,
        organization_id: record.organization_id as string,
        token_hash: record.token_hash as string,
        expires_at: record.expires_at as string,
        created_by: record.created_by as string,
        created_at: new Date().toISOString(),
        role: (record.role as string) ?? 'admin',
      };
      inviteTokens.push(stored);
      return {
        select: () => ({
          single: async () => ({ data: { id: stored.id, expires_at: stored.expires_at }, error: null }),
        }),
      };
    },
    delete: () => ({
      eq: (column: string, value: string) => {
        if (column !== 'id') throw new Error(`Unexpected delete column ${column}`);
        const index = inviteTokens.findIndex(token => token.id === value);
        if (index >= 0) {
          inviteTokens.splice(index, 1);
        }
        return { error: null };
      },
    }),
  };
  return builder;
};

const createMockClient = () => ({
  auth: {
    getUser: vi.fn(async () => ({
      data: { user: { id: currentUserContext.user.id, user_metadata: currentUserMetadata } },
      error: null,
    })),
  },
  from: (table: string) => {
    if (table === 'admin_invite_tokens') {
      return createInviteTableClient();
    }
    if (table === 'admin_actions') {
      return {
        insert: vi.fn(async (payload: Record<string, unknown>) => {
          adminActionRows.push(payload);
          return { error: null };
        }),
      };
    }
    throw new Error(`Unexpected table ${table}`);
  },
});

createRequestClient.mockImplementation(() => createMockClient());

vi.mock('../../supabase/functions/_shared/auth-middleware.ts', () => ({
  corsHeaders,
  RouteOptions: { admin: {} },
  logApiAccess,
  createProtectedRoute: (handler: (req: Request, context: TestUserContext) => Promise<Response>) => {
    return (req: Request) => handler(req, currentUserContext);
  },
}));

vi.mock('../../supabase/functions/_shared/database.ts', () => ({
  createRequestClient,
}));

vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  assertAdminOrSuperAdmin,
}));

describe('admin invite edge function', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  const loadHandler = async () => {
    const module = await import('../../supabase/functions/admin-invite/index.ts');
    return module.handler as (req: Request) => Promise<Response>;
  };

  beforeEach(async () => {
    vi.resetModules();
    inviteTokens.splice(0, inviteTokens.length);
    adminActionRows.splice(0, adminActionRows.length);
    currentUserContext = {
      user: { id: 'admin-1', email: 'admin@example.com' },
      profile: { id: 'profile-1', email: 'admin@example.com', role: 'admin', is_active: true },
    };
    currentUserMetadata = { organization_id: 'org-123' };
    envValues.set('ADMIN_INVITE_EMAIL_URL', 'https://mailer.example.com');
    envValues.set('ADMIN_PORTAL_URL', 'https://admin.example.com');
    fetchMock = vi.fn(async () => ({ ok: true, status: 202 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    logApiAccess.mockClear();
    assertAdminOrSuperAdmin.mockClear();
    createRequestClient.mockClear();
  });

  it('creates a scoped invite token, sends email, and logs the admin action', async () => {
    const handler = await loadHandler();

    const response = await handler(
      new Request('https://edge.example.com/admin/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: 'Bearer valid' },
        body: JSON.stringify({ email: 'NewAdmin@example.com' }),
      }),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({ inviteId: expect.any(String), expiresAt: expect.any(String) });

    expect(inviteTokens).toHaveLength(1);
    const storedToken = inviteTokens[0];
    expect(storedToken.email).toBe('newadmin@example.com');
    expect(storedToken.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(storedToken.organization_id).toBe('org-123');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0];
    expect(requestInit?.method).toBe('POST');
    const emailPayload = JSON.parse(requestInit?.body as string);
    expect(emailPayload.template).toBe('admin-invite');
    expect(emailPayload.to).toBe('newadmin@example.com');
    expect(emailPayload.variables.invite_url).toContain('?token=');

    expect(adminActionRows).toHaveLength(1);
    expect(adminActionRows[0]).toMatchObject({
      admin_user_id: 'admin-1',
      organization_id: 'org-123',
      action_type: 'admin_invite_sent',
    });
    expect(adminActionRows[0]?.action_details).toMatchObject({
      email: 'newadmin@example.com',
      email_delivery_status: 'sent',
    });

    expect(assertAdminOrSuperAdmin).toHaveBeenCalledTimes(1);
  });

  it('replaces an expired invite token with a new one', async () => {
    const expiredToken: StoredInviteToken = {
      id: 'invite-old',
      email: 'newadmin@example.com',
      organization_id: 'org-123',
      token_hash: 'deadbeef',
      expires_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      created_by: 'admin-1',
      created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      role: 'admin',
    };
    inviteTokens.push(expiredToken);

    const handler = await loadHandler();

    const response = await handler(
      new Request('https://edge.example.com/admin/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: 'Bearer valid' },
        body: JSON.stringify({ email: 'newadmin@example.com', expiresInHours: 4 }),
      }),
    );

    expect(response.status).toBe(201);

    expect(inviteTokens).toHaveLength(1);
    const newToken = inviteTokens[0];
    expect(newToken.id).not.toBe(expiredToken.id);
    expect(newToken.token_hash).not.toBe(expiredToken.token_hash);
    expect(newToken.expires_at).not.toBe(expiredToken.expires_at);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(adminActionRows).toHaveLength(1);
    expect(adminActionRows[0]?.action_details).toMatchObject({
      email: 'newadmin@example.com',
      email_delivery_status: 'sent',
    });
  });
});
