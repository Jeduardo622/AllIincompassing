import { beforeEach, describe, expect, it, vi } from "vitest";
import { payrollTimeEventsHandler } from "../api/payroll-time-events";

vi.mock("../api/shared", async () => {
  const actual = await vi.importActual<typeof import("../api/shared")>("../api/shared");
  return {
    ...actual,
    consumeRateLimit: vi.fn(),
    fetchAuthenticatedUserIdWithStatus: vi.fn(),
    fetchJson: vi.fn(),
    getAccessToken: vi.fn(),
    getSupabaseConfig: vi.fn(),
    resolveOrgAndRoleWithStatus: vi.fn(),
  };
});

vi.mock("../api/edgeAuthority", async () => {
  const actual = await vi.importActual<typeof import("../api/edgeAuthority")>("../api/edgeAuthority");
  return {
    ...actual,
    getApiAuthorityMode: vi.fn(),
    proxyToEdgeAuthority: vi.fn(),
  };
});

import {
  consumeRateLimit,
  fetchAuthenticatedUserIdWithStatus,
  fetchJson,
  getAccessToken,
  getSupabaseConfig,
  resolveOrgAndRoleWithStatus,
} from "../api/shared";
import { getApiAuthorityMode, proxyToEdgeAuthority } from "../api/edgeAuthority";

const createAuthToken = (subject = "bt-user-1") => {
  const payload = Buffer.from(JSON.stringify({ sub: subject }), "utf8").toString("base64url");
  return `header.${payload}.signature`;
};

const validMutationPayload = {
  action: "record_time_event",
  event: {
    occurredAt: "2026-08-11T16:00:00.000Z",
    timezone: "America/Los_Angeles",
    workLocation: "office",
    data: {
      eventType: "shift_started",
    },
  },
};

