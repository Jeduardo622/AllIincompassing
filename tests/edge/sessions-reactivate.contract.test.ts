import { beforeEach, describe, expect, it, vi } from "vitest";
import { stubDenoEnv } from "../utils/stubDeno";

stubDenoEnv(() => "");

const { idempotencyConflictCtor } = vi.hoisted(() => ({
  idempotencyConflictCtor: class IdempotencyConflictError extends Error {},
}));

const createRequestClientMock = vi.fn();
const resolveOrgIdMock = vi.fn();
const assertUserHasOrgRoleMock = vi.fn();
const buildScopedIdempotencyKeyMock = vi.fn();
const findIdempotencyMock = vi.fn();
const persistIdempotencyMock = vi.fn();
const supabaseAdminFromMock = vi.fn();
const supabaseAdminRpcMock = vi.fn();

class MissingOrgContextError extends Error {
  status = 403;
  constructor(message = "Organization context required") {
    super(message);
    this.name = "MissingOrgContextError";
  }
}

class ForbiddenError extends Error {
  status = 403;
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

async function loadModule() {
  vi.doMock("../../supabase/functions/_shared/database.ts", () => ({
    createRequestClient: createRequestClientMock,
    supabaseAdmin: {
      from: supabaseAdminFromMock,
      rpc: supabaseAdminRpcMock,
    },
  }));
  vi.doMock("../../supabase/functions/_shared/org.ts", () => ({
    resolveOrgId: resolveOrgIdMock,
    assertUserHasOrgRole: assertUserHasOrgRoleMock,
    MissingOrgContextError,
    ForbiddenError,
  }));
  vi.doMock("../../supabase/functions/_shared/idempotency.ts", () => ({
    buildScopedIdempotencyKey: buildScopedIdempotencyKeyMock,
    createSupabaseIdempotencyService: () => ({
      find: findIdempotencyMock,
      persist: persistIdempotencyMock,
    }),
    IdempotencyConflictError: idempotencyConflictCtor,
  }));

  return import("../../supabase/functions/sessions-reactivate/index.ts");
}

const postUrl = "https://edge.example/functions/v1/sessions-reactivate";

const makeScopedSessionBuilder = (rows: unknown[]) => {
  const builder: any = {};
  const chain = () => builder;
  builder.select = vi.fn(() => chain());
  builder.eq = vi.fn(() => chain());
  builder.limit = vi.fn(async () => ({ data: rows, error: null }));
  return builder;
};

describe("sessions-reactivate contract", () => {
  beforeEach(() => {
    vi.resetModules();
    createRequestClientMock.mockReset();
    resolveOrgIdMock.mockReset();
    assertUserHasOrgRoleMock.mockReset();
    buildScopedIdempotencyKeyMock.mockReset();
    findIdempotencyMock.mockReset();
    persistIdempotencyMock.mockReset();
    supabaseAdminFromMock.mockReset();
    supabaseAdminRpcMock.mockReset();

    buildScopedIdempotencyKeyMock.mockImplementation((key: string, scope: { organizationId: string; userId: string }) => (
      `${scope.organizationId}::${scope.userId}::${key}`
    ));
    persistIdempotencyMock.mockResolvedValue(null);
    supabaseAdminFromMock.mockReturnValue(makeScopedSessionBuilder([{
      id: "11111111-1111-4111-8111-111111111111",
      organization_id: "org-1",
    }]));
  });

  it("returns 400 when session_id is missing or invalid", async () => {
    createRequestClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })),
      },
      rpc: vi.fn(async () => ({ data: true, error: null })),
    });
    resolveOrgIdMock.mockResolvedValue("org-1");

    const mod = await loadModule();
    const response = await mod.handleSessionsReactivate(new Request(postUrl, {
      method: "POST",
      body: JSON.stringify({ session_id: "bad-id" }),
    }));

    expect(response.status).toBe(400);
  });

  it("returns 401 for unauthenticated requests", async () => {
    createRequestClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: null }, error: new Error("missing") })),
      },
    });

    const mod = await loadModule();
    const response = await mod.handleSessionsReactivate(new Request(postUrl, {
      method: "POST",
      body: JSON.stringify({ session_id: "11111111-1111-4111-8111-111111111111" }),
    }));

    expect(response.status).toBe(401);
  });

  it("allows only the exact reactivation role list and denies therapist-only callers", async () => {
    createRequestClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: "therapist-user" } }, error: null })),
      },
      rpc: vi.fn(async (fn: string) => {
        if (fn === "current_user_is_super_admin") {
          return { data: false, error: null };
        }
        return { data: null, error: null };
      }),
    });
    resolveOrgIdMock.mockResolvedValue("org-1");
    assertUserHasOrgRoleMock.mockImplementation(async (_db: unknown, _orgId: string, role: string) => role === "therapist");

    const mod = await loadModule();
    const response = await mod.handleSessionsReactivate(new Request(postUrl, {
      method: "POST",
      body: JSON.stringify({ session_id: "11111111-1111-4111-8111-111111111111" }),
    }));

    expect(response.status).toBe(403);
    expect(assertUserHasOrgRoleMock).toHaveBeenCalledWith(expect.anything(), "org-1", "super_admin");
    expect(assertUserHasOrgRoleMock).toHaveBeenCalledWith(expect.anything(), "org-1", "admin");
    expect(assertUserHasOrgRoleMock).toHaveBeenCalledWith(expect.anything(), "org-1", "admin_schedule");
    expect(assertUserHasOrgRoleMock).toHaveBeenCalledWith(expect.anything(), "org-1", "midtier");
    expect(assertUserHasOrgRoleMock).toHaveBeenCalledWith(expect.anything(), "org-1", "bcba");
    expect(assertUserHasOrgRoleMock).not.toHaveBeenCalledWith(expect.anything(), "org-1", "therapist");
  });

  it("filters the target session by the resolved organization before the RPC", async () => {
    const rpcMock = vi.fn(async () => ({
      data: {
        success: true,
        already_reactivated: false,
        session_id: "11111111-1111-4111-8111-111111111111",
      },
      error: null,
    }));
    createRequestClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: "admin-user" } }, error: null })),
      },
      rpc: vi.fn(async (fn: string) => {
        if (fn === "current_user_is_super_admin") {
          return { data: false, error: null };
        }
        return { data: null, error: null };
      }),
    });
    resolveOrgIdMock.mockResolvedValue("org-1");
    assertUserHasOrgRoleMock.mockImplementation(async (_db: unknown, _orgId: string, role: string) => role === "admin_schedule");
    supabaseAdminRpcMock.mockImplementation(rpcMock);

    const mod = await loadModule();
    const response = await mod.handleSessionsReactivate(new Request(postUrl, {
      method: "POST",
      headers: { "Idempotency-Key": "reactivate-1" },
      body: JSON.stringify({
        session_id: "11111111-1111-4111-8111-111111111111",
        start_time: "2026-07-29T17:00:00.000Z",
        end_time: "2026-07-29T18:00:00.000Z",
      }),
    }));

    expect(response.status).toBe(200);
    expect(supabaseAdminFromMock).toHaveBeenCalledWith("sessions");
    expect(rpcMock).toHaveBeenCalledWith("reactivate_cancelled_session", {
      p_session_id: "11111111-1111-4111-8111-111111111111",
      p_actor_id: "admin-user",
      p_start_time: "2026-07-29T17:00:00.000Z",
      p_end_time: "2026-07-29T18:00:00.000Z",
    });
  });

  it("rejects partial reactivation windows", async () => {
    createRequestClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: "admin-user" } }, error: null })),
      },
      rpc: vi.fn(async (fn: string) => {
        if (fn === "current_user_is_super_admin") {
          return { data: false, error: null };
        }
        return { data: null, error: null };
      }),
    });
    resolveOrgIdMock.mockResolvedValue("org-1");

    const mod = await loadModule();
    const response = await mod.handleSessionsReactivate(new Request(postUrl, {
      method: "POST",
      body: JSON.stringify({
        session_id: "11111111-1111-4111-8111-111111111111",
        start_time: "2026-07-29T17:00:00.000Z",
      }),
    }));

    expect(response.status).toBe(400);
  });

  it("maps RPC outcomes to stable HTTP statuses", async () => {
    createRequestClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: "admin-user" } }, error: null })),
      },
      rpc: vi.fn(async (fn: string) => {
        if (fn === "current_user_is_super_admin") {
          return { data: false, error: null };
        }
        return { data: null, error: null };
      }),
    });
    resolveOrgIdMock.mockResolvedValue("org-1");
    assertUserHasOrgRoleMock.mockImplementation(async (_db: unknown, _orgId: string, role: string) => role === "admin");
    const mod = await loadModule();

    supabaseAdminRpcMock.mockResolvedValueOnce({
      data: { success: false, error_code: "SESSION_NOT_FOUND" },
      error: null,
    });
    let response = await mod.handleSessionsReactivate(new Request(postUrl, {
      method: "POST",
      body: JSON.stringify({ session_id: "11111111-1111-4111-8111-111111111111" }),
    }));
    expect(response.status).toBe(404);

    supabaseAdminRpcMock.mockResolvedValueOnce({
      data: { success: false, error_code: "THERAPIST_CONFLICT" },
      error: null,
    });
    response = await mod.handleSessionsReactivate(new Request(postUrl, {
      method: "POST",
      body: JSON.stringify({ session_id: "11111111-1111-4111-8111-111111111111" }),
    }));
    expect(response.status).toBe(409);

    supabaseAdminRpcMock.mockResolvedValueOnce({
      data: { success: false, error_code: "AUTHORIZATION_INVALID" },
      error: null,
    });
    response = await mod.handleSessionsReactivate(new Request(postUrl, {
      method: "POST",
      body: JSON.stringify({ session_id: "11111111-1111-4111-8111-111111111111" }),
    }));
    expect(response.status).toBe(409);

    supabaseAdminRpcMock.mockResolvedValueOnce({
      data: { success: false, error_code: "HOLD_CONFLICT" },
      error: null,
    });
    response = await mod.handleSessionsReactivate(new Request(postUrl, {
      method: "POST",
      body: JSON.stringify({ session_id: "11111111-1111-4111-8111-111111111111" }),
    }));
    expect(response.status).toBe(409);
    const holdConflictBody = await response.json() as { code?: string };
    expect(holdConflictBody.code).toBe("HOLD_CONFLICT");
  });

  it("replays stored responses and marks them with Idempotent-Replay", async () => {
    createRequestClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: "admin-user" } }, error: null })),
      },
      rpc: vi.fn(async (fn: string) => {
        if (fn === "current_user_is_super_admin") {
          return { data: false, error: null };
        }
        return { data: null, error: null };
      }),
    });
    resolveOrgIdMock.mockResolvedValue("org-1");
    assertUserHasOrgRoleMock.mockImplementation(async (_db: unknown, _orgId: string, role: string) => role === "admin");
    findIdempotencyMock.mockResolvedValue({
      key: "org-1::admin-user::reactivate-1",
      endpoint: "sessions-reactivate",
      responseHash: "hash",
      responseBody: {
        success: true,
        data: {
          outcome: "reactivated",
          sessionId: "11111111-1111-4111-8111-111111111111",
        },
        _request_session_id: "11111111-1111-4111-8111-111111111111",
        _request_start_time: null,
        _request_end_time: null,
      },
      statusCode: 200,
    });

    const mod = await loadModule();
    const response = await mod.handleSessionsReactivate(new Request(postUrl, {
      method: "POST",
      headers: { "Idempotency-Key": "reactivate-1" },
      body: JSON.stringify({ session_id: "11111111-1111-4111-8111-111111111111" }),
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Idempotent-Replay")).toBe("true");
    const body = await response.json() as Record<string, unknown>;
    expect(body).not.toHaveProperty("_request_session_id");
  });

  it("does not expose idempotency matching metadata in the initial success body", async () => {
    createRequestClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: "admin-user" } }, error: null })),
      },
      rpc: vi.fn(async (fn: string) => {
        if (fn === "current_user_is_super_admin") {
          return { data: false, error: null };
        }
        return { data: null, error: null };
      }),
    });
    resolveOrgIdMock.mockResolvedValue("org-1");
    assertUserHasOrgRoleMock.mockImplementation(async (_db: unknown, _orgId: string, role: string) => role === "admin");
    supabaseAdminRpcMock.mockResolvedValueOnce({
      data: {
        success: true,
        already_reactivated: false,
        session_id: "11111111-1111-4111-8111-111111111111",
      },
      error: null,
    });

    const mod = await loadModule();
    const response = await mod.handleSessionsReactivate(new Request(postUrl, {
      method: "POST",
      headers: { "Idempotency-Key": "reactivate-1" },
      body: JSON.stringify({ session_id: "11111111-1111-4111-8111-111111111111" }),
    }));

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).not.toHaveProperty("_request_session_id");
    expect(persistIdempotencyMock).toHaveBeenCalledWith(
      "org-1::admin-user::reactivate-1",
      "sessions-reactivate",
      expect.objectContaining({
        _request_session_id: "11111111-1111-4111-8111-111111111111",
        _request_start_time: null,
        _request_end_time: null,
      }),
      200,
    );
  });

  it("returns JSON 500 with cors headers when an unexpected exception escapes", async () => {
    createRequestClientMock.mockImplementation(() => {
      throw new Error("boom");
    });

    const mod = await loadModule();
    const response = await mod.handleSessionsReactivate(new Request(postUrl, {
      method: "POST",
      body: JSON.stringify({ session_id: "11111111-1111-4111-8111-111111111111" }),
    }));

    expect(response.status).toBe(500);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeTruthy();
  });

  it("replays the stored response when identical idempotency persistence races after rpc success", async () => {
    createRequestClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: "admin-user" } }, error: null })),
      },
      rpc: vi.fn(async (fn: string) => {
        if (fn === "current_user_is_super_admin") {
          return { data: false, error: null };
        }
        return { data: null, error: null };
      }),
    });
    resolveOrgIdMock.mockResolvedValue("org-1");
    assertUserHasOrgRoleMock.mockImplementation(async (_db: unknown, _orgId: string, role: string) => role === "admin");
    supabaseAdminRpcMock.mockResolvedValueOnce({
      data: {
        success: true,
        already_reactivated: false,
        session_id: "11111111-1111-4111-8111-111111111111",
      },
      error: null,
    });
    persistIdempotencyMock.mockRejectedValueOnce(new idempotencyConflictCtor("conflict"));
    findIdempotencyMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        key: "org-1::admin-user::reactivate-1",
        endpoint: "sessions-reactivate",
        responseHash: "hash",
        responseBody: {
          success: true,
          data: {
            outcome: "reactivated",
            sessionId: "11111111-1111-4111-8111-111111111111",
          },
          _request_session_id: "11111111-1111-4111-8111-111111111111",
          _request_start_time: null,
          _request_end_time: null,
        },
        statusCode: 200,
      });

    const mod = await loadModule();
    const response = await mod.handleSessionsReactivate(new Request(postUrl, {
      method: "POST",
      headers: { "Idempotency-Key": "reactivate-1" },
      body: JSON.stringify({ session_id: "11111111-1111-4111-8111-111111111111" }),
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Idempotent-Replay")).toBe("true");
    const body = await response.json() as Record<string, unknown>;
    expect(body).not.toHaveProperty("_request_session_id");
  });

  it("returns 409 when an idempotency key is reused with a different session payload", async () => {
    createRequestClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: "admin-user" } }, error: null })),
      },
      rpc: vi.fn(async (fn: string) => {
        if (fn === "current_user_is_super_admin") {
          return { data: false, error: null };
        }
        return { data: null, error: null };
      }),
    });
    resolveOrgIdMock.mockResolvedValue("org-1");
    assertUserHasOrgRoleMock.mockImplementation(async (_db: unknown, _orgId: string, role: string) => role === "admin");
    findIdempotencyMock.mockResolvedValue({
      key: "org-1::admin-user::reactivate-1",
      endpoint: "sessions-reactivate",
      responseHash: "hash",
        responseBody: {
          success: true,
          data: { outcome: "reactivated", sessionId: "11111111-1111-4111-8111-111111111111" },
          _request_session_id: "11111111-1111-4111-8111-111111111111",
          _request_start_time: null,
          _request_end_time: null,
        },
      statusCode: 200,
    });

    const mod = await loadModule();
    const response = await mod.handleSessionsReactivate(new Request(postUrl, {
      method: "POST",
      headers: { "Idempotency-Key": "reactivate-1" },
      body: JSON.stringify({ session_id: "22222222-2222-4222-8222-222222222222" }),
    }));

    expect(response.status).toBe(409);
  });

  it("returns 409 when the same idempotency key is replayed with a different request window", async () => {
    createRequestClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: "admin-user" } }, error: null })),
      },
      rpc: vi.fn(async (fn: string) => {
        if (fn === "current_user_is_super_admin") {
          return { data: false, error: null };
        }
        return { data: null, error: null };
      }),
    });
    resolveOrgIdMock.mockResolvedValue("org-1");
    assertUserHasOrgRoleMock.mockImplementation(async (_db: unknown, _orgId: string, role: string) => role === "admin");
    findIdempotencyMock.mockResolvedValue({
      key: "org-1::admin-user::reactivate-1",
      endpoint: "sessions-reactivate",
      responseHash: "hash",
      responseBody: {
        success: true,
        data: { outcome: "reactivated", sessionId: "11111111-1111-4111-8111-111111111111" },
        _request_session_id: "11111111-1111-4111-8111-111111111111",
        _request_start_time: "2026-07-29T17:00:00.000Z",
        _request_end_time: "2026-07-29T18:00:00.000Z",
      },
      statusCode: 200,
    });

    const mod = await loadModule();
    const response = await mod.handleSessionsReactivate(new Request(postUrl, {
      method: "POST",
      headers: { "Idempotency-Key": "reactivate-1" },
      body: JSON.stringify({
        session_id: "11111111-1111-4111-8111-111111111111",
        start_time: "2026-07-29T19:00:00.000Z",
        end_time: "2026-07-29T20:00:00.000Z",
      }),
    }));

    expect(response.status).toBe(409);
  });
});
