import { beforeEach, describe, expect, it, vi } from "vitest";

const createRequestClientMock = vi.fn();
const requireOrgMock = vi.fn();
const assertUserHasOrgRoleMock = vi.fn();
const orgScopedQueryMock = vi.fn();

async function loadGoalsModule() {
  vi.doMock("../../supabase/functions/_shared/database.ts", () => ({
    createRequestClient: createRequestClientMock,
  }));
  vi.doMock("../../supabase/functions/_shared/org.ts", () => ({
    requireOrg: requireOrgMock,
    assertUserHasOrgRole: assertUserHasOrgRoleMock,
    orgScopedQuery: orgScopedQueryMock,
  }));
  return import("../../supabase/functions/goals/index.ts");
}

describe("goals route out-of-org PATCH deny matrix parity", () => {
  beforeEach(() => {
    vi.resetModules();
    createRequestClientMock.mockReset();
    requireOrgMock.mockReset();
    assertUserHasOrgRoleMock.mockReset();
    orgScopedQueryMock.mockReset();
  });

  const roleMatrix = [["therapist"], ["admin"], ["super_admin"]] as const;

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
