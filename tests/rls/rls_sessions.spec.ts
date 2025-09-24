import { describe, it, expect } from 'vitest';

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY as string;

async function callRpcInsertSessionWithBilling(token: string, payload: any) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/insert_session_with_billing`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

describe('RLS insert_session_with_billing', () => {
  it('allows same-org therapist to insert session with CPT/modifiers', async () => {
    const token = process.env.TEST_JWT_ORG_A as string; // non-prod user JWT
    if (!token) return; // skip if not configured

    const now = new Date();
    const start = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    const end = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();

    const { status, json } = await callRpcInsertSessionWithBilling(token, {
      p_session: {
        therapist_id: process.env.TEST_THERAPIST_ID_ORG_A,
        client_id: process.env.TEST_CLIENT_ID_ORG_A,
        start_time: start,
        end_time: end,
        session_type: 'individual',
        location_type: 'in_clinic',
      },
      p_cpt_code: '97153',
      p_modifiers: ['HN'],
    });

    expect([200, 201, 204]).toContain(status);
    expect(json?.success).toBeTruthy();
  });

  it('denies cross-org user for insert/read', async () => {
    const token = process.env.TEST_JWT_ORG_B as string;
    if (!token) return; // skip if not configured

    const now = new Date();
    const start = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    const end = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();

    const { status, json } = await callRpcInsertSessionWithBilling(token, {
      p_session: {
        therapist_id: process.env.TEST_THERAPIST_ID_ORG_A,
        client_id: process.env.TEST_CLIENT_ID_ORG_A,
        start_time: start,
        end_time: end,
        session_type: 'individual',
        location_type: 'in_clinic',
      },
      p_cpt_code: '97153',
      p_modifiers: ['HN'],
    });

    expect([401, 403]).toContain(status);
    expect(json?.success).not.toBeTruthy();
  });
});


