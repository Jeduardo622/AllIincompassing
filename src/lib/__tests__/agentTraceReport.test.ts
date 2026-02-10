import { describe, expect, it, vi, beforeEach } from 'vitest';

import { fetchAgentTraceReport, hasTraceSelector } from '../agentTraceReport';
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
              idempotencyRows: 0,
              sessionAuditRows: 0,
              timelineEvents: 2,
              requestIds: ['req-1'],
              correlationIds: ['corr-1'],
              agentOperationIds: ['op-1'],
            },
            timeline: [],
            traces: [],
            orchestrationRuns: [],
            idempotency: [],
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
