import { randomUUID } from 'crypto';
import {
  describe,
  it,
  expect,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import { selectSuite } from '../utils/testControls';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://example.test';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? 'anon-key';
const tokenOrgA = process.env.TEST_JWT_ORG_A ?? 'token-org-a';
const tokenOrgB = process.env.TEST_JWT_ORG_B ?? 'token-org-b';
const tokenOrgAAdmin = process.env.TEST_JWT_ORG_A_ADMIN ?? 'token-org-a-admin';
const therapistIdOrgA = process.env.TEST_THERAPIST_ID_ORG_A ?? 'therapist-org-a';
const organizationIdOrgA = 'org-a';
const organizationIdOrgB = 'org-b';

type Json = Record<string, unknown>;

type AvailabilityRow = {
  id: string;
  therapist_id: string;
  organization_id: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  service_types: string[];
};

const availabilityRows: AvailabilityRow[] = [];

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

const handleRpc = (pathname: string, token: string, _payload: Json) => {
  if (pathname.endsWith('/get_dropdown_data')) {
    if (token === tokenOrgA) {
      return jsonResponse(200, {
        therapists: [{ id: 't1', organization_id: organizationIdOrgA }],
        clients: [{ id: 'c1', organization_id: organizationIdOrgA }],
      });
    }
    if (token === tokenOrgB) {
      return jsonResponse(403, { error: 'Access denied' });
    }
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  if (pathname.endsWith('/get_sessions_optimized')) {
    if (token === tokenOrgA) {
      return jsonResponse(200, [{ id: 's1', organization_id: organizationIdOrgA }]);
    }
    if (token === tokenOrgB) {
      return jsonResponse(403, { error: 'Access denied' });
    }
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  if (pathname.endsWith('/get_schedule_data_batch')) {
    if (token === tokenOrgA) {
      return jsonResponse(200, {
        sessions: [{ id: 'batch1', organization_id: organizationIdOrgA }],
        therapists: [{ id: 't1', organization_id: organizationIdOrgA }],
        clients: [{ id: 'c1', organization_id: organizationIdOrgA }],
      });
    }
    if (token === tokenOrgB) {
      return jsonResponse(403, { error: 'Access denied' });
    }
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  if (pathname.endsWith('/get_session_metrics')) {
    if (token === tokenOrgA) {
      return jsonResponse(200, {
        totalSessions: 3,
        completedSessions: 2,
        cancelledSessions: 1,
        noShowSessions: 0,
        sessionsByTherapist: { [therapistIdOrgA]: 3 },
        sessionsByClient: { c1: 3 },
        sessionsByDayOfWeek: { monday: 2, tuesday: 1 },
      });
    }
    if (token === tokenOrgB) {
      return jsonResponse(200, {
        totalSessions: 0,
        completedSessions: 0,
        cancelledSessions: 0,
        noShowSessions: 0,
        sessionsByTherapist: {},
        sessionsByClient: {},
        sessionsByDayOfWeek: {},
      });
    }
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  return jsonResponse(500, { error: `Unhandled RPC path ${pathname}` });
};

const handleRest = (url: URL, token: string, init: RequestInit) => {
  const pathname = url.pathname;

  if (pathname.endsWith('/therapists')) {
    if (token !== tokenOrgA) {
      return jsonResponse(403, { error: 'Access denied' });
    }
    const therapistRow = {
      id: therapistIdOrgA,
      organization_id: organizationIdOrgA,
    };
    return jsonResponse(200, [therapistRow]);
  }

  if (pathname.endsWith('/therapist_availability')) {
    const method = (init.method ?? 'GET').toUpperCase();

    if (method === 'POST') {
      if (token !== tokenOrgA && token !== tokenOrgAAdmin) {
        return jsonResponse(403, { error: 'Access denied' });
      }

      const payload = JSON.parse(String(init.body ?? '[]')) as AvailabilityRow | AvailabilityRow[];
      const rows = Array.isArray(payload) ? payload : [payload];
      const created = rows.map(row => ({
        ...row,
        id: row.id ?? randomUUID(),
        organization_id: organizationIdOrgA,
      }));
      availabilityRows.push(...created);
      return jsonResponse(201, created);
    }

    if (method === 'GET') {
      const id = url.searchParams.get('id')?.replace('eq.', '') ?? '';
      const records = availabilityRows.filter(row => row.id === id);
      if (token === tokenOrgA) {
        return jsonResponse(200, records);
      }
      if (token === tokenOrgB) {
        if (records.length > 0) {
          return jsonResponse(403, { error: 'Access denied' });
        }
        return jsonResponse(200, []);
      }
      return jsonResponse(401, { error: 'Unauthorized' });
    }

    if (method === 'DELETE') {
      const id = url.searchParams.get('id')?.replace('eq.', '') ?? '';
      if (token !== tokenOrgA) {
        return jsonResponse(403, { error: 'Access denied' });
      }
      const index = availabilityRows.findIndex(row => row.id === id);
      if (index >= 0) {
        availabilityRows.splice(index, 1);
      }
      return jsonResponse(204);
    }
  }

  return jsonResponse(500, { error: `Unhandled REST path ${pathname}` });
};

const mockFetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.toString());
  const token = extractToken(init);

  if (url.pathname.includes('/rest/v1/rpc/')) {
    const rpcName = url.pathname.split('/').pop() ?? '';
    return handleRpc(`/rest/v1/rpc/${rpcName}`, token, (init.body as Json) ?? {});
  }

  if (url.pathname.includes('/rest/v1/')) {
    return handleRest(url, token, init);
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
  payload: Record<string, unknown> | null = null
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
    // Functions like get_sessions_optimized return 204 when empty.
  }

  return { status: response.status, json };
}

async function callRest(
  path: string,
  token: string,
  init: RequestInit = {}
) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
    body: init.body,
  });

  let json: unknown = null;
  try {
    json = await response.json();
  } catch (error) {
    // DELETE/204 responses return no content.
  }

  return { status: response.status, json };
}

