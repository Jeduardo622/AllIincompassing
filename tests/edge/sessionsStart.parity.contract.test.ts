import { beforeEach, describe, expect, it, vi } from "vitest";
import { stubDenoEnv } from "../utils/stubDeno";

stubDenoEnv(() => "");

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

async function loadSessionsStartModule() {
  vi.doMock("../../supabase/functions/_shared/database.ts", () => ({
    createRequestClient: createRequestClientMock,
  }));
  vi.doMock("../../supabase/functions/_shared/org.ts", () => ({
    requireOrg: requireOrgMock,
    assertUserHasOrgRole: assertUserHasOrgRoleMock,
    orgScopedQuery: orgScopedQueryMock,
    MissingOrgContextError,
  }));
  return import("../../supabase/functions/sessions-start/index.ts");
}

const postUrl = "https://edge.example/functions/v1/sessions-start";

const baseBody = () => ({
  session_id: "11111111-1111-4111-8111-111111111111",
  program_id: "22222222-2222-4222-8222-222222222222",
  goal_id: "33333333-3333-4333-8333-333333333333",
});

describe("sessions-start organization context parity", () => {
  beforeEach(() => {
    vi.resetModules();
    createRequestClientMock.mockReset();
    requireOrgMock.mockReset();
    assertUserHasOrgRoleMock.mockReset();
    orgScopedQueryMock.mockReset();
  });

  it("returns 403 when organization context is missing before auth.getUser", async () => {
    const getUserMock = vi.fn(async () => ({ data: { user: { id: "user-1" } }, error: null }));
    createRequestClientMock.mockReturnValue({
      auth: { getUser: getUserMock },
    });
    requireOrgMock.mockRejectedValue(new MissingOrgContextError());
    const mod = await loadSessionsStartModule();

    const response = await mod.handleSessionsStart(
      new Request(postUrl, {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify(baseBody()),
      }),
    );

    expect(response.status).toBe(403);
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it("returns 403 when therapist is not the session owner", async () => {
    createRequestClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: "therapist-self" } }, error: null })),
      },
      rpc: vi.fn(async () => {
        throw new Error("rpc should not run");
      }),
    });
    requireOrgMock.mockResolvedValue("org-1");
    assertUserHasOrgRoleMock.mockImplementation(async (_db: unknown, _org: string, role: string) => role === "therapist");
    orgScopedQueryMock.mockImplementation(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          limit: vi.fn(async () => ({
            data: [
              {
                id: baseBody().session_id,
                client_id: "c1",
                therapist_id: "other-therapist",
                started_at: null,
                status: "scheduled",
              },
            ],
            error: null,
          })),
        })),
      })),
    }));
    const mod = await loadSessionsStartModule();

    const response = await mod.handleSessionsStart(
      new Request(postUrl, {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify(baseBody()),
      }),
    );

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe("Forbidden");
  });

  it("returns 404 when session is not in org scope", async () => {
    createRequestClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: "therapist-1" } }, error: null })),
      },
    });
    requireOrgMock.mockResolvedValue("org-1");
    assertUserHasOrgRoleMock.mockResolvedValue(true);
    orgScopedQueryMock.mockImplementation(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          limit: vi.fn(async () => ({ data: [], error: null })),
        })),
      })),
    }));
    const mod = await loadSessionsStartModule();

    const response = await mod.handleSessionsStart(
      new Request(postUrl, {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify(baseBody()),
      }),
    );

    expect(response.status).toBe(404);
  });
});

describe("sessions-start RPC result mapping parity", () => {
  beforeEach(() => {
    vi.resetModules();
    createRequestClientMock.mockReset();
    requireOrgMock.mockReset();
    assertUserHasOrgRoleMock.mockReset();
    orgScopedQueryMock.mockReset();
  });

  it("maps RPC failure FORBIDDEN to HTTP 403", async () => {
    const rpcMock = vi.fn(async () => ({
      data: {
        success: false,
        error_code: "FORBIDDEN",
        error_message: "Not allowed",
      },
      error: null,
    }));
    createRequestClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: "therapist-1" } }, error: null })),
      },
      rpc: rpcMock,
    });
    requireOrgMock.mockResolvedValue("org-1");
    assertUserHasOrgRoleMock.mockResolvedValue(true);
    orgScopedQueryMock.mockImplementation(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          limit: vi.fn(async () => ({
            data: [
              {
                id: baseBody().session_id,
                client_id: "c1",
                therapist_id: "therapist-1",
                started_at: null,
                status: "scheduled",
              },
            ],
            error: null,
          })),
        })),
      })),
    }));
    const mod = await loadSessionsStartModule();

    const response = await mod.handleSessionsStart(
      new Request(postUrl, {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify(baseBody()),
      }),
    );

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe("Not allowed");
    expect(rpcMock).toHaveBeenCalled();
  });
});
