import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubDenoEnv } from '../utils/stubDeno';

type StoredInviteToken = {
  id: string;
  email: string;
  organization_id: string;
  token_hash: string;
  expires_at: string;
  created_by: string;
  created_at: string;
  role: string;
  target_therapist_id: string | null;
  accepted_at: string | null;
  accepted_by_user_id: string | null;
  revoked_at: string | null;
};

type TherapistRow = {
  id: string;
  email: string;
  organization_id: string;
  status: string;
  deleted_at: string | null;
};

const envValues = new Map<string, string>([
  ['SUPABASE_URL', 'http://localhost'],
  ['SUPABASE_SERVICE_ROLE_KEY', 'service-role'],
]);

stubDenoEnv((key) => envValues.get(key) ?? '');

const inviteTokens: StoredInviteToken[] = [];
const therapists: TherapistRow[] = [];
const roleRows = [
  { id: 'role-bt', name: 'bt' },
  { id: 'role-admin', name: 'admin' },
  { id: 'role-bcba', name: 'bcba' },
];
const createdUsers: Array<Record<string, unknown>> = [];
const upsertedUserRoles: Array<Record<string, unknown>> = [];
const upsertedProfiles: Array<Record<string, unknown>> = [];
const insertedTherapistLinks: Array<Record<string, unknown>> = [];
const consumedInvites: Array<Record<string, unknown>> = [];
const adminActionRows: Array<Record<string, unknown>> = [];
const deletedInviteTokenHashes: string[] = [];
const deletedAuthUserIds: string[] = [];
let failCreateUser = false;
let failUserRoleUpsert = false;
let failProfileUpsert = false;
let failTherapistLinkUpsert = false;
let failInviteConsumeUpdate = false;

const toHex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

const hashToken = async (token: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return toHex(digest);
};

const makeSingleQuery = (table: string, filters: Record<string, unknown>) => ({
  single: vi.fn(async () => {
    if (table === 'admin_invite_tokens') {
      const match = inviteTokens.find((token) => token.token_hash === filters.token_hash) ?? null;
      return match ? { data: match, error: null } : { data: null, error: { code: 'PGRST116', message: 'No rows' } };
    }

    if (table === 'therapists') {
      const match = therapists.find((therapist) => therapist.id === filters.id) ?? null;
      return match ? { data: match, error: null } : { data: null, error: { code: 'PGRST116', message: 'No rows' } };
    }

    if (table === 'roles') {
      const match = roleRows.find((role) => role.name === filters.name) ?? null;
      return match ? { data: match, error: null } : { data: null, error: { code: 'PGRST116', message: 'No rows' } };
    }

    throw new Error(`Unexpected single query for ${table}`);
  }),
});

const makeTableClient = (table: string) => ({
  select: vi.fn(function select(_columns?: string) {
    return this;
  }),
  eq: vi.fn(function eq(column: string, value: unknown) {
    return makeSingleQuery(table, { [column]: value });
  }),
  upsert: vi.fn(async (payload: Record<string, unknown>) => {
    if (table === 'user_roles') {
      if (failUserRoleUpsert) {
        return { error: { message: 'user role upsert failed' } };
      }
      upsertedUserRoles.push(payload);
      return { error: null };
    }

    if (table === 'profiles') {
      if (failProfileUpsert) {
        return { error: { message: 'profile upsert failed' } };
      }
      upsertedProfiles.push(payload);
      return { error: null };
    }

    if (table === 'user_therapist_links') {
      if (failTherapistLinkUpsert) {
        return { error: { message: 'therapist link upsert failed' } };
      }
      insertedTherapistLinks.push(payload);
      return { error: null };
    }

    throw new Error(`Unexpected upsert for ${table}`);
  }),
  update: vi.fn((payload: Record<string, unknown>) => ({
    eq: vi.fn((column: string, value: unknown) => ({
      is: vi.fn((firstNullColumn: string, firstNullValue: unknown) => ({
        is: vi.fn((secondNullColumn: string, secondNullValue: unknown) => ({
          select: vi.fn((_columns?: string) => ({
            single: vi.fn(async () => {
              if (table !== 'admin_invite_tokens') {
                throw new Error(`Unexpected update for ${table}`);
              }

              if (column !== 'id' || firstNullValue !== null || secondNullValue !== null) {
                throw new Error(`Unexpected compare-and-set for ${table}`);
              }

              const match = inviteTokens.find(
                (token) =>
                  token.id === value &&
                  token[firstNullColumn as keyof StoredInviteToken] === null &&
                  token[secondNullColumn as keyof StoredInviteToken] === null,
              );

              if (!match || failInviteConsumeUpdate) {
                return { data: null, error: { code: 'PGRST116', message: 'No rows' } };
              }

              match.accepted_at = String(payload.accepted_at ?? new Date().toISOString());
              match.accepted_by_user_id = String(payload.accepted_by_user_id ?? '');
              consumedInvites.push({
                id: match.id,
                accepted_at: match.accepted_at,
                accepted_by_user_id: match.accepted_by_user_id,
              });
              return { data: match, error: null };
            }),
          })),
        })),
      })),
    })),
  })),
  insert: vi.fn(async (payload: Record<string, unknown>) => {
    if (table === 'admin_actions') {
      adminActionRows.push(payload);
      return { error: null };
    }

    throw new Error(`Unexpected insert for ${table}`);
  }),
  delete: vi.fn(function deleteRow() {
    return {
      eq: vi.fn(async (column: string, value: unknown) => {
        if (table !== 'admin_invite_tokens' || column !== 'token_hash') {
          throw new Error(`Unexpected delete for ${table}.${column}`);
        }

        deletedInviteTokenHashes.push(String(value));
        const index = inviteTokens.findIndex((token) => token.token_hash === value);
        if (index >= 0) {
          inviteTokens.splice(index, 1);
        }
        return { error: null };
      }),
    };
  }),
});