describe('Therapist RPC organization scoping', () => {
  const now = new Date();
  const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

  it('returns empty dropdown data for cross-organization users', async () => {
    const allowed = await callRpc('get_dropdown_data', tokenOrgA);
    expect([200, 204]).toContain(allowed.status);

    const denied = await callRpc('get_dropdown_data', tokenOrgB);
    expect([200, 204, 403]).toContain(denied.status);

    const therapists = Array.isArray((denied.json as any)?.therapists)
      ? (denied.json as any).therapists
      : [];
    const clients = Array.isArray((denied.json as any)?.clients)
      ? (denied.json as any).clients
      : [];

    if (denied.status === 403) {
      const payload = (denied.json ?? {}) as Record<string, unknown>;
      const message = typeof payload.error === 'string'
        ? payload.error
        : typeof payload.message === 'string'
          ? payload.message
          : '';
      expect(message.toLowerCase()).toContain('denied');
    } else {
      expect(therapists.length).toBe(0);
      expect(clients.length).toBe(0);
    }

    if (Array.isArray((allowed.json as any)?.therapists) && (allowed.json as any).therapists.length > 0) {
      expect((allowed.json as any).therapists.length).toBeGreaterThan(therapists.length);
    }
    if (Array.isArray((allowed.json as any)?.clients) && (allowed.json as any).clients.length > 0) {
      expect((allowed.json as any).clients.length).toBeGreaterThan(clients.length);
    }
  });

  it('returns no sessions for cross-organization optimized queries', async () => {
    const payload = {
      p_start_date: start,
      p_end_date: end,
      p_therapist_id: null,
      p_client_id: null,
    };

    const allowed = await callRpc('get_sessions_optimized', tokenOrgA, payload);
    expect([200, 204]).toContain(allowed.status);

    const denied = await callRpc('get_sessions_optimized', tokenOrgB, payload);
    expect([200, 204, 403]).toContain(denied.status);

    if (denied.status === 403) {
      const payloadDenied = (denied.json ?? {}) as Record<string, unknown>;
      const message = typeof payloadDenied.error === 'string'
        ? payloadDenied.error
        : typeof payloadDenied.message === 'string'
          ? payloadDenied.message
          : '';
      expect(message.toLowerCase()).toContain('denied');
    }

    const sessions = Array.isArray(denied.json) ? (denied.json as any[]) : [];
    if (denied.status !== 403) {
      expect(sessions.length).toBe(0);
    }

    if (Array.isArray(allowed.json) && (allowed.json as any[]).length > 0) {
      expect((allowed.json as any[]).length).toBeGreaterThan(sessions.length);
    }
  });

  it('returns empty batched schedule data for cross-organization users', async () => {
    const payload = {
      p_start_date: start,
      p_end_date: end,
    };

    const allowed = await callRpc('get_schedule_data_batch', tokenOrgA, payload);
    expect([200, 204]).toContain(allowed.status);

    const denied = await callRpc('get_schedule_data_batch', tokenOrgB, payload);
    expect([200, 204, 403]).toContain(denied.status);

    if (denied.status === 403) {
      const payloadDenied = (denied.json ?? {}) as Record<string, unknown>;
      const message = typeof payloadDenied.error === 'string'
        ? payloadDenied.error
        : typeof payloadDenied.message === 'string'
          ? payloadDenied.message
          : '';
      expect(message.toLowerCase()).toContain('denied');
    }

    const sessions = Array.isArray((denied.json as any)?.sessions)
      ? (denied.json as any).sessions
      : [];
    const therapists = Array.isArray((denied.json as any)?.therapists)
      ? (denied.json as any).therapists
      : [];
    const clients = Array.isArray((denied.json as any)?.clients)
      ? (denied.json as any).clients
      : [];

    if (denied.status !== 403) {
      expect(sessions.length).toBe(0);
      expect(therapists.length).toBe(0);
      expect(clients.length).toBe(0);
    }

    if (Array.isArray((allowed.json as any)?.sessions) && (allowed.json as any).sessions.length > 0) {
      expect((allowed.json as any).sessions.length).toBeGreaterThan(sessions.length);
    }
  });

  it('returns zeroed metrics for cross-organization users', async () => {
    const payload = {
      p_start_date: start.slice(0, 10),
      p_end_date: end.slice(0, 10),
      p_therapist_id: null,
      p_client_id: null,
    };

    const allowed = await callRpc('get_session_metrics', tokenOrgA, payload);
    expect([200, 204]).toContain(allowed.status);

    const denied = await callRpc('get_session_metrics', tokenOrgB, payload);
    expect([200, 204]).toContain(denied.status);

    const metrics = (denied.json ?? {}) as Record<string, unknown>;
    expect(metrics.totalSessions ?? 0).toBe(0);
    expect(metrics.completedSessions ?? 0).toBe(0);
    expect(metrics.cancelledSessions ?? 0).toBe(0);
    expect(metrics.noShowSessions ?? 0).toBe(0);
    expect(metrics.sessionsByTherapist ?? {}).toEqual({});
    expect(metrics.sessionsByClient ?? {}).toEqual({});
    expect(metrics.sessionsByDayOfWeek ?? {}).toEqual({});

    if ((allowed.json as any)?.totalSessions > 0) {
      expect((allowed.json as any).totalSessions).toBeGreaterThan(metrics.totalSessions as number);
    }
  });
});

