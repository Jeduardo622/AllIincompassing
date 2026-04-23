import { beforeEach, describe, expect, it, vi } from "vitest";
import { sessionNotesUpsertHandler } from "../api/session-notes-upsert";

vi.mock("../api/shared", async () => {
  const actual = await vi.importActual<typeof import("../api/shared")>("../api/shared");
  return {
    ...actual,
    getAccessToken: vi.fn(),
    resolveOrgAndRoleWithStatus: vi.fn(),
    fetchAuthenticatedUserIdWithStatus: vi.fn(),
    getSupabaseConfig: vi.fn(),
    fetchJson: vi.fn(),
  };
});

import {
  fetchAuthenticatedUserIdWithStatus,
  fetchJson,
  getAccessToken,
  getSupabaseConfig,
  resolveOrgAndRoleWithStatus,
} from "../api/shared";

const ACCESS_TOKEN = "token-123";
const BASE_URL = "https://example.supabase.co";
const HEADERS = { Authorization: `Bearer ${ACCESS_TOKEN}` };

const basePayload = {
  clientId: "11111111-1111-4111-8111-111111111111",
  authorizationId: "22222222-2222-4222-8222-222222222222",
  therapistId: "33333333-3333-4333-8333-333333333333",
  serviceCode: "97153",
  sessionDate: "2026-03-10",
  startTime: "09:00",
  endTime: "10:00",
  goalIds: ["44444444-4444-4444-8444-444444444444"],
  goalsAddressed: ["Goal A"],
  goalNotes: { "44444444-4444-4444-8444-444444444444": "  covered  " },
  goalMeasurements: {
    "44444444-4444-4444-8444-444444444444": {
      data: { metric_value: 4, opportunities: 5, note: "  measured  " },
    },
    "55555555-5555-4555-8555-555555555555": {
      data: { note: "   " },
    },
  },
  narrative: "  Session narrative  ",
  isLocked: false,
};

const buildSessionNoteRow = (id: string) => ({
  id,
  authorization_id: basePayload.authorizationId,
  client_id: basePayload.clientId,
  created_at: "2026-03-10T16:00:00.000Z",
  end_time: "10:00:00",
  goal_ids: basePayload.goalIds,
  goal_measurements: {
    "44444444-4444-4444-8444-444444444444": {
      version: 1,
      data: {
        metric_label: "Count",
        metric_unit: null,
        metric_value: 4,
        incorrect_trials: null,
        opportunities: 5,
        prompt_level: null,
        note: "measured",
        trial_prompt_note: null,
      },
    },
  },
  goal_notes: { "44444444-4444-4444-8444-444444444444": "covered" },
  goals_addressed: basePayload.goalsAddressed,
  is_locked: false,
  narrative: "Session narrative",
  organization_id: "org-1",
  service_code: basePayload.serviceCode,
  session_date: basePayload.sessionDate,
  session_duration: 60,
  session_id: null,
  signed_at: null,
  start_time: "09:00:00",
  therapist_id: basePayload.therapistId,
  updated_at: "2026-03-10T16:00:00.000Z",
  therapists: { full_name: "Therapist A", title: "BCBA" },
});

