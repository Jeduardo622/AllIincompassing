import { describe, expect, it } from 'vitest';

// This legacy suite validated client-side fallback queries that have been removed.
// Keep a minimal test to document the change and ensure the file remains a no-op
// while preserving historical context for coverage balance.

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

describe('dashboard fallback removed', () => {
  it('no-op suite documenting removal of client fallbacks', () => {
    expect(true).toBe(true);
  });
});
