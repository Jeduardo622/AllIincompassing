import { beforeEach, describe, expect, it, vi } from "vitest";
import { stubDenoEnv } from "../utils/stubDeno";

const envValues = new Map<string, string>([
  ["CORS_ALLOWED_ORIGINS", "https://app.example.com,https://preview.example.com"],
  ["APP_ENV", "production"],
]);

stubDenoEnv((key) => envValues.get(key) ?? "");

const createRequestClientMock = vi.fn();
const requireOrgMock = vi.fn();
const currentUserCanManageProgramsGoalsMock = vi.fn();
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
    currentUserCanManageProgramsGoals: currentUserCanManageProgramsGoalsMock,
    orgScopedQuery: orgScopedQueryMock,
    MissingOrgContextError,
  }));
  return import("../../supabase/functions/goals/index.ts");
}

function configureGoalsGetSuccessDb() {
  createRequestClientMock.mockReturnValue({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "therapist-1" } }, error: null })),
    },
  });
  requireOrgMock.mockResolvedValue("org-1");
  currentUserCanManageProgramsGoalsMock.mockResolvedValue(true);
  orgScopedQueryMock.mockImplementation((_db: unknown, table: string) => {
    if (table !== "goals") {
      throw new Error(`Unexpected table lookup: ${table}`);
    }
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(async () => ({ data: [{ id: "goal-1" }], error: null })),
        })),
      })),
    };
  });
}

const roleMatrix = [["therapist"], ["midtier"], ["admin"], ["super_admin"]] as const;

describe("goals route organization context parity", () => {
  beforeEach(() => {
    vi.resetModules();
    createRequestClientMock.mockReset();
    requireOrgMock.mockReset();
    currentUserCanManageProgramsGoalsMock.mockReset();
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

  it("includes request-scoped CORS headers on allowed-origin GET success", async () => {
    configureGoalsGetSuccessDb();
    const module = await loadGoalsModule();

    const response = await module.handleGoals(
      new Request("https://edge.example.com/functions/v1/goals?program_id=11111111-1111-4111-8111-111111111111", {
        method: "GET",
        headers: {
          Origin: "https://preview.example.com",
          Authorization: "Bearer token",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://preview.example.com");
    expect(response.headers.get("Vary")).toBe("Origin");
    expect(response.headers.get("Content-Type")).toContain("application/json");
  });

  it("keeps OPTIONS preflight behavior unchanged for goals route", async () => {
    const module = await loadGoalsModule();

    const response = await module.default(
      new Request("https://edge.example.com/functions/v1/goals?program_id=11111111-1111-4111-8111-111111111111", {
        method: "OPTIONS",
        headers: {
          Origin: "https://preview.example.com",
          "Access-Control-Request-Method": "GET",
        },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://preview.example.com");
    expect(response.headers.get("Vary")).toBe("Origin");
  });
});

describe("goals route out-of-org PATCH deny matrix parity", () => {
  beforeEach(() => {
    vi.resetModules();
    createRequestClientMock.mockReset();
    requireOrgMock.mockReset();
    currentUserCanManageProgramsGoalsMock.mockReset();
    orgScopedQueryMock.mockReset();
  });

  it.each(roleMatrix)("denies out-of-org PATCH goal_id when %s has program-goal capability", async () => {
    createRequestClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })),
      },
    });
    requireOrgMock.mockResolvedValue("org-1");
    currentUserCanManageProgramsGoalsMock.mockResolvedValue(true);
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
    currentUserCanManageProgramsGoalsMock.mockReset();
    orgScopedQueryMock.mockReset();
  });

  const validGoalBody = () => ({
    client_id: "11111111-1111-4111-8111-111111111111",
    program_id: "22222222-2222-4222-8222-222222222222",
    title: "Goal",
    description: "Description",
    original_text: "Clinical text",
  });

  it.each(roleMatrix)("denies out-of-org program_id on POST when %s has program-goal capability", async () => {
    createRequestClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })),
      },
    });
    requireOrgMock.mockResolvedValue("org-1");
    currentUserCanManageProgramsGoalsMock.mockResolvedValue(true);
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

  it("allows midtier through the handler role gate when the capability helper allows program-goal management", async () => {
    const insertMock = vi.fn(() => ({
      select: vi.fn(() => ({
        limit: vi.fn(async () => ({ data: [{ id: "goal-1" }], error: null })),
      })),
    }));
    const db = {
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: "midtier-1" } }, error: null })),
      },
    };
    createRequestClientMock.mockReturnValue(db);
    requireOrgMock.mockResolvedValue("org-1");
    currentUserCanManageProgramsGoalsMock.mockResolvedValue(true);
    orgScopedQueryMock.mockImplementation((_db: unknown, table: string) => {
      if (table === "programs") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              limit: vi.fn(async () => ({
                data: [{ id: "program-1", client_id: "11111111-1111-4111-8111-111111111111" }],
                error: null,
              })),
            })),
          })),
        };
      }
      if (table === "goals") {
        return { insert: insertMock };
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

    expect(response.status).toBe(201);
    expect(currentUserCanManageProgramsGoalsMock).toHaveBeenCalledWith(db, "org-1");
  });

  it.each([["admin_schedule"], ["bt"]])("denies %s when the capability helper rejects program-goal management", async () => {
    createRequestClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: "denied-user-1" } }, error: null })),
      },
    });
    requireOrgMock.mockResolvedValue("org-1");
    currentUserCanManageProgramsGoalsMock.mockResolvedValue(false);
    const module = await loadGoalsModule();

    const response = await module.handleGoals(
      new Request("https://edge.example.com/functions/v1/goals", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify(validGoalBody()),
      }),
    );

    expect(response.status).toBe(403);
    expect(orgScopedQueryMock).not.toHaveBeenCalled();
  });
});