describe("sessionNotesUpsertHandler", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getAccessToken).mockReturnValue(ACCESS_TOKEN);
    vi.mocked(resolveOrgAndRoleWithStatus).mockResolvedValue({
      organizationId: "org-1",
      isTherapist: true,
      isAdmin: false,
      isOrgMember: false,
      isSuperAdmin: false,
      upstreamError: false,
    });
    vi.mocked(fetchAuthenticatedUserIdWithStatus).mockResolvedValue({
      userId: "actor-1",
      upstreamError: false,
    });
    vi.mocked(getSupabaseConfig).mockReturnValue({
      supabaseUrl: BASE_URL,
      anonKey: "anon-key",
    });
  });

  it("creates a session note with normalized goal notes and measurements", async () => {
    const fetchJsonMock = vi.mocked(fetchJson);
    fetchJsonMock.mockImplementation(async (url, init) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/rest/v1/authorizations?")) {
        return {
          ok: true,
          status: 200,
          data: [{
            id: basePayload.authorizationId,
            organization_id: "org-1",
            client_id: basePayload.clientId,
            status: "approved",
            start_date: "2026-01-01",
            end_date: "2026-12-31",
            services: [{ service_code: basePayload.serviceCode, approved_units: 10 }],
          }],
        };
      }
      if (requestUrl.includes("/rest/v1/client_session_notes?select=id,is_locked")) {
        return { ok: true, status: 200, data: [] };
      }
      if (requestUrl.endsWith("/rest/v1/client_session_notes") && init?.method === "POST") {
        const parsedBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        expect(parsedBody.goal_notes).toEqual({
          "44444444-4444-4444-8444-444444444444": "covered",
        });
        expect(parsedBody.goal_measurements).toEqual({
          "44444444-4444-4444-8444-444444444444": {
            version: 1,
            data: {
              measurement_type: null,
              metric_label: "Count",
              metric_unit: null,
              metric_value: 4,
              incorrect_trials: null,
              opportunities: 5,
              prompt_level: null,
              note: "measured",
              trial_prompt_note: null,
            },
          },
        });
        return { ok: true, status: 201, data: [{ id: "note-created" }] };
      }
      if (requestUrl.includes("select=id%2Cauthorization_id") && requestUrl.includes("id=eq.note-created")) {
        return { ok: true, status: 200, data: [buildSessionNoteRow("note-created")] };
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });

    const response = await sessionNotesUpsertHandler(
      new Request("http://localhost/api/session-notes/upsert", {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify(basePayload),
      }),
    );
    const payload = await response.json() as { id: string; goal_notes?: Record<string, string> | null };

    expect(response.status).toBe(200);
    expect(payload.id).toBe("note-created");
    expect(payload.goal_notes).toEqual({ "44444444-4444-4444-8444-444444444444": "covered" });
  });

  it("merges goal_ids from goal_notes keys omitted in goalIds and pads goals_addressed", async () => {
    const adhocId = "adhoc-skill-550e8400-e29b-41d4-a716-446655440000";
    const fetchJsonMock = vi.mocked(fetchJson);
    fetchJsonMock.mockImplementation(async (url, init) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/rest/v1/authorizations?")) {
        return {
          ok: true,
          status: 200,
          data: [{
            id: basePayload.authorizationId,
            organization_id: "org-1",
            client_id: basePayload.clientId,
            status: "approved",
            start_date: "2026-01-01",
            end_date: "2026-12-31",
            services: [{ service_code: basePayload.serviceCode, approved_units: 10 }],
          }],
        };
      }
      if (requestUrl.includes("/rest/v1/client_session_notes?select=id,is_locked")) {
        return { ok: true, status: 200, data: [] };
      }
      if (requestUrl.endsWith("/rest/v1/client_session_notes") && init?.method === "POST") {
        const parsedBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        expect(parsedBody.goal_ids).toEqual(["44444444-4444-4444-8444-444444444444", adhocId]);
        expect(parsedBody.goal_notes).toEqual({
          "44444444-4444-4444-8444-444444444444": "covered",
          [adhocId]: "adhoc only",
        });
        expect(parsedBody.goals_addressed).toEqual(["Goal A", "Session target"]);
        return { ok: true, status: 201, data: [{ id: "note-merge" }] };
      }
      if (requestUrl.includes("select=id%2Cauthorization_id") && requestUrl.includes("id=eq.note-merge")) {
        return {
          ok: true,
          status: 200,
          data: [
            {
              ...buildSessionNoteRow("note-merge"),
              goal_ids: ["44444444-4444-4444-8444-444444444444", adhocId],
              goal_notes: {
                "44444444-4444-4444-8444-444444444444": "covered",
                [adhocId]: "adhoc only",
              },
              goals_addressed: ["Goal A", "Session target"],
            },
          ],
        };
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });

    const response = await sessionNotesUpsertHandler(
      new Request("http://localhost/api/session-notes/upsert", {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({
          ...basePayload,
          goalIds: ["44444444-4444-4444-8444-444444444444"],
          goalsAddressed: ["Goal A"],
          goalNotes: {
            "44444444-4444-4444-8444-444444444444": "covered",
            [adhocId]: "adhoc only",
          },
          goalMeasurements: {},
        }),
      }),
    );

    expect(response.status).toBe(200);
  });

  it("creates a session note with ad-hoc goal ids alongside plan goal uuids", async () => {
    const adhocId = "adhoc-skill-550e8400-e29b-41d4-a716-446655440000";
    const fetchJsonMock = vi.mocked(fetchJson);
    fetchJsonMock.mockImplementation(async (url, init) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/rest/v1/authorizations?")) {
        return {
          ok: true,
          status: 200,
          data: [{
            id: basePayload.authorizationId,
            organization_id: "org-1",
            client_id: basePayload.clientId,
            status: "approved",
            start_date: "2026-01-01",
            end_date: "2026-12-31",
            services: [{ service_code: basePayload.serviceCode, approved_units: 10 }],
          }],
        };
      }
      if (requestUrl.includes("/rest/v1/client_session_notes?select=id,is_locked")) {
        return { ok: true, status: 200, data: [] };
      }
      if (requestUrl.endsWith("/rest/v1/client_session_notes") && init?.method === "POST") {
        const parsedBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        expect(parsedBody.goal_ids).toEqual(["44444444-4444-4444-8444-444444444444", adhocId]);
        expect(parsedBody.goal_notes).toEqual({
          "44444444-4444-4444-8444-444444444444": "covered",
          [adhocId]: "adhoc line",
        });
        expect(parsedBody.goal_measurements).toMatchObject({
          [adhocId]: expect.objectContaining({
            version: 1,
            data: expect.objectContaining({ metric_value: 2 }),
          }),
        });
        return { ok: true, status: 201, data: [{ id: "note-adhoc" }] };
      }
      if (requestUrl.includes("select=id%2Cauthorization_id") && requestUrl.includes("id=eq.note-adhoc")) {
        return { ok: true, status: 200, data: [buildSessionNoteRow("note-adhoc")] };
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });

    const response = await sessionNotesUpsertHandler(
      new Request("http://localhost/api/session-notes/upsert", {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({
          ...basePayload,
          goalIds: ["44444444-4444-4444-8444-444444444444", adhocId],
          goalsAddressed: ["Goal A", "Custom target"],
          goalNotes: {
            "44444444-4444-4444-8444-444444444444": "covered",
            [adhocId]: "adhoc line",
          },
          goalMeasurements: {
            [adhocId]: { data: { metric_value: 2 } },
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
  });

  it("updates an existing unlocked note when noteId is provided", async () => {
    const fetchJsonMock = vi.mocked(fetchJson);
    fetchJsonMock.mockImplementation(async (url, init) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/rest/v1/authorizations?")) {
        return {
          ok: true,
          status: 200,
          data: [{
            id: basePayload.authorizationId,
            organization_id: "org-1",
            client_id: basePayload.clientId,
            status: "approved",
            start_date: "2026-01-01",
            end_date: "2026-12-31",
            services: [{ service_code: basePayload.serviceCode, approved_units: 10 }],
          }],
        };
      }
      if (requestUrl.includes("/rest/v1/client_session_notes?select=id,is_locked") && requestUrl.includes("id=eq.66666666-6666-4666-8666-666666666666")) {
        return { ok: true, status: 200, data: [{ id: "66666666-6666-4666-8666-666666666666", is_locked: false }] };
      }
      if (requestUrl.includes("/rest/v1/client_session_notes?id=eq.66666666-6666-4666-8666-666666666666") && init?.method === "PATCH") {
        return { ok: true, status: 200, data: [{ id: "66666666-6666-4666-8666-666666666666" }] };
      }
      if (requestUrl.includes("select=id%2Cauthorization_id") && requestUrl.includes("id=eq.66666666-6666-4666-8666-666666666666")) {
        return { ok: true, status: 200, data: [buildSessionNoteRow("66666666-6666-4666-8666-666666666666")] };
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });

    const response = await sessionNotesUpsertHandler(
      new Request("http://localhost/api/session-notes/upsert", {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({ ...basePayload, noteId: "66666666-6666-4666-8666-666666666666" }),
      }),
    );

    expect(response.status).toBe(200);
  });

  it("rejects updates for locked notes", async () => {
    const fetchJsonMock = vi.mocked(fetchJson);
    fetchJsonMock.mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/rest/v1/authorizations?")) {
        return {
          ok: true,
          status: 200,
          data: [{
            id: basePayload.authorizationId,
            organization_id: "org-1",
            client_id: basePayload.clientId,
            status: "approved",
            start_date: "2026-01-01",
            end_date: "2026-12-31",
            services: [{ service_code: basePayload.serviceCode, approved_units: 10 }],
          }],
        };
      }
      if (requestUrl.includes("/rest/v1/client_session_notes?select=id,is_locked") && requestUrl.includes("id=eq.77777777-7777-4777-8777-777777777777")) {
        return { ok: true, status: 200, data: [{ id: "77777777-7777-4777-8777-777777777777", is_locked: true }] };
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });

    const response = await sessionNotesUpsertHandler(
      new Request("http://localhost/api/session-notes/upsert", {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({ ...basePayload, noteId: "77777777-7777-4777-8777-777777777777" }),
      }),
    );
    const payload = await response.json() as { error?: string };

    expect(response.status).toBe(409);
    expect(payload.error).toMatch(/locked/i);
  });

  it("rejects when session date is outside authorization range", async () => {
    const fetchJsonMock = vi.mocked(fetchJson);
    fetchJsonMock.mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/rest/v1/authorizations?")) {
        return {
          ok: true,
          status: 200,
          data: [{
            id: basePayload.authorizationId,
            organization_id: "org-1",
            client_id: basePayload.clientId,
            status: "approved",
            start_date: "2026-01-01",
            end_date: "2026-01-31",
            services: [{ service_code: basePayload.serviceCode, approved_units: 10 }],
          }],
        };
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });

    const response = await sessionNotesUpsertHandler(
      new Request("http://localhost/api/session-notes/upsert", {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({ ...basePayload, sessionDate: "2026-03-10" }),
      }),
    );
    const payload = await response.json() as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/date range/i);
  });

  it("rejects when service code is not authorized", async () => {
    const fetchJsonMock = vi.mocked(fetchJson);
    fetchJsonMock.mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/rest/v1/authorizations?")) {
        return {
          ok: true,
          status: 200,
          data: [{
            id: basePayload.authorizationId,
            organization_id: "org-1",
            client_id: basePayload.clientId,
            status: "approved",
            start_date: "2026-01-01",
            end_date: "2026-12-31",
            services: [{ service_code: "97151", approved_units: 10 }],
          }],
        };
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });

    const response = await sessionNotesUpsertHandler(
      new Request("http://localhost/api/session-notes/upsert", {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify(basePayload),
      }),
    );
    const payload = await response.json() as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/service code/i);
  });

  it("rejects when client does not match authorization", async () => {
    const fetchJsonMock = vi.mocked(fetchJson);
    fetchJsonMock.mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/rest/v1/authorizations?")) {
        return {
          ok: true,
          status: 200,
          data: [{
            id: basePayload.authorizationId,
            organization_id: "org-1",
            client_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            status: "approved",
            start_date: "2026-01-01",
            end_date: "2026-12-31",
            services: [{ service_code: basePayload.serviceCode, approved_units: 10 }],
          }],
        };
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });

    const response = await sessionNotesUpsertHandler(
      new Request("http://localhost/api/session-notes/upsert", {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify(basePayload),
      }),
    );
    const payload = await response.json() as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/client does not match/i);
  });

  it("merges only captureMergeGoalIds into an existing note on update", async () => {
    const gidA = "44444444-4444-4444-8444-444444444444";
    const gidB = "55555555-5555-4555-8555-555555555555";
    const sessionId = "66666666-6666-4666-8666-666666666666";
    const noteId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

    const existingRow = buildSessionNoteRow(noteId);
    existingRow.session_id = sessionId;
    existingRow.goal_ids = [gidA, gidB];
    existingRow.goals_addressed = ["Goal A", "Goal B"];
    existingRow.goal_notes = { [gidA]: "server kept skill note", [gidB]: "server old bx note" };
    existingRow.goal_measurements = {
      [gidA]: {
        version: 1,
        data: {
          metric_label: "Count",
          metric_unit: null,
          metric_value: 1,
          incorrect_trials: null,
          opportunities: null,
          prompt_level: null,
          note: null,
          trial_prompt_note: null,
        },
      },
    };

    const savedAfterPatch = {
      ...existingRow,
      goal_notes: { [gidA]: "server kept skill note", [gidB]: "merged bx from client" },
    };

    let fullNoteSelectGets = 0;

    const fetchJsonMock = vi.mocked(fetchJson);
    fetchJsonMock.mockImplementation(async (url, init) => {
      const requestUrl = String(url);
      const method = init?.method ?? "GET";
      if (requestUrl.includes("/rest/v1/authorizations?")) {
        return {
          ok: true,
          status: 200,
          data: [{
            id: basePayload.authorizationId,
            organization_id: "org-1",
            client_id: basePayload.clientId,
            status: "approved",
            start_date: "2026-01-01",
            end_date: "2026-12-31",
            services: [{ service_code: basePayload.serviceCode, approved_units: 10 }],
          }],
        };
      }
      if (
        requestUrl.includes("/rest/v1/client_session_notes?") &&
        method === "GET" &&
        requestUrl.includes(`session_id=eq.${encodeURIComponent(sessionId)}`)
      ) {
        return { ok: true, status: 200, data: [{ id: noteId, is_locked: false }] };
      }
      if (
        requestUrl.includes("/rest/v1/client_session_notes?") &&
        method === "GET" &&
        requestUrl.includes(`id=eq.${encodeURIComponent(noteId)}`) &&
        !requestUrl.includes("session_id=eq.")
      ) {
        fullNoteSelectGets += 1;
        if (fullNoteSelectGets === 1) {
          return { ok: true, status: 200, data: [existingRow] };
        }
        return { ok: true, status: 200, data: [savedAfterPatch] };
      }
      if (requestUrl.includes("/rest/v1/client_session_notes?id=eq.") && method === "PATCH") {
        const parsedBody = JSON.parse(String(init.body)) as { goal_notes?: Record<string, string> };
        expect(parsedBody.goal_notes?.[gidA]).toBe("server kept skill note");
        expect(parsedBody.goal_notes?.[gidB]).toBe("merged bx from client");
        return { ok: true, status: 200, data: [{ id: noteId }] };
      }
      throw new Error(`Unexpected request: ${requestUrl} ${method}`);
    });

    const response = await sessionNotesUpsertHandler(
      new Request("http://localhost/api/session-notes/upsert", {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({
          ...basePayload,
          sessionId,
          noteId: undefined,
          goalIds: [gidA, gidB],
          goalsAddressed: ["Goal A", "Goal B"],
          goalNotes: {
            [gidA]: "CLIENT STALE MUST NOT WIN",
            [gidB]: "merged bx from client",
          },
          goalMeasurements: null,
          captureMergeGoalIds: [gidB],
        }),
      }),
    );

    expect(response.status).toBe(200);
    const json = await response.json() as { goal_notes?: Record<string, string> | null };
    expect(json.goal_notes?.[gidA]).toBe("server kept skill note");
    expect(json.goal_notes?.[gidB]).toBe("merged bx from client");
  });

  it("falls back when merge-read select misses goal_measurements column", async () => {
    const sessionId = "66666666-6666-4666-8666-666666666666";
    const noteId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    let patchCalled = false;
    let noteReadAttempts = 0;

    const fetchJsonMock = vi.mocked(fetchJson);
    fetchJsonMock.mockImplementation(async (url, init) => {
      const requestUrl = String(url);
      const decodedUrl = decodeURIComponent(requestUrl);
      const method = init?.method ?? "GET";
      if (requestUrl.includes("/rest/v1/authorizations?")) {
        return {
          ok: true,
          status: 200,
          data: [{
            id: basePayload.authorizationId,
            organization_id: "org-1",
            client_id: basePayload.clientId,
            status: "approved",
            start_date: "2026-01-01",
            end_date: "2026-12-31",
            services: [{ service_code: basePayload.serviceCode, approved_units: 10 }],
          }],
        };
      }
      if (
        requestUrl.includes("/rest/v1/client_session_notes?") &&
        method === "GET" &&
        requestUrl.includes(`session_id=eq.${encodeURIComponent(sessionId)}`)
      ) {
        return { ok: true, status: 200, data: [{ id: noteId, is_locked: false }] };
      }
      if (requestUrl.includes("/rest/v1/client_session_notes?") && method === "GET" && requestUrl.includes(`id=eq.${encodeURIComponent(noteId)}`)) {
        noteReadAttempts += 1;
        if (noteReadAttempts === 1) {
          expect(decodedUrl).toContain("goal_measurements");
          return {
            ok: false,
            status: 400,
            data: {
              code: "42703",
              message: 'column "goal_measurements" does not exist',
            },
          };
        }
        if (noteReadAttempts === 2) {
          expect(decodedUrl).not.toContain("goal_measurements");
          return { ok: true, status: 200, data: [buildSessionNoteRow(noteId)] };
        }
        return { ok: true, status: 200, data: [buildSessionNoteRow(noteId)] };
      }
      if (requestUrl.includes("/rest/v1/client_session_notes?id=eq.") && method === "PATCH") {
        patchCalled = true;
        return { ok: true, status: 200, data: [{ id: noteId }] };
      }
      throw new Error(`Unexpected request: ${requestUrl} ${method}`);
    });

    const response = await sessionNotesUpsertHandler(
      new Request("http://localhost/api/session-notes/upsert", {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({
          ...basePayload,
          sessionId,
          captureMergeGoalIds: [basePayload.goalIds[0]],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(noteReadAttempts).toBeGreaterThanOrEqual(2);
    expect(patchCalled).toBe(true);
  });

  it("falls back when post-save read misses goal_measurements column", async () => {
    const noteId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    let postSaveReads = 0;

    const fetchJsonMock = vi.mocked(fetchJson);
    fetchJsonMock.mockImplementation(async (url, init) => {
      const requestUrl = String(url);
      const decodedUrl = decodeURIComponent(requestUrl);
      const method = init?.method ?? "GET";
      if (requestUrl.includes("/rest/v1/authorizations?")) {
        return {
          ok: true,
          status: 200,
          data: [{
            id: basePayload.authorizationId,
            organization_id: "org-1",
            client_id: basePayload.clientId,
            status: "approved",
            start_date: "2026-01-01",
            end_date: "2026-12-31",
            services: [{ service_code: basePayload.serviceCode, approved_units: 10 }],
          }],
        };
      }
      if (requestUrl.includes("/rest/v1/client_session_notes?select=id,is_locked")) {
        return { ok: true, status: 200, data: [] };
      }
      if (requestUrl.endsWith("/rest/v1/client_session_notes") && method === "POST") {
        return { ok: true, status: 201, data: [{ id: noteId }] };
      }
      if (requestUrl.includes("/rest/v1/client_session_notes?") && method === "GET" && requestUrl.includes(`id=eq.${encodeURIComponent(noteId)}`)) {
        postSaveReads += 1;
        if (postSaveReads === 1) {
          expect(decodedUrl).toContain("goal_measurements");
          return {
            ok: false,
            status: 400,
            data: {
              code: "PGRST204",
              details: "Could not find the 'goal_measurements' column of 'client_session_notes' in the schema cache",
            },
          };
        }
        expect(decodedUrl).not.toContain("goal_measurements");
        const row = buildSessionNoteRow(noteId);
        const { goal_measurements: _dropped, ...withoutGoalMeasurements } = row;
        return { ok: true, status: 200, data: [withoutGoalMeasurements] };
      }
      throw new Error(`Unexpected request: ${requestUrl} ${method}`);
    });

    const response = await sessionNotesUpsertHandler(
      new Request("http://localhost/api/session-notes/upsert", {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify(basePayload),
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json() as { id: string; goal_measurements?: unknown };
    expect(payload.id).toBe(noteId);
    expect(payload.goal_measurements ?? null).toBeNull();
  });
});
