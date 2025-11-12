import { beforeEach, describe, expect, it, vi } from "vitest";

const { callEdgeMock, persistSessionCptMetadataMock } = vi.hoisted(() => ({
  callEdgeMock: vi.fn(),
  persistSessionCptMetadataMock: vi
    .fn()
    .mockResolvedValue({ entryId: "entry-id", modifierIds: [] }),
}));

const supabaseModuleFactory = vi.hoisted(() => async () => {
  const actual = await vi.importActual<typeof import("../../lib/supabase")>("../../lib/supabase");
  return {
    ...actual,
    callEdge: callEdgeMock,
  };
});

vi.mock("../../lib/supabase", supabaseModuleFactory);

vi.mock("../sessionCptPersistence", () => ({
  persistSessionCptMetadata: persistSessionCptMetadataMock,
}));

const importBookHandler = async () => {
  const module = await import("../api/book");
  return module.bookHandler;
};

const TEST_SUPABASE_URL = "https://testing.supabase.co";
const TEST_SUPABASE_ANON_KEY = "testing-anon-key";
const TEST_SUPABASE_EDGE_URL = "https://testing.supabase.co/functions/v1/";

const ORIGINAL_ENV = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  SUPABASE_EDGE_URL: process.env.SUPABASE_EDGE_URL,
  DEFAULT_ORGANIZATION_ID: process.env.DEFAULT_ORGANIZATION_ID,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("bookHandler integration", () => {
  const payload = {
    session: {
      therapist_id: "therapist-1",
      client_id: "client-1",
      start_time: "2025-01-01T10:00:00Z",
      end_time: "2025-01-01T11:00:00Z",
    },
    startTimeOffsetMinutes: 0,
    endTimeOffsetMinutes: 0,
    timeZone: "UTC",
  } as const;

  beforeEach(async () => {
    vi.clearAllMocks();
    const runtimeConfig = await import("../../lib/runtimeConfig");
    runtimeConfig.resetRuntimeSupabaseConfigForTests();
    process.env.SUPABASE_URL = TEST_SUPABASE_URL;
    process.env.SUPABASE_ANON_KEY = TEST_SUPABASE_ANON_KEY;
    process.env.SUPABASE_EDGE_URL = TEST_SUPABASE_EDGE_URL;
    process.env.DEFAULT_ORGANIZATION_ID = "org-default-123";
  });

  it("calls edge functions with the bearer token from the request", async () => {
    const accessToken = "integration-token";
    callEdgeMock
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            holdKey: "hold-key",
            holdId: "hold-id",
            expiresAt: "2025-01-01T09:05:00Z",
            holds: [
              {
                holdKey: "hold-key",
                holdId: "hold-id",
                startTime: payload.session.start_time,
                endTime: payload.session.end_time,
                expiresAt: "2025-01-01T09:05:00Z",
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            session: {
              id: "session-1",
              therapist_id: payload.session.therapist_id,
              client_id: payload.session.client_id,
              start_time: payload.session.start_time,
              end_time: payload.session.end_time,
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
                therapist_id: payload.session.therapist_id,
                client_id: payload.session.client_id,
                start_time: payload.session.start_time,
                end_time: payload.session.end_time,
                status: "scheduled",
                notes: "",
                created_at: "2025-01-01T09:00:00Z",
                created_by: "user-1",
                updated_at: "2025-01-01T09:00:00Z",
                updated_by: "user-1",
                duration_minutes: 60,
              },
            ],
            roundedDurationMinutes: 60,
          },
        }),
      );

    const bookHandler = await importBookHandler();

    const response = await bookHandler(
      new Request("http://localhost/api/book", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.session.id).toBe("session-1");
    expect(callEdgeMock).toHaveBeenCalledTimes(2);
    expect(callEdgeMock).toHaveBeenNthCalledWith(
      1,
      "sessions-hold",
      expect.any(Object),
      { accessToken },
    );
    expect(callEdgeMock).toHaveBeenNthCalledWith(
      2,
      "sessions-confirm",
      expect.any(Object),
      { accessToken },
    );
    expect(persistSessionCptMetadataMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "session-1" }),
    );
  });

  it("rejects unauthorized requests before invoking edge functions", async () => {
    const bookHandler = await importBookHandler();

    const response = await bookHandler(
      new Request("http://localhost/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );

    expect(response.status).toBe(401);
    expect(callEdgeMock).not.toHaveBeenCalled();
    expect(persistSessionCptMetadataMock).not.toHaveBeenCalled();
  });

  it("bootstraps Supabase runtime config for server handlers", async () => {
    vi.resetModules();
    vi.doUnmock("../../lib/supabase");
    persistSessionCptMetadataMock.mockClear();

    const runtimeConfig = await import("../../lib/runtimeConfig");
    runtimeConfig.resetRuntimeSupabaseConfigForTests();

    const originalEnv = {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
      SUPABASE_EDGE_URL: process.env.SUPABASE_EDGE_URL,
    };

    const supabaseUrl = "https://runtime.example.supabase.co";
    const supabaseAnonKey = "test-anon-key";
    const supabaseEdgeUrl = "https://runtime.example.supabase.co/functions/v1/";

    process.env.SUPABASE_URL = supabaseUrl;
    process.env.SUPABASE_ANON_KEY = supabaseAnonKey;
    process.env.SUPABASE_EDGE_URL = supabaseEdgeUrl;

    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn<typeof fetch>();
    const holdResponsePayload = {
      success: true,
      data: {
        holdKey: "hold-key",
        holdId: "hold-id",
        expiresAt: "2025-01-01T09:05:00Z",
        holds: [
          {
            holdKey: "hold-key",
            holdId: "hold-id",
            startTime: payload.session.start_time,
            endTime: payload.session.end_time,
            expiresAt: "2025-01-01T09:05:00Z",
          },
        ],
      },
    } as const;

    const confirmResponsePayload = {
      success: true,
      data: {
        session: {
          id: "session-1",
          therapist_id: payload.session.therapist_id,
          client_id: payload.session.client_id,
          start_time: payload.session.start_time,
          end_time: payload.session.end_time,
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
            therapist_id: payload.session.therapist_id,
            client_id: payload.session.client_id,
            start_time: payload.session.start_time,
            end_time: payload.session.end_time,
            status: "scheduled",
            notes: "",
            created_at: "2025-01-01T09:00:00Z",
            created_by: "user-1",
            updated_at: "2025-01-01T09:00:00Z",
            updated_by: "user-1",
            duration_minutes: 60,
          },
        ],
        roundedDurationMinutes: 60,
      },
    } as const;

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(holdResponsePayload), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(confirmResponsePayload), { status: 200 }));

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const accessToken = "bootstrap-token";

    try {
      await import("../bootstrapSupabase");
      const { bookHandler } = await import("../api/book");

      const response = await bookHandler(
        new Request("http://localhost/api/book", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(payload),
        }),
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.session.id).toBe("session-1");

      expect(runtimeConfig.getRuntimeSupabaseConfig()).toEqual({
        supabaseUrl,
        supabaseAnonKey,
        supabaseEdgeUrl,
        defaultOrganizationId: "org-default-123",
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const expectedBaseUrl = supabaseEdgeUrl.endsWith("/")
        ? supabaseEdgeUrl
        : `${supabaseEdgeUrl}/`;
      expect(fetchMock.mock.calls[0]?.[0]).toBe(`${expectedBaseUrl}sessions-hold`);
      expect(fetchMock.mock.calls[1]?.[0]).toBe(`${expectedBaseUrl}sessions-confirm`);

      expect(persistSessionCptMetadataMock).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: "session-1" }),
      );
      expect(callEdgeMock).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
      runtimeConfig.resetRuntimeSupabaseConfigForTests();
      if (typeof originalEnv.SUPABASE_URL === "string") {
        process.env.SUPABASE_URL = originalEnv.SUPABASE_URL;
      } else {
        delete process.env.SUPABASE_URL;
      }
      if (typeof originalEnv.SUPABASE_ANON_KEY === "string") {
        process.env.SUPABASE_ANON_KEY = originalEnv.SUPABASE_ANON_KEY;
      } else {
        delete process.env.SUPABASE_ANON_KEY;
      }
      if (typeof originalEnv.SUPABASE_EDGE_URL === "string") {
        process.env.SUPABASE_EDGE_URL = originalEnv.SUPABASE_EDGE_URL;
      } else {
        delete process.env.SUPABASE_EDGE_URL;
      }
      if (typeof originalEnv.DEFAULT_ORGANIZATION_ID === "string") {
        process.env.DEFAULT_ORGANIZATION_ID = originalEnv.DEFAULT_ORGANIZATION_ID;
      } else {
        delete process.env.DEFAULT_ORGANIZATION_ID;
      }
      vi.doMock("../../lib/supabase", supabaseModuleFactory);
      vi.resetModules();
    }
  });
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
  if (typeof ORIGINAL_ENV.SUPABASE_EDGE_URL === "string") {
    process.env.SUPABASE_EDGE_URL = ORIGINAL_ENV.SUPABASE_EDGE_URL;
  } else {
    delete process.env.SUPABASE_EDGE_URL;
  }
  if (typeof ORIGINAL_ENV.DEFAULT_ORGANIZATION_ID === "string") {
    process.env.DEFAULT_ORGANIZATION_ID = ORIGINAL_ENV.DEFAULT_ORGANIZATION_ID;
  } else {
    delete process.env.DEFAULT_ORGANIZATION_ID;
  }
});
