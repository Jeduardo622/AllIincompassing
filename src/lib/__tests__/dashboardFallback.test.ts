import { describe, expect, it, vi } from 'vitest';
import {
  buildRedactedDashboardFallback,
  fetchBillingAlertsFallback,
  fetchClientMetricsFallback,
  fetchIncompleteSessionsFallback,
  fetchTodaySessionsFallback,
} from '../dashboardFallback';

const createSessionBuilder = (dataOverride?: unknown[]) => {
  const rows =
    dataOverride ??
    [
      {
        id: 'session-1',
        start_time: '2024-01-01T12:00:00.000Z',
        status: 'scheduled',
        therapists: { id: 'therapist-1', full_name: 'Therapist Example' },
        clients: { id: 'client-1', full_name: 'Client Example' },
      },
    ];

  const result = { data: rows, error: null };
  const builder: any = {};
  builder.select = vi.fn().mockImplementation(() => builder);
  builder.gte = vi.fn().mockReturnValue(builder);
  builder.lte = vi.fn().mockReturnValue(builder);
  builder.eq = vi.fn().mockReturnValue(builder);
  builder.is = vi.fn().mockReturnValue(builder);
  builder.order = vi.fn().mockReturnValue(builder);
  builder.limit = vi.fn().mockImplementation(() => Promise.resolve(result));
  return { builder, result };
};

const createBillingBuilder = () => {
  const result = {
    data: [
      { id: 'billing-1', amount: 42, status: 'pending', created_at: '2024-01-01T00:00:00.000Z' },
    ],
    error: null,
  };
  const builder: any = {};
  builder.select = vi.fn().mockImplementation(() => builder);
  builder.in = vi.fn().mockReturnValue(builder);
  builder.order = vi.fn().mockReturnValue(builder);
  builder.limit = vi.fn().mockImplementation(() => Promise.resolve(result));
  return { builder, result };
};

const createCountBuilder = (count: number) => {
  const builder: any = { promise: Promise.resolve({ data: [], error: null, count }) };
  builder.select = vi.fn().mockImplementation(() => {
    builder.promise = Promise.resolve({ data: [], error: null, count });
    return builder;
  });
  builder.gte = vi.fn().mockImplementation(() => builder);
  builder.then = (...args: unknown[]) => builder.promise.then(...args);
  builder.catch = (...args: unknown[]) => builder.promise.catch(...args);
  builder.finally = (...args: unknown[]) => builder.promise.finally(...args);
  return builder;
};

const createTotalsBuilder = () => {
  const builder: any = {};
  builder.select = vi.fn().mockImplementation(() => builder);
  builder.maybeSingle = vi.fn().mockResolvedValue({
    data: {
      total_one_to_one: 12,
      total_supervision: 4,
      total_parent: 2,
    },
    error: null,
  });
  return builder;
};

describe('dashboard fallback queries', () => {
  it('limits today sessions fallback query to required columns', async () => {
    const { builder } = createSessionBuilder();
    const from = vi.fn().mockReturnValue(builder);
    const supabaseMock = { from } as any;

    const sessions = await fetchTodaySessionsFallback(supabaseMock, new Date('2024-01-01T09:00:00.000Z'));

    expect(from).toHaveBeenCalledWith('sessions');
    expect(builder.select).toHaveBeenCalledTimes(1);
    const selectArg = builder.select.mock.calls[0][0] as string;
    expect(selectArg).toContain('therapists:therapists!inner');
    expect(selectArg).toContain('clients:clients!inner');
    expect(builder.limit).toHaveBeenCalledWith(50);
    expect(sessions[0]).toMatchObject({
      id: 'session-1',
      therapist: { id: 'therapist-1', full_name: 'Therapist Example' },
      client: { id: 'client-1', full_name: 'Client Example' },
    });
  });

  it('limits incomplete sessions fallback query', async () => {
    const { builder } = createSessionBuilder();
    const from = vi.fn().mockReturnValue(builder);
    const supabaseMock = { from } as any;

    await fetchIncompleteSessionsFallback(supabaseMock);

    expect(from).toHaveBeenCalledWith('sessions');
    expect(builder.eq).toHaveBeenCalledWith('status', 'completed');
    expect(builder.is).toHaveBeenCalledWith('notes', null);
    expect(builder.limit).toHaveBeenCalledWith(50);
  });

  it('limits billing alert fallback query and prunes columns', async () => {
    const { builder } = createBillingBuilder();
    const from = vi.fn().mockReturnValue(builder);
    const supabaseMock = { from } as any;

    const alerts = await fetchBillingAlertsFallback(supabaseMock);

    expect(from).toHaveBeenCalledWith('billing_records');
    expect(builder.select).toHaveBeenCalledWith('id, amount, status, created_at');
    expect(builder.limit).toHaveBeenCalledWith(50);
    expect(alerts[0]).toMatchObject({ id: 'billing-1', amount: 42, status: 'pending' });
  });

  it('aggregates client metrics without scanning entire table payloads', async () => {
    const totalBuilder = createCountBuilder(120);
    const activeBuilder = createCountBuilder(45);
    const totalsBuilder = createTotalsBuilder();
    let callIndex = -1;
    const builders = [totalBuilder, activeBuilder, totalsBuilder];
    const from = vi.fn().mockImplementation(() => {
      callIndex += 1;
      return builders[callIndex] ?? totalsBuilder;
    });

    const supabaseMock = { from } as any;

    const metrics = await fetchClientMetricsFallback(supabaseMock, new Date('2024-01-31T00:00:00.000Z'));

    expect(from).toHaveBeenCalledWith('clients');
    expect(totalBuilder.select).toHaveBeenCalledWith('id', { count: 'exact', head: true });
    expect(activeBuilder.gte).toHaveBeenCalledWith('created_at', expect.stringMatching(/T/));
    expect(totalsBuilder.select).toHaveBeenCalledTimes(1);
    const selectArg = totalsBuilder.select.mock.calls[0][0] as string;
    expect(selectArg).toContain('one_to_one_units.sum()');
    expect(metrics).toEqual({ total: 120, active: 45, totalUnits: 18 });
  });

  it('provides redacted placeholders when fallback is blocked', () => {
    const fallback = buildRedactedDashboardFallback();

    expect(fallback.redacted).toBe(true);
    expect(fallback.todaySessions[0]?.__redacted).toBe(true);
    expect(fallback.incompleteSessions[0]?.__redacted).toBe(true);
    expect(fallback.billingAlerts[0]?.__redacted).toBe(true);
    expect(fallback.clientMetrics.redacted).toBe(true);
  });
});
