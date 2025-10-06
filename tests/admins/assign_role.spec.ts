import { describe, expect } from 'vitest';
import { selectTest } from '../utils/testControls';

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

describe('Admin role assignments', () => {
  const tokenOrgA = process.env.TEST_JWT_ORG_A as string;

  const removalTest = selectTest({
    run: process.env.RUN_ADMIN_ROLE_REMOVAL_TEST === 'true',
    reason: 'Seeded admin fixtures required. Enable by setting RUN_ADMIN_ROLE_REMOVAL_TEST=true.',
  });

  removalTest('removes admins within the same organization', async () => {
    if (!tokenOrgA) return;

    const { status: orgStatus, json: orgJson } = await callRpc('current_user_organization_id', tokenOrgA);
    expect([200, 204]).toContain(orgStatus);

    const organizationId = typeof orgJson === 'string'
      ? orgJson
      : typeof (orgJson as Record<string, unknown> | null)?.organization_id === 'string'
        ? (orgJson as Record<string, string>).organization_id
        : null;

    expect(organizationId).toBeTypeOf('string');
    if (!organizationId) return;

    // TODO: Replace placeholder ID with seeded admin fixture once available.
    const targetAdminId = process.env.TEST_ADMIN_ID_ORG_A;
    expect(targetAdminId).toBeTypeOf('string');
    if (!targetAdminId) return;

    const { status } = await callRpc('manage_admin_users', tokenOrgA, {
      operation: 'remove',
      target_user_id: targetAdminId,
    });

    expect([200, 204]).toContain(status);
  });
});