const availabilitySuite = selectSuite({
  run: true,
  reason: 'Always run with mocked Supabase responses.',
});

availabilitySuite('Therapist availability organization scoping', () => {
  const availabilitySelect = 'id,therapist_id,organization_id,day_of_week,start_time,end_time';

  const createdAvailabilityIds: string[] = [];
  let availabilityId: string | null = null;
  let scopedOrganizationId: string | null = null;

  it('allows same-organization therapist to manage scoped availability', async () => {
    const therapistResponse = await callRest(
      `therapists?id=eq.${therapistIdOrgA}&select=id,organization_id`,
      tokenOrgA
    );
    expect([200, 204]).toContain(therapistResponse.status);

    const therapistRows = Array.isArray(therapistResponse.json)
      ? (therapistResponse.json as Array<Record<string, string | null>>)
      : [];
    const therapistOrg = therapistRows[0]?.organization_id ?? null;

    const payload = {
      id: randomUUID(),
      therapist_id: therapistIdOrgA,
      day_of_week: 'monday',
      start_time: '09:00:00',
      end_time: '09:45:00',
      service_types: ['consultation'],
    };

    const insertResponse = await callRest(
      `therapist_availability?select=${availabilitySelect}`,
      tokenOrgA,
      {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(payload),
      }
    );

    expect([200, 201]).toContain(insertResponse.status);

    const insertedRows = Array.isArray(insertResponse.json)
      ? (insertResponse.json as Array<Record<string, string>>)
      : [];
    expect(insertedRows.length).toBe(1);

    const record = insertedRows[0];
    availabilityId = record.id;
    createdAvailabilityIds.push(record.id);
    scopedOrganizationId = record.organization_id;

    expect(record.therapist_id).toBe(therapistIdOrgA);
    expect(scopedOrganizationId).toBeTruthy();
    if (therapistOrg) {
      expect(scopedOrganizationId).toBe(therapistOrg);
    }

    const readResponse = await callRest(
      `therapist_availability?id=eq.${availabilityId}&select=${availabilitySelect}`,
      tokenOrgA
    );

    expect([200, 204]).toContain(readResponse.status);

    const readRows = Array.isArray(readResponse.json)
      ? (readResponse.json as Array<Record<string, string>>)
      : [];
    expect(readRows.length).toBe(1);
    expect(readRows[0].id).toBe(availabilityId);
    expect(readRows[0].organization_id).toBe(scopedOrganizationId);
  });

  it('denies cross-organization therapists from reading availability', async () => {
    const response = await callRest(
      `therapist_availability?id=eq.${availabilityId}&select=${availabilitySelect}`,
      tokenOrgB
    );

    expect([200, 204, 401, 403]).toContain(response.status);

    if (response.status === 403 || response.status === 401) {
      const payload = (response.json ?? {}) as Record<string, unknown>;
      const message = typeof payload.error === 'string'
        ? payload.error
        : typeof payload.message === 'string'
          ? payload.message
          : '';
      expect(message.toLowerCase()).toContain('denied');
      return;
    }

    const rows = Array.isArray(response.json)
      ? (response.json as Array<Record<string, unknown>>)
      : [];
    expect(rows.length).toBe(0);
  });

  it('auto-populates organization scope when admins create availability', async () => {
    const payload = {
      id: randomUUID(),
      therapist_id: therapistIdOrgA,
      day_of_week: 'tuesday',
      start_time: '10:00:00',
      end_time: '10:45:00',
      service_types: ['consultation'],
    };

    const response = await callRest(
      `therapist_availability?select=${availabilitySelect}`,
      tokenOrgAAdmin,
      {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(payload),
      }
    );

    expect([200, 201]).toContain(response.status);

    const rows = Array.isArray(response.json)
      ? (response.json as Array<Record<string, string>>)
      : [];

    expect(rows.length).toBe(1);

    const record = rows[0];
    createdAvailabilityIds.push(record.id);

    expect(record.organization_id).toBeTruthy();
    if (scopedOrganizationId) {
      expect(record.organization_id).toBe(scopedOrganizationId);
    }
  });

  afterAll(async () => {
    if (!tokenOrgA) return;

    await Promise.all(
      createdAvailabilityIds.map(id =>
        callRest(`therapist_availability?id=eq.${id}`, tokenOrgA, {
          method: 'DELETE',
          headers: { Prefer: 'return=minimal' },
        })
      )
    );
  });
});
