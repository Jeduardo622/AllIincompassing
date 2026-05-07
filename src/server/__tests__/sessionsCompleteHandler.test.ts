import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __TESTING__, sessionsCompleteHandler } from "../api/sessions-complete";

vi.mock("../api/shared", async () => {
  const actual = await vi.importActual<typeof import("../api/shared")>("../api/shared");
  return {
    ...actual,
    getAccessToken: vi.fn(),
    consumeRateLimit: vi.fn(),
  };
});

vi.mock("../runtimeConfig", async () => {
  const actual = await vi.importActual<typeof import("../runtimeConfig")>("../runtimeConfig");
  return {
    ...actual,
    getRuntimeSupabaseConfig: vi.fn(),
  };
});

import { consumeRateLimit, getAccessToken } from "../api/shared";
import { getRuntimeSupabaseConfig } from "../runtimeConfig";

describe("sessionsCompleteHandler", () => {
  const sessionId = "11111111-1111-1111-1111-111111111111";

  const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  const makeFallbackFetchMock = ({
    session = {
      id: sessionId,
      status: "scheduled",
      therapist_id: "therapist-user",
      start_time: "2026-03-31T09:00:00Z",
      end_time: "2026-03-31T10:00:00Z",
    },
    updateRows = [{ id: sessionId, status: "completed", updated_at: "2026-03-31T10:05:00Z" }],
    goalRows = [] as Array<Record<string, unknown>>,
    noteRows = [] as Array<Record<string, unknown>>,
    authStatus = 200,
    sessionStatus = 200,
    sessionRows,
    goalsStatus = 200,
    notesStatus = 200,
    auditStatus = 200,
    edgeNetworkFailure = false,
  } = {}) => vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";

    if (url.includes("/functions/v1/sessions-complete") && edgeNetworkFailure) {
      throw new TypeError("fetch failed");
    }
    if (url.includes("/rest/v1/rpc/current_user_is_super_admin")) {
      return jsonResponse(false);
    }
    if (url.includes("/rest/v1/rpc/current_user_organization_id")) {
      return jsonResponse("org-1");
    }
    if (url.includes("/rest/v1/rpc/user_has_role_for_org")) {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as { role_name?: string } : {};
      return jsonResponse(body.role_name === "admin");
    }
    if (url.includes("/auth/v1/user")) {
      return jsonResponse(authStatus < 400 ? { id: "admin-user" } : { error: "Unauthorized" }, authStatus);
    }
    if (url.includes("/rest/v1/session_goals")) {
      return jsonResponse(goalRows, goalsStatus);
    }
    if (url.includes("/rest/v1/client_session_notes")) {
      return jsonResponse(noteRows, notesStatus);
    }
    if (url.includes("/rest/v1/sessions") && method === "GET") {
      return jsonResponse(sessionRows ?? [session], sessionStatus);
    }
    if (url.includes("/rest/v1/sessions") && method === "PATCH") {
      return jsonResponse(updateRows);
    }
    if (url.includes("/rest/v1/rpc/record_session_audit")) {
      return jsonResponse({ ok: auditStatus < 400 }, auditStatus);
    }

    throw new Error(`Unexpected fetch call: ${method} ${url}`);
  });

  const getFetchBody = (fetchMock: ReturnType<typeof vi.spyOn>, path: string) => {
    const call = fetchMock.mock.calls.find(([input]) => String(input).includes(path));
    expect(call).toBeTruthy();
    return JSON.parse(String(call?.[1]?.body));
  };

  const expectMetric = (
    logSpy: ReturnType<typeof vi.spyOn>,
    metric: string,
    labels: Record<string, unknown>,
  ) => {
    const payloads = logSpy.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
    expect(payloads).toEqual(expect.arrayContaining([
      expect.objectContaining({
        level: "metric",
        metric,
        ...labels,
      }),
    ]));
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getRuntimeSupabaseConfig).mockReturnValue({
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "anon-key",
      defaultOrganizationId: "org-default",
    });
    vi.mocked(consumeRateLimit).mockResolvedValue({
      limited: false,
      retryAfterSeconds: null,
      mode: "memory",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 405 for non-POST methods", async () => {
    const response = await sessionsCompleteHandler(
      new Request("http://localhost/api/sessions-complete", { method: "GET" }),
    );
    expect(response.status).toBe(405);
  });

  it("returns 401 when auth token is missing", async () => {
    vi.mocked(getAccessToken).mockReturnValue(null);
    const response = await sessionsCompleteHandler(
      new Request("http://localhost/api/sessions-complete", {
        method: "POST",
        body: JSON.stringify({
          session_id: "11111111-1111-1111-1111-111111111111",
          outcome: "completed",
          notes: null,
        }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("proxies valid payloads to edge authority", async () => {
    vi.mocked(getAccessToken).mockReturnValue("token-123");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: true, data: { outcome: "completed" } }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "Idempotency-Key": "edge-returned-key",
            "Idempotent-Replay": "true",
            "Retry-After": "3",
          },
        },
      ),
    );

    const request = new Request("http://localhost/api/sessions-complete", {
      method: "POST",
      headers: {
        Authorization: "Bearer token-123",
        "Idempotency-Key": "complete-idempotency-key",
        "x-request-id": "request-1",
        "x-correlation-id": "correlation-1",
        "x-agent-operation-id": "agent-op-1",
      },
      body: JSON.stringify({
        session_id: sessionId,
        outcome: "completed",
        notes: "done",
      }),
    });
    const response = await sessionsCompleteHandler(request);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.supabase.co/functions/v1/sessions-complete",
      expect.objectContaining({
        method: "POST",
        headers: expect.any(Headers),
        body: JSON.stringify({
          session_id: sessionId,
          outcome: "completed",
          notes: "done",
        }),
      }),
    );
    const forwardedHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(forwardedHeaders.get("Idempotency-Key")).toBe("complete-idempotency-key");
    expect(forwardedHeaders.get("x-request-id")).toBe("request-1");
    expect(forwardedHeaders.get("x-correlation-id")).toBe("correlation-1");
    expect(forwardedHeaders.get("x-agent-operation-id")).toBe("agent-op-1");
    expect(response.headers.get("Idempotency-Key")).toBe("edge-returned-key");
    expect(response.headers.get("Idempotent-Replay")).toBe("true");
    expect(response.headers.get("Retry-After")).toBe("3");
    expect(response.headers.get("Content-Type")).toBe("application/json");
  });

  it("fails closed when edge returns 401 instead of degrading to runtime REST", async () => {
    vi.mocked(getAccessToken).mockReturnValue("token-123");
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
          status: 401,
          headers: {
            "content-type": "application/json",
            "WWW-Authenticate": "Bearer error=\"invalid_token\"",
          },
        }),
      );

    const request = new Request("http://localhost/api/sessions-complete", {
      method: "POST",
      headers: { Authorization: "Bearer token-123" },
      body: JSON.stringify({
        session_id: sessionId,
        outcome: "completed",
        notes: "done",
      }),
    });
    const response = await sessionsCompleteHandler(request);
    const payload = await response.json() as { success: boolean; error: string };

    expect(response.status).toBe(401);
    expect(payload.success).toBe(false);
    expect(payload.error).toBe("Unauthorized");
    expect(response.headers.get("WWW-Authenticate")).toBe("Bearer error=\"invalid_token\"");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves downstream Retry-After when edge returns a retryable completion conflict", async () => {
    vi.mocked(getAccessToken).mockReturnValue("token-123");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          error: "Session could not be completed yet",
          code: "UPDATE_FAILED",
          retryAfter: "2026-03-31T10:05:03.000Z",
        }),
        {
          status: 409,
          headers: {
            "content-type": "application/json",
            "Retry-After": "3",
            "Idempotency-Key": "edge-complete-conflict",
          },
        },
      ),
    );

    const response = await sessionsCompleteHandler(
      new Request("http://localhost/api/sessions-complete", {
        method: "POST",
        headers: {
          Authorization: "Bearer token-123",
          "Idempotency-Key": "complete-idempotency-key",
          "x-request-id": "request-complete-conflict",
        },
        body: JSON.stringify({
          session_id: sessionId,
          outcome: "completed",
          notes: null,
        }),
      }),
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("Retry-After")).toBe("3");
    expect(response.headers.get("Idempotency-Key")).toBe("edge-complete-conflict");
    expect(response.headers.get("Content-Type")).toBe("application/json");
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "Session could not be completed yet",
      code: "UPDATE_FAILED",
      retryAfter: "2026-03-31T10:05:03.000Z",
    });
  });

  it("falls back to runtime REST when edge fetch has no HTTP response", async () => {
    vi.mocked(getAccessToken).mockReturnValue("token-123");
    const fetchMock = makeFallbackFetchMock({ edgeNetworkFailure: true });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const response = await sessionsCompleteHandler(
      new Request("http://localhost/api/sessions-complete", {
        method: "POST",
        headers: {
          Authorization: "Bearer token-123",
          "x-request-id": "request-1",
        },
        body: JSON.stringify({
          session_id: sessionId,
          outcome: "completed",
          notes: "done",
        }),
      }),
    );
    const body = await response.json() as { success: boolean; data: { outcome: string } };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.outcome).toBe("completed");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://example.supabase.co/functions/v1/sessions-complete");
    expect(getFetchBody(fetchMock, "/rest/v1/rpc/record_session_audit")).toEqual(expect.objectContaining({
      p_event_type: "session_completed",
      p_actor_id: "admin-user",
    }));
    expectMetric(logSpy, "session_complete_success_total", {
      function: "sessions-complete",
      orgId: "org-1",
      outcome: "completed",
    });
  });

  it("runtime REST fallback records completed-session audit and success metric", async () => {
    const fetchMock = makeFallbackFetchMock();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const response = await __TESTING__.completeSessionViaRuntimeRest({
      request: new Request("http://localhost/api/sessions-complete", { method: "POST" }),
      payload: { session_id: sessionId, outcome: "completed", notes: "done" },
      accessToken: "token-123",
      traceHeaders: {
        "x-request-id": "request-1",
        "x-correlation-id": "correlation-1",
        "x-agent-operation-id": "agent-op-1",
      },
    });

    expect(response.status).toBe(200);
    const auditBody = getFetchBody(fetchMock, "/rest/v1/rpc/record_session_audit");
    expect(auditBody).toEqual({
      p_session_id: sessionId,
      p_event_type: "session_completed",
      p_actor_id: "admin-user",
      p_event_payload: {
        outcome: "completed",
        startTime: "2026-03-31T09:00:00Z",
        endTime: "2026-03-31T10:00:00Z",
        notes: "done",
        agentOperationId: "agent-op-1",
        trace: {
          requestId: "request-1",
          correlationId: "correlation-1",
          agentOperationId: "agent-op-1",
        },
      },
    });
    expectMetric(logSpy, "session_complete_success_total", {
      function: "sessions-complete",
      orgId: "org-1",
      outcome: "completed",
    });
  });

  it("runtime REST fallback records no-show audit event", async () => {
    const fetchMock = makeFallbackFetchMock({
      updateRows: [{ id: sessionId, status: "no-show", updated_at: "2026-03-31T10:05:00Z" }],
    });
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const response = await __TESTING__.completeSessionViaRuntimeRest({
      request: new Request("http://localhost/api/sessions-complete", { method: "POST" }),
      payload: { session_id: sessionId, outcome: "no-show", notes: null },
      accessToken: "token-123",
      traceHeaders: {},
    });

    expect(response.status).toBe(200);
    expect(getFetchBody(fetchMock, "/rest/v1/rpc/record_session_audit")).toEqual(expect.objectContaining({
      p_event_type: "session_no_show",
      p_actor_id: "admin-user",
    }));
  });

  it("runtime REST fallback emits notes-required metric", async () => {
    makeFallbackFetchMock({
      session: {
        id: sessionId,
        status: "in_progress",
        therapist_id: "therapist-user",
        start_time: "2026-03-31T09:00:00Z",
        end_time: "2026-03-31T10:00:00Z",
      },
      goalRows: [{ goal_id: "goal-1" }],
      noteRows: [],
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const response = await __TESTING__.completeSessionViaRuntimeRest({
      request: new Request("http://localhost/api/sessions-complete", { method: "POST" }),
      payload: { session_id: sessionId, outcome: "completed", notes: null },
      accessToken: "token-123",
      traceHeaders: {},
    });
    const body = await response.json() as { code: string };

    expect(response.status).toBe(409);
    expect(body.code).toBe("SESSION_NOTES_REQUIRED");
    expectMetric(logSpy, "session_notes_required_rejection_total", {
      function: "sessions-complete",
      orgId: "org-1",
    });
  });

  it("runtime REST fallback emits concurrent-modification metric", async () => {
    makeFallbackFetchMock({ updateRows: [] });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const response = await __TESTING__.completeSessionViaRuntimeRest({
      request: new Request("http://localhost/api/sessions-complete", { method: "POST" }),
      payload: { session_id: sessionId, outcome: "completed", notes: null },
      accessToken: "token-123",
      traceHeaders: {},
    });
    const body = await response.json() as { code: string; error: string };

    expect(response.status).toBe(409);
    expect(body.code).toBe("CONCURRENT_MODIFICATION");
    expect(body.error).toBe("Session was modified concurrently. Refresh and try again.");
    expectMetric(logSpy, "session_complete_concurrent_total", {
      function: "sessions-complete",
      orgId: "org-1",
    });
  });

  it("runtime REST fallback does not fail completion when audit RPC fails", async () => {
    makeFallbackFetchMock({ auditStatus: 500 });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await __TESTING__.completeSessionViaRuntimeRest({
      request: new Request("http://localhost/api/sessions-complete", { method: "POST" }),
      payload: { session_id: sessionId, outcome: "completed", notes: null },
      accessToken: "token-123",
      traceHeaders: {},
    });

    expect(response.status).toBe(200);
    expectMetric(logSpy, "session_audit_failure_total", {
      eventType: "session_completed",
      required: false,
      failureType: "rpc_error",
    });
  });

  it("runtime REST fallback maps invalid authenticated user lookups to 401", async () => {
    makeFallbackFetchMock({ authStatus: 401 });

    const response = await __TESTING__.completeSessionViaRuntimeRest({
      request: new Request("http://localhost/api/sessions-complete", { method: "POST" }),
      payload: { session_id: sessionId, outcome: "completed", notes: null },
      accessToken: "token-123",
      traceHeaders: {},
    });
    const body = await response.json() as { error: string };

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
    expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
  });

  it("runtime REST fallback maps session fetch failures to upstream errors", async () => {
    makeFallbackFetchMock({ sessionStatus: 500 });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const response = await __TESTING__.completeSessionViaRuntimeRest({
      request: new Request("http://localhost/api/sessions-complete", { method: "POST" }),
      payload: { session_id: sessionId, outcome: "completed", notes: null },
      accessToken: "token-123",
      traceHeaders: {},
    });

    expect(response.status).toBe(502);
    expectMetric(logSpy, "org_scoped_query_total", {
      function: "sessions-complete",
      orgId: "org-1",
      operation: "fetch-session",
    });
  });

  it("runtime REST fallback emits tenant denial metric when session is outside org scope", async () => {
    makeFallbackFetchMock({ sessionRows: [] });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const response = await __TESTING__.completeSessionViaRuntimeRest({
      request: new Request("http://localhost/api/sessions-complete", { method: "POST" }),
      payload: { session_id: sessionId, outcome: "completed", notes: null },
      accessToken: "token-123",
      traceHeaders: {},
    });
    const body = await response.json() as { code: string };

    expect(response.status).toBe(404);
    expect(body.code).toBe("SESSION_NOT_FOUND");
    expectMetric(logSpy, "tenant_denial_total", {
      function: "sessions-complete",
      orgId: "org-1",
      reason: "session-not-found",
    });
  });

  it("runtime REST fallback maps session_goals fetch failures to upstream errors", async () => {
    makeFallbackFetchMock({
      session: {
        id: sessionId,
        status: "in_progress",
        therapist_id: "therapist-user",
        start_time: "2026-03-31T09:00:00Z",
        end_time: "2026-03-31T10:00:00Z",
      },
      goalsStatus: 500,
    });

    const response = await __TESTING__.completeSessionViaRuntimeRest({
      request: new Request("http://localhost/api/sessions-complete", { method: "POST" }),
      payload: { session_id: sessionId, outcome: "completed", notes: null },
      accessToken: "token-123",
      traceHeaders: {},
    });
    const body = await response.json() as { error: string };

    expect(response.status).toBe(502);
    expect(body.error).toBe("Failed to load session goals for notes check");
  });

  it("runtime REST fallback maps client_session_notes fetch failures to upstream errors", async () => {
    makeFallbackFetchMock({
      session: {
        id: sessionId,
        status: "in_progress",
        therapist_id: "therapist-user",
        start_time: "2026-03-31T09:00:00Z",
        end_time: "2026-03-31T10:00:00Z",
      },
      goalRows: [{ goal_id: "goal-1" }],
      notesStatus: 500,
    });

    const response = await __TESTING__.completeSessionViaRuntimeRest({
      request: new Request("http://localhost/api/sessions-complete", { method: "POST" }),
      payload: { session_id: sessionId, outcome: "completed", notes: null },
      accessToken: "token-123",
      traceHeaders: {},
    });
    const body = await response.json() as { error: string };

    expect(response.status).toBe(502);
    expect(body.error).toBe("Failed to load session notes for notes check");
  });
});
