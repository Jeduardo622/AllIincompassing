import { beforeEach, describe, expect, it, vi } from "vitest";
import { trialEventsHandler } from "../api/trial-events";

vi.mock("../api/shared", async () => {
  const actual = await vi.importActual<typeof import("../api/shared")>("../api/shared");
  return {
    ...actual,
    currentUserCanManageLockedTrialEvent: vi.fn(),
    currentUserCanTakeClientData: vi.fn(),
    fetchAuthenticatedUserIdWithStatus: vi.fn(),
    fetchJson: vi.fn(),
    getAccessToken: vi.fn(),
    getSupabaseConfig: vi.fn(),
    resolveOrgAndRoleWithStatus: vi.fn(),
    sessionHasLockedNote: vi.fn(),
  };
});

import {
  currentUserCanManageLockedTrialEvent,
  currentUserCanTakeClientData,
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

const mockTargetAndSessionLookups = () => {
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
          measurement_type: "frequency",
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

describe("trialEventsHandler", () => {
  beforeEach(() => {
    vi.resetAllMocks();
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

  it("denies trial-event creation before insert when caller cannot capture data for the client", async () => {
    mockTargetAndSessionLookups();
    vi.mocked(currentUserCanTakeClientData).mockResolvedValue({ allowed: false, upstreamError: false });

    const response = await trialEventsHandler(buildPostRequest());

    expect(response.status).toBe(403);
    expect(currentUserCanTakeClientData).toHaveBeenCalledWith(ACCESS_TOKEN, ORG_ID, CLIENT_ID);
    expect(sessionHasLockedNote).not.toHaveBeenCalled();
    expect(fetchJson).toHaveBeenCalledTimes(2);
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

  it("returns 502 when trial-event capture access cannot be validated", async () => {
    mockTargetAndSessionLookups();
    vi.mocked(currentUserCanTakeClientData).mockResolvedValue({ allowed: false, upstreamError: true });

    const response = await trialEventsHandler(buildPostRequest());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Unable to validate trial-event capture access" });
    expect(sessionHasLockedNote).not.toHaveBeenCalled();
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it("returns a locked-session conflict before insert when caller cannot manage locked trial events", async () => {
    mockTargetAndSessionLookups();
    vi.mocked(currentUserCanTakeClientData).mockResolvedValue({ allowed: true, upstreamError: false });
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
    vi.mocked(currentUserCanTakeClientData).mockResolvedValue({ allowed: true, upstreamError: false });
    vi.mocked(sessionHasLockedNote).mockResolvedValue({ locked: true, upstreamError: true });

    const response = await trialEventsHandler(buildPostRequest());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Unable to validate session lock state" });
    expect(currentUserCanManageLockedTrialEvent).not.toHaveBeenCalled();
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it("returns 502 when locked-session management access cannot be validated", async () => {
    mockTargetAndSessionLookups();
    vi.mocked(currentUserCanTakeClientData).mockResolvedValue({ allowed: true, upstreamError: false });
    vi.mocked(sessionHasLockedNote).mockResolvedValue({ locked: true, upstreamError: false });
    vi.mocked(currentUserCanManageLockedTrialEvent).mockResolvedValue({ allowed: false, upstreamError: true });

    const response = await trialEventsHandler(buildPostRequest());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Unable to validate locked-session trial-event access" });
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it("inserts a frequency trial event without a standardized response when capture and lock checks allow it", async () => {
    mockTargetAndSessionLookups();
    vi.mocked(currentUserCanTakeClientData).mockResolvedValue({ allowed: true, upstreamError: false });
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
    vi.mocked(currentUserCanTakeClientData).mockResolvedValue({ allowed: true, upstreamError: false });
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
