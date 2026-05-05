import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/setup";
import { resetRateLimitsForTests } from "../api/shared";

const importHandler = async () => {
  const module = await import("../api/sessions-week-forward");
  return module.sessionsWeekForwardHandler;
};

const TEST_SUPABASE_URL = "https://testing.supabase.co";
const TEST_SUPABASE_ANON_KEY = "testing-anon-key";

const ORIGINAL_ENV = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  DEFAULT_ORGANIZATION_ID: process.env.DEFAULT_ORGANIZATION_ID,
};

const validPayload = {
  sourceSessionIds: [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ],
  displayedWeekStart: "2025-06-30T07:00:00.000Z",
  displayedWeekEnd: "2025-07-07T06:59:59.999Z",
  endDate: "2025-08-31",
  timeZone: "America/Los_Angeles",
  dryRun: true,
};

const buildRequest = (body: unknown, init: RequestInit = {}) =>
  new Request("http://localhost/api/sessions-week-forward", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer valid-token",
      ...(init.headers ?? {}),
    },
    body: JSON.stringify(body),
    ...init,
  });

beforeEach(async () => {
  resetRateLimitsForTests();
  vi.clearAllMocks();

  const runtimeConfig = await import("../../lib/runtimeConfig");
  runtimeConfig.resetRuntimeSupabaseConfigForTests();

  process.env.SUPABASE_URL = TEST_SUPABASE_URL;
  process.env.SUPABASE_ANON_KEY = TEST_SUPABASE_ANON_KEY;
  process.env.DEFAULT_ORGANIZATION_ID = "5238e88b-6198-4862-80a2-dbe15bbeabdd";

  server.use(
    http.post(`${TEST_SUPABASE_URL}/rest/v1/rpc/current_user_is_super_admin`, () => HttpResponse.json(false)),
    http.post(`${TEST_SUPABASE_URL}/rest/v1/rpc/current_user_organization_id`, () =>
      HttpResponse.json("5238e88b-6198-4862-80a2-dbe15bbeabdd")),
    http.post(`${TEST_SUPABASE_URL}/rest/v1/rpc/user_has_role_for_org`, async ({ request }) => {
      const body = await request.json() as { role_name?: string };
      return HttpResponse.json(body.role_name === "admin");
    }),
    http.get(`${TEST_SUPABASE_URL}/rest/v1/sessions`, () =>
      HttpResponse.json([
        {
          id: validPayload.sourceSessionIds[0],
          organization_id: "5238e88b-6198-4862-80a2-dbe15bbeabdd",
          therapist_id: "therapist-1",
          client_id: "client-1",
          start_time: "2025-07-01T10:00:00Z",
          end_time: "2025-07-01T11:00:00Z",
          status: "scheduled",
        },
        {
          id: validPayload.sourceSessionIds[1],
          organization_id: "5238e88b-6198-4862-80a2-dbe15bbeabdd",
          therapist_id: "therapist-2",
          client_id: "client-2",
          start_time: "2025-07-01T11:00:00Z",
          end_time: "2025-07-01T12:00:00Z",
          status: "scheduled",
        },
      ])),
    http.post(`${TEST_SUPABASE_URL}/rest/v1/rpc/apply_schedule_week_forward`, async ({ request }) => {
      const body = await request.json() as { p_dry_run?: boolean; p_end_date?: string };
      return HttpResponse.json({
        success: true,
        source_session_count: 2,
        generated_session_count: 8,
        generated_week_count: 4,
        end_date: body.p_end_date ?? validPayload.endDate,
        conflicts: [],
        ...(body.p_dry_run === true ? {} : { created_sessions: [] }),
      });
    }),
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
  if (typeof ORIGINAL_ENV.DEFAULT_ORGANIZATION_ID === "string") {
    process.env.DEFAULT_ORGANIZATION_ID = ORIGINAL_ENV.DEFAULT_ORGANIZATION_ID;
  } else {
    delete process.env.DEFAULT_ORGANIZATION_ID;
  }
});

describe("sessionsWeekForwardHandler", () => {
  it("returns CORS headers for OPTIONS requests", async () => {
    const handler = await importHandler();
    const response = await handler(new Request("http://localhost/api/sessions-week-forward", {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:3000" },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
  });

  it("rejects non-admin actors", async () => {
    server.use(
      http.post(`${TEST_SUPABASE_URL}/rest/v1/rpc/user_has_role_for_org`, () => HttpResponse.json(false)),
    );
    const handler = await importHandler();
    const response = await handler(buildRequest(validPayload));
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe("Forbidden");
  });

  it("rejects source sessions that are outside the active organization scope", async () => {
    server.use(
      http.get(`${TEST_SUPABASE_URL}/rest/v1/sessions`, () =>
        HttpResponse.json([
          {
            id: validPayload.sourceSessionIds[0],
            organization_id: "5238e88b-6198-4862-80a2-dbe15bbeabdd",
            therapist_id: "therapist-1",
            client_id: "client-1",
            start_time: "2025-07-01T10:00:00Z",
            end_time: "2025-07-01T11:00:00Z",
            status: "scheduled",
          },
        ])),
    );
    const handler = await importHandler();
    const response = await handler(buildRequest(validPayload));
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.code).toBe("SOURCE_SCOPE_MISMATCH");
  });

  it("rejects visible source sessions that are not scheduled", async () => {
    server.use(
      http.get(`${TEST_SUPABASE_URL}/rest/v1/sessions`, () =>
        HttpResponse.json([
          {
            id: validPayload.sourceSessionIds[0],
            organization_id: "5238e88b-6198-4862-80a2-dbe15bbeabdd",
            therapist_id: "therapist-1",
            client_id: "client-1",
            start_time: "2025-07-01T10:00:00Z",
            end_time: "2025-07-01T11:00:00Z",
            status: "scheduled",
          },
          {
            id: validPayload.sourceSessionIds[1],
            organization_id: "5238e88b-6198-4862-80a2-dbe15bbeabdd",
            therapist_id: "therapist-2",
            client_id: "client-2",
            start_time: "2025-07-01T11:00:00Z",
            end_time: "2025-07-01T12:00:00Z",
            status: "completed",
          },
        ])),
    );
    const handler = await importHandler();
    const response = await handler(buildRequest(validPayload));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/must be scheduled/i);
  });

  it("returns a preview for dry runs", async () => {
    const handler = await importHandler();
    const response = await handler(buildRequest(validPayload));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      sourceSessionCount: 2,
      generatedSessionCount: 8,
      generatedWeekCount: 4,
      endDate: "2025-08-31",
      conflicts: [],
    });
  });

  it("maps RPC conflicts to 409 responses with preview data", async () => {
    server.use(
      http.post(`${TEST_SUPABASE_URL}/rest/v1/rpc/apply_schedule_week_forward`, () =>
        HttpResponse.json({
          success: false,
          error_code: "THERAPIST_CONFLICT",
          error_message: "Therapist already has a session during this time.",
          source_session_count: 2,
          generated_session_count: 8,
          generated_week_count: 4,
          end_date: "2025-08-31",
          conflicts: [
            {
              sourceSessionId: validPayload.sourceSessionIds[0],
              conflictingSessionId: "33333333-3333-4333-8333-333333333333",
              startTime: "2025-07-08T10:00:00Z",
              endTime: "2025-07-08T11:00:00Z",
              therapistId: "therapist-1",
              clientId: "client-1",
              code: "THERAPIST_CONFLICT",
              message: "Therapist already has a session during this time.",
            },
          ],
        })),
    );
    const handler = await importHandler();
    const response = await handler(buildRequest(validPayload));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("THERAPIST_CONFLICT");
    expect(body.data).toMatchObject({
      sourceSessionCount: 2,
      generatedSessionCount: 8,
      generatedWeekCount: 4,
    });
  });
});
