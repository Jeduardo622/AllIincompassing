import { describe, it, expect } from 'vitest';

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY as string;

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

describe('Admin RPC organization scope', () => {
  const tokenOrgA = process.env.TEST_JWT_ORG_A as string;
  const tokenOrgB = process.env.TEST_JWT_ORG_B as string;

  it('denies cross-organization admin listings', async () => {
    if (!tokenOrgA || !tokenOrgB) return;

    const { status: orgStatus, json: orgJson } = await callRpc('current_user_organization_id', tokenOrgA);
    expect([200, 204]).toContain(orgStatus);

    const organizationId = typeof orgJson === 'string'
      ? orgJson
      : typeof (orgJson as Record<string, unknown> | null)?.organization_id === 'string'
        ? (orgJson as Record<string, string>).organization_id
        : null;

    expect(organizationId).toBeTypeOf('string');
    if (!organizationId) return;

    const { status, json } = await callRpc('get_admin_users', tokenOrgB, { organization_id: organizationId });

    expect([401, 403]).toContain(status);
    if (status === 403 && json && typeof json === 'object') {
      const payload = json as Record<string, unknown>;
      const message = typeof payload.error === 'string'
        ? payload.error
        : typeof payload.message === 'string'
          ? payload.message
          : '';
      expect(message.toLowerCase()).toContain('denied');
    }
  });

  it('allows same-organization admin listings', async () => {
    if (!tokenOrgA) return;

    const { status: orgStatus, json: orgJson } = await callRpc('current_user_organization_id', tokenOrgA);
    expect([200, 204]).toContain(orgStatus);

    const organizationId = typeof orgJson === 'string'
      ? orgJson
      : typeof (orgJson as Record<string, unknown> | null)?.organization_id === 'string'
        ? (orgJson as Record<string, string>).organization_id
        : null;

    if (!organizationId) return;

    const { status, json } = await callRpc('get_admin_users', tokenOrgA, { organization_id: organizationId });
    expect([200, 204]).toContain(status);
    if (status === 200) {
      expect(Array.isArray(json)).toBe(true);
    }
  });
});
