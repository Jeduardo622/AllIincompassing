import { beforeEach, describe, expect, it, vi } from "vitest";
import { __TESTING__ } from "../../supabase/functions/generate-report/index.ts";
import * as orgHelpers from "../../supabase/functions/_shared/org.ts";

type SelectResult = { data: unknown[]; error: null };

const makeBuilder = (result: SelectResult) => {
  const chained: Record<string, any> = {};
  const chain = () => chained;

  chained.select = vi.fn(() => chain());
  chained.gte = vi.fn(() => chain());
  chained.lte = vi.fn(() => chain());
  chained.in = vi.fn(() => chain());
  chained.eq = vi.fn(() => chain());
  chained.then = (resolve: (value: SelectResult) => unknown) => resolve(result);

  return chained;
};

describe("generate-report org scoping", () => {
  const scopedCalls: Array<{ table: string; orgId: string }> = [];

  beforeEach(() => {
    scopedCalls.length = 0;
    vi.restoreAllMocks();
  });

  it("scopes session queries by organization and date", async () => {
    const builder = makeBuilder({ data: [], error: null });
    const spy = vi.spyOn(orgHelpers, "orgScopedQuery").mockImplementation(
      (_db: unknown, table: string, orgId: string) => {
        scopedCalls.push({ table, orgId });
        return builder as unknown as ReturnType<typeof orgHelpers.orgScopedQuery>;
      },
    );

    await __TESTING__.generateSessionsReport(
      {},
      "org-123",
      { startDate: "2024-01-01", endDate: "2024-01-07" },
      undefined,
      undefined,
      undefined,
      [],
      "admin",
    );

    expect(spy).toHaveBeenCalledTimes(1);
    expect(scopedCalls).toEqual([{ table: "sessions", orgId: "org-123" }]);
    expect(builder.gte).toHaveBeenCalledWith("start_time", "2024-01-01T00:00:00");
    expect(builder.lte).toHaveBeenCalledWith("start_time", "2024-01-07T23:59:59");
  });

  it("filters billing queries for the active organization", async () => {
    const builder = makeBuilder({ data: [], error: null });
    const spy = vi.spyOn(orgHelpers, "orgScopedQuery").mockImplementation(
      (_db: unknown, table: string, orgId: string) => {
        scopedCalls.push({ table, orgId });
        return builder as unknown as ReturnType<typeof orgHelpers.orgScopedQuery>;
      },
    );

    await __TESTING__.generateBillingReport(
      {},
      "org-456",
      { startDate: "2024-02-01", endDate: "2024-02-02" },
      undefined,
      undefined,
      [],
      "admin",
    );

    expect(spy).toHaveBeenCalledTimes(1);
    expect(scopedCalls).toEqual([{ table: "sessions", orgId: "org-456" }]);
    expect(builder.eq).toHaveBeenCalledWith("status", "completed");
  });
});
