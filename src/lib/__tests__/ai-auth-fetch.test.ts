import { describe, it, expect, beforeEach, afterEach, vi, type SpyInstance } from 'vitest';
import {
  processMessage,
  getClientDetails,
  getTherapistDetails,
  getAuthorizationDetails,
  generateProgramGoalDraft,
} from '../ai';
import {
  setRuntimeSupabaseConfig,
  resetRuntimeSupabaseConfigForTests,
} from '../runtimeConfig';

const anonKey = 'anon-key';
const accessToken = 'mock-user-jwt';
const ASSESSMENT_ID = '11111111-1111-4111-8111-111111111111';
const CLIENT_ID = '22222222-2222-4222-8222-222222222222';
const ORG_ID = '33333333-3333-4333-8333-333333333333';

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
      defaultOrganizationId: '5238e88b-6198-4862-80a2-dbe15bbeabdd',
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
    const optimizedHeaders = (optimizedInit as RequestInit).headers as Record<string, string>;
    expect(optimizedHeaders).toEqual(
      expect.objectContaining({
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
        'x-request-id': expect.any(String),
        'x-correlation-id': expect.any(String),
      })
    );
    expect(optimizedHeaders['x-request-id']).toBe(optimizedHeaders['x-correlation-id']);

    const requestBody = JSON.parse((optimizedInit as RequestInit).body as string);
    expect(requestBody.message).toBe('Hello?');
    expect(requestBody.context.guardrails.allowedTools).toEqual([
      'schedule_session',
      'cancel_sessions',
      'start_session',
      'predict_conflicts',
      'suggest_optimal_times',
      'get_monthly_session_count',
    ]);
    expect(requestBody.context.guardrails.audit).toMatchObject({
      actorId: 'user-1',
      reason: 'approved',
    });
    expect(result.response).toBe('Hello there');
  });

  it('retries with the optimized endpoint preserving headers', async () => {
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
    const firstHeaders = (fetchMock.mock.calls[0][1] as RequestInit)
      .headers as Record<string, string>;
    const secondHeaders = (fetchMock.mock.calls[1][1] as RequestInit)
      .headers as Record<string, string>;
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `${edgeBase}ai-agent-optimized`,
      expect.objectContaining({
        headers: expect.objectContaining({
          apikey: anonKey,
          Authorization: `Bearer ${accessToken}`,
        }),
      })
    );
    expect(secondHeaders['x-request-id']).toBe(firstHeaders['x-request-id']);
    expect(secondHeaders['x-correlation-id']).toBe(firstHeaders['x-correlation-id']);
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

  it('posts the established snake_case payload for authenticated legacy generate-program-goals requests', async () => {
    fetchMock.mockResolvedValueOnce(
      buildFetchResponse({
        programs: [
          {
            name: 'Communication Program',
            description: 'Program description',
            rationale: 'Program rationale',
            evidence_refs: [{ section_key: 'assessment_summary', source_span: 'Program evidence' }],
            review_flags: [],
          },
        ],
        goals: [
          {
            program_name: 'Communication Program',
            title: 'Goal A',
            description: 'desc',
            original_text: 'original',
            goal_type: 'child',
            target_behavior: 'behavior',
            measurement_type: 'frequency',
            baseline_data: 'baseline',
            target_criteria: 'target',
            mastery_criteria: 'mastery',
            maintenance_criteria: 'maintenance',
            generalization_criteria: 'generalization',
            objective_data_points: ['point'],
            rationale: 'rationale',
            evidence_refs: [{ section_key: 'assessment_summary', source_span: 'Goal evidence' }],
            review_flags: [],
          },
        ],
        summary_rationale: 'summary',
        confidence: 'medium',
      })
    );

    await generateProgramGoalDraft(
      'Synthetic assessment text with sufficient detail.',
      { accessToken },
      {
        assessmentDocumentId: ASSESSMENT_ID,
        clientId: CLIENT_ID,
        organizationId: ORG_ID,
        clientName: 'Client One',
        organizationGuidance: 'Use objective ABA language.',
        checklistRows: [
          {
            section_key: 'treatment_planning',
            label: 'Replacement goals',
            placeholder_key: 'CALOPTIMA_FBA_TARGET_REPLACEMENT_GOALS',
            value_text: 'Replacement goals',
            value_json: null,
            status: 'approved',
          },
          {
            section_key: 'assessment_summary',
            label: 'Empty approved row',
            placeholder_key: 'EMPTY_APPROVED',
            value_text: '   ',
            value_json: null,
            status: 'approved',
          },
        ],
        extractionRows: [
          {
            section_key: 'assessment_summary',
            field_key: 'CALOPTIMA_FBA_BASELINE',
            label: 'Baseline',
            value_text: 'Observed in synthetic sessions.',
            value_json: null,
            source_span: { page: 2 },
            status: 'verified',
          },
        ],
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestUrl, init] = fetchMock.mock.calls[0];
    expect(requestUrl).toBe(`${edgeBase}generate-program-goals`);
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      assessment_document_id: ASSESSMENT_ID,
      client_id: CLIENT_ID,
      organization_id: ORG_ID,
      client_display_name: 'Client One',
      organization_guidance: 'Use objective ABA language.',
      approved_checklist_rows: [
        {
          section_key: 'treatment_planning',
          label: 'Replacement goals',
          placeholder_key: 'CALOPTIMA_FBA_TARGET_REPLACEMENT_GOALS',
          value_text: 'Replacement goals',
        },
      ],
      extracted_canonical_fields: {
        CALOPTIMA_FBA_BASELINE: 'Observed in synthetic sessions.',
        CALOPTIMA_FBA_TARGET_REPLACEMENT_GOALS: 'Replacement goals',
        EMPTY_APPROVED: '',
      },
      assessment_summary: 'TREATMENT PLANNING\n- Replacement goals: Replacement goals',
      source_evidence_snippets: [
        {
          section_key: 'assessment_summary',
          snippet: 'Baseline | Observed in synthetic sessions. | {"page":2}',
        },
      ],
    });
  });

  it('rejects legacy generate-program-goals requests missing assessment, client, or organization scope before fetch', async () => {
    await expect(
      generateProgramGoalDraft(
        'Synthetic assessment text with sufficient detail.',
        { accessToken },
        { assessmentDocumentId: ASSESSMENT_ID, clientId: CLIENT_ID },
      ),
    ).rejects.toThrow('Legacy generation requires assessment, client, and organization scope');

    await expect(
      generateProgramGoalDraft(
        'Synthetic assessment text with sufficient detail.',
        { accessToken },
        { assessmentDocumentId: ASSESSMENT_ID, organizationId: ORG_ID },
      ),
    ).rejects.toThrow('Legacy generation requires assessment, client, and organization scope');

    await expect(
      generateProgramGoalDraft(
        'Synthetic assessment text with sufficient detail.',
        { accessToken },
        { clientId: CLIENT_ID, organizationId: ORG_ID },
      ),
    ).rejects.toThrow('Legacy generation requires assessment, client, and organization scope');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects generateProgramGoalDraft when assessment text is too short', async () => {
    await expect(
      generateProgramGoalDraft('Too short', { accessToken })
    ).rejects.toThrow('Assessment text must be at least 20 characters');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the strict ledger correlation envelope without caller-supplied evidence or attempt authority', async () => {
    fetchMock.mockResolvedValueOnce(buildFetchResponse({
      programs: [],
      goals: [],
      summary_rationale: 'Synthetic ledger response',
      confidence: 'low',
    }));

    await generateProgramGoalDraft(
      'Assessment text is ignored for ledger-bound authoritative loading.',
      { accessToken },
      {
        assessmentDocumentId: '11111111-1111-4111-8111-111111111111',
        organizationId: '33333333-3333-4333-8333-333333333333',
        clientId: '22222222-2222-4222-8222-222222222222',
        ledgerWorkItemId: '44444444-4444-4444-8444-444444444444',
      },
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['x-request-id']).toBe(
      'caloptima-ledger.44444444-4444-4444-8444-444444444444',
    );
    expect(headers['x-correlation-id']).toBe(headers['x-request-id']);
    expect(JSON.parse(init.body as string)).toEqual({
      assessmentDocumentId: '11111111-1111-4111-8111-111111111111',
      organizationId: '33333333-3333-4333-8333-333333333333',
      clientId: '22222222-2222-4222-8222-222222222222',
      workItemId: '44444444-4444-4444-8444-444444444444',
      correlationId: headers['x-correlation-id'],
    });
  });
});
