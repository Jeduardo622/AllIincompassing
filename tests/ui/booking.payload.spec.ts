import { describe, it, expect, vi } from 'vitest';

describe('Booking payload carries optional overrides', () => {
  it('includes overrides when provided', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ success: true, data: {} }) })) as any;
    (globalThis as any).fetch = fetchMock;

    const payload = {
      session: { therapist_id: 't', client_id: 'c', start_time: new Date().toISOString(), end_time: new Date(Date.now()+3600000).toISOString() },
      startTimeOffsetMinutes: 0,
      endTimeOffsetMinutes: 0,
      timeZone: 'UTC',
      overrides: { cptCode: '97153', modifiers: ['HN'] },
    };

    // post to API
    await fetch('/api/book', { method: 'POST', headers: { Authorization: 'Bearer token' }, body: JSON.stringify(payload) });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.overrides.cptCode).toBe('97153');
    expect(body.overrides.modifiers).toContain('HN');
  });
});


