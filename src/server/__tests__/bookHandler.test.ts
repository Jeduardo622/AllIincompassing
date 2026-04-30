import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { resetRateLimitsForTests } from "../api/shared";
import { server } from "../../test/setup";

const bookSessionMock = vi.hoisted(() => vi.fn());
const loggerMock = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("../bookSession", () => ({
  bookSession: bookSessionMock,
  deriveBookSessionOccurrences: (payload: {
    session: { start_time: string; end_time: string };
    startTimeOffsetMinutes: number;
    endTimeOffsetMinutes: number;
    occurrences?: Array<{
      startTime: string;
      endTime: string;
      startOffsetMinutes: number;
      endOffsetMinutes: number;
    }>;
    recurrence?: { count?: number; timeZone?: string } | null;
    timeZone: string;
  }) => {
    if (payload.recurrence?.count === 2 && payload.session.start_time === "2026-03-30T05:00:00.000Z") {
      const derivedOccurrences = [
        {
          startTime: "2026-03-30T05:00:00.000Z",
          endTime: "2026-03-30T05:30:00.000Z",
          startOffsetMinutes: payload.startTimeOffsetMinutes,
          endOffsetMinutes: payload.endTimeOffsetMinutes,
        },
        {
          startTime: "2026-04-06T05:00:00.000Z",
          endTime: "2026-04-06T05:30:00.000Z",
          startOffsetMinutes: payload.startTimeOffsetMinutes,
          endOffsetMinutes: payload.endTimeOffsetMinutes,
        },
      ];

      if (!Array.isArray(payload.occurrences) || payload.occurrences.length === 0) {
        return derivedOccurrences;
      }

      const matches = payload.occurrences.length === derivedOccurrences.length
        && payload.occurrences.every((occurrence, index) =>
          occurrence.startTime === derivedOccurrences[index]?.startTime
          && occurrence.endTime === derivedOccurrences[index]?.endTime
          && occurrence.startOffsetMinutes === derivedOccurrences[index]?.startOffsetMinutes
          && occurrence.endOffsetMinutes === derivedOccurrences[index]?.endOffsetMinutes
        );
      if (!matches) {
        const error = new Error("Provided booking occurrences do not match the server-derived recurrence windows.") as Error & {
          status?: number;
          code?: string;
        };
        error.status = 400;
        error.code = "INVALID_OCCURRENCES";
        throw error;
      }

      return derivedOccurrences;
    }

    if (Array.isArray(payload.occurrences) && payload.occurrences.length > 0) {
      return payload.occurrences;
    }

    return [{
      startTime: payload.session.start_time,
      endTime: payload.session.end_time,
      startOffsetMinutes: payload.startTimeOffsetMinutes,
      endOffsetMinutes: payload.endTimeOffsetMinutes,
    }];
  },
}));

vi.mock("../../lib/logger/logger", () => ({
  logger: loggerMock,
}));

const importBookHandler = async () => {
  const module = await import("../api/book");
  return module.bookHandler;
};

const toHeaderObject = (headers: HeadersInit | undefined): Record<string, string> => {
  if (!headers) {
    return {};
  }

  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }

  return headers as Record<string, string>;
};

const createRequest = (body: unknown, overrides: RequestInit = {}) => {
  const headers = {
    "Content-Type": "application/json",
    Authorization: "Bearer valid-token",
    ...toHeaderObject(overrides.headers),
  };

  const { headers: _headers, ...rest } = overrides;

  return new Request("http://localhost/api/book", {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    ...rest,
  });
};

const validPayload = {
  session: {
    therapist_id: "therapist-1",
    client_id: "client-1",
    program_id: "program-1",
    goal_id: "goal-1",
    start_time: "2025-01-01T10:00:00Z",
    end_time: "2025-01-01T11:00:00Z",
  },
  startTimeOffsetMinutes: 0,
  endTimeOffsetMinutes: 0,
  timeZone: "UTC",
};

