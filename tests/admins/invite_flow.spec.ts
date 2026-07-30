import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubDenoEnv } from '../utils/stubDeno';

type TestRole = 'client' | 'bt' | 'therapist' | 'admin' | 'bcba' | 'super_admin';

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
  target_therapist_id: string | null;
  revoked_at: string | null;
}

interface TherapistRecord {
  id: string;
  email: string;
  organization_id: string;
  status: string | null;
  deleted_at: string | null;
}

const envValues = new Map<string, string>([
  ['SUPABASE_URL', 'http://localhost'],
  ['SUPABASE_ANON_KEY', 'anon'],
  ['ADMIN_INVITE_EMAIL_URL', 'https://mailer.example.com'],
  ['ADMIN_PORTAL_URL', 'https://admin.example.com'],
]);

stubDenoEnv((key) => envValues.get(key) ?? '');

const logApiAccess = vi.fn();
const getUserRoles = vi.fn(async () => [currentUserContext.profile.role]);
const createRequestClient = vi.fn();
const resolveOrgId = vi.fn(async () => currentUserMetadata.organization_id as string | null);

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
const therapists: TherapistRecord[] = [];
const adminActionRows: Array<Record<string, unknown>> = [];
let rollbackUpdateError: { message: string } | null = null;
const therapistLookupSpy = vi.fn();

const fromTable = (table: string) => {
  if (table === 'admin_actions') {
    return {
      insert: vi.fn(async (payload: Record<string, unknown>) => {
        adminActionRows.push(payload);
        return { error: null };
      }),
    };
  }
  if (table === 'admin_invite_tokens') {
    return {
      update: vi.fn((payload: { revoked_at?: string | null }) => {
        const filters: Record<string, unknown> = {};
        const builder = {
          eq: vi.fn((column: string, value: unknown) => {
            filters[column] = value;
            if (filters.id && filters.organization_id && !rollbackUpdateError) {
              const inviteToken = inviteTokens.find(token =>
                token.id === filters.id && token.organization_id === filters.organization_id,
              );
              if (inviteToken) {
                inviteToken.revoked_at = payload.revoked_at ?? null;
              }
            }
            return builder;
          }),
          then: (resolve: (value: { error: { message: string } | null }) => void) => resolve({ error: rollbackUpdateError }),
        };
        return builder;
      }),
    };
  }
  if (table === 'therapists') {
    return {
      select: vi.fn(() => {
        therapistLookupSpy();
        const filters: Record<string, unknown> = {};
        return {
          eq: vi.fn((column: string, value: unknown) => {
            filters[column] = value;
            return {
              maybeSingle: vi.fn(async () => ({
                data:
                  therapists.find(therapist => Object.entries(filters).every(([key, filterValue]) => therapist[key as keyof TherapistRecord] === filterValue))
                  ?? null,
                error: null,
              })),
            };
          }),
        };
      }),
    };
  }
  throw new Error(`Unexpected table ${table}`);
};

const createMockClient = () => ({
  auth: {
    getUser: vi.fn(async () => ({
      data: { user: { id: currentUserContext.user.id, user_metadata: currentUserMetadata } },
      error: null,
    })),
  },
  from: fromTable,
});

const createAdminRpc = vi.fn(async (functionName: string, params: Record<string, unknown>) => {
  if (functionName !== 'create_admin_invite_token_rate_limited') {
    throw new Error(`Unexpected service RPC ${functionName}`);
  }

  const email = String(params.p_email);
  const organizationId = String(params.p_organization_id);
  const createdBy = String(params.p_created_by);
  const now = Date.now();
  const activeToken = inviteTokens
    .filter(token =>
      token.email === email
      && token.organization_id === organizationId
      && token.revoked_at === null
      && new Date(token.expires_at).getTime() > now
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

  if (activeToken) {
    return {
      data: [{ id: activeToken.id, expires_at: activeToken.expires_at, status: 'active_invite_exists' }],
      error: null,
    };
  }

  for (let index = inviteTokens.length - 1; index >= 0; index -= 1) {
    const token = inviteTokens[index];
    if (
      token.email === email
      && token.organization_id === organizationId
      && token.revoked_at === null
      && new Date(token.expires_at).getTime() <= now
    ) {
      inviteTokens.splice(index, 1);
    }
  }

  const windowStart = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const recentInviteCount = inviteTokens.filter(token =>
    token.created_by === createdBy && token.created_at >= windowStart,
  ).length;

  if (recentInviteCount >= 10) {
    return { data: [{ id: null, expires_at: null, status: 'rate_limited' }], error: null };
  }

  const stored: StoredInviteToken = {
    id: crypto.randomUUID(),
    email,
    organization_id: organizationId,
    token_hash: String(params.p_token_hash),
    expires_at: String(params.p_expires_at),
    created_by: createdBy,
    created_at: new Date().toISOString(),
    role: String(params.p_role ?? 'admin'),
    target_therapist_id: (params.p_target_therapist_id as string | null | undefined) ?? null,
    revoked_at: null,
  };
  inviteTokens.push(stored);

  return {
    data: [{ id: stored.id, expires_at: stored.expires_at, status: 'created' }],
    error: null,
  };
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
  supabaseAdmin: {
    rpc: createAdminRpc,
    from: fromTable,
  },
}));

vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  getUserRoles,
}));

vi.mock('../../supabase/functions/_shared/org.ts', () => ({
  resolveOrgId,
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
    therapists.splice(0, therapists.length);
    adminActionRows.splice(0, adminActionRows.length);
    rollbackUpdateError = null;
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
    getUserRoles.mockClear();
    createRequestClient.mockClear();
    createAdminRpc.mockClear();
    resolveOrgId.mockClear();
    therapistLookupSpy.mockClear();
  });

  it('creates a scoped invite token, sends email, and logs the admin action', async () => {
    const handler = await loadHandler();

    const response = await handler(
      new Request('https://edge.example.com/admin/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: 'Bearer valid' },
        body: JSON.stringify({ email: 'NewAdmin@example.com', reason: 'Coverage for staff onboarding.' }),
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
      reason: 'Coverage for staff onboarding.',
    });

    expect(getUserRoles).toHaveBeenCalledTimes(1);
  }, 20_000);

  it('does not persist an invite token when the email service URL is missing', async () => {
    envValues.set('ADMIN_INVITE_EMAIL_URL', '');
    const handler = await loadHandler();

    const response = await handler(
      new Request('https://edge.example.com/admin/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: 'Bearer valid' },
        body: JSON.stringify({ email: 'missing-mailer@example.com', reason: 'Coverage for missing mailer.' }),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: 'email_service_unconfigured' });
    expect(createAdminRpc).not.toHaveBeenCalled();
    expect(inviteTokens).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(adminActionRows).toHaveLength(0);
  }, 20_000);

  it('does not persist an invite token when the portal URL is missing', async () => {
    envValues.set('ADMIN_PORTAL_URL', '');
    const handler = await loadHandler();

    const response = await handler(
      new Request('https://edge.example.com/admin/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: 'Bearer valid' },
        body: JSON.stringify({ email: 'missing-portal@example.com', reason: 'Coverage for missing portal.' }),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: 'portal_url_unconfigured' });
    expect(createAdminRpc).not.toHaveBeenCalled();
    expect(inviteTokens).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(adminActionRows).toHaveLength(0);
  }, 20_000);

  it('revokes the invite token when email delivery fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
    const handler = await loadHandler();

    const response = await handler(
      new Request('https://edge.example.com/admin/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: 'Bearer valid' },
        body: JSON.stringify({ email: 'mailer-failure@example.com', reason: 'Coverage for mailer failure.' }),
      }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ error: 'email_delivery_failed' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(inviteTokens).toHaveLength(1);
    expect(inviteTokens[0]?.revoked_at).toEqual(expect.any(String));
    expect(adminActionRows).toHaveLength(1);
    expect(adminActionRows[0]?.action_details).toMatchObject({
      email: 'mailer-failure@example.com',
      email_delivery_status: 'failed',
      email_error: 'Email service responded with status 503',
      reason: 'Coverage for mailer failure.',
    });
  }, 20_000);

  it('surfaces rollback failure when email delivery fails and invite revocation cannot complete', async () => {
    rollbackUpdateError = { message: 'revoke update denied' };
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
    const handler = await loadHandler();

    const response = await handler(
      new Request('https://edge.example.com/admin/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: 'Bearer valid' },
        body: JSON.stringify({ email: 'rollback-failure@example.com', reason: 'Coverage for rollback failure.' }),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: 'invite_rollback_failed' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(inviteTokens).toHaveLength(1);
    expect(inviteTokens[0]?.email).toBe('rollback-failure@example.com');
    expect(adminActionRows).toHaveLength(1);
    expect(adminActionRows[0]?.action_details).toMatchObject({
      email: 'rollback-failure@example.com',
      email_delivery_status: 'failed',
      email_error: 'Email service responded with status 503',
      reason: 'Coverage for rollback failure.',
    });
  }, 20_000);

  it('replaces an expired invite token with a new one', async () => {
    const expiredEmail = 'expiredadmin@example.com';
    const expiredToken: StoredInviteToken = {
      id: 'invite-old',
      email: expiredEmail,
      organization_id: 'org-123',
      token_hash: 'deadbeef',
      expires_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      created_by: 'admin-1',
      created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      role: 'admin',
      target_therapist_id: null,
      revoked_at: null,
    };
    inviteTokens.push(expiredToken);

    const handler = await loadHandler();

    const response = await handler(
      new Request('https://edge.example.com/admin/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: 'Bearer valid' },
        body: JSON.stringify({ email: expiredEmail, expiresInHours: 4 }),
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
      email: expiredEmail,
      email_delivery_status: 'sent',
    });
  }, 20_000);

  it('rejects replay while an active invite token already exists for the email and organization', async () => {
    inviteTokens.push({
      id: 'invite-active',
      email: 'activeadmin@example.com',
      organization_id: 'org-123',
      token_hash: 'deadbeef',
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      created_by: 'admin-1',
      created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      role: 'admin',
      target_therapist_id: null,
      revoked_at: null,
    });

    const handler = await loadHandler();

    const response = await handler(
      new Request('https://edge.example.com/admin/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: 'Bearer valid' },
        body: JSON.stringify({ email: 'activeadmin@example.com' }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: 'active_invite_exists' });
    expect(inviteTokens).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(adminActionRows).toHaveLength(0);
  }, 20_000);

  it('rate limits excessive invite creation by the same admin', async () => {
    const now = Date.now();
    for (let index = 0; index < 10; index += 1) {
      inviteTokens.push({
        id: `invite-${index}`,
        email: `candidate-${index}@example.com`,
        organization_id: 'org-123',
        token_hash: `hash-${index}`,
        expires_at: new Date(now + 60 * 60 * 1000).toISOString(),
        created_by: 'admin-1',
        created_at: new Date(now - index * 60 * 1000).toISOString(),
        role: 'admin',
        target_therapist_id: null,
        revoked_at: null,
      });
    }

    const handler = await loadHandler();

    const response = await handler(
      new Request('https://edge.example.com/admin/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: 'Bearer valid' },
        body: JSON.stringify({ email: 'overflow@example.com' }),
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('3600');
    await expect(response.json()).resolves.toMatchObject({
      error: 'invite_rate_limit_exceeded',
      retry_after_seconds: 3600,
    });
    expect(inviteTokens).toHaveLength(10);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(adminActionRows).toHaveLength(0);
  }, 20_000);

  it('prevents standard admins from inviting super admins', async () => {
    const handler = await loadHandler();

    const response = await handler(
      new Request('https://edge.example.com/admin/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: 'Bearer valid' },
        body: JSON.stringify({ email: 'super@example.com', role: 'super_admin' }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: 'insufficient_role_for_target' });
    expect(inviteTokens).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(adminActionRows).toHaveLength(0);
  }, 20_000);

  it('prevents standard admins from inviting BCBA staff', async () => {
    const handler = await loadHandler();

    const response = await handler(
      new Request('https://edge.example.com/admin/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: 'Bearer valid' },
        body: JSON.stringify({ email: 'bcba@example.com', role: 'bcba' }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: 'insufficient_role_for_target' });
    expect(inviteTokens).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(adminActionRows).toHaveLength(0);
  }, 20_000);

  it('allows standard admins to invite BT staff in their organization', async () => {
    const handler = await loadHandler();

    const response = await handler(
      new Request('https://edge.example.com/admin/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: 'Bearer valid' },
        body: JSON.stringify({ email: 'bt.staff@example.com', role: 'bt' }),
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      inviteId: expect.any(String),
      expiresAt: expect.any(String),
    });

    expect(inviteTokens).toHaveLength(1);
    expect(inviteTokens[0]).toMatchObject({
      email: 'bt.staff@example.com',
      organization_id: 'org-123',
      role: 'bt',
      target_therapist_id: null,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0];
    const emailPayload = JSON.parse(requestInit?.body as string);
    expect(emailPayload.variables).toMatchObject({
      role: 'bt',
      organization_id: 'org-123',
    });

    expect(adminActionRows).toHaveLength(1);
    expect(adminActionRows[0]?.action_details).toMatchObject({
      email: 'bt.staff@example.com',
      role: 'bt',
      email_delivery_status: 'sent',
    });
  }, 20_000);

  it('issues targeted BT invites against the canonical organization scope', async () => {
    therapists.push({
      id: '11111111-1111-4111-8111-111111111111',
      email: 'bt.staff@example.com',
      organization_id: 'org-123',
      status: 'active',
      deleted_at: null,
    });
    const handler = await loadHandler();

    const response = await handler(
      new Request('https://edge.example.com/admin/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: 'Bearer valid' },
        body: JSON.stringify({
          email: 'bt.staff@example.com',
          role: 'bt',
          targetTherapistId: '11111111-1111-4111-8111-111111111111',
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(resolveOrgId).toHaveBeenCalledWith(expect.anything());
    expect(createAdminRpc).toHaveBeenCalledWith(
      'create_admin_invite_token_rate_limited',
      expect.objectContaining({ p_target_therapist_id: '11111111-1111-4111-8111-111111111111' }),
    );
    expect(adminActionRows[0]?.action_details).toMatchObject({
      target_therapist_id: '11111111-1111-4111-8111-111111111111',
    });
  }, 20_000);

  it('rejects a targeted invite when a generic active invite already exists for the same org and email', async () => {
    inviteTokens.push({
      id: 'invite-generic-active',
      email: 'bt.staff@example.com',
      organization_id: 'org-123',
      token_hash: 'generic-active-hash',
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      created_by: 'admin-1',
      created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      role: 'bt',
      target_therapist_id: null,
      revoked_at: null,
    });
    therapists.push({
      id: '77777777-7777-4777-8777-777777777777',
      email: 'bt.staff@example.com',
      organization_id: 'org-123',
      status: 'active',
      deleted_at: null,
    });
    const handler = await loadHandler();

    const response = await handler(
      new Request('https://edge.example.com/admin/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: 'Bearer valid' },
        body: JSON.stringify({
          email: 'bt.staff@example.com',
          role: 'bt',
          targetTherapistId: '77777777-7777-4777-8777-777777777777',
        }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: 'active_invite_exists' });
    expect(therapistLookupSpy).toHaveBeenCalledTimes(1);
    expect(createAdminRpc).toHaveBeenCalledWith(
      'create_admin_invite_token_rate_limited',
      expect.objectContaining({ p_target_therapist_id: '77777777-7777-4777-8777-777777777777' }),
    );
    expect(inviteTokens).toHaveLength(1);
    expect(inviteTokens[0]).toMatchObject({ target_therapist_id: null });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(adminActionRows).toHaveLength(0);
  }, 20_000);

  it('rejects a generic invite when a targeted active invite already exists for the same org and email', async () => {
    inviteTokens.push({
      id: 'invite-targeted-active',
      email: 'bt.staff@example.com',
      organization_id: 'org-123',
      token_hash: 'targeted-active-hash',
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      created_by: 'admin-1',
      created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      role: 'bt',
      target_therapist_id: '88888888-8888-4888-8888-888888888888',
      revoked_at: null,
    });
    const handler = await loadHandler();

    const response = await handler(
      new Request('https://edge.example.com/admin/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: 'Bearer valid' },
        body: JSON.stringify({
          email: 'bt.staff@example.com',
          role: 'bt',
        }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: 'active_invite_exists' });
    expect(createAdminRpc).toHaveBeenCalledWith(
      'create_admin_invite_token_rate_limited',
      expect.objectContaining({ p_target_therapist_id: null }),
    );
    expect(therapistLookupSpy).not.toHaveBeenCalled();
    expect(inviteTokens).toHaveLength(1);
    expect(inviteTokens[0]).toMatchObject({ target_therapist_id: '88888888-8888-4888-8888-888888888888' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(adminActionRows).toHaveLength(0);
  }, 20_000);

  it('rejects targeted invites when the requested role is not bt', async () => {
    therapists.push({
      id: '66666666-6666-4666-8666-666666666666',
      email: 'therapist.staff@example.com',
      organization_id: 'org-123',
      status: 'active',
      deleted_at: null,
    });
    const handler = await loadHandler();

    const response = await handler(
      new Request('https://edge.example.com/admin/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: 'Bearer valid' },
        body: JSON.stringify({
          email: 'therapist.staff@example.com',
          role: 'therapist',
          targetTherapistId: '66666666-6666-4666-8666-666666666666',
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: 'target_therapist_role_forbidden' });
    expect(therapistLookupSpy).not.toHaveBeenCalled();
    expect(createAdminRpc).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(adminActionRows).toHaveLength(0);
    expect(inviteTokens).toHaveLength(0);
  }, 20_000);

  it('rejects targeted invites when the therapist belongs to another organization', async () => {
    therapists.push({
      id: '22222222-2222-4222-8222-222222222222',
      email: 'bt.staff@example.com',
      organization_id: 'org-999',
      status: 'active',
      deleted_at: null,
    });
    const handler = await loadHandler();

    const response = await handler(
      new Request('https://edge.example.com/admin/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: 'Bearer valid' },
        body: JSON.stringify({
          email: 'bt.staff@example.com',
          role: 'bt',
          targetTherapistId: '22222222-2222-4222-8222-222222222222',
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(createAdminRpc).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  }, 20_000);

  it('rejects targeted invites when the therapist email does not match', async () => {
    therapists.push({
      id: '33333333-3333-4333-8333-333333333333',
      email: 'other.staff@example.com',
      organization_id: 'org-123',
      status: 'active',
      deleted_at: null,
    });
    const handler = await loadHandler();

    const response = await handler(
      new Request('https://edge.example.com/admin/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: 'Bearer valid' },
        body: JSON.stringify({
          email: 'bt.staff@example.com',
          role: 'bt',
          targetTherapistId: '33333333-3333-4333-8333-333333333333',
        }),
      }),
    );

    expect(response.status).toBe(409);
    expect(createAdminRpc).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  }, 20_000);

  it('rejects targeted invites when the therapist is inactive', async () => {
    therapists.push({
      id: '44444444-4444-4444-8444-444444444444',
      email: 'bt.staff@example.com',
      organization_id: 'org-123',
      status: 'inactive',
      deleted_at: null,
    });
    const handler = await loadHandler();

    const response = await handler(
      new Request('https://edge.example.com/admin/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: 'Bearer valid' },
        body: JSON.stringify({
          email: 'bt.staff@example.com',
          role: 'bt',
          targetTherapistId: '44444444-4444-4444-8444-444444444444',
        }),
      }),
    );

    expect(response.status).toBe(409);
    expect(createAdminRpc).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  }, 20_000);

  it('rejects targeted invites when the therapist is soft deleted', async () => {
    therapists.push({
      id: '55555555-5555-4555-8555-555555555555',
      email: 'bt.staff@example.com',
      organization_id: 'org-123',
      status: 'active',
      deleted_at: new Date().toISOString(),
    });
    const handler = await loadHandler();

    const response = await handler(
      new Request('https://edge.example.com/admin/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: 'Bearer valid' },
        body: JSON.stringify({
          email: 'bt.staff@example.com',
          role: 'bt',
          targetTherapistId: '55555555-5555-4555-8555-555555555555',
        }),
      }),
    );

    expect(response.status).toBe(409);
    expect(createAdminRpc).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  }, 20_000);

  it('fails closed for BCBA callers before invite side effects begin', async () => {
    currentUserContext = {
      user: { id: 'bcba-1', email: 'bcba@example.com' },
      profile: { id: 'profile-bcba-1', email: 'bcba@example.com', role: 'bcba', is_active: true },
    };

    const handler = await loadHandler();

    const response = await handler(
      new Request('https://edge.example.com/admin/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: 'Bearer valid' },
        body: JSON.stringify({ email: 'bt.staff@example.com', role: 'bt' }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: 'insufficient_role' });
    expect(getUserRoles).toHaveBeenCalledTimes(1);
    expect(createAdminRpc).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(adminActionRows).toHaveLength(0);
    expect(inviteTokens).toHaveLength(0);
  }, 20_000);

  it('allows a multi-role caller with an active admin assignment', async () => {
    currentUserContext = {
      user: { id: 'multi-role-1', email: 'multi-role@example.com' },
      profile: { id: 'profile-multi-role-1', email: 'multi-role@example.com', role: 'bcba', is_active: true },
    };
    getUserRoles.mockResolvedValueOnce(['bcba', 'admin']);
    const handler = await loadHandler();

    const response = await handler(
      new Request('https://edge.example.com/admin/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: 'Bearer valid' },
        body: JSON.stringify({ email: 'bt.staff@example.com', role: 'bt' }),
      }),
    );

    expect(response.status).toBe(201);
    expect(createAdminRpc).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(adminActionRows).toHaveLength(1);
    expect(inviteTokens).toHaveLength(1);
  }, 20_000);
});
