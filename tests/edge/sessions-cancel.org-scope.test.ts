// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import * as orgHelpers from "../../supabase/functions/_shared/org.ts";
import { __TESTING__ } from "../../supabase/functions/sessions-cancel/index.ts";
import { ForbiddenError } from "../../supabase/functions/_shared/org.ts";
import { supabaseAdmin } from "../../supabase/functions/_shared/database.ts";

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
  let idFilter: string[] = [];
  builder.update = vi.fn(() => chain());
  builder.in = vi.fn((column: string, values: unknown[]) => {
    if (column === "id" && Array.isArray(values)) {
      idFilter = values.filter((value): value is string => typeof value === "string");
    }
    return chain();
  });
  builder.eq = vi.fn(() => chain());
  builder.select = vi.fn(() => chain());
  builder.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
    resolve({ data: idFilter.map((id) => ({ id })), error: null });
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
      rpc: vi.fn(async () => ({ error: null })),
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
    expect(payload.data.summary.cancelledCount).toBe(0);
  });

  it("allows super_admin cancellation for an in-scope scheduled session", async () => {
    const selectBuilder = makeSelectBuilder({
      data: [
        { id: "session-super", status: "scheduled", therapist_id: "therapist-9" },
      ],
      error: null,
    });
    vi.spyOn(orgHelpers, "orgScopedQuery").mockImplementation(
      () => selectBuilder as unknown as ReturnType<typeof orgHelpers.orgScopedQuery>,
    );

    const updateBuilder = makeUpdateBuilder();
    vi.spyOn(supabaseAdmin, "from").mockReturnValue(updateBuilder as never);
    const mockDb: any = {
      from: vi.fn(() => updateBuilder),
      rpc: vi.fn(async () => ({ error: null })),
    };

    const logger = createStubLogger();

    const response = await __TESTING__.handleSessionCancellation(
      mockDb,
      "org-9",
      {
        sessionIds: ["session-super"],
        dateRange: null,
        therapistId: null,
        reason: "Scoped super admin cancellation",
      },
      "super-admin-user",
      "super_admin",
      logger,
    );

    const payload = await response.json() as {
      success: boolean;
      data: { summary: { cancelledCount: number; cancelledSessionIds: string[] } };
    };
    expect(payload.success).toBe(true);
    expect(payload.data.summary.cancelledCount).toBe(1);
    expect(payload.data.summary.cancelledSessionIds).toEqual(["session-super"]);
  });

  it("denies super_admin cancellation when the target session is outside the chosen org scope", async () => {
    const selectBuilder = makeSelectBuilder({
      data: [],
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
        "org-a",
        {
          sessionIds: ["session-org-b"],
          dateRange: null,
          therapistId: null,
          reason: null,
        },
        "super-admin-user",
        "super_admin",
        logger,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("treats in_progress sessions as cancellable for lifecycle parity", async () => {
    const selectBuilder = makeSelectBuilder({
      data: [
        { id: "session-progress", status: "in_progress", therapist_id: "therapist-1" },
      ],
      error: null,
    });
    vi.spyOn(orgHelpers, "orgScopedQuery").mockImplementation(
      () => selectBuilder as unknown as ReturnType<typeof orgHelpers.orgScopedQuery>,
    );

    const updateBuilder = makeUpdateBuilder();
    const mockDb: any = {
      from: vi.fn(() => updateBuilder),
      rpc: vi.fn(async () => ({ error: null })),
    };

    const logger = createStubLogger();

    const response = await __TESTING__.handleSessionCancellation(
      mockDb,
      "org-2",
      {
        sessionIds: ["session-progress"],
        dateRange: null,
        therapistId: null,
        reason: "Lifecycle parity",
      },
      "therapist-1",
      "therapist",
      logger,
    );

    const payload = await response.json() as {
      success: boolean;
      data: { summary: { cancelledCount: number; nonCancellableCount: number } };
    };
    expect(payload.success).toBe(true);
    expect(payload.data.summary.cancelledCount).toBe(0);
    expect(payload.data.summary.nonCancellableCount).toBe(0);
  });

  it("builds explicit timezone-aware UTC ranges for date cancellation across DST", () => {
    const springForward = __TESTING__.buildDateRange("2025-03-09", "America/Los_Angeles");
    const fallBack = __TESTING__.buildDateRange("2025-11-02", "America/Los_Angeles");

    expect(springForward).toEqual({
      start: "2025-03-09T08:00:00.000Z",
      end: "2025-03-10T06:59:59.999Z",
      timeZone: "America/Los_Angeles",
    });
    expect(fallBack).toEqual({
      start: "2025-11-02T07:00:00.000Z",
      end: "2025-11-03T07:59:59.999Z",
      timeZone: "America/Los_Angeles",
    });
  });

  it("reports invalid time zones as a bad date-window request instead of missing date input", () => {
    expect(() =>
      __TESTING__.parseCancelPayload({
        date: "2025-03-09",
        time_zone: "Mars/Phobos",
      }),
    ).toThrowError("Invalid date or time_zone for cancellation window");
  });

  it("derives super_admin scheduling org from targeted sessions when direct org context is absent", async () => {
    const mockDb: any = {
      rpc: vi.fn(async (fn: string) => {
        if (fn === "current_user_organization_id") {
          return { data: null, error: null };
        }
        if (fn === "current_user_is_super_admin") {
          return { data: true, error: null };
        }
        return { data: null, error: null };
      }),
    };
    const selectBuilder = {
      select: vi.fn(() => selectBuilder),
      in: vi.fn(() => Promise.resolve({
        data: [{ id: "session-a", organization_id: "org-42" }],
        error: null,
      })),
    } as any;
    vi.spyOn(supabaseAdmin, "from").mockReturnValue(selectBuilder);

    await expect(
      __TESTING__.resolveOrgForCancellationRequest(
        mockDb,
        { holdKey: null, sessionIds: ["session-a"], therapistId: null },
      ),
    ).resolves.toBe("org-42");
  });

  it("denies super_admin fallback when targeted sessions span multiple organizations", async () => {
    const mockDb: any = {
      rpc: vi.fn(async (fn: string) => {
        if (fn === "current_user_organization_id") {
          return { data: null, error: null };
        }
        if (fn === "current_user_is_super_admin") {
          return { data: true, error: null };
        }
        return { data: null, error: null };
      }),
    };
    const selectBuilder = {
      select: vi.fn(() => selectBuilder),
      in: vi.fn(() => Promise.resolve({
        data: [
          { id: "session-a", organization_id: "org-42" },
          { id: "session-b", organization_id: "org-43" },
        ],
        error: null,
      })),
    } as any;
    vi.spyOn(supabaseAdmin, "from").mockReturnValue(selectBuilder);

    await expect(
      __TESTING__.resolveOrgForCancellationRequest(
        mockDb,
        { holdKey: null, sessionIds: ["session-a", "session-b"], therapistId: null },
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("derives super_admin scheduling org from targeted hold when direct org context is absent", async () => {
    const mockDb: any = {
      rpc: vi.fn(async (fn: string) => {
        if (fn === "current_user_organization_id") {
          return { data: null, error: null };
        }
        if (fn === "current_user_is_super_admin") {
          return { data: true, error: null };
        }
        return { data: null, error: null };
      }),
    };
    const selectBuilder = {
      select: vi.fn(() => selectBuilder),
      eq: vi.fn(() => selectBuilder),
      maybeSingle: vi.fn(() => Promise.resolve({
        data: { organization_id: "org-hold" },
        error: null,
      })),
    } as any;
    vi.spyOn(supabaseAdmin, "from").mockReturnValue(selectBuilder);

    await expect(
      __TESTING__.resolveOrgForCancellationRequest(
        mockDb,
        { holdKey: "hold-1", sessionIds: [], therapistId: null },
      ),
    ).resolves.toBe("org-hold");
  });

  it("returns no cancellation role for unauthorized users", async () => {
    vi.spyOn(orgHelpers, "assertUserHasOrgRole").mockResolvedValue(false);

    const mockDb: any = {
      rpc: vi.fn(),
    };

    await expect(
      __TESTING__.resolveCancellationRole(mockDb, "org-1", "viewer-user"),
    ).resolves.toBeNull();
  });
});