const TEST_SUPABASE_URL = "https://testing.supabase.co";
const TEST_SUPABASE_ANON_KEY = "testing-anon-key";
const TEST_SUPABASE_EDGE_URL = "https://testing.supabase.co/functions/v1/";

const ORIGINAL_ENV = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_EDGE_URL: process.env.SUPABASE_EDGE_URL,
  API_AUTHORITY_MODE: process.env.API_AUTHORITY_MODE,
  DEFAULT_ORGANIZATION_ID: process.env.DEFAULT_ORGANIZATION_ID,
};

beforeEach(async () => {
  resetRateLimitsForTests();
  vi.clearAllMocks();
  bookSessionMock.mockReset();
  loggerMock.error.mockReset();
  loggerMock.warn.mockReset();
  loggerMock.info.mockReset();
  loggerMock.debug.mockReset();

  const runtimeConfig = await import("../../lib/runtimeConfig");
  runtimeConfig.resetRuntimeSupabaseConfigForTests();

  process.env.SUPABASE_URL = TEST_SUPABASE_URL;
  process.env.SUPABASE_ANON_KEY = TEST_SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_EDGE_URL = TEST_SUPABASE_EDGE_URL;
  delete process.env.API_AUTHORITY_MODE;
  process.env.DEFAULT_ORGANIZATION_ID = "5238e88b-6198-4862-80a2-dbe15bbeabdd";

  server.use(
    http.post(`${TEST_SUPABASE_URL}/rest/v1/rpc/current_user_is_super_admin`, () => HttpResponse.json(false)),
    http.post(`${TEST_SUPABASE_URL}/rest/v1/rpc/current_user_organization_id`, () =>
      HttpResponse.json("5238e88b-6198-4862-80a2-dbe15bbeabdd")),
    http.post(`${TEST_SUPABASE_URL}/rest/v1/rpc/user_has_role_for_org`, () => HttpResponse.json(true)),
    http.get(`${TEST_SUPABASE_URL}/auth/v1/user`, () => HttpResponse.json({ id: "therapist-1" })),
    http.get(`${TEST_SUPABASE_URL}/rest/v1/therapists`, () => HttpResponse.json([{ id: "therapist-1" }])),
    http.get(`${TEST_SUPABASE_URL}/rest/v1/clients`, () => HttpResponse.json([{ id: "client-1" }])),
    http.get(`${TEST_SUPABASE_URL}/rest/v1/programs`, () =>
      HttpResponse.json([{ id: "program-1", client_id: "client-1" }])),
    http.get(`${TEST_SUPABASE_URL}/rest/v1/goals`, () =>
      HttpResponse.json([{ id: "goal-1", program_id: "program-1" }])),
  );
});

