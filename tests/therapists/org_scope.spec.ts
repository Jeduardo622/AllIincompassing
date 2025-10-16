import { randomUUID } from 'crypto';
import { describe, it, expect, afterAll } from 'vitest';
import { selectSuite } from '../utils/testControls';

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY as string;

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
  const tokenOrgA = process.env.TEST_JWT_ORG_A as string;
  const tokenOrgB = process.env.TEST_JWT_ORG_B as string;

  const now = new Date();
  const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

  it('returns empty dropdown data for cross-organization users', async () => {
    if (!tokenOrgA || !tokenOrgB) return;

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
    if (!tokenOrgA || !tokenOrgB) return;

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
    if (!tokenOrgA || !tokenOrgB) return;

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
    if (!tokenOrgA || !tokenOrgB) return;

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

const runAvailabilitySuite =
  process.env.RUN_THERAPIST_AVAILABILITY_TESTS === 'true' &&
  Boolean(process.env.TEST_JWT_ORG_A) &&
  Boolean(process.env.TEST_THERAPIST_ID_ORG_A);

const availabilitySuite = selectSuite({
  run: runAvailabilitySuite,
  reason:
    'Set RUN_THERAPIST_AVAILABILITY_TESTS=true and configure TEST_JWT_ORG_A, TEST_THERAPIST_ID_ORG_A credentials.',
});

availabilitySuite('Therapist availability organization scoping', () => {
  const tokenOrgA = process.env.TEST_JWT_ORG_A as string;
  const tokenOrgB = process.env.TEST_JWT_ORG_B as string;
  const therapistIdOrgA = process.env.TEST_THERAPIST_ID_ORG_A as string;
  const availabilitySelect = 'id,therapist_id,organization_id,day_of_week,start_time,end_time';

  let availabilityId: string | null = null;
  let scopedOrganizationId: string | null = null;

  it('allows same-organization therapist to manage scoped availability', async () => {
    if (!tokenOrgA || !therapistIdOrgA) return;

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
    if (!tokenOrgB || !availabilityId) return;

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

  afterAll(async () => {
    if (!tokenOrgA || !availabilityId) return;

    await callRest(
      `therapist_availability?id=eq.${availabilityId}`,
      tokenOrgA,
      {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      }
    );
  });
});
