import { randomUUID } from 'crypto';
import { describe, it, expect } from 'vitest';
import { selectSuite } from '../utils/testControls';

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY as string;

const runSessionHoldSuite =
  process.env.RUN_SESSION_HOLD_TESTS === 'true'
  && Boolean(SUPABASE_URL)
  && Boolean(SUPABASE_ANON_KEY)
  && Boolean(process.env.TEST_JWT_ORG_A)
  && Boolean(process.env.TEST_JWT_ORG_B)
  && Boolean(process.env.TEST_JWT_THERAPIST_ORG_A)
  && Boolean(process.env.TEST_THERAPIST_ID_ORG_A)
  && Boolean(process.env.TEST_CLIENT_ID_ORG_A);

const describeSessionHolds = selectSuite({
  run: runSessionHoldSuite,
  reason:
    'Set RUN_SESSION_HOLD_TESTS=true with SUPABASE_URL, SUPABASE_ANON_KEY, TEST_JWT_ORG_A, TEST_JWT_ORG_B, TEST_JWT_THERAPIST_ORG_A, TEST_THERAPIST_ID_ORG_A, and TEST_CLIENT_ID_ORG_A.',
});

type JsonRecord = Record<string, unknown>;

type FetchResult = {
  status: number;
  json: unknown;
};

async function getHoldById(token: string, holdId: string) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/session_holds?id=eq.${holdId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
  });

  let json: unknown = null;
  try {
    json = await response.json();
  } catch (error) {
    // Ignore
  }

  return { status: response.status, json } satisfies FetchResult;
}

async function patchHold(token: string, holdId: string, payload: JsonRecord) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/session_holds?id=eq.${holdId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      Prefer: 'return=representation',
    },
    body: JSON.stringify(payload),
  });

  let json: unknown = null;
  try {
    json = await response.json();
  } catch (error) {
    // Ignore empty bodies
  }

  return { status: response.status, json } satisfies FetchResult;
}

async function deleteHold(token: string, holdId: string) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/session_holds?id=eq.${holdId}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      Prefer: 'return=representation',
    },
  });

  let json: unknown = null;
  try {
    json = await response.json();
  } catch (error) {
    // DELETE may not return a body.
  }

  return { status: response.status, json } satisfies FetchResult;
}

describeSessionHolds('Session hold organization scoping', () => {
  const tokenOrgA = process.env.TEST_JWT_ORG_A as string;
  const tokenOrgB = process.env.TEST_JWT_ORG_B as string;
  const therapistToken = process.env.TEST_JWT_THERAPIST_ORG_A as string;
  const therapistId = process.env.TEST_THERAPIST_ID_ORG_A as string;
  const clientId = process.env.TEST_CLIENT_ID_ORG_A as string;

  it('prevents cross-organization admins from reading or mutating holds', async () => {
    if (!tokenOrgA || !tokenOrgB || !therapistToken || !therapistId || !clientId) return;

    const now = Date.now();
    const start = new Date(now + 30 * 60 * 1000).toISOString();
    const end = new Date(now + 60 * 60 * 1000).toISOString();
    const expires = new Date(now + 20 * 60 * 1000).toISOString();
    const holdKey = randomUUID();

    const createResult = await fetch(`${SUPABASE_URL}/rest/v1/session_holds`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${tokenOrgA}`,
        Prefer: 'return=representation',
      },
      body: JSON.stringify([
        {
          therapist_id: therapistId,
          client_id: clientId,
          start_time: start,
          end_time: end,
          hold_key: holdKey,
          expires_at: expires,
        },
      ]),
    });

    const createdJson = await createResult.json();
    expect([200, 201]).toContain(createResult.status);
    expect(Array.isArray(createdJson)).toBe(true);
    const holdRow = (createdJson as JsonRecord[])[0] ?? null;
    expect(holdRow).toBeTruthy();

    const holdId = String((holdRow as JsonRecord).id ?? '');
    expect(holdId).not.toEqual('');

    const sameOrgFetch = await getHoldById(tokenOrgA, holdId);
    expect([200, 206]).toContain(sameOrgFetch.status);
    const sameOrgRows = Array.isArray(sameOrgFetch.json)
      ? (sameOrgFetch.json as JsonRecord[])
      : [];
    expect(sameOrgRows.length).toBeGreaterThan(0);

    const crossOrgFetch = await getHoldById(tokenOrgB, holdId);
    expect([200, 206, 403]).toContain(crossOrgFetch.status);
    if (crossOrgFetch.status === 403) {
      const payload = (crossOrgFetch.json ?? {}) as JsonRecord;
      const errorMessage = typeof payload.message === 'string'
        ? payload.message.toLowerCase()
        : typeof payload.error === 'string'
          ? payload.error.toLowerCase()
          : '';
      expect(errorMessage).toContain('denied');
    } else {
      const rows = Array.isArray(crossOrgFetch.json)
        ? (crossOrgFetch.json as JsonRecord[])
        : [];
      expect(rows.length).toBe(0);
    }

    const heldRow = sameOrgRows[0] as JsonRecord;
    const originalExpires = String(heldRow.expires_at ?? expires);

    const crossOrgUpdateTarget = new Date(now + 90 * 60 * 1000).toISOString();
    const crossOrgUpdate = await patchHold(tokenOrgB, holdId, {
      expires_at: crossOrgUpdateTarget,
    });
    expect([401, 403, 204]).toContain(crossOrgUpdate.status);

    const afterCrossOrgFetch = await getHoldById(tokenOrgA, holdId);
    const afterCrossOrgRows = Array.isArray(afterCrossOrgFetch.json)
      ? (afterCrossOrgFetch.json as JsonRecord[])
      : [];
    const afterCrossOrgExpires = String((afterCrossOrgRows[0] as JsonRecord)?.expires_at ?? originalExpires);
    expect(afterCrossOrgExpires).toBe(originalExpires);

    const sameOrgUpdatedExpiry = new Date(now + 95 * 60 * 1000).toISOString();
    const sameOrgUpdate = await patchHold(tokenOrgA, holdId, {
      expires_at: sameOrgUpdatedExpiry,
    });
    expect([200, 204]).toContain(sameOrgUpdate.status);

    const therapistUpdatedExpiry = new Date(now + 100 * 60 * 1000).toISOString();
    const therapistUpdate = await patchHold(therapistToken, holdId, {
      expires_at: therapistUpdatedExpiry,
    });
    expect([200, 204]).toContain(therapistUpdate.status);

    const therapistView = await getHoldById(therapistToken, holdId);
    const therapistRows = Array.isArray(therapistView.json)
      ? (therapistView.json as JsonRecord[])
      : [];
    expect(therapistRows.length).toBeGreaterThan(0);
    const therapistRow = therapistRows[0] as JsonRecord;
    expect(String(therapistRow.expires_at ?? '')).toBe(therapistUpdatedExpiry);

    const crossOrgDelete = await deleteHold(tokenOrgB, holdId);
    expect([401, 403, 204]).toContain(crossOrgDelete.status);

    const stillExists = await getHoldById(tokenOrgA, holdId);
    const stillRows = Array.isArray(stillExists.json)
      ? (stillExists.json as JsonRecord[])
      : [];
    expect(stillRows.length).toBeGreaterThan(0);

    const sameOrgDelete = await deleteHold(tokenOrgA, holdId);
    expect([200, 204]).toContain(sameOrgDelete.status);
  });
});
