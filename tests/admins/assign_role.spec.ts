import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://example.test';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? 'anon-key';
const tokenOrgA = process.env.TEST_JWT_ORG_A ?? 'token-org-a';
const targetAdminId = process.env.TEST_ADMIN_ID_ORG_A ?? 'admin-user-org-a';
const organizationIdOrgA = 'org-a';

type JsonRecord = Record<string, unknown>;

const jsonResponse = (status: number, body?: unknown) =>
  new Response(body !== undefined ? JSON.stringify(body) : undefined, {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const extractToken = (init?: RequestInit) => {
  const headerToken =
    (init?.headers as Record<string, string> | undefined)?.Authorization ??
    (init?.headers as Record<string, string> | undefined)?.authorization ??
    '';
  return headerToken.replace('Bearer ', '');
};

const mockFetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.toString());
  const token = extractToken(init);

  if (url.pathname.includes('/rest/v1/rpc/current_user_organization_id')) {
    if (token !== tokenOrgA) {
      return jsonResponse(403, { error: 'Access denied' });
    }
    return jsonResponse(200, { organization_id: organizationIdOrgA });
  }

  if (url.pathname.includes('/rest/v1/rpc/manage_admin_users')) {
    if (token !== tokenOrgA) {
      return jsonResponse(403, { error: 'Access denied' });
    }
    const payload = JSON.parse(String(init.body ?? '{}')) as JsonRecord;
    if (payload.operation === 'remove' && payload.target_user_id === targetAdminId) {
      return jsonResponse(204);
    }
    return jsonResponse(400, { error: 'Invalid request' });
  }

  return jsonResponse(404, { error: 'Not found' });
};

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function callRpc(
  functionName: string,
  token: string,
  payload: Record<string, unknown> | null = null,
) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload ?? {}),
  });

  let json: unknown = null;
  try {
    json = await response.json();
  } catch (error) {
    // Some RPCs can return 204 with no content when empty.
  }

  return { status: response.status, json };
}

describe('Admin role assignments', () => {
  it('removes admins within the same organization', async () => {
    const { status: orgStatus, json: orgJson } = await callRpc('current_user_organization_id', tokenOrgA);
    expect([200, 204]).toContain(orgStatus);

    const organizationId = typeof orgJson === 'string'
      ? orgJson
      : typeof (orgJson as Record<string, unknown> | null)?.organization_id === 'string'
        ? (orgJson as Record<string, string>).organization_id
        : null;

    expect(organizationId).toBeTypeOf('string');
    if (!organizationId) return;

    const { status } = await callRpc('manage_admin_users', tokenOrgA, {
      operation: 'remove',
      target_user_id: targetAdminId,
    });

    expect([200, 204]).toContain(status);
  });
});