const supabaseAdmin = {
  auth: {
    admin: {
      createUser: vi.fn(async (payload: Record<string, unknown>) => {
        if (failCreateUser) {
          return {
            data: { user: null },
            error: { message: 'create user failed' },
          };
        }
        createdUsers.push(payload);
        return {
          data: { user: { id: 'new-user-1', email: payload.email } },
          error: null,
        };
      }),
      deleteUser: vi.fn(async (userId: string) => {
        deletedAuthUserIds.push(userId);
        return { error: null };
      }),
    },
  },
  from: vi.fn((table: string) => makeTableClient(table)),
};

vi.mock('../../supabase/functions/_shared/database.ts', () => ({
  supabaseAdmin,
}));

vi.mock('../../supabase/functions/_shared/auth-middleware.ts', () => ({
  corsHeadersForRequest: (req: Request) => ({
    'Access-Control-Allow-Origin': req.headers.get('origin') ?? 'https://app.allincompassing.ai',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Client-Info, apikey',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }),
  createPublicRoute: (handler: (req: Request, context: null) => Promise<Response>) => {
    return (req: Request) => {
      if (req.method === 'OPTIONS') {
        const origin = req.headers.get('origin') ?? 'https://app.allincompassing.ai';
        return new Response('ok', {
          headers: {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Client-Info, apikey',
            'Access-Control-Max-Age': '86400',
            Vary: 'Origin',
          },
        });
      }
      return handler(req, null);
    };
  },
}));

describe('accept staff invite edge function', () => {
  const rawToken = '0123456789abcdef0123456789abcdef';

  const loadHandler = async () => {
    const module = await import('../../supabase/functions/accept-staff-invite/index.ts');
    return module.handler as (req: Request) => Promise<Response>;
  };

  beforeEach(async () => {
    vi.resetModules();
    inviteTokens.splice(0, inviteTokens.length);
    therapists.splice(0, therapists.length);
    createdUsers.splice(0, createdUsers.length);
    upsertedUserRoles.splice(0, upsertedUserRoles.length);
    upsertedProfiles.splice(0, upsertedProfiles.length);
    insertedTherapistLinks.splice(0, insertedTherapistLinks.length);
    consumedInvites.splice(0, consumedInvites.length);
    adminActionRows.splice(0, adminActionRows.length);
    deletedInviteTokenHashes.splice(0, deletedInviteTokenHashes.length);
    deletedAuthUserIds.splice(0, deletedAuthUserIds.length);
    supabaseAdmin.auth.admin.createUser.mockClear();
    supabaseAdmin.auth.admin.deleteUser.mockClear();
    supabaseAdmin.from.mockClear();
    failCreateUser = false;
    failUserRoleUpsert = false;
    failProfileUpsert = false;
    failTherapistLinkUpsert = false;
    failInviteConsumeUpdate = false;
  });

  const buildInvite = async (overrides: Partial<StoredInviteToken> = {}) => ({
    id: 'invite-1',
    email: 'bt.staff@example.com',
    organization_id: 'org-123',
    token_hash: await hashToken(rawToken),
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    created_by: 'admin-1',
    created_at: new Date().toISOString(),
    role: 'bt',
    target_therapist_id: null,
    accepted_at: null,
    accepted_by_user_id: null,
    revoked_at: null,
    ...overrides,
  });

  it('creates the invited BT account, assigns role, updates profile, logs acceptance, and consumes the token', async () => {
    therapists.push({
      id: 'therapist-1',
      email: 'bt.staff@example.com',
      organization_id: 'org-123',
      status: 'active',
      deleted_at: null,
    });
    const invite = await buildInvite({ target_therapist_id: 'therapist-1' });
    inviteTokens.push(invite);

    const handler = await loadHandler();

    const response = await handler(
      new Request('https://edge.example.com/accept-staff-invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token: rawToken,
          password: 'StrongPass123!',
          first_name: 'Bea',
          last_name: 'Therapist',
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      email: 'bt.staff@example.com',
      role: 'bt',
    });

    expect(createdUsers).toHaveLength(1);
    expect(createdUsers[0]).toMatchObject({
      email: 'bt.staff@example.com',
      password: 'StrongPass123!',
      email_confirm: true,
      user_metadata: expect.objectContaining({
        first_name: 'Bea',
        last_name: 'Therapist',
        organization_id: 'org-123',
        role: 'bt',
      }),
    });

    expect(upsertedUserRoles).toEqual([
      expect.objectContaining({
        user_id: 'new-user-1',
        role_id: 'role-bt',
        granted_by: 'admin-1',
        is_active: true,
      }),
    ]);
    expect(upsertedProfiles).toEqual([
      expect.objectContaining({
        id: 'new-user-1',
        email: 'bt.staff@example.com',
        first_name: 'Bea',
        last_name: 'Therapist',
        organization_id: 'org-123',
        role: 'bt',
        is_active: true,
      }),
    ]);
    expect(insertedTherapistLinks).toEqual([
      { user_id: 'new-user-1', therapist_id: 'therapist-1' },
    ]);
    expect(consumedInvites).toEqual([
      expect.objectContaining({ id: 'invite-1', accepted_by_user_id: 'new-user-1' }),
    ]);
    expect(adminActionRows).toEqual([
      expect.objectContaining({
        admin_user_id: 'admin-1',
        target_user_id: 'new-user-1',
        organization_id: 'org-123',
        action_type: 'staff_invite_accepted',
        action_details: expect.objectContaining({
          invite_id: 'invite-1',
          email: 'bt.staff@example.com',
          role: 'bt',
        }),
      }),
    ]);
    expect(deletedInviteTokenHashes).toHaveLength(0);
    expect(inviteTokens).toHaveLength(1);
    expect(inviteTokens[0]).toMatchObject({
      accepted_by_user_id: 'new-user-1',
    });
  }, 20_000);

  it('rejects replay after a successful invite acceptance', async () => {
    therapists.push({
      id: 'therapist-1',
      email: 'bt.staff@example.com',
      organization_id: 'org-123',
      status: 'active',
      deleted_at: null,
    });
    inviteTokens.push(await buildInvite({ target_therapist_id: 'therapist-1' }));

    const handler = await loadHandler();
    const requestBody = {
      token: rawToken,
      password: 'StrongPass123!',
      first_name: 'Bea',
      last_name: 'Therapist',
    };

    const firstResponse = await handler(
      new Request('https://edge.example.com/accept-staff-invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requestBody),
      }),
    );
    expect(firstResponse.status).toBe(200);

    const replayResponse = await handler(
      new Request('https://edge.example.com/accept-staff-invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requestBody),
      }),
    );

    expect(replayResponse.status).toBe(404);
    await expect(replayResponse.json()).resolves.toMatchObject({ error: 'invite_not_found' });
    expect(createdUsers).toHaveLength(1);
    expect(consumedInvites).toHaveLength(1);
  }, 20_000);

  it('does not consume the token when account creation fails', async () => {
    failCreateUser = true;
    inviteTokens.push(await buildInvite({ id: 'invite-create-fails' }));

    const handler = await loadHandler();
    const response = await handler(
      new Request('https://edge.example.com/accept-staff-invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: rawToken, password: 'StrongPass123!' }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: 'account_creation_failed' });
    expect(deletedInviteTokenHashes).toHaveLength(0);
    expect(inviteTokens).toHaveLength(1);
  }, 20_000);

  it('deletes the partially created auth user when role assignment fails', async () => {
    failUserRoleUpsert = true;
    inviteTokens.push(await buildInvite({ id: 'invite-role-fails' }));

    const handler = await loadHandler();
    const response = await handler(
      new Request('https://edge.example.com/accept-staff-invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: rawToken, password: 'StrongPass123!' }),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: 'role_assignment_failed' });
    expect(deletedAuthUserIds).toEqual(['new-user-1']);
    expect(deletedInviteTokenHashes).toHaveLength(0);
  }, 20_000);

  it('deletes the partially created auth user when profile sync fails', async () => {
    failProfileUpsert = true;
    inviteTokens.push(await buildInvite({ id: 'invite-profile-fails' }));

    const handler = await loadHandler();
    const response = await handler(
      new Request('https://edge.example.com/accept-staff-invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: rawToken, password: 'StrongPass123!' }),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: 'profile_sync_failed' });
    expect(deletedAuthUserIds).toEqual(['new-user-1']);
    expect(deletedInviteTokenHashes).toHaveLength(0);
  }, 20_000);

  it('returns request-scoped CORS headers for preflight requests', async () => {
    const handler = await loadHandler();

    const response = await handler(
      new Request('https://edge.example.com/accept-staff-invite', {
        method: 'OPTIONS',
        headers: { origin: 'https://preview.allincompassing.ai' },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://preview.allincompassing.ai');
    expect(response.headers.get('Vary')).toBe('Origin');
    expect(createdUsers).toHaveLength(0);
  }, 20_000);

  it('rejects missing or expired invite tokens without creating a user', async () => {
    const expiredInvite = await buildInvite({
      id: 'invite-expired',
      email: 'expired@example.com',
      expires_at: new Date(Date.now() - 60 * 1000).toISOString(),
      created_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    });
    inviteTokens.push(expiredInvite);

    const handler = await loadHandler();

    const response = await handler(
      new Request('https://edge.example.com/accept-staff-invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: rawToken, password: 'StrongPass123!' }),
      }),
    );

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({ error: 'invite_expired' });
    expect(createdUsers).toHaveLength(0);
    expect(deletedInviteTokenHashes).toEqual([expiredInvite.token_hash]);
  }, 20_000);

  it('rejects targeted invites when the therapist belongs to another organization', async () => {
    therapists.push({
      id: 'therapist-org-mismatch',
      email: 'bt.staff@example.com',
      organization_id: 'org-999',
      status: 'active',
      deleted_at: null,
    });
    inviteTokens.push(await buildInvite({ id: 'invite-org-mismatch', target_therapist_id: 'therapist-org-mismatch' }));

    const handler = await loadHandler();
    const response = await handler(
      new Request('https://edge.example.com/accept-staff-invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: rawToken, password: 'StrongPass123!' }),
      }),
    );

    expect(response.status).toBe(409);
    expect(createdUsers).toHaveLength(0);
    expect(consumedInvites).toHaveLength(0);
  }, 20_000);

  it('rejects targeted invites when the therapist email does not match', async () => {
    therapists.push({
      id: 'therapist-email-mismatch',
      email: 'other.staff@example.com',
      organization_id: 'org-123',
      status: 'active',
      deleted_at: null,
    });
    inviteTokens.push(await buildInvite({ id: 'invite-email-mismatch', target_therapist_id: 'therapist-email-mismatch' }));

    const handler = await loadHandler();
    const response = await handler(
      new Request('https://edge.example.com/accept-staff-invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: rawToken, password: 'StrongPass123!' }),
      }),
    );

    expect(response.status).toBe(409);
    expect(createdUsers).toHaveLength(0);
    expect(consumedInvites).toHaveLength(0);
  }, 20_000);

  it('rejects targeted invites when the therapist is inactive', async () => {
    therapists.push({
      id: 'therapist-inactive',
      email: 'bt.staff@example.com',
      organization_id: 'org-123',
      status: 'inactive',
      deleted_at: null,
    });
    inviteTokens.push(await buildInvite({ id: 'invite-inactive', target_therapist_id: 'therapist-inactive' }));

    const handler = await loadHandler();
    const response = await handler(
      new Request('https://edge.example.com/accept-staff-invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: rawToken, password: 'StrongPass123!' }),
      }),
    );

    expect(response.status).toBe(409);
    expect(createdUsers).toHaveLength(0);
    expect(consumedInvites).toHaveLength(0);
  }, 20_000);

  it('rejects targeted invites when the therapist is soft deleted', async () => {
    therapists.push({
      id: 'therapist-deleted',
      email: 'bt.staff@example.com',
      organization_id: 'org-123',
      status: 'active',
      deleted_at: new Date().toISOString(),
    });
    inviteTokens.push(await buildInvite({ id: 'invite-deleted', target_therapist_id: 'therapist-deleted' }));

    const handler = await loadHandler();
    const response = await handler(
      new Request('https://edge.example.com/accept-staff-invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: rawToken, password: 'StrongPass123!' }),
      }),
    );

    expect(response.status).toBe(409);
    expect(createdUsers).toHaveLength(0);
    expect(consumedInvites).toHaveLength(0);
  }, 20_000);

  it('rejects revoked invites before account creation', async () => {
    inviteTokens.push(await buildInvite({ id: 'invite-revoked', revoked_at: new Date().toISOString() }));

    const handler = await loadHandler();
    const response = await handler(
      new Request('https://edge.example.com/accept-staff-invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: rawToken, password: 'StrongPass123!' }),
      }),
    );

    expect(response.status).toBe(404);
    expect(createdUsers).toHaveLength(0);
  }, 20_000);

  it('rejects already accepted invites before account creation', async () => {
    inviteTokens.push(
      await buildInvite({
        id: 'invite-accepted',
        accepted_at: new Date().toISOString(),
        accepted_by_user_id: 'existing-user-1',
      }),
    );

    const handler = await loadHandler();
    const response = await handler(
      new Request('https://edge.example.com/accept-staff-invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: rawToken, password: 'StrongPass123!' }),
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: 'invite_not_found' });
    expect(createdUsers).toHaveLength(0);
    expect(insertedTherapistLinks).toHaveLength(0);
    expect(consumedInvites).toHaveLength(0);
  }, 20_000);

  it('rejects targeted invites when the stored role is not bt without side effects', async () => {
    therapists.push({
      id: 'therapist-role-forbidden',
      email: 'bt.staff@example.com',
      organization_id: 'org-123',
      status: 'active',
      deleted_at: null,
    });
    inviteTokens.push(
      await buildInvite({
        id: 'invite-role-forbidden',
        role: 'bcba',
        target_therapist_id: 'therapist-role-forbidden',
      }),
    );

    const handler = await loadHandler();
    const response = await handler(
      new Request('https://edge.example.com/accept-staff-invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: rawToken, password: 'StrongPass123!' }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: 'invite_target_role_forbidden' });
    expect(createdUsers).toHaveLength(0);
    expect(upsertedUserRoles).toHaveLength(0);
    expect(upsertedProfiles).toHaveLength(0);
    expect(insertedTherapistLinks).toHaveLength(0);
    expect(consumedInvites).toHaveLength(0);
    expect(deletedAuthUserIds).toHaveLength(0);
    expect(adminActionRows).toHaveLength(0);
  }, 20_000);

  it('deletes the partially created auth user when therapist link creation fails', async () => {
    failTherapistLinkUpsert = true;
    therapists.push({
      id: 'therapist-link-fail',
      email: 'bt.staff@example.com',
      organization_id: 'org-123',
      status: 'active',
      deleted_at: null,
    });
    inviteTokens.push(await buildInvite({ id: 'invite-link-fails', target_therapist_id: 'therapist-link-fail' }));

    const handler = await loadHandler();
    const response = await handler(
      new Request('https://edge.example.com/accept-staff-invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: rawToken, password: 'StrongPass123!' }),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: 'therapist_link_failed' });
    expect(deletedAuthUserIds).toEqual(['new-user-1']);
    expect(consumedInvites).toHaveLength(0);
  }, 20_000);

  it('deletes the partially created auth user when invite consumption fails', async () => {
    failInviteConsumeUpdate = true;
    therapists.push({
      id: 'therapist-consume-fail',
      email: 'bt.staff@example.com',
      organization_id: 'org-123',
      status: 'active',
      deleted_at: null,
    });
    inviteTokens.push(await buildInvite({ id: 'invite-consume-fails', target_therapist_id: 'therapist-consume-fail' }));

    const handler = await loadHandler();
    const response = await handler(
      new Request('https://edge.example.com/accept-staff-invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: rawToken, password: 'StrongPass123!' }),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: 'invite_consumption_failed' });
    expect(deletedAuthUserIds).toEqual(['new-user-1']);
    expect(consumedInvites).toHaveLength(0);
  }, 20_000);
});
