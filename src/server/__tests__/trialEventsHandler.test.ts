import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trialEventsHandler } from "../api/trial-events";

vi.mock("../api/shared", async () => {
  const actual = await vi.importActual<typeof import("../api/shared")>("../api/shared");
  return {
    ...actual,
    currentUserCanCaptureTrialEvent: vi.fn(),
    currentUserCanManageLockedTrialEvent: vi.fn(),
    fetchAuthenticatedUserIdWithStatus: vi.fn(),
    fetchJson: vi.fn(),
    getAccessToken: vi.fn(),
    getSupabaseConfig: vi.fn(),
    resolveOrgAndRoleWithStatus: vi.fn(),
    sessionHasLockedNote: vi.fn(),
  };
});

import {
  currentUserCanCaptureTrialEvent,
  currentUserCanManageLockedTrialEvent,
  fetchAuthenticatedUserIdWithStatus,
  fetchJson,
  getAccessToken,
  getSupabaseConfig,
  resolveOrgAndRoleWithStatus,
  sessionHasLockedNote,
} from "../api/shared";

const ACCESS_TOKEN = "token-123";
const ORG_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const TARGET_ID = "44444444-4444-4444-8444-444444444444";
const GOAL_ID = "55555555-5555-4555-8555-555555555555";
const THERAPIST_ID = "66666666-6666-4666-8666-666666666666";
const SERVICE_ROLE_KEY = "service-role-key";
const ORIGINAL_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const buildPostRequest = () =>
  new Request("http://localhost/api/trial-events", {
    method: "POST",
    body: JSON.stringify({
      session_id: SESSION_ID,
      target_id: TARGET_ID,
      trial_number: 1,
      value: 3,
    }),
  });

const buildGetRequest = (query = `target_id=${TARGET_ID}`) =>
  new Request(`http://localhost/api/trial-events?${query}`, {
    method: "GET",
  });

const mockTargetAndSessionLookups = (measurementType = "frequency") => {
  vi.mocked(fetchJson)
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: [
        {
          id: TARGET_ID,
          organization_id: ORG_ID,
          client_id: CLIENT_ID,
          goal_id: GOAL_ID,
          measurement_type: measurementType,
        },
      ],
    })
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: [
        {
          id: SESSION_ID,
          organization_id: ORG_ID,
          client_id: CLIENT_ID,
          therapist_id: THERAPIST_ID,
        },
      ],
    });
};

const mockTargetReadLookup = () => {
  vi.mocked(fetchJson).mockResolvedValueOnce({
    ok: true,
    status: 200,
    data: [
      {
        id: TARGET_ID,
        organization_id: ORG_ID,
        client_id: CLIENT_ID,
        goal_id: GOAL_ID,
        measurement_type: "frequency",
      },
    ],
  });
};

const mockSessionReadLookup = (clientId = CLIENT_ID) => {
  vi.mocked(fetchJson).mockResolvedValueOnce({
    ok: true,
    status: 200,
    data: [
      {
        id: SESSION_ID,
        organization_id: ORG_ID,
        client_id: clientId,
        therapist_id: THERAPIST_ID,
      },
    ],
  });
};

