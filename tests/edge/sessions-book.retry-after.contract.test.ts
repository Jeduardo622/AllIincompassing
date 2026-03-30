// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('sessions-book retry-after propagation contract', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();

    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          error: 'Therapist already has a session in that time range',
          code: 'THERAPIST_CONFLICT',
          retryAfter: '2026-03-30T05:00:37.000Z',
          orchestration: {
            action: 'hold_conflict',
            retryAfter: '2026-03-30T05:00:37.000Z',
          },
        }),
        {
          status: 409,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '37',
          },
        },
      ),
    );
  });

  it('preserves downstream conflict status, Retry-After, and body through the sessions-book wrapper', async () => {
    const handler = await loadHandler();

    const response = await handler(
      new Request('https://edge.example.com/functions/v1/sessions-book', {
        method: 'POST',
        headers: {
          Origin: 'https://preview.example.com',
          Authorization: 'Bearer token',
          'Content-Type': 'application/json',
          'x-request-id': 'req-sessions-book-conflict',
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

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.supabase.co/functions/v1/sessions-hold',
      expect.objectContaining({
        method: 'POST',
        headers: expect.any(Headers),
      }),
    );

    expect(response.status).toBe(409);
    expect(response.headers.get('Retry-After')).toBe('37');
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://preview.example.com');

    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Therapist already has a session in that time range',
      code: 'THERAPIST_CONFLICT',
      retryAfter: '2026-03-30T05:00:37.000Z',
      orchestration: {
        action: 'hold_conflict',
        retryAfter: '2026-03-30T05:00:37.000Z',
      },
    });
  });

  it('preserves downstream Retry-After when the confirm step returns a retryable conflict', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              holdKey: 'hold-1',
              holdId: 'hold-id-1',
              expiresAt: '2026-03-30T05:05:00.000Z',
              holds: [],
            },
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: false,
            error: 'Client already has a session in that time range',
            code: 'CLIENT_CONFLICT',
            retryAfter: '2026-03-30T05:15:37.000Z',
            orchestration: {
              action: 'confirm_conflict',
              retryAfter: '2026-03-30T05:15:37.000Z',
            },
          }),
          {
            status: 409,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': '37',
            },
          },
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
          'x-request-id': 'req-sessions-book-confirm-conflict',
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

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://example.supabase.co/functions/v1/sessions-hold');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://example.supabase.co/functions/v1/sessions-confirm');

    expect(response.status).toBe(409);
    expect(response.headers.get('Retry-After')).toBe('37');
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://preview.example.com');

    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Client already has a session in that time range',
      code: 'CLIENT_CONFLICT',
      retryAfter: '2026-03-30T05:15:37.000Z',
      orchestration: {
        action: 'confirm_conflict',
        retryAfter: '2026-03-30T05:15:37.000Z',
      },
    });
  });
});