afterAll(() => {
  if (typeof ORIGINAL_ENV.SUPABASE_URL === "string") {
    process.env.SUPABASE_URL = ORIGINAL_ENV.SUPABASE_URL;
  } else {
    delete process.env.SUPABASE_URL;
  }
  if (typeof ORIGINAL_ENV.SUPABASE_ANON_KEY === "string") {
    process.env.SUPABASE_ANON_KEY = ORIGINAL_ENV.SUPABASE_ANON_KEY;
  } else {
    delete process.env.SUPABASE_ANON_KEY;
  }
  if (typeof ORIGINAL_ENV.SUPABASE_SERVICE_ROLE_KEY === "string") {
    process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_ENV.SUPABASE_SERVICE_ROLE_KEY;
  } else {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
  if (typeof ORIGINAL_ENV.SUPABASE_EDGE_URL === "string") {
    process.env.SUPABASE_EDGE_URL = ORIGINAL_ENV.SUPABASE_EDGE_URL;
  } else {
    delete process.env.SUPABASE_EDGE_URL;
  }
  if (typeof ORIGINAL_ENV.API_AUTHORITY_MODE === "string") {
    process.env.API_AUTHORITY_MODE = ORIGINAL_ENV.API_AUTHORITY_MODE;
  } else {
    delete process.env.API_AUTHORITY_MODE;
  }
  if (typeof ORIGINAL_ENV.DEFAULT_ORGANIZATION_ID === "string") {
    process.env.DEFAULT_ORGANIZATION_ID = ORIGINAL_ENV.DEFAULT_ORGANIZATION_ID;
  } else {
    delete process.env.DEFAULT_ORGANIZATION_ID;
  }
});

describe("bookHandler", () => {
  it("returns CORS headers for OPTIONS requests", async () => {
    const bookHandler = await importBookHandler();
    const response = await bookHandler(new Request("http://localhost/api/book", {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:3000" },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
  });

  it("rejects disallowed origins", async () => {
    const bookHandler = await importBookHandler();
    const response = await bookHandler(new Request("http://localhost/api/book", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer valid-token",
        Origin: "https://attacker.example.com",
      },
      body: JSON.stringify(validPayload),
    }));
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe("Origin not allowed");
  });

  it("rejects non-POST methods", async () => {
    const bookHandler = await importBookHandler();
    const response = await bookHandler(new Request("http://localhost/api/book", { method: "GET" }));
    expect(response.status).toBe(405);
  });

  it("returns error when JSON payload is invalid", async () => {
    const bookHandler = await importBookHandler();
    const response = await bookHandler(new Request("http://localhost/api/book", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer valid-token",
      },
      body: "not-json",
    }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/invalid json/i);
  });

  it("returns 401 when authorization header is missing", async () => {
    const bookHandler = await importBookHandler();
    const response = await bookHandler(new Request("http://localhost/api/book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session: {
          therapist_id: "therapist-1",
          client_id: "client-1",
          start_time: "2025-01-01T10:00:00Z",
          end_time: "2025-01-01T11:00:00Z",
        },
        startTimeOffsetMinutes: 0,
        endTimeOffsetMinutes: 0,
        timeZone: "UTC",
      }),
    }));

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/authorization/i);
    expect(bookSessionMock).not.toHaveBeenCalled();
  });

  it("rejects caller-supplied occurrences that do not match the server-derived recurrence windows", async () => {
    process.env.API_AUTHORITY_MODE = "edge";
    const bookHandler = await importBookHandler();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const response = await bookHandler(
      createRequest({
        ...validPayload,
        recurrence: {
          rule: "FREQ=WEEKLY;COUNT=2;BYDAY=MO",
          count: 2,
          timeZone: "America/Los_Angeles",
        },
        session: {
          ...validPayload.session,
          start_time: "2026-03-30T05:00:00.000Z",
          end_time: "2026-03-30T05:30:00.000Z",
        },
        occurrences: [
          {
            startTime: "2026-03-30T05:00:00.000Z",
            endTime: "2026-03-30T05:30:00.000Z",
            startOffsetMinutes: 0,
            endOffsetMinutes: 0,
          },
          {
            startTime: "2026-04-13T05:00:00.000Z",
            endTime: "2026-04-13T05:30:00.000Z",
            startOffsetMinutes: 0,
            endOffsetMinutes: 0,
          },
        ],
      }),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.code).toBe("INVALID_OCCURRENCES");
    expect(bookSessionMock).not.toHaveBeenCalled();
    expect(
      fetchSpy.mock.calls.some(([url]) => String(url).includes("/functions/v1/sessions-book")),
    ).toBe(false);
    fetchSpy.mockRestore();
  });

  it("accepts session payloads when audit timestamps omit timezone offsets (RPC-shaped rows)", async () => {
    bookSessionMock.mockResolvedValueOnce({
      session: {
        id: "session-naive-audit",
        client_id: "client-1",
        therapist_id: "therapist-1",
        start_time: "2025-01-01T10:00:00Z",
        end_time: "2025-01-01T11:00:00Z",
        status: "scheduled",
        notes: "",
        created_at: "2025-01-01T09:00:00Z",
        created_by: "user-1",
        updated_at: "2025-01-01T09:00:00Z",
        updated_by: "user-1",
        duration_minutes: 60,
      },
      sessions: [],
      hold: {
        holdKey: "hold",
        holdId: "1",
        startTime: "2025-01-01T10:00:00Z",
        endTime: "2025-01-01T11:00:00Z",
        expiresAt: "2025-01-01T10:05:00Z",
        holds: [],
      },
      cpt: {
        code: "97153",
        description: "Adaptive behavior treatment by protocol",
        modifiers: [],
        source: "fallback",
        durationMinutes: 60,
      },
    });

    const bookHandler = await importBookHandler();
    const response = await bookHandler(
      createRequest({
        ...validPayload,
        session: {
          ...validPayload.session,
          created_at: "2025-01-01T09:00:00",
          updated_at: "2025-01-01T09:30:00",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(bookSessionMock).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when booking entity relationships are invalid", async () => {
    server.use(
      http.get(`${TEST_SUPABASE_URL}/rest/v1/programs`, () =>
        HttpResponse.json([{ id: "program-1", client_id: "different-client" }])),
    );

    const bookHandler = await importBookHandler();
    const response = await bookHandler(createRequest(validPayload));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Invalid booking relationships");
    expect(bookSessionMock).not.toHaveBeenCalled();
  });

  it("forbids org-member-equivalent therapist role from booking for a different therapist", async () => {
    server.use(
      http.post(`${TEST_SUPABASE_URL}/rest/v1/rpc/user_has_role_for_org`, async ({ request }) => {
        const body = await request.json() as { role_name?: string };
        if (body.role_name === "therapist" || body.role_name === "org_member") {
          return HttpResponse.json(true);
        }
        return HttpResponse.json(false);
      }),
      http.get(`${TEST_SUPABASE_URL}/auth/v1/user`, () => HttpResponse.json({ id: "org-member-user" })),
    );

    const bookHandler = await importBookHandler();
    const response = await bookHandler(createRequest({
      ...validPayload,
      session: {
        ...validPayload.session,
        therapist_id: "therapist-2",
      },
    }));

    expect(response.status).toBe(403);
    expect(bookSessionMock).not.toHaveBeenCalled();
  });

  it("returns 502 when org resolution dependency fails", async () => {
    server.use(
      http.post(`${TEST_SUPABASE_URL}/rest/v1/rpc/current_user_organization_id`, () =>
        new HttpResponse(null, { status: 503 })),
    );

    const bookHandler = await importBookHandler();
    const response = await bookHandler(createRequest(validPayload));

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.code).toBe("upstream_error");
    expect(body.message).toMatch(/unable to validate organization access/i);
    expect(bookSessionMock).not.toHaveBeenCalled();
  });

  it("uses service-role scope fallback for super-admin booking when user-scoped org lookup has no context", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

    server.use(
      http.post(`${TEST_SUPABASE_URL}/rest/v1/rpc/current_user_is_super_admin`, () => HttpResponse.json(true)),
      http.post(`${TEST_SUPABASE_URL}/rest/v1/rpc/current_user_organization_id`, () => HttpResponse.json(null)),
      http.get(`${TEST_SUPABASE_URL}/rest/v1/therapists`, ({ request }) => {
        const apikey = request.headers.get("apikey");
        const select = new URL(request.url).searchParams.get("select");
        if (apikey === "service-role-key" && select === "organization_id") {
          return HttpResponse.json([{ organization_id: "5238e88b-6198-4862-80a2-dbe15bbeabdd" }]);
        }
        if (apikey === "service-role-key") {
          return HttpResponse.json([{ id: "therapist-1" }]);
        }
        return HttpResponse.json({ error: "forbidden" }, { status: 403 });
      }),
      http.get(`${TEST_SUPABASE_URL}/rest/v1/clients`, ({ request }) => {
        const apikey = request.headers.get("apikey");
        if (apikey === "service-role-key") {
          return HttpResponse.json([{ id: "client-1" }]);
        }
        return HttpResponse.json({ error: "forbidden" }, { status: 403 });
      }),
      http.get(`${TEST_SUPABASE_URL}/rest/v1/programs`, ({ request }) => {
        const apikey = request.headers.get("apikey");
        if (apikey === "service-role-key") {
          return HttpResponse.json([{ id: "program-1", client_id: "client-1" }]);
        }
        return HttpResponse.json({ error: "forbidden" }, { status: 403 });
      }),
      http.get(`${TEST_SUPABASE_URL}/rest/v1/goals`, ({ request }) => {
        const apikey = request.headers.get("apikey");
        if (apikey === "service-role-key") {
          return HttpResponse.json([{ id: "goal-1", program_id: "program-1" }]);
        }
        return HttpResponse.json({ error: "forbidden" }, { status: 403 });
      }),
    );

    bookSessionMock.mockResolvedValueOnce({
      session: {
        id: "session-super-admin",
        client_id: "client-1",
        therapist_id: "therapist-1",
        start_time: "2025-01-01T10:00:00Z",
        end_time: "2025-01-01T11:00:00Z",
        status: "scheduled",
        notes: "",
        created_at: "2025-01-01T09:00:00Z",
        created_by: "user-1",
        updated_at: "2025-01-01T09:00:00Z",
        updated_by: "user-1",
        duration_minutes: 60,
      },
      sessions: [],
      hold: {
        holdKey: "hold",
        holdId: "1",
        startTime: "2025-01-01T10:00:00Z",
        endTime: "2025-01-01T11:00:00Z",
        expiresAt: "2025-01-01T10:05:00Z",
        holds: [],
      },
      cpt: {
        code: "97153",
        description: "Adaptive behavior treatment by protocol",
        modifiers: [],
        source: "fallback",
        durationMinutes: 60,
      },
    });

    const bookHandler = await importBookHandler();
    const response = await bookHandler(createRequest(validPayload));

    expect(response.status).toBe(200);
    expect(bookSessionMock).toHaveBeenCalledTimes(1);
  });

  it("accepts lowercase bearer prefix", async () => {
    bookSessionMock.mockResolvedValueOnce({
      session: {
        id: "session-lower-bearer",
        client_id: "client-1",
        therapist_id: "therapist-1",
        start_time: "2025-01-01T10:00:00Z",
        end_time: "2025-01-01T11:00:00Z",
        status: "scheduled",
        notes: "",
        created_at: "2025-01-01T09:00:00Z",
        created_by: "user-1",
        updated_at: "2025-01-01T09:00:00Z",
        updated_by: "user-1",
        duration_minutes: 60,
      },
      sessions: [],
      hold: {
        holdKey: "hold",
        holdId: "1",
        startTime: "2025-01-01T10:00:00Z",
        endTime: "2025-01-01T11:00:00Z",
        expiresAt: "2025-01-01T10:05:00Z",
        holds: [],
      },
      cpt: {
        code: "97153",
        description: "Adaptive behavior treatment by protocol",
        modifiers: [],
        source: "fallback",
        durationMinutes: 60,
      },
    });

    const bookHandler = await importBookHandler();
    const response = await bookHandler(createRequest(validPayload, {
      headers: { Authorization: "bearer valid-token" },
    }));

    expect(response.status).toBe(200);
    expect(bookSessionMock).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "valid-token" }));
  });

  it("invokes booking service and returns success", async () => {
    bookSessionMock.mockResolvedValueOnce({
      session: {
        id: "session-1",
        client_id: "client-1",
        therapist_id: "therapist-1",
        start_time: "2025-01-01T10:00:00Z",
        end_time: "2025-01-01T11:00:00Z",
        status: "scheduled",
        notes: "",
        created_at: "2025-01-01T09:00:00Z",
        created_by: "user-1",
        updated_at: "2025-01-01T09:00:00Z",
        updated_by: "user-1",
        duration_minutes: 60,
      },
      sessions: [
        {
          id: "session-1",
          client_id: "client-1",
          therapist_id: "therapist-1",
          start_time: "2025-01-01T10:00:00Z",
          end_time: "2025-01-01T11:00:00Z",
          status: "scheduled",
          notes: "",
          created_at: "2025-01-01T09:00:00Z",
          created_by: "user-1",
          updated_at: "2025-01-01T09:00:00Z",
          updated_by: "user-1",
          duration_minutes: 60,
        },
      ],
      hold: {
        holdKey: "hold",
        holdId: "1",
        startTime: "2025-01-01T10:00:00Z",
        endTime: "2025-01-01T11:00:00Z",
        expiresAt: "2025-01-01T10:05:00Z",
        holds: [
          {
            holdKey: "hold",
            holdId: "1",
            startTime: "2025-01-01T10:00:00Z",
            endTime: "2025-01-01T11:00:00Z",
            expiresAt: "2025-01-01T10:05:00Z",
          },
        ],
      },
      cpt: { code: "97153", description: "Adaptive behavior treatment by protocol", modifiers: [], source: "fallback", durationMinutes: 60 },
    });

    const bookHandler = await importBookHandler();
    const response = await bookHandler(createRequest(validPayload, {
      headers: { "Idempotency-Key": "abc-123" },
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Idempotency-Key")).toBe("abc-123");
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.session.id).toBe("session-1");
    expect(bookSessionMock).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "abc-123",
      accessToken: "valid-token",
    }));
  });

  it("rejects invalid payloads", async () => {
    const bookHandler = await importBookHandler();
    const invalidPayload = {
      ...validPayload,
      session: {
        ...validPayload.session,
        start_time: "invalid",
      },
    };

    const response = await bookHandler(createRequest(invalidPayload));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("Invalid request body");
    expect(body.code).toBe("invalid_request");
    expect(bookSessionMock).not.toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      "Rejected invalid booking payload",
      expect.objectContaining({
        metadata: expect.arrayContaining([
          expect.objectContaining({ path: expect.stringContaining("session.start_time") }),
        ]),
      }),
    );
  });

  it("rejects negative financial booking fields", async () => {
    const bookHandler = await importBookHandler();
    const response = await bookHandler(createRequest({
      ...validPayload,
      session: {
        ...validPayload.session,
        duration_minutes: 60,
        rate_per_hour: -10,
        total_cost: 100,
      },
    }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe("invalid_request");
    expect(bookSessionMock).not.toHaveBeenCalled();
  });

  it("sanitizes booking errors", async () => {
    bookSessionMock.mockRejectedValueOnce(new Error("conflict"));

    const bookHandler = await importBookHandler();
    const response = await bookHandler(createRequest(validPayload));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("Booking failed");
    expect(body.error).not.toMatch(/conflict/i);
    expect(body.error).not.toMatch(/error/i);
    expect(body.upstream).toBeUndefined();
    expect(body.upstreamMessage).toBeUndefined();
    expect(body.inputProgramId).toBeUndefined();
    expect(body.inputGoalId).toBeUndefined();
    expect(bookSessionMock).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "valid-token" }));
    expect(loggerMock.error).toHaveBeenCalledWith(
      "Session booking failed",
      expect.objectContaining({
        error: expect.objectContaining({ message: "conflict" }),
        metadata: expect.objectContaining({ status: 500 }),
      }),
    );
  });

  it("maps downstream throttling to API rate_limited responses", async () => {
    bookSessionMock.mockRejectedValueOnce({
      message: "throttled",
      status: 429,
      retryAfterSeconds: 33,
    });

    const bookHandler = await importBookHandler();
    const response = await bookHandler(createRequest(validPayload));

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("33");
    const body = await response.json();
    expect(body.code).toBe("rate_limited");
    expect(body.retryAfterSeconds).toBe(33);
  });

  it("returns 429 when booking rate limit is exceeded", async () => {
    bookSessionMock.mockResolvedValue({
      session: {
        id: "session-1",
        client_id: "client-1",
        therapist_id: "therapist-1",
        start_time: "2025-01-01T10:00:00Z",
        end_time: "2025-01-01T11:00:00Z",
        status: "scheduled",
        notes: "",
        created_at: "2025-01-01T09:00:00Z",
        created_by: "user-1",
        updated_at: "2025-01-01T09:00:00Z",
        updated_by: "user-1",
        duration_minutes: 60,
      },
      sessions: [],
      hold: {
        holdKey: "hold",
        holdId: "1",
        startTime: "2025-01-01T10:00:00Z",
        endTime: "2025-01-01T11:00:00Z",
        expiresAt: "2025-01-01T10:05:00Z",
        holds: [],
      },
      cpt: {
        code: "97153",
        description: "Adaptive behavior treatment by protocol",
        modifiers: [],
        source: "fallback",
        durationMinutes: 60,
      },
    });
    const bookHandler = await importBookHandler();
    let lastResponse: Response | null = null;
    for (let index = 0; index < 31; index += 1) {
      lastResponse = await bookHandler(createRequest(validPayload));
    }
    expect(lastResponse).not.toBeNull();
    expect(lastResponse?.status).toBe(429);
    expect(lastResponse?.headers.get("Retry-After")).toBeTruthy();
  });

  it("returns conflict retry metadata for 409 scheduling errors", async () => {
    bookSessionMock.mockRejectedValueOnce({
      message: "conflict",
      status: 409,
      code: "THERAPIST_CONFLICT",
      retryAfter: "2026-02-10T12:05:00.000Z",
      retryAfterSeconds: 120,
      orchestration: {
        rollbackPlan: {
          guidance: "Retry after the suggested time window.",
        },
      },
    });

    const bookHandler = await importBookHandler();
    const response = await bookHandler(createRequest(validPayload));

    expect(response.status).toBe(409);
    expect(response.headers.get("Retry-After")).toBe("120");
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe("THERAPIST_CONFLICT");
    expect(body.retryAfter).toBe("2026-02-10T12:05:00.000Z");
    expect(body.retryAfterSeconds).toBe(120);
    expect(body.hint).toContain("Retry after about 120 seconds");
    expect(body.orchestration).toBeUndefined();
  });

  it("forwards derived recurrence occurrences to edge booking authority", async () => {
    process.env.API_AUTHORITY_MODE = "edge";
    let forwardedBody: Record<string, unknown> | null = null;
    server.use(
      http.post(`${TEST_SUPABASE_EDGE_URL.replace(/\/$/, "")}/sessions-book`, async ({ request }) => {
        forwardedBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json({
          success: true,
          data: {
            session: { id: "session-recurring" },
            sessions: [{ id: "session-recurring-1" }, { id: "session-recurring-2" }],
            hold: { holdKey: "hold-recurring", holdId: "hold-recurring", expiresAt: "2026-03-30T05:05:00.000Z", holds: [] },
            cpt: {},
          },
        });
      }),
    );

    const recurringPayload = {
      ...validPayload,
      session: {
        ...validPayload.session,
        start_time: "2026-03-30T05:00:00.000Z",
        end_time: "2026-03-30T05:30:00.000Z",
      },
      recurrence: {
        rule: "FREQ=WEEKLY;INTERVAL=1",
        count: 2,
        timeZone: "America/Los_Angeles",
      },
    };

    const bookHandler = await importBookHandler();
    const response = await bookHandler(createRequest(recurringPayload));

    expect(response.status).toBe(200);
    expect(bookSessionMock).not.toHaveBeenCalled();
    expect(Array.isArray(forwardedBody?.occurrences)).toBe(true);
    expect((forwardedBody?.occurrences as unknown[])?.length).toBe(2);
    expect((forwardedBody?.occurrences as Array<Record<string, unknown>>)?.[1]?.startTime).toBe("2026-04-06T05:00:00.000Z");
  });

  it("falls back to legacy booking when edge authority is unavailable", async () => {
    process.env.API_AUTHORITY_MODE = "edge";
    server.use(
      http.post(`${TEST_SUPABASE_EDGE_URL.replace(/\/$/, "")}/sessions-book`, () =>
        HttpResponse.json({ success: false, error: "gateway unavailable" }, { status: 503 })),
    );
    bookSessionMock.mockResolvedValueOnce({
      session: {
        id: "session-edge-fallback",
        client_id: "client-1",
        therapist_id: "therapist-1",
        start_time: "2025-01-01T10:00:00Z",
        end_time: "2025-01-01T11:00:00Z",
        status: "scheduled",
        notes: "",
        created_at: "2025-01-01T09:00:00Z",
        created_by: "user-1",
        updated_at: "2025-01-01T09:00:00Z",
        updated_by: "user-1",
        duration_minutes: 60,
      },
      sessions: [],
      hold: {
        holdKey: "hold",
        holdId: "1",
        startTime: "2025-01-01T10:00:00Z",
        endTime: "2025-01-01T11:00:00Z",
        expiresAt: "2025-01-01T10:05:00Z",
        holds: [],
      },
      cpt: {
        code: "97153",
        description: "Adaptive behavior treatment by protocol",
        modifiers: [],
        source: "fallback",
        durationMinutes: 60,
      },
    });

    const bookHandler = await importBookHandler();
    const response = await bookHandler(createRequest(validPayload));

    expect(response.status).toBe(200);
    expect(bookSessionMock).toHaveBeenCalledTimes(1);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.session.id).toBe("session-edge-fallback");
  });

  it("does not fallback to legacy booking for edge conflict responses", async () => {
    process.env.API_AUTHORITY_MODE = "edge";
    server.use(
      http.post(`${TEST_SUPABASE_EDGE_URL.replace(/\/$/, "")}/sessions-book`, () =>
        HttpResponse.json(
          {
            success: false,
            error: "Booking failed",
            code: "THERAPIST_CONFLICT",
            hint: "The selected slot is unavailable.",
          },
          { status: 409 },
        )),
    );

    const bookHandler = await importBookHandler();
    const response = await bookHandler(createRequest(validPayload));

    expect(response.status).toBe(409);
    expect(bookSessionMock).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body.code).toBe("THERAPIST_CONFLICT");
  });

  it("does not fallback to legacy booking when edge authority returns 401", async () => {
    process.env.API_AUTHORITY_MODE = "edge";
    server.use(
      http.post(`${TEST_SUPABASE_EDGE_URL.replace(/\/$/, "")}/sessions-book`, () =>
        HttpResponse.json({ success: false, error: "Missing authorization token" }, { status: 401 })),
    );

    const bookHandler = await importBookHandler();
    const response = await bookHandler(createRequest(validPayload));

    expect(response.status).toBe(401);
    expect(bookSessionMock).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("Missing authorization token");
  });

  it("falls back to legacy booking when edge authority request throws", async () => {
    process.env.API_AUTHORITY_MODE = "edge";
    server.use(
      http.post(`${TEST_SUPABASE_EDGE_URL.replace(/\/$/, "")}/sessions-book`, () => HttpResponse.error()),
    );
    bookSessionMock.mockResolvedValueOnce({
      session: {
        id: "session-edge-error-fallback",
        client_id: "client-1",
        therapist_id: "therapist-1",
        start_time: "2025-01-01T10:00:00Z",
        end_time: "2025-01-01T11:00:00Z",
        status: "scheduled",
        notes: "",
        created_at: "2025-01-01T09:00:00Z",
        created_by: "user-1",
        updated_at: "2025-01-01T09:00:00Z",
        updated_by: "user-1",
        duration_minutes: 60,
      },
      sessions: [],
      hold: {
        holdKey: "hold",
        holdId: "1",
        startTime: "2025-01-01T10:00:00Z",
        endTime: "2025-01-01T11:00:00Z",
        expiresAt: "2025-01-01T10:05:00Z",
        holds: [],
      },
      cpt: {
        code: "97153",
        description: "Adaptive behavior treatment by protocol",
        modifiers: [],
        source: "fallback",
        durationMinutes: 60,
      },
    });

    const bookHandler = await importBookHandler();
    const response = await bookHandler(createRequest(validPayload));

    expect(response.status).toBe(200);
    expect(bookSessionMock).toHaveBeenCalledTimes(1);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.session.id).toBe("session-edge-error-fallback");
  });
});