describe("trialEventsHandler", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_ROLE_KEY;
    vi.mocked(getAccessToken).mockReturnValue(ACCESS_TOKEN);
    vi.mocked(getSupabaseConfig).mockReturnValue({
      supabaseUrl: "https://example.supabase.co",
      anonKey: "anon-key",
    });
    vi.mocked(resolveOrgAndRoleWithStatus).mockResolvedValue({
      organizationId: ORG_ID,
      isTherapist: true,
      isAdmin: false,
      isOrgMember: false,
      isSuperAdmin: false,
      upstreamError: false,
    });
    vi.mocked(fetchAuthenticatedUserIdWithStatus).mockResolvedValue({
      userId: "actor-user",
      upstreamError: false,
    });
  });

  afterEach(() => {
    if (typeof ORIGINAL_SERVICE_ROLE_KEY === "string") {
      process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_SERVICE_ROLE_KEY;
    } else {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    }
  });

  it("denies trial-event reads when caller cannot access the target client data", async () => {
    mockTargetReadLookup();
    vi.mocked(currentUserCanCaptureTrialEvent).mockResolvedValue({ allowed: false, upstreamError: false });

    const response = await trialEventsHandler(buildGetRequest());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
    expect(currentUserCanCaptureTrialEvent).toHaveBeenCalledWith(ACCESS_TOKEN, ORG_ID, CLIENT_ID);
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it("returns 502 when trial-event read access cannot be validated", async () => {
    mockTargetReadLookup();
    vi.mocked(currentUserCanCaptureTrialEvent).mockResolvedValue({ allowed: false, upstreamError: true });

    const response = await trialEventsHandler(buildGetRequest());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Unable to validate trial-event read access" });
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it("loads target trial events only after target client access is allowed", async () => {
    mockTargetReadLookup();
    vi.mocked(currentUserCanCaptureTrialEvent).mockResolvedValue({ allowed: true, upstreamError: false });
    vi.mocked(fetchJson).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: [{ id: "event-1", target_id: TARGET_ID, value: 4, response: null }],
    });

    const response = await trialEventsHandler(buildGetRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ id: "event-1", target_id: TARGET_ID, value: 4, response: null }]);
    expect(currentUserCanCaptureTrialEvent).toHaveBeenCalledWith(ACCESS_TOKEN, ORG_ID, CLIENT_ID);
    expect(fetchJson).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("/rest/v1/goal_targets?"),
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          apikey: SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        }),
      }),
    );
    expect(fetchJson).toHaveBeenLastCalledWith(
      expect.stringContaining(`/rest/v1/trial_events?select=*&organization_id=eq.${ORG_ID}&target_id=eq.${TARGET_ID}`),
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          apikey: "anon-key",
          Authorization: `Bearer ${ACCESS_TOKEN}`,
        }),
      }),
    );
  });

  it("loads session trial events only after session client access is allowed", async () => {
    mockSessionReadLookup();
    vi.mocked(currentUserCanCaptureTrialEvent).mockResolvedValue({ allowed: true, upstreamError: false });
    vi.mocked(fetchJson).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: [{ id: "event-1", session_id: SESSION_ID, value: 2, response: null }],
    });

    const response = await trialEventsHandler(buildGetRequest(`session_id=${SESSION_ID}`));

    expect(response.status).toBe(200);
    expect(currentUserCanCaptureTrialEvent).toHaveBeenCalledWith(ACCESS_TOKEN, ORG_ID, CLIENT_ID);
    expect(fetchJson).toHaveBeenLastCalledWith(
      expect.stringContaining(`/rest/v1/trial_events?select=*&organization_id=eq.${ORG_ID}&session_id=eq.${SESSION_ID}`),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("rejects mixed session and target reads when they belong to different clients", async () => {
    const otherClientId = "77777777-7777-4777-8777-777777777777";
    mockTargetReadLookup();
    mockSessionReadLookup(otherClientId);

    const response = await trialEventsHandler(buildGetRequest(`session_id=${SESSION_ID}&target_id=${TARGET_ID}`));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "session_id and target_id must belong to the same client" });
    expect(currentUserCanCaptureTrialEvent).not.toHaveBeenCalled();
  });

  it("denies trial-event creation before insert when caller cannot capture data for the client", async () => {
    mockTargetAndSessionLookups();
    vi.mocked(currentUserCanCaptureTrialEvent).mockResolvedValue({ allowed: false, upstreamError: false });

    const response = await trialEventsHandler(buildPostRequest());

    expect(response.status).toBe(403);
    expect(currentUserCanCaptureTrialEvent).toHaveBeenCalledWith(ACCESS_TOKEN, ORG_ID, CLIENT_ID);
    expect(sessionHasLockedNote).not.toHaveBeenCalled();
    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(fetchJson).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("/rest/v1/goal_targets?"),
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          apikey: SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        }),
      }),
    );
    expect(fetchJson).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/rest/v1/sessions?"),
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          apikey: SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        }),
      }),
    );
  });

  it("rejects negative measurement values before scope lookups", async () => {
    const response = await trialEventsHandler(
      new Request("http://localhost/api/trial-events", {
        method: "POST",
        body: JSON.stringify({
          session_id: SESSION_ID,
          target_id: TARGET_ID,
          trial_number: 1,
          value: -1,
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid request body" });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("rejects value-based measurements without a numeric value", async () => {
    mockTargetAndSessionLookups("frequency");

    const response = await trialEventsHandler(
      new Request("http://localhost/api/trial-events", {
        method: "POST",
        body: JSON.stringify({
          session_id: SESSION_ID,
          target_id: TARGET_ID,
          trial_number: 1,
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "value is required for this target measurement type" });
    expect(currentUserCanCaptureTrialEvent).not.toHaveBeenCalled();
  });

  it("rejects standardized responses for value-based measurements", async () => {
    mockTargetAndSessionLookups("frequency");

    const response = await trialEventsHandler(
      new Request("http://localhost/api/trial-events", {
        method: "POST",
        body: JSON.stringify({
          session_id: SESSION_ID,
          target_id: TARGET_ID,
          trial_number: 1,
          response: "correct",
          value: 1,
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "response is not allowed for this target measurement type" });
    expect(currentUserCanCaptureTrialEvent).not.toHaveBeenCalled();
  });

  it("rejects numeric values for response-based measurements", async () => {
    mockTargetAndSessionLookups("correctIncorrect");

    const response = await trialEventsHandler(
      new Request("http://localhost/api/trial-events", {
        method: "POST",
        body: JSON.stringify({
          session_id: SESSION_ID,
          target_id: TARGET_ID,
          trial_number: 1,
          response: "correct",
          value: 1,
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "value is not allowed for this target measurement type" });
    expect(currentUserCanCaptureTrialEvent).not.toHaveBeenCalled();
  });

  it("returns 502 when trial-event capture access cannot be validated", async () => {
    mockTargetAndSessionLookups();
    vi.mocked(currentUserCanCaptureTrialEvent).mockResolvedValue({ allowed: false, upstreamError: true });

    const response = await trialEventsHandler(buildPostRequest());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Unable to validate trial-event capture access" });
    expect(sessionHasLockedNote).not.toHaveBeenCalled();
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it("returns a locked-session conflict before insert when caller cannot manage locked trial events", async () => {
    mockTargetAndSessionLookups();
    vi.mocked(currentUserCanCaptureTrialEvent).mockResolvedValue({ allowed: true, upstreamError: false });
    vi.mocked(sessionHasLockedNote).mockResolvedValue({ locked: true, upstreamError: false });
    vi.mocked(currentUserCanManageLockedTrialEvent).mockResolvedValue({ allowed: false, upstreamError: false });

    const response = await trialEventsHandler(buildPostRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Session is locked for trial-event changes" });
    expect(currentUserCanManageLockedTrialEvent).toHaveBeenCalledWith(ACCESS_TOKEN, ORG_ID);
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it("returns 502 when session lock state cannot be validated", async () => {
    mockTargetAndSessionLookups();
    vi.mocked(currentUserCanCaptureTrialEvent).mockResolvedValue({ allowed: true, upstreamError: false });
    vi.mocked(sessionHasLockedNote).mockResolvedValue({ locked: true, upstreamError: true });

    const response = await trialEventsHandler(buildPostRequest());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Unable to validate session lock state" });
    expect(currentUserCanManageLockedTrialEvent).not.toHaveBeenCalled();
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it("returns 502 when locked-session management access cannot be validated", async () => {
    mockTargetAndSessionLookups();
    vi.mocked(currentUserCanCaptureTrialEvent).mockResolvedValue({ allowed: true, upstreamError: false });
    vi.mocked(sessionHasLockedNote).mockResolvedValue({ locked: true, upstreamError: false });
    vi.mocked(currentUserCanManageLockedTrialEvent).mockResolvedValue({ allowed: false, upstreamError: true });

    const response = await trialEventsHandler(buildPostRequest());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Unable to validate locked-session trial-event access" });
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it("inserts a frequency trial event without a standardized response when capture and lock checks allow it", async () => {
    mockTargetAndSessionLookups();
    vi.mocked(currentUserCanCaptureTrialEvent).mockResolvedValue({ allowed: true, upstreamError: false });
    vi.mocked(sessionHasLockedNote).mockResolvedValue({ locked: false, upstreamError: false });
    vi.mocked(fetchJson).mockResolvedValueOnce({
      ok: true,
      status: 201,
      data: [{ id: "event-1", target_id: TARGET_ID, value: 3, response: null }],
    });

    const response = await trialEventsHandler(buildPostRequest());

    expect(response.status).toBe(201);
    expect(fetchJson).toHaveBeenCalledWith(
      "https://example.supabase.co/rest/v1/trial_events",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("\"value\":3"),
      }),
    );
  });

  it("returns a conflict response for duplicate trial numbers within a session target", async () => {
    mockTargetAndSessionLookups();
    vi.mocked(currentUserCanCaptureTrialEvent).mockResolvedValue({ allowed: true, upstreamError: false });
    vi.mocked(sessionHasLockedNote).mockResolvedValue({ locked: false, upstreamError: false });
    vi.mocked(fetchJson).mockResolvedValueOnce({
      ok: false,
      status: 409,
      data: { code: "23505" },
    });

    const response = await trialEventsHandler(buildPostRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "trial_number already exists for this session target" });
  });
});
