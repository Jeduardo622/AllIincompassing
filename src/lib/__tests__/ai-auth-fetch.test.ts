import { describe, it, expect, beforeEach, afterEach, vi, type SpyInstance } from 'vitest';
import {
  processMessage,
  getClientDetails,
  getTherapistDetails,
  getAuthorizationDetails,
} from '../ai';
import { GUARDRAIL_AUDIT_VERSION, getRoleAllowedTools } from '../aiGuardrails';
import {
  setRuntimeSupabaseConfig,
  resetRuntimeSupabaseConfigForTests,
} from '../runtimeConfig';

const anonKey = 'anon-key';
const accessToken = 'mock-user-jwt';

const buildFetchResponse = (payload: unknown, ok = true, status = 200) => ({
  ok,
  status,
  json: vi.fn(async () => payload),
});

describe('AI edge function authentication', () => {
  const edgeBase = 'https://example.supabase.co/functions/v1/';
  let fetchMock: ReturnType<typeof vi.fn>;
  let fetchSpy: SpyInstance<Parameters<typeof fetch>, ReturnType<typeof fetch>>;

  beforeEach(() => {
    setRuntimeSupabaseConfig({
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: anonKey,
      supabaseEdgeUrl: edgeBase,
    });

    fetchMock = vi.fn();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockImplementation(fetchMock as unknown as typeof fetch);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    resetRuntimeSupabaseConfigForTests();
  });

  it('forwards anon and user tokens to the optimized AI endpoint', async () => {
    fetchMock.mockResolvedValueOnce(
      buildFetchResponse({ response: 'Hello there', conversationId: 'conv-1' })
    );

    const adminAllowedTools = getRoleAllowedTools('admin');

    const result = await processMessage(
      ' Hello?\u0007 ',
      {
        url: 'http://localhost',
        userAgent: 'jest',
        conversationId: undefined,
        actor: { id: 'user-1', role: 'admin' },
      },
      { accessToken }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [optimizedUrl, optimizedInit] = fetchMock.mock.calls[0];
    expect(optimizedUrl).toBe(`${edgeBase}ai-agent-optimized`);
    expect(optimizedInit).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          apikey: anonKey,
          Authorization: `Bearer ${accessToken}`,
        }),
      })
    );

    const requestBody = JSON.parse((optimizedInit as RequestInit).body as string);
    expect(requestBody.message).toBe('Hello?');
    expect(requestBody.context.guardrails.allowedTools).toEqual(adminAllowedTools);
    expect(requestBody.context.guardrails.audit).toMatchObject({
      actorId: 'user-1',
      actorRole: 'admin',
      reason: 'approved',
      actionDenied: false,
      toolUsed: adminAllowedTools[0],
      redactedPrompt: 'Hello?',
    });
    expect(requestBody.context.guardrails.audit.requestedTools).toEqual(
      expect.arrayContaining([adminAllowedTools[0]])
    );
    expect(requestBody.context.guardrails.audit.traceId).toMatch(/^(trace_|[0-9a-f-]{8})/);
    expect(requestBody.context.guardrails.auditLog).toMatchObject({
      auditVersion: GUARDRAIL_AUDIT_VERSION,
      actorRole: 'admin',
      actionDenied: false,
      redactedPrompt: 'Hello?',
      traceId: requestBody.context.guardrails.audit.traceId,
    });
    expect(result.response).toBe('Hello there');
  });

  it('retries with the legacy endpoint preserving headers', async () => {
    fetchMock
      .mockResolvedValueOnce(buildFetchResponse({}, false, 503))
      .mockResolvedValueOnce(
        buildFetchResponse({ response: 'Fallback success', conversationId: 'conv-2' })
      );

    const result = await processMessage(
      'Trigger fallback',
      { url: 'http://localhost', userAgent: 'jest', actor: { id: 'user-1', role: 'admin' } },
      { accessToken }
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `${edgeBase}process-message`,
      expect.objectContaining({
        headers: expect.objectContaining({
          apikey: anonKey,
          Authorization: `Bearer ${accessToken}`,
        }),
      })
    );
    expect(result.response).toBe('Fallback success');
  });

  it.each([
    [
      'getClientDetails',
      () =>
        getClientDetails('client-1', { accessToken }),
      `${edgeBase}get-client-details`,
      { client: { id: 'client-1' } },
    ],
    [
      'getTherapistDetails',
      () =>
        getTherapistDetails('therapist-1', { accessToken }),
      `${edgeBase}get-therapist-details`,
      { therapist: { id: 'therapist-1' } },
    ],
    [
      'getAuthorizationDetails',
      () =>
        getAuthorizationDetails('auth-1', { accessToken }),
      `${edgeBase}get-authorization-details`,
      { authorization: { id: 'auth-1' } },
    ],
  ])('%s forwards headers to edge function', async (_name, invoke, expectedUrl, payload) => {
    fetchMock.mockResolvedValueOnce(buildFetchResponse(payload));

    const result = await invoke();

    expect(fetchMock).toHaveBeenCalledWith(
      expectedUrl,
      expect.objectContaining({
        headers: expect.objectContaining({
          apikey: anonKey,
          Authorization: `Bearer ${accessToken}`,
        }),
      })
    );
    expect(result).toMatchObject(Object.values(payload)[0]);
  });

  it('throws when an access token is not provided', async () => {
    await expect(
      getClientDetails('client-2', { accessToken: '' })
    ).rejects.toThrow('Missing Supabase access token');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
