// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bookSessionEnvelopeSchema } from '../../src/lib/contracts/scheduling';
import { stubDenoEnv } from '../utils/stubDeno';

const envValues = new Map<string, string>([
  ['CORS_ALLOWED_ORIGINS', 'https://app.example.com,https://preview.example.com'],
  ['SUPABASE_URL', 'https://example.supabase.co'],
  ['SUPABASE_ANON_KEY', 'anon-key'],
]);

stubDenoEnv((key) => envValues.get(key) ?? '');

const fetchMock = vi.fn<typeof fetch>();

async function loadHandler() {
  let serveHandler: ((req: Request) => Promise<Response>) | undefined;
  const denoObject = (globalThis as typeof globalThis & { Deno?: Record<string, unknown> }).Deno ?? {};

  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('Deno', {
    ...denoObject,
    env: {
      get: (key: string) => envValues.get(key) ?? '',
    },
    serve: vi.fn((handler: (req: Request) => Promise<Response>) => {
      serveHandler = handler;
      return {};
    }),
  });

  await import('../../supabase/functions/sessions-book/index.ts');

  if (!serveHandler) {
    throw new Error('Expected sessions-book to register a Deno.serve handler');
  }

  return serveHandler;
}

const buildValidBookingPayload = () => ({
  session: {
    therapist_id: '11111111-1111-1111-1111-111111111111',
    client_id: '22222222-2222-2222-2222-222222222222',
    program_id: '33333333-3333-3333-3333-333333333333',
    goal_id: '44444444-4444-4444-4444-444444444444',
    start_time: '2026-03-30T05:00:00.000Z',
    end_time: '2026-03-30T05:30:00.000Z',
  },
  startTimeOffsetMinutes: -420,
  endTimeOffsetMinutes: -420,
  timeZone: 'America/Los_Angeles',
});

