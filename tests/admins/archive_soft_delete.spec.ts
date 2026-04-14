import { describe, it, expect } from 'vitest';

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY as string;

async function callRpc(
  functionName: string,
  token: string,
  payload: Record<string, unknown>,
) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  let json: unknown = null;
  try {
    json = await response.json();
  } catch (error) {
    // Some RPCs can return 204 with no content
  }

  return { status: response.status, json };
}

async function fetchRow(
  table: 'clients' | 'therapists',
  token: string,
  filters: string,
) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=id,organization_id,deleted_at&${filters}`, {
    method: 'GET',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      Prefer: 'return=representation',
    },
  });

  const json = (await response.json()) as unknown;
  const row = Array.isArray(json)
    ? (json[0] as { id: string; organization_id: string | null; deleted_at: string | null })
    : null;

  return { status: response.status, row };
}

type AdminActionRow = { action_type: string; action_details: Record<string, unknown> | null };

async function fetchRecentAdminActions(orgId: string, token: string) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/admin_actions?select=action_type,action_details,created_at&organization_id=eq.${orgId}&order=created_at.desc&limit=15`,
    {
      method: 'GET',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    },
  );
  const json = (await response.json()) as unknown;
  const rows = Array.isArray(json) ? (json as AdminActionRow[]) : [];
  return { status: response.status, rows };
}

describe('Soft delete archive controls', () => {
  const tokenOrgA = process.env.TEST_JWT_ORG_A as string;
  const tokenOrgB = process.env.TEST_JWT_ORG_B as string;

  it('enforces organization scoped archive controls for clients', async () => {
    if (!tokenOrgA || !tokenOrgB) return;

    const { row: client } = await fetchRow('clients', tokenOrgA, 'deleted_at=is.null&limit=1');
    expect(client).toBeTruthy();
    if (!client) return;

    const archiveResult = await callRpc('set_client_archive_state', tokenOrgA, {
      p_client_id: client.id,
      p_restore: false,
    });
    expect([200, 204]).toContain(archiveResult.status);
    expect((archiveResult.json as { deleted_at?: string | null } | null)?.deleted_at).toBeTruthy();

    const crossOrg = await callRpc('set_client_archive_state', tokenOrgB, {
      p_client_id: client.id,
      p_restore: true,
    });
    expect([401, 403, 400]).toContain(crossOrg.status);

    const { row: archivedRow } = await fetchRow('clients', tokenOrgA, `id=eq.${client.id}`);
    expect(archivedRow?.deleted_at).toBeTruthy();

    const restoreResult = await callRpc('set_client_archive_state', tokenOrgA, {
      p_client_id: client.id,
      p_restore: true,
    });
    expect([200, 204]).toContain(restoreResult.status);

    const { row: restoredRow } = await fetchRow('clients', tokenOrgA, `id=eq.${client.id}`);
    expect(restoredRow?.deleted_at).toBeNull();
  });

  it('enforces organization scoped archive controls for therapists', async () => {
    if (!tokenOrgA || !tokenOrgB) return;

    const { row: therapist } = await fetchRow('therapists', tokenOrgA, 'deleted_at=is.null&limit=1');
    expect(therapist).toBeTruthy();
    if (!therapist) return;

    const archiveResult = await callRpc('set_therapist_archive_state', tokenOrgA, {
      p_therapist_id: therapist.id,
      p_restore: false,
    });
    expect([200, 204]).toContain(archiveResult.status);
    expect((archiveResult.json as { deleted_at?: string | null } | null)?.deleted_at).toBeTruthy();

    const crossOrg = await callRpc('set_therapist_archive_state', tokenOrgB, {
      p_therapist_id: therapist.id,
      p_restore: true,
    });
    expect([401, 403, 400]).toContain(crossOrg.status);

    const { row: archivedRow } = await fetchRow('therapists', tokenOrgA, `id=eq.${therapist.id}`);
    expect(archivedRow?.deleted_at).toBeTruthy();

    const restoreResult = await callRpc('set_therapist_archive_state', tokenOrgA, {
      p_therapist_id: therapist.id,
      p_restore: true,
    });
    expect([200, 204]).toContain(restoreResult.status);

    const { row: restoredRow } = await fetchRow('therapists', tokenOrgA, `id=eq.${therapist.id}`);
    expect(restoredRow?.deleted_at).toBeNull();
  });

  it('records client_archived in admin_actions when an org admin JWT can read the audit log', async () => {
    const adminReadToken = process.env.TEST_JWT_ORG_A_ADMIN as string;
    if (!adminReadToken || !tokenOrgA) return;

    const { row: client } = await fetchRow('clients', tokenOrgA, 'deleted_at=is.null&limit=1');
    expect(client).toBeTruthy();
    if (!client?.organization_id) return;

    const archiveResult = await callRpc('set_client_archive_state', tokenOrgA, {
      p_client_id: client.id,
      p_restore: false,
    });
    expect([200, 204]).toContain(archiveResult.status);

    const { status, rows } = await fetchRecentAdminActions(client.organization_id, adminReadToken);
    if (status === 403 || status === 401) {
      // RLS: reader token is not org admin; skip without failing default CI secrets.
      await callRpc('set_client_archive_state', tokenOrgA, {
        p_client_id: client.id,
        p_restore: true,
      });
      return;
    }
    expect(status).toBe(200);

    const archivedEvent = rows.find(
      (r) =>
        r.action_type === 'client_archived' &&
        r.action_details &&
        String((r.action_details as { target_id?: string }).target_id) === client.id,
    );
    expect(archivedEvent).toBeTruthy();

    const restoreFinal = await callRpc('set_client_archive_state', tokenOrgA, {
      p_client_id: client.id,
      p_restore: true,
    });
    expect([200, 204]).toContain(restoreFinal.status);
  });
});
