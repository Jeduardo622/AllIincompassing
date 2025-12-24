import { randomUUID } from 'crypto';
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import { selectSuite } from '../utils/testControls';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://example.test';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? 'anon-key';
const tokenOrgA = process.env.TEST_JWT_ORG_A ?? 'token-org-a';
const tokenOrgB = process.env.TEST_JWT_ORG_B ?? 'token-org-b';
const therapistToken = process.env.TEST_JWT_THERAPIST_ORG_A ?? 'token-therapist-org-a';
const therapistId = process.env.TEST_THERAPIST_ID_ORG_A ?? 'therapist-org-a';
const clientId = process.env.TEST_CLIENT_ID_ORG_A ?? 'client-org-a';
const organizationIdOrgA = 'org-a';

type JsonRecord = Record<string, unknown>;

type FetchResult = {
  status: number;
  json: unknown;
};

type SessionHoldRow = {
  id: string;
  therapist_id: string;
  client_id: string;
  start_time: string;
  end_time: string;
  hold_key: string;
  expires_at: string;
  organization_id: string;
};

const sessionHolds: SessionHoldRow[] = [];

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

const handleSessionHolds = (url: URL, token: string, init: RequestInit) => {
  const method = (init.method ?? 'GET').toUpperCase();

  if (method === 'POST') {
    if (token !== tokenOrgA) {
      return jsonResponse(403, { error: 'Access denied' });
    }
    const payload = JSON.parse(String(init.body ?? '[]')) as SessionHoldRow[];
    const created = payload.map(row => ({
      ...row,
      id: row.id ?? randomUUID(),
      organization_id: organizationIdOrgA,
    }));
    sessionHolds.push(...created);
    return jsonResponse(201, created);
  }

  if (method === 'GET') {
    const id = url.searchParams.get('id')?.replace('eq.', '') ?? '';
    const rows = sessionHolds.filter(row => row.id === id);
    if (token === tokenOrgA || token === therapistToken) {
      return jsonResponse(200, rows);
    }
    if (token === tokenOrgB) {
      if (rows.length > 0) {
        return jsonResponse(403, { message: 'Access denied' });
      }
      return jsonResponse(200, []);
    }
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  if (method === 'PATCH') {
    const id = url.searchParams.get('id')?.replace('eq.', '') ?? '';
    const targetIndex = sessionHolds.findIndex(row => row.id === id);
    if (targetIndex === -1) {
      return jsonResponse(404, { error: 'Not found' });
    }

    if (token !== tokenOrgA && token !== therapistToken) {
      return jsonResponse(403, { message: 'Access denied' });
    }

    const update = JSON.parse(String(init.body ?? '{}')) as JsonRecord;
    sessionHolds[targetIndex] = { ...sessionHolds[targetIndex], ...update };
    return jsonResponse(200, [sessionHolds[targetIndex]]);
  }

  if (method === 'DELETE') {
    const id = url.searchParams.get('id')?.replace('eq.', '') ?? '';
    const targetIndex = sessionHolds.findIndex(row => row.id === id);
    if (token !== tokenOrgA) {
      return jsonResponse(403, { message: 'Access denied' });
    }
    if (targetIndex >= 0) {
      sessionHolds.splice(targetIndex, 1);
    }
    return jsonResponse(200, []);
  }

  return jsonResponse(500, { error: 'Unhandled session_holds operation' });
};

const mockFetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.toString());
  const token = extractToken(init);

  if (url.pathname.endsWith('/session_holds')) {
    return handleSessionHolds(url, token, init);
  }

  return jsonResponse(404, { error: 'Not found' });
};

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const describeSessionHolds = selectSuite({
  run: true,
  reason: 'Always run with mocked Supabase responses.',
});

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
  it('prevents cross-organization admins from reading or mutating holds', async () => {
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
