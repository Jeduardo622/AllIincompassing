// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubDenoEnv } from '../utils/stubDeno';

const envValues = new Map<string, string>([
  ['CORS_ALLOWED_ORIGINS', 'https://app.example.com,https://preview.example.com'],
]);

const createRequestClientMock = vi.fn();
const getUserOrThrowMock = vi.fn();
const requireOrgMock = vi.fn();
const evaluateTherapistAuthorizationMock = vi.fn();
const createSupabaseIdempotencyServiceMock = vi.fn();
const buildScopedIdempotencyKeyMock = vi.fn();
const resolveSchedulingRetryAfterMock = vi.fn();
const orchestrateSchedulingMock = vi.fn();

stubDenoEnv((key) => envValues.get(key) ?? '');

async function loadHandler() {
  let serveHandler: ((req: Request) => Promise<Response>) | undefined;
  const denoObject = (globalThis as typeof globalThis & { Deno?: Record<string, unknown> }).Deno ?? {};
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

  vi.doMock('../../supabase/functions/_shared/database.ts', () => ({
    createRequestClient: createRequestClientMock,
    supabaseAdmin: {
      rpc: vi.fn(async (fn: string) => {
        if (fn !== 'acquire_session_hold') {
          throw new Error(`Unexpected rpc call: ${fn}`);
        }
        return {
          data: {
            success: false,
            error_code: 'THERAPIST_CONFLICT',
            error_message: 'Therapist already has a session in that time range',
          },
          error: null,
        };
      }),
      from: vi.fn(() => ({
        delete: vi.fn(() => ({
          eq: vi.fn(() => ({
            in: vi.fn(),
          })),
        })),
      })),
    },
  }));
  vi.doMock('../../supabase/functions/_shared/auth.ts', () => ({
    getUserOrThrow: getUserOrThrowMock,
  }));
  vi.doMock('../../supabase/functions/_shared/org.ts', async () => {
    const actual = await vi.importActual<typeof import('../../supabase/functions/_shared/org.ts')>(
      '../../supabase/functions/_shared/org.ts',
    );
    return {
      ...actual,
      requireOrg: requireOrgMock,
    };
  });
  vi.doMock('../../supabase/functions/_shared/authorization.ts', () => ({
    evaluateTherapistAuthorization: evaluateTherapistAuthorizationMock,
  }));
  vi.doMock('../../supabase/functions/_shared/idempotency.ts', async () => {
    const actual = await vi.importActual<typeof import('../../supabase/functions/_shared/idempotency.ts')>(
      '../../supabase/functions/_shared/idempotency.ts',
    );
    return {
      ...actual,
      buildScopedIdempotencyKey: buildScopedIdempotencyKeyMock,
      createSupabaseIdempotencyService: createSupabaseIdempotencyServiceMock,
    };
  });
  vi.doMock('../../supabase/functions/_shared/retry-after.ts', () => ({
    resolveSchedulingRetryAfter: resolveSchedulingRetryAfterMock,
  }));
  vi.doMock('../../supabase/functions/_shared/scheduling-orchestrator.ts', () => ({
    orchestrateScheduling: orchestrateSchedulingMock,
  }));

  await import('../../supabase/functions/sessions-hold/index.ts');

  if (!serveHandler) {
    throw new Error('Expected sessions-hold to register a Deno.serve handler');
  }

  return serveHandler;
}

describe('sessions-hold retry-after contract', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();

    createRequestClientMock.mockReturnValue({});
    getUserOrThrowMock.mockResolvedValue({ id: 'user-1' });
    requireOrgMock.mockResolvedValue('org-1');
    evaluateTherapistAuthorizationMock.mockResolvedValue({ ok: true });
    buildScopedIdempotencyKeyMock.mockImplementation((key: string) => `scoped:${key}`);
    createSupabaseIdempotencyServiceMock.mockReturnValue({
      find: vi.fn(async () => null),
      persist: vi.fn(async () => undefined),
    });
    resolveSchedulingRetryAfterMock.mockResolvedValue({
      retryAfterSeconds: 37,
      retryAfterIso: '2026-03-30T05:00:37.000Z',
    });
    orchestrateSchedulingMock.mockResolvedValue({
      action: 'hold_conflict',
      retryAfter: '2026-03-30T05:00:37.000Z',
    });
  });

  it('returns the current 409 conflict envelope with Retry-After for the first retryable sessions-hold branch', async () => {
    const handler = await loadHandler();

    const response = await handler(
      new Request('https://edge.example.com/functions/v1/sessions-hold', {
        method: 'POST',
        headers: {
          Origin: 'https://preview.example.com',
          Authorization: 'Bearer token',
          'Content-Type': 'application/json',
          'x-request-id': 'req-hold-conflict',
          'x-correlation-id': 'corr-hold-conflict',
          'x-agent-operation-id': 'agent-hold-conflict',
        },
        body: JSON.stringify({
          therapist_id: 'therapist-1',
          client_id: 'client-1',
          start_time: '2026-03-30T05:00:00.000Z',
          end_time: '2026-03-30T05:30:00.000Z',
          start_time_offset_minutes: -420,
          end_time_offset_minutes: -420,
          time_zone: 'America/Los_Angeles',
        }),
      }),
    );

    expect(createRequestClientMock).toHaveBeenCalledTimes(1);
    expect(getUserOrThrowMock).toHaveBeenCalledTimes(1);
    expect(requireOrgMock).toHaveBeenCalledTimes(1);
    expect(evaluateTherapistAuthorizationMock).toHaveBeenCalledWith({}, 'therapist-1');
    expect(resolveSchedulingRetryAfterMock).toHaveBeenCalledWith(
      expect.objectContaining({ rpc: expect.any(Function), from: expect.any(Function) }),
      {
        startTime: '2026-03-30T05:00:00.000Z',
        endTime: '2026-03-30T05:30:00.000Z',
        therapistId: 'therapist-1',
        clientId: 'client-1',
      },
      ['therapist'],
    );

    expect(response.status).toBe(409);
    expect(response.headers.get('Retry-After')).toBe('37');
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');

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
});
