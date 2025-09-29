import { describe, it, expect } from 'vitest';

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
    expect([200, 204]).toContain(denied.status);

    const therapists = Array.isArray((denied.json as any)?.therapists)
      ? (denied.json as any).therapists
      : [];
    const clients = Array.isArray((denied.json as any)?.clients)
      ? (denied.json as any).clients
      : [];

    expect(therapists.length).toBe(0);
    expect(clients.length).toBe(0);

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
    expect([200, 204]).toContain(denied.status);

    const sessions = Array.isArray(denied.json) ? (denied.json as any[]) : [];
    expect(sessions.length).toBe(0);

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
    expect([200, 204]).toContain(denied.status);

    const sessions = Array.isArray((denied.json as any)?.sessions)
      ? (denied.json as any).sessions
      : [];
    const therapists = Array.isArray((denied.json as any)?.therapists)
      ? (denied.json as any).therapists
      : [];
    const clients = Array.isArray((denied.json as any)?.clients)
      ? (denied.json as any).clients
      : [];

    expect(sessions.length).toBe(0);
    expect(therapists.length).toBe(0);
    expect(clients.length).toBe(0);

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