const buildBookRequest = (body: unknown) =>
  new Request('https://edge.example.com/functions/v1/sessions-book', {
    method: 'POST',
    headers: {
      Origin: 'https://preview.example.com',
      Authorization: 'Bearer token',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

describe('sessions-book success envelope vs bookSessionEnvelopeSchema', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns data.cpt as {} when overrides are omitted so client Zod parse succeeds', async () => {
    const sessionRow = {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      therapist_id: '11111111-1111-1111-1111-111111111111',
      client_id: '22222222-2222-2222-2222-222222222222',
      program_id: '33333333-3333-3333-3333-333333333333',
      goal_id: '44444444-4444-4444-4444-444444444444',
      start_time: '2026-03-30T05:00:00.000Z',
      end_time: '2026-03-30T05:30:00.000Z',
      status: 'scheduled',
    };

    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              holdKey: 'hold-ok',
              holdId: 'hold-id-ok',
              expiresAt: '2026-03-30T05:05:00.000Z',
              holds: [],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              session: sessionRow,
              sessions: [sessionRow],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

    const handler = await loadHandler();

    const response = await handler(
      new Request('https://edge.example.com/functions/v1/sessions-book', {
        method: 'POST',
        headers: {
          Origin: 'https://preview.example.com',
          Authorization: 'Bearer token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          session: {
            therapist_id: '11111111-1111-1111-1111-111111111111',
            client_id: '22222222-2222-2222-2222-222222222222',
            program_id: '33333333-3333-3333-3333-333333333333',
            goal_id: '44444444-4444-4444-4444-444444444444',
            start_time: '2026-03-30T05:00:00.000Z',
            end_time: '2026-03-30T05:30:00.000Z',
          },
          startTimeOffsetMinutes: -420,
          endTimeOffsetMinutes: -420,
          timeZone: 'America/Los_Angeles',
        }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.cpt).toEqual({});
    expect(payload.data.hold).toMatchObject({ holdKey: 'hold-ok' });

    const parsed = bookSessionEnvelopeSchema.safeParse(payload);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.format())).toBe(true);
  });

  it('forwards batched occurrences to hold and confirm and preserves multi-session responses', async () => {
    const sessionRowOne = {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      therapist_id: '11111111-1111-1111-1111-111111111111',
      client_id: '22222222-2222-2222-2222-222222222222',
      program_id: '33333333-3333-3333-3333-333333333333',
      goal_id: '44444444-4444-4444-4444-444444444444',
      start_time: '2026-03-30T05:00:00.000Z',
      end_time: '2026-03-30T05:30:00.000Z',
      status: 'scheduled',
    };
    const sessionRowTwo = {
      ...sessionRowOne,
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      start_time: '2026-04-06T05:00:00.000Z',
      end_time: '2026-04-06T05:30:00.000Z',
    };

    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              holdKey: 'hold-1',
              holdId: 'hold-id-1',
              expiresAt: '2026-03-30T05:05:00.000Z',
              holds: [
                {
                  holdKey: 'hold-1',
                  holdId: 'hold-id-1',
                  startTime: sessionRowOne.start_time,
                  endTime: sessionRowOne.end_time,
                  expiresAt: '2026-03-30T05:05:00.000Z',
                },
                {
                  holdKey: 'hold-2',
                  holdId: 'hold-id-2',
                  startTime: sessionRowTwo.start_time,
                  endTime: sessionRowTwo.end_time,
                  expiresAt: '2026-03-30T05:05:00.000Z',
                },
              ],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              session: sessionRowOne,
              sessions: [sessionRowOne, sessionRowTwo],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

    const handler = await loadHandler();
    const response = await handler(
      new Request('https://edge.example.com/functions/v1/sessions-book', {
        method: 'POST',
        headers: {
          Origin: 'https://preview.example.com',
          Authorization: 'Bearer token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          session: {
            therapist_id: '11111111-1111-1111-1111-111111111111',
            client_id: '22222222-2222-2222-2222-222222222222',
            program_id: '33333333-3333-3333-3333-333333333333',
            goal_id: '44444444-4444-4444-4444-444444444444',
            goal_ids: ['44444444-4444-4444-4444-444444444444', '55555555-5555-5555-5555-555555555555'],
            start_time: sessionRowOne.start_time,
            end_time: sessionRowOne.end_time,
          },
          startTimeOffsetMinutes: -420,
          endTimeOffsetMinutes: -420,
          timeZone: 'America/Los_Angeles',
          occurrences: [
            {
              startTime: sessionRowOne.start_time,
              endTime: sessionRowOne.end_time,
              startOffsetMinutes: -420,
              endOffsetMinutes: -420,
            },
            {
              startTime: sessionRowTwo.start_time,
              endTime: sessionRowTwo.end_time,
              startOffsetMinutes: -420,
              endOffsetMinutes: -420,
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const holdBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(holdBody.occurrences).toHaveLength(2);
    expect(holdBody.occurrences[1].start_time).toBe(sessionRowTwo.start_time);

    const confirmBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(confirmBody.occurrences).toHaveLength(2);
    expect(confirmBody.occurrences[1].hold_key).toBe('hold-2');
    expect(confirmBody.occurrences[1].session.start_time).toBe(sessionRowTwo.start_time);
    const payload = await response.json();
    expect(payload.data.sessions).toHaveLength(2);
  });

  it('matches hold occurrences by time window instead of relying on returned order', async () => {
    const sessionRowOne = {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      therapist_id: '11111111-1111-1111-1111-111111111111',
      client_id: '22222222-2222-2222-2222-222222222222',
      program_id: '33333333-3333-3333-3333-333333333333',
      goal_id: '44444444-4444-4444-4444-444444444444',
      start_time: '2026-03-30T05:00:00.000Z',
      end_time: '2026-03-30T05:30:00.000Z',
      status: 'scheduled',
    };
    const sessionRowTwo = {
      ...sessionRowOne,
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      start_time: '2026-04-06T05:00:00.000Z',
      end_time: '2026-04-06T05:30:00.000Z',
    };

    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              holdKey: 'hold-1',
              holdId: 'hold-id-1',
              expiresAt: '2026-03-30T05:05:00.000Z',
              holds: [
                {
                  holdKey: 'hold-2',
                  holdId: 'hold-id-2',
                  startTime: sessionRowTwo.start_time,
                  endTime: sessionRowTwo.end_time,
                  expiresAt: '2026-03-30T05:05:00.000Z',
                },
                {
                  holdKey: 'hold-1',
                  holdId: 'hold-id-1',
                  startTime: sessionRowOne.start_time,
                  endTime: sessionRowOne.end_time,
                  expiresAt: '2026-03-30T05:05:00.000Z',
                },
              ],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              session: sessionRowOne,
              sessions: [sessionRowOne, sessionRowTwo],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

    const handler = await loadHandler();
    const response = await handler(
      new Request('https://edge.example.com/functions/v1/sessions-book', {
        method: 'POST',
        headers: {
          Origin: 'https://preview.example.com',
          Authorization: 'Bearer token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          session: {
            therapist_id: '11111111-1111-1111-1111-111111111111',
            client_id: '22222222-2222-2222-2222-222222222222',
            program_id: '33333333-3333-3333-3333-333333333333',
            goal_id: '44444444-4444-4444-4444-444444444444',
            start_time: sessionRowOne.start_time,
            end_time: sessionRowOne.end_time,
          },
          startTimeOffsetMinutes: -420,
          endTimeOffsetMinutes: -420,
          timeZone: 'America/Los_Angeles',
          occurrences: [
            {
              startTime: sessionRowOne.start_time,
              endTime: sessionRowOne.end_time,
              startOffsetMinutes: -420,
              endOffsetMinutes: -420,
            },
            {
              startTime: sessionRowTwo.start_time,
              endTime: sessionRowTwo.end_time,
              startOffsetMinutes: -420,
              endOffsetMinutes: -420,
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(200);
    const confirmBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(confirmBody.occurrences[0].hold_key).toBe('hold-2');
    expect(confirmBody.occurrences[0].session.start_time).toBe(sessionRowTwo.start_time);
    expect(confirmBody.occurrences[1].hold_key).toBe('hold-1');
    expect(confirmBody.occurrences[1].session.start_time).toBe(sessionRowOne.start_time);
  });

  it('rejects malformed occurrence timestamps with 400 before calling hold or confirm', async () => {
    const handler = await loadHandler();
    const response = await handler(
      buildBookRequest({
        ...buildValidBookingPayload(),
        occurrences: [
          {
            startTime: 'not-an-iso-datetime',
            endTime: '2026-03-30T05:30:00.000Z',
            startOffsetMinutes: -420,
            endOffsetMinutes: -420,
          },
        ],
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: 'Invalid request body',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 400 before hold when top-level session.start_time is malformed', async () => {
    const handler = await loadHandler();
    const response = await handler(
      buildBookRequest({
        ...buildValidBookingPayload(),
        session: {
          ...buildValidBookingPayload().session,
          start_time: 'not-a-date',
        },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: 'Invalid request body',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 400 before hold when top-level session.end_time is malformed', async () => {
    const handler = await loadHandler();
    const response = await handler(
      buildBookRequest({
        ...buildValidBookingPayload(),
        session: {
          ...buildValidBookingPayload().session,
          end_time: 'not-a-date',
        },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: 'Invalid request body',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
