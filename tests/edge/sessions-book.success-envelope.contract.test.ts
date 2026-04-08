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
});
