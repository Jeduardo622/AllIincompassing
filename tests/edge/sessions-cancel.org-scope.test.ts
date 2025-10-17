import { afterEach, describe, expect, it, vi } from "vitest";
import * as orgHelpers from "../../supabase/functions/_shared/org.ts";
import { __TESTING__ } from "../../supabase/functions/sessions-cancel/index.ts";
import { ForbiddenError } from "../../supabase/functions/_shared/org.ts";

type QueryResult = { data: unknown[]; error: null };

const makeSelectBuilder = (result: QueryResult) => {
  const builder: any = {};
  const chain = () => builder;
  const eqFilters = new Map<string, unknown>();
  const inFilters = new Map<string, unknown[]>();

  const applyFilters = () => {
    if (!Array.isArray(result.data)) {
      return [];
    }

    return result.data.filter(row => {
      if (!row || typeof row !== "object") {
        return false;
      }

      for (const [column, value] of eqFilters.entries()) {
        if ((row as Record<string, unknown>)[column] !== value) {
          return false;
        }
      }

      for (const [column, values] of inFilters.entries()) {
        const candidate = (row as Record<string, unknown>)[column];
        if (!values.some(item => item === candidate)) {
          return false;
        }
      }

      return true;
    });
  };

  builder.select = vi.fn(() => chain());
  builder.eq = vi.fn((column: string, value: unknown) => {
    eqFilters.set(column, value);
    return chain();
  });
  builder.in = vi.fn((column: string, values: unknown[]) => {
    const normalized = Array.isArray(values) ? values : [values];
    inFilters.set(column, normalized);
    return chain();
  });
  builder.gte = vi.fn(() => chain());
  builder.lt = vi.fn(() => chain());
  builder.order = vi.fn(() => chain());
  builder.then = (resolve: (value: QueryResult) => unknown) => (
    resolve({ data: applyFilters(), error: result.error })
  );
  return builder;
};

const makeUpdateBuilder = () => {
  const builder: any = {};
  const chain = () => builder;
  builder.update = vi.fn(() => chain());
  builder.in = vi.fn(() => chain());
  builder.eq = vi.fn(() => chain());
  builder.select = vi.fn(() => chain());
  builder.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
    resolve({ data: [], error: null });
  return builder;
};

const createStubLogger = () => {
  const stub: any = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    with: vi.fn().mockImplementation(() => stub),
  };
  return stub;
};

describe("sessions-cancel org scoping", () => {
  const scopedResults: QueryResult[] = [];

  afterEach(() => {
    scopedResults.length = 0;
    vi.restoreAllMocks();
  });

  it("denies cancellation when a session is outside caller organization", async () => {
    const selectBuilder = makeSelectBuilder({
      data: [{ id: "session-a", status: "scheduled", therapist_id: "therapist-1" }],
      error: null,
    });
    vi.spyOn(orgHelpers, "orgScopedQuery").mockImplementation(
      () => selectBuilder as unknown as ReturnType<typeof orgHelpers.orgScopedQuery>,
    );

    const mockDb: any = {
      from: vi.fn(() => makeUpdateBuilder()),
    };

    const logger = createStubLogger();

    await expect(
      __TESTING__.handleSessionCancellation(
        mockDb,
        "org-1",
        {
          sessionIds: ["session-a", "session-b"],
          dateRange: null,
          therapistId: null,
          reason: null,
        },
        "admin-user",
        "admin",
        logger,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("updates sessions within the caller organization", async () => {
    const selectBuilder = makeSelectBuilder({
      data: [
        { id: "session-a", status: "scheduled", therapist_id: "therapist-1" },
        { id: "session-b", status: "cancelled", therapist_id: "therapist-1" },
      ],
      error: null,
    });
    vi.spyOn(orgHelpers, "orgScopedQuery").mockImplementation(
      () => selectBuilder as unknown as ReturnType<typeof orgHelpers.orgScopedQuery>,
    );

    const updateBuilder = makeUpdateBuilder();
    const mockDb: any = {
      from: vi.fn(() => updateBuilder),
    };

    const logger = createStubLogger();

    const response = await __TESTING__.handleSessionCancellation(
      mockDb,
      "org-2",
      {
        sessionIds: ["session-a"],
        dateRange: null,
        therapistId: null,
        reason: "Testing",
      },
      "therapist-1",
      "therapist",
      logger,
    );

    const payload = await response.json() as { success: boolean; data: { summary: { cancelledCount: number } } };

    expect(payload.success).toBe(true);
    expect(payload.data.summary.cancelledCount).toBe(1);
    expect(updateBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "cancelled" }));
  });
});
