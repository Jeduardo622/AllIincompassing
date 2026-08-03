import { describe, expect, it, vi, beforeEach } from 'vitest';

import {
  fetchAgentTraceReport,
  fetchAgentWorkOperations,
  hasTraceSelector,
} from '../agentTraceReport';
import { callEdge } from '../supabase';

vi.mock('../supabase', () => ({
  callEdge: vi.fn(),
}));

describe('agentTraceReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('validates selector presence', () => {
    expect(hasTraceSelector({})).toBe(false);
    expect(hasTraceSelector({ correlationId: 'corr-1' })).toBe(true);
  });

  it('loads report data from edge function', async () => {
    vi.mocked(callEdge).mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            selector: { correlationId: 'corr-1' },
            summary: {
              traces: 1,
              orchestrationRuns: 1,
              sessionAuditRows: 0,
              timelineEvents: 2,
              requestIds: ['req-1'],
              correlationIds: ['corr-1'],
              agentOperationIds: ['op-1'],
            },
            timeline: [],
            traces: [],
            orchestrationRuns: [],
            sessionAudit: [],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const data = await fetchAgentTraceReport({ correlationId: 'corr-1' });
    expect(data.summary.traces).toBe(1);
    expect(callEdge).toHaveBeenCalledWith(
      'agent-trace-report',
      expect.objectContaining({ method: 'POST' }),
      expect.any(Object),
    );
  });

  it('loads the versioned bounded agent work operations report', async () => {
    vi.mocked(callEdge).mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            operations: {
              schemaVersion: 'agent-work-operations.v1',
              generatedAt: '2026-08-02T12:00:00.000Z',
              sample: { limit: 500, truncated: false, releaseGateStatus: 'evaluable' },
              summary: {
                totalWorkItems: 2,
                blockedWorkItems: 1,
                waitingSteps: 1,
                staleLeases: 0,
                retryExhaustedSteps: 0,
                parityMismatches: 0,
                duplicateEffectsPrevented: 1,
                pendingApprovals: 1,
                oldestWaitingAgeSeconds: 60,
                oldestApprovalAgeSeconds: 120,
              },
              rates: { retryExhaustionPercent: 0, abortPercent: 0 },
              releaseSignals: {
                crossTenantAccess: 0,
                falseCompletion: 0,
                unverifiedMutationEffects: 0,
                phiPayloadViolations: 0,
                approvalBypassOrStaleAcceptance: 0,
                unknownStateTransitions: 0,
                staleRunningBeyondSlo: 0,
                readinessEvidenceCoveragePercent: 100,
              },
              aggregations: { workflows: [], models: [] },
              drilldown: {
                blocked: [],
                waiting: [],
                staleLeases: [],
                retryExhausted: [],
                parityMismatches: [],
              },
              nonBlocking: {
                medianTimeToNeedsReviewSeconds: 300,
                retryAbortRatePercent: 0,
                humanOverrideRatePercent: 0,
                duplicateEffectsPrevented: 1,
                tokensPerCompletedObjective: 15,
                costPerCompletedObjective: 0,
                timeInEachStateSeconds: { running: 300 },
                blockerResolutionTimeSeconds: {
                  value: null,
                  availability: 'unavailable',
                  reasonCode: 'blocker_resolution_not_recorded',
                },
                clinicianAdministrativeTimeSeconds: {
                  value: null,
                  availability: 'unavailable',
                  reasonCode: 'not_recorded',
                },
              },
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const operations = await fetchAgentWorkOperations();

    expect(operations.schemaVersion).toBe('agent-work-operations.v1');
    expect(operations.summary.blockedWorkItems).toBe(1);
    expect(callEdge).toHaveBeenCalledWith(
      'agent-trace-report',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ mode: 'operations' }),
      }),
      expect.any(Object),
    );
  });

  it('throws on edge errors', async () => {
    vi.mocked(callEdge).mockResolvedValue(
      new Response(
        JSON.stringify({ success: false, error: 'Forbidden' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(fetchAgentTraceReport({ correlationId: 'corr-1' })).rejects.toThrow('Forbidden');
  });
});
