import { beforeEach, describe, expect, it, vi } from "vitest";

const createRequestClientMock = vi.fn();
const requireOrgMock = vi.fn();
const assertUserHasOrgRoleMock = vi.fn();
const orgScopedQueryMock = vi.fn();

class MissingOrgContextError extends Error {
  status = 403;
  constructor(message = "Organization context required") {
    super(message);
    this.name = "MissingOrgContextError";
  }
}

async function loadGoalsModule() {
  vi.doMock("../../supabase/functions/_shared/database.ts", () => ({
    createRequestClient: createRequestClientMock,
  }));
  vi.doMock("../../supabase/functions/_shared/org.ts", () => ({
    requireOrg: requireOrgMock,
    assertUserHasOrgRole: assertUserHasOrgRoleMock,
    orgScopedQuery: orgScopedQueryMock,
    MissingOrgContextError,
  }));
  return import("../../supabase/functions/goals/index.ts");
}

const roleMatrix = [["therapist"], ["admin"], ["super_admin"]] as const;

describe("goals route organization context parity", () => {
  beforeEach(() => {
    vi.resetModules();
    createRequestClientMock.mockReset();
    requireOrgMock.mockReset();
    assertUserHasOrgRoleMock.mockReset();
    orgScopedQueryMock.mockReset();
  });

  it("fails closed with 403 when organization context is missing (GET)", async () => {
    createRequestClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })),
      },
    });
    requireOrgMock.mockRejectedValue(new MissingOrgContextError());
    const module = await loadGoalsModule();

    const response = await module.handleGoals(
      new Request("https://edge.example.com/functions/v1/goals?program_id=11111111-1111-4111-8111-111111111111", {
        method: "GET",
        headers: { Authorization: "Bearer token" },
      }),
    );

    expect(response.status).toBe(403);
  });

  it("returns 403 for invalid-token + missing-org by prioritizing org-context denial", async () => {
    const getUserMock = vi.fn(async () => ({
      data: { user: null },
      error: { message: "invalid token" },
    }));
    createRequestClientMock.mockReturnValue({
      auth: {
        getUser: getUserMock,
      },
    });
    requireOrgMock.mockRejectedValue(new MissingOrgContextError());
    const module = await loadGoalsModule();

    const response = await module.handleGoals(
      new Request("https://edge.example.com/functions/v1/goals?program_id=11111111-1111-4111-8111-111111111111", {
        method: "GET",
        headers: { Authorization: "Bearer invalid-token" },
      }),
    );

    expect(response.status).toBe(403);
    expect(getUserMock).not.toHaveBeenCalled();
  });
});

describe("goals route out-of-org PATCH deny matrix parity", () => {
  beforeEach(() => {
    vi.resetModules();
    createRequestClientMock.mockReset();
    requireOrgMock.mockReset();
    assertUserHasOrgRoleMock.mockReset();
    orgScopedQueryMock.mockReset();
  });

  it.each(roleMatrix)("denies out-of-org PATCH goal_id for %s role", async (activeRole) => {
    createRequestClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })),
      },
    });
    requireOrgMock.mockResolvedValue("org-1");
    assertUserHasOrgRoleMock.mockImplementation(async (_db: unknown, _orgId: string, role: string) => role === activeRole);
    orgScopedQueryMock.mockImplementation((_db: unknown, table: string) => {
      if (table !== "goals") {
        throw new Error(`Unexpected table lookup: ${table}`);
      }
      return {
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              limit: vi.fn(async () => ({ data: [], error: null })),
            })),
          })),
        })),
      };
    });
    const module = await loadGoalsModule();

    const response = await module.handleGoals(
      new Request(
        "https://edge.example.com/functions/v1/goals?goal_id=11111111-1111-4111-8111-111111111111",
        {
          method: "PATCH",
          headers: { Authorization: "Bearer token" },
          body: JSON.stringify({ title: "Updated goal title" }),
        },
      ),
    );

    expect(response.status).toBe(403);
  });
});

describe("goals route org-scope deny matrix", () => {
  beforeEach(() => {
    vi.resetModules();
    createRequestClientMock.mockReset();
    requireOrgMock.mockReset();
    assertUserHasOrgRoleMock.mockReset();
    orgScopedQueryMock.mockReset();
  });

  const validGoalBody = () => ({
    client_id: "11111111-1111-4111-8111-111111111111",
    program_id: "22222222-2222-4222-8222-222222222222",
    title: "Goal",
    description: "Description",
    original_text: "Clinical text",
  });

  it.each(roleMatrix)("denies out-of-org program_id on POST for %s role", async (activeRole) => {
    createRequestClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })),
      },
    });
    requireOrgMock.mockResolvedValue("org-1");
    assertUserHasOrgRoleMock.mockImplementation(async (_db: unknown, _orgId: string, role: string) => role === activeRole);
    const goalsInsert = vi.fn(() => {
      throw new Error("goals insert should not run when program is out of scope");
    });
    orgScopedQueryMock.mockImplementation((_db: unknown, table: string) => {
      if (table === "programs") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              limit: vi.fn(async () => ({ data: [], error: null })),
            })),
          })),
        };
      }
      if (table === "goals") {
        return { insert: goalsInsert };
      }
      throw new Error(`Unexpected table lookup: ${table}`);
    });
    const module = await loadGoalsModule();

    const response = await module.handleGoals(
      new Request("https://edge.example.com/functions/v1/goals", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify(validGoalBody()),
      }),
    );

    expect(response.status).toBe(403);
    expect(goalsInsert).not.toHaveBeenCalled();
  });
});