describe("payrollTimeEventsHandler", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getAccessToken).mockReturnValue(createAuthToken());
    vi.mocked(consumeRateLimit).mockResolvedValue({
      limited: false,
      retryAfterSeconds: null,
      mode: "memory",
    });
    vi.mocked(resolveOrgAndRoleWithStatus).mockResolvedValue({
      organizationId: "org-1",
      isTherapist: false,
      isAdmin: false,
      isOrgMember: false,
      isSuperAdmin: false,
      upstreamError: false,
    });
    vi.mocked(fetchAuthenticatedUserIdWithStatus).mockResolvedValue({
      userId: "bt-user-1",
      upstreamError: false,
    });
    vi.mocked(getSupabaseConfig).mockReturnValue({
      supabaseUrl: "https://example.supabase.co",
      anonKey: "anon-key",
    });
  });

  it("returns 405 for non-POST requests", async () => {
    const response = await payrollTimeEventsHandler(
      new Request("http://localhost/api/payroll-time-events", { method: "GET" }),
    );

    expect(response.status).toBe(405);
  });

  it("rejects disallowed origins before auth", async () => {
    const response = await payrollTimeEventsHandler(
      new Request("http://localhost/api/payroll-time-events", {
        method: "POST",
        headers: { Origin: "https://evil.example.com" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(403);
  });

  it("fails closed when the bearer token is missing", async () => {
    vi.mocked(getAccessToken).mockReturnValue(null);

    const response = await payrollTimeEventsHandler(
      new Request("http://localhost/api/payroll-time-events", { method: "POST", body: "{}" }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
  });

  it("proxies to edge authority in production and preserves protected response headers", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("edge");
    vi.mocked(proxyToEdgeAuthority).mockResolvedValue(
      new Response(JSON.stringify({ event_id: "event-1", idempotencyKey: "edge-key" }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "edge-key",
          "Idempotent-Replay": "true",
          "Retry-After": "4",
          "x-request-id": "edge-request",
          "x-correlation-id": "edge-correlation",
          "x-agent-operation-id": "edge-agent",
        },
      }),
    );

    const request = new Request("http://localhost/api/payroll-time-events", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${createAuthToken()}`,
        "Idempotency-Key": "client-key",
        "x-request-id": "request-1",
        "x-correlation-id": "correlation-1",
        "x-agent-operation-id": "agent-1",
      },
      body: JSON.stringify(validMutationPayload),
    });

    const response = await payrollTimeEventsHandler(request);

    expect(response.status).toBe(200);
    expect(vi.mocked(proxyToEdgeAuthority)).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        functionName: "payroll-time-events",
        accessToken: createAuthToken(),
        method: "POST",
      }),
    );
    expect(response.headers.get("Idempotency-Key")).toBe("edge-key");
    expect(response.headers.get("Idempotent-Replay")).toBe("true");
    expect(response.headers.get("Retry-After")).toBe("4");
    expect(response.headers.get("x-request-id")).toBe("edge-request");
    expect(response.headers.get("x-correlation-id")).toBe("edge-correlation");
    expect(response.headers.get("x-agent-operation-id")).toBe("edge-agent");
  });

  it("does not use a service-role fallback in legacy mode and calls the protected RPC with the caller token only", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("legacy");
    vi.mocked(fetchJson).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        event_id: "77777777-7777-7777-7777-777777777777",
        operation: "record_employee_time_event",
        replayed: false,
      },
    });

    const response = await payrollTimeEventsHandler(
      new Request("http://localhost/api/payroll-time-events", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${createAuthToken()}`,
          "Idempotency-Key": "runtime-key-1",
        },
        body: JSON.stringify(validMutationPayload),
      }),
    );

    expect(response.status).toBe(200);
    expect(vi.mocked(fetchJson)).toHaveBeenCalledWith(
      "https://example.supabase.co/rest/v1/rpc/record_employee_time_event",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          apikey: "anon-key",
          Authorization: `Bearer ${createAuthToken()}`,
        }),
        body: JSON.stringify({
          event_payload: validMutationPayload.event,
          idempotency_key: "runtime-key-1",
        }),
      }),
    );
  });

  it("rejects forbidden authority fields in legacy mode before any RPC call", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("legacy");

    const response = await payrollTimeEventsHandler(
      new Request("http://localhost/api/payroll-time-events", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${createAuthToken()}`,
          "Idempotency-Key": "runtime-key-2",
        },
        body: JSON.stringify({
          action: "record_session_attendance",
          event: {
            occurredAt: "2026-08-11T16:05:00.000Z",
            timezone: "America/Los_Angeles",
            workLocation: "client_site",
            data: {
              eventType: "session_started",
              sessionId: "11111111-1111-1111-1111-111111111111",
              actorId: "malicious-user",
            },
          },
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(vi.mocked(fetchJson)).not.toHaveBeenCalled();
  });

  it("returns 429 with Retry-After when rate limited", async () => {
    vi.mocked(consumeRateLimit).mockResolvedValue({
      limited: true,
      retryAfterSeconds: 9,
      mode: "memory",
    });

    const response = await payrollTimeEventsHandler(
      new Request("http://localhost/api/payroll-time-events", {
        method: "POST",
        headers: { Authorization: `Bearer ${createAuthToken()}` },
        body: JSON.stringify({ action: "get_day", localDate: "2026-08-11" }),
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("9");
  });

  it("fails closed when org resolution cannot establish canonical access", async () => {
    vi.mocked(resolveOrgAndRoleWithStatus).mockResolvedValue({
      organizationId: null,
      isTherapist: false,
      isAdmin: false,
      isOrgMember: false,
      isSuperAdmin: false,
      upstreamError: false,
    });

    const response = await payrollTimeEventsHandler(
      new Request("http://localhost/api/payroll-time-events", {
        method: "POST",
        headers: { Authorization: `Bearer ${createAuthToken()}` },
        body: JSON.stringify({ action: "get_day", localDate: "2026-08-11" }),
      }),
    );

    expect(response.status).toBe(403);
    expect(vi.mocked(fetchJson)).not.toHaveBeenCalled();
  });

  it("maps idempotency conflicts to 409 and echoes the effective key", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("legacy");
    vi.mocked(fetchJson).mockResolvedValue({
      ok: false,
      status: 409,
      data: {
        message: "IDEMPOTENCY_CONFLICT",
        code: "23505",
      },
    });

    const response = await payrollTimeEventsHandler(
      new Request("http://localhost/api/payroll-time-events", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${createAuthToken()}`,
          "Idempotency-Key": "runtime-key-conflict",
        },
        body: JSON.stringify(validMutationPayload),
      }),
    );

    const body = await response.json() as { code: string; message: string; idempotencyKey: string };
    expect(response.status).toBe(409);
    expect(body.code).toBe("conflict");
    expect(body.idempotencyKey).toBe("runtime-key-conflict");
    expect(response.headers.get("Idempotency-Key")).toBe("runtime-key-conflict");
  });
});
