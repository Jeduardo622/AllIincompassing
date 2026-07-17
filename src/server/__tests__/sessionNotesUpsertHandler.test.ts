import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionGoalMeasurementEntry } from "../../types";
import { sessionNotesUpsertHandler, validateFinalizationTargetVersions } from "../api/session-notes-upsert";
import { finalizeBtAbaSessionNote, getBtAbaSessionNote, saveBtAbaSessionNoteDraft } from "../../lib/session-notes";

vi.mock("../api/shared", async () => {
  const actual = await vi.importActual<typeof import("../api/shared")>("../api/shared");
  return {
    ...actual,
    getAccessToken: vi.fn(),
    resolveOrgAndRoleWithStatus: vi.fn(),
    fetchAuthenticatedUserIdWithStatus: vi.fn(),
    currentUserCanCaptureTrialEvent: vi.fn(),
    currentUserCanTakeClientData: vi.fn(),
    currentUserIsBcbaForOrg: vi.fn(),
    getSupabaseConfig: vi.fn(),
    fetchJson: vi.fn(),
  };
});

vi.mock("../sessionCaptureBillingGate", () => ({
  resolveSessionCaptureStrictBillingPolicy: vi.fn(),
}));

vi.mock("../../lib/api", () => ({ callApi: vi.fn() }));

import {
  currentUserCanCaptureTrialEvent,
  currentUserCanTakeClientData,
  currentUserIsBcbaForOrg,
  fetchAuthenticatedUserIdWithStatus,
  fetchJson,
  getAccessToken,
  getSupabaseConfig,
  resolveOrgAndRoleWithStatus,
} from "../api/shared";
import { resolveSessionCaptureStrictBillingPolicy } from "../sessionCaptureBillingGate";
import { callApi } from "../../lib/api";

const ACCESS_TOKEN = "token-123";
const BASE_URL = "https://example.supabase.co";
const HEADERS = { Authorization: `Bearer ${ACCESS_TOKEN}` };
const ORIGINAL_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const basePayload = {
  sessionId: "77777777-7777-4777-8777-777777777777",
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
      data: { metric_value: 4, opportunities: 5, note: "  measured  ", target: "  Match peer greeting in 4/5 trials  " },
    },
    "55555555-5555-4555-8555-555555555555": {
      data: { note: "   " },
    },
  },
  narrative: "  Session narrative  ",
  isLocked: false,
};

const targetId = "88888888-8888-4888-8888-888888888888";

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
        target: "Match peer greeting in 4/5 trials",
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
  it.each([
    { events: [{ target_id: "a" }], expected: null, label: "absent" },
    { events: [{ target_id: "a", expected_progression_version: 1 }, { target_id: "b" }], expected: null, label: "partial" },
    { events: [{ target_id: "a", expected_progression_version: 1 }, { target_id: "a", expected_progression_version: 2 }], expected: null, label: "conflicting duplicate" },
    { events: [{ target_id: "a", expected_progression_version: Number.POSITIVE_INFINITY }], expected: null, label: "nonfinite" },
    { events: [{ target_id: "a", expected_progression_version: -1 }], expected: null, label: "negative" },
  ])("rejects $label first-finalization target versions", ({ events, expected }) => {
    expect(validateFinalizationTargetVersions(events)).toBe(expected);
  });

  it("returns exactly one version per distinct target", () => {
    expect(validateFinalizationTargetVersions([
      { target_id: "a", expected_progression_version: 1 },
      { target_id: "a", expected_progression_version: 1 },
      { target_id: "b", expected_progression_version: 3 },
    ])).toEqual([{ target_id: "a", progression_version: 1 }, { target_id: "b", progression_version: 3 }]);
  });
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(resolveSessionCaptureStrictBillingPolicy).mockResolvedValue({ strict: true, upstreamError: false });
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
    vi.mocked(currentUserCanCaptureTrialEvent).mockResolvedValue({
      allowed: true,
      upstreamError: false,
    });
    vi.mocked(currentUserCanTakeClientData).mockResolvedValue({
      allowed: false,
      upstreamError: false,
    });
    vi.mocked(currentUserIsBcbaForOrg).mockResolvedValue({
      allowed: false,
      upstreamError: false,
    });
    vi.mocked(getSupabaseConfig).mockReturnValue({
      supabaseUrl: BASE_URL,
      anonKey: "anon-key",
    });
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  });

  const validBtAbaResponses = {
    purpose_of_session: ["RBT/BT worked on goals as stated in the treatment plan"],
    client_status: "Client arrived ready to participate.",
    skill_strategies: ["Natural environment teaching"],
    behavior_strategies: ["Visual supports"],
    supervisor_support: ["Supervisor did not attend this session"],
    progress_toward_goals: "Client made progress on the selected goals.",
    client_response_to_treatment: "Client responded positively to treatment.",
    data_point_scope: "linked" as const,
    link_unlinked_data: false,
    bt_signature: { method: "typed" as const, value: "Behavior Technician" },
  };

  const validBtAbaNotePayload = {
    goals_addressed: ["Goal A"],
    goal_ids: basePayload.goalIds,
    goal_measurements: basePayload.goalMeasurements,
    goal_notes: basePayload.goalNotes,
    narrative: basePayload.narrative,
  };

  const arrangeAssignedBtSession = (rpcResult: { ok: boolean; status: number; data: unknown }) => {
    vi.mocked(resolveOrgAndRoleWithStatus).mockResolvedValue({
      organizationId: "org-1",
      isTherapist: false,
      isAdmin: false,
      isOrgMember: false,
      isSuperAdmin: false,
      upstreamError: false,
    });
    vi.mocked(fetchAuthenticatedUserIdWithStatus).mockResolvedValue({
      userId: basePayload.therapistId,
      upstreamError: false,
    });
    vi.mocked(fetchJson).mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/rest/v1/sessions?")) {
        return {
          ok: true,
          status: 200,
          data: [{
            id: basePayload.sessionId,
            organization_id: "org-1",
            client_id: basePayload.clientId,
            therapist_id: basePayload.therapistId,
            status: "in_progress",
          }],
        };
      }
      if (requestUrl.includes("/rest/v1/rpc/get_bt_aba_session_note")) {
        return {
          ok: true,
          status: 200,
          data: {
            note_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            template_id: "66666666-6666-4666-8666-666666666666",
            responses: validBtAbaResponses,
            status: "draft",
          },
        };
      }
      if (requestUrl.includes("/rest/v1/rpc/")) {
        return rpcResult;
      }
      return { ok: true, status: 200, data: [] };
    });
  };

  it("rejects a malformed BT ABA action payload before calling a write RPC", async () => {
    vi.mocked(resolveOrgAndRoleWithStatus).mockResolvedValue({
      organizationId: "org-1", isTherapist: false, isAdmin: false, isOrgMember: false, isSuperAdmin: false, upstreamError: false,
    });
    const response = await sessionNotesUpsertHandler(new Request("http://localhost/api/session-notes/upsert", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ action: "draft_bt_aba", sessionId: "not-a-uuid" }),
    }));

    expect(response.status).toBe(400);
    expect(vi.mocked(fetchJson).mock.calls.some(([url]) => String(url).includes("/rest/v1/rpc/"))).toBe(false);
  });

  it("rejects an unrelated BT without calling a write RPC", async () => {
    vi.mocked(resolveOrgAndRoleWithStatus).mockResolvedValue({
      organizationId: "org-1", isTherapist: false, isAdmin: false, isOrgMember: false, isSuperAdmin: false, upstreamError: false,
    });
    vi.mocked(fetchJson).mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/rest/v1/sessions?")) {
        return {
          ok: true,
          status: 200,
          data: [{
            id: basePayload.sessionId,
            organization_id: "org-1",
            client_id: basePayload.clientId,
            therapist_id: "99999999-9999-4999-8999-999999999999",
            status: "in_progress",
          }],
        };
      }
      if (requestUrl.includes("/rest/v1/rpc/get_bt_aba_session_note")) {
        return { ok: false, status: 403, data: { code: "42501", message: "caller is not the assigned BT" } };
      }
      return { ok: true, status: 200, data: [] };
    });

    const response = await sessionNotesUpsertHandler(new Request("http://localhost/api/session-notes/upsert", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({
        action: "draft_bt_aba",
        sessionId: basePayload.sessionId,
        templateId: "66666666-6666-4666-8666-666666666666",
        notePayload: validBtAbaNotePayload,
        responses: validBtAbaResponses,
      }),
    }));

    expect(response.status).toBe(403);
    expect(vi.mocked(fetchJson).mock.calls.some(([url]) => String(url).includes("/rpc/get_bt_aba_session_note"))).toBe(true);
    expect(vi.mocked(fetchJson).mock.calls.some(([url]) => String(url).includes("/rpc/save_bt_aba_session_note_draft"))).toBe(false);
  });

  it("saves a BT ABA draft through the protected RPC", async () => {
    arrangeAssignedBtSession({ ok: true, status: 200, data: { status: "draft", note_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } });

    const response = await sessionNotesUpsertHandler(new Request("http://localhost/api/session-notes/upsert", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({
        action: "draft_bt_aba",
        sessionId: basePayload.sessionId,
        templateId: "66666666-6666-4666-8666-666666666666",
        notePayload: validBtAbaNotePayload,
        responses: validBtAbaResponses,
      }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "draft", noteId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    expect(fetchJson).toHaveBeenCalledWith(`${BASE_URL}/rest/v1/rpc/save_bt_aba_session_note_draft`, expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: `Bearer ${ACCESS_TOKEN}` }),
    }));
  });

  it("recognizes an assigned BT through the canonical user-therapist link", async () => {
    vi.mocked(resolveOrgAndRoleWithStatus).mockResolvedValue({
      organizationId: "org-1", isTherapist: false, isAdmin: false, isOrgMember: false, isSuperAdmin: false, upstreamError: false,
    });
    vi.mocked(fetchJson).mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/rest/v1/sessions?")) {
        return {
          ok: true,
          status: 200,
          data: [{
            id: basePayload.sessionId,
            organization_id: "org-1",
            client_id: basePayload.clientId,
            therapist_id: basePayload.therapistId,
            status: "in_progress",
          }],
        };
      }
      if (requestUrl.includes("/rest/v1/rpc/get_bt_aba_session_note")) {
        return { ok: true, status: 200, data: {
          note_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          template_id: "66666666-6666-4666-8666-666666666666",
          responses: validBtAbaResponses,
          status: "draft",
        } };
      }
      if (requestUrl.includes("/rest/v1/rpc/save_bt_aba_session_note_draft")) {
        return { ok: true, status: 200, data: { status: "draft", note_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } };
      }
      return { ok: true, status: 200, data: [] };
    });

    const response = await sessionNotesUpsertHandler(new Request("http://localhost/api/session-notes/upsert", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({
        action: "draft_bt_aba",
        sessionId: basePayload.sessionId,
        templateId: "66666666-6666-4666-8666-666666666666",
        notePayload: validBtAbaNotePayload,
        responses: validBtAbaResponses,
      }),
    }));

    expect(response.status).toBe(200);
    expect(vi.mocked(fetchJson).mock.calls.some(([url]) => String(url).includes("user_therapist_links"))).toBe(false);
    expect(fetchJson).toHaveBeenCalledWith(`${BASE_URL}/rest/v1/rpc/get_bt_aba_session_note`, expect.any(Object));
  });

  it("returns completed only after the BT ABA finalization RPC succeeds", async () => {
    arrangeAssignedBtSession({
      ok: true,
      status: 200,
      data: {
        status: "completed",
        note_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        note: buildSessionNoteRow("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
        progression_results: [],
      },
    });

    const response = await sessionNotesUpsertHandler(new Request("http://localhost/api/session-notes/upsert", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({
        action: "finalize_bt_aba",
        sessionId: basePayload.sessionId,
        noteId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        notePayload: validBtAbaNotePayload,
        responses: validBtAbaResponses,
        trialEvents: [{
          target_id: targetId,
          trial_number: 1,
          response: "correct",
          expected_progression_version: 7,
        }],
        expectedTargetVersions: [{ target_id: targetId, progression_version: 7 }],
      }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "completed",
      noteId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      progressionResults: [],
    });
    const finalizeCall = vi.mocked(fetchJson).mock.calls.find(([url]) => String(url).includes("/rpc/finalize_bt_aba_session_note"));
    expect(JSON.parse(String(finalizeCall?.[1]?.body))).toMatchObject({
      p_trial_events: [{ target_id: targetId, expected_progression_version: 7 }],
    });
  });

  it("does not return an optimistic completed result when BT ABA finalization fails", async () => {
    arrangeAssignedBtSession({ ok: false, status: 409, data: { code: "23514", message: "session cannot be finalized" } });

    const response = await sessionNotesUpsertHandler(new Request("http://localhost/api/session-notes/upsert", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({
        action: "finalize_bt_aba",
        sessionId: basePayload.sessionId,
        noteId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        notePayload: validBtAbaNotePayload,
        responses: validBtAbaResponses,
        trialEvents: [],
        expectedTargetVersions: [],
      }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.not.toMatchObject({ status: "completed" });
  });

  it("loads, drafts, and finalizes BT ABA notes through the session-note API boundary", async () => {
    vi.mocked(callApi)
      .mockResolvedValueOnce(new Response(JSON.stringify({ noteId: null, templateId: null, responses: null, status: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "draft", noteId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "completed", noteId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", progressionResults: [] }), { status: 200 }));

    await expect(getBtAbaSessionNote(basePayload.sessionId)).resolves.toMatchObject({ noteId: null });
    await expect(saveBtAbaSessionNoteDraft({
      sessionId: basePayload.sessionId,
      templateId: "66666666-6666-4666-8666-666666666666",
      notePayload: validBtAbaNotePayload,
      responses: validBtAbaResponses,
    })).resolves.toEqual({ status: "draft", noteId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    await expect(finalizeBtAbaSessionNote({
      sessionId: basePayload.sessionId,
      noteId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      notePayload: validBtAbaNotePayload,
      responses: validBtAbaResponses,
      trialEvents: [],
      expectedTargetVersions: [],
    })).resolves.toMatchObject({ status: "completed" });

    expect(callApi).toHaveBeenNthCalledWith(1, `/api/session-notes/upsert?sessionId=${basePayload.sessionId}`, { method: "GET" });
    expect(JSON.parse(String(vi.mocked(callApi).mock.calls[1]?.[1]?.body))).toMatchObject({ action: "draft_bt_aba" });
    expect(JSON.parse(String(vi.mocked(callApi).mock.calls[2]?.[1]?.body))).toMatchObject({ action: "finalize_bt_aba" });
  });

  it("loads a durable BT ABA draft only for the assigned BT", async () => {
    vi.mocked(resolveOrgAndRoleWithStatus).mockResolvedValue({
      organizationId: "org-1", isTherapist: false, isAdmin: false, isOrgMember: false, isSuperAdmin: false, upstreamError: false,
    });
    vi.mocked(fetchAuthenticatedUserIdWithStatus).mockResolvedValue({
      userId: basePayload.therapistId,
      upstreamError: false,
    });
    vi.mocked(fetchJson).mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/rest/v1/sessions?")) {
        return { ok: true, status: 200, data: [{
          id: basePayload.sessionId,
          organization_id: "org-1",
          client_id: basePayload.clientId,
          therapist_id: basePayload.therapistId,
          status: "in_progress",
        }] };
      }
      if (requestUrl.includes("/rest/v1/rpc/get_bt_aba_session_note")) {
        return { ok: true, status: 200, data: {
          note_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          template_id: "66666666-6666-4666-8666-666666666666",
          responses: validBtAbaResponses,
          status: "draft",
        } };
      }
      return { ok: true, status: 200, data: [] };
    });

    const response = await sessionNotesUpsertHandler(new Request(
      `http://localhost/api/session-notes/upsert?sessionId=${basePayload.sessionId}`,
      { method: "GET", headers: HEADERS },
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      noteId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      templateId: "66666666-6666-4666-8666-666666666666",
      status: "draft",
    });
    expect(fetchJson).toHaveBeenCalledWith(`${BASE_URL}/rest/v1/rpc/get_bt_aba_session_note`, expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: `Bearer ${ACCESS_TOKEN}` }),
      body: JSON.stringify({ p_session_id: basePayload.sessionId }),
    }));
    expect(vi.mocked(fetchJson).mock.calls.filter(([url]) => String(url).includes("/rpc/get_bt_aba_session_note"))).toHaveLength(1);
  });

  it("keeps the legacy upsert forbidden for a caller without a legacy session-note role", async () => {
    vi.mocked(resolveOrgAndRoleWithStatus).mockResolvedValue({
      organizationId: "org-1", isTherapist: false, isAdmin: false, isOrgMember: false, isSuperAdmin: false, upstreamError: false,
    });

    const response = await sessionNotesUpsertHandler(new Request("http://localhost/api/session-notes/upsert", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify(basePayload),
    }));

    expect(response.status).toBe(403);
    expect(fetchAuthenticatedUserIdWithStatus).not.toHaveBeenCalled();
  });

  it("passes a valid assigned-BT legacy capture through the role gate before actor validation", async () => {
    vi.mocked(resolveOrgAndRoleWithStatus).mockResolvedValue({
      organizationId: "org-1", isTherapist: false, isAdmin: false, isOrgMember: false, isSuperAdmin: false, upstreamError: false,
    });
    vi.mocked(currentUserCanTakeClientData).mockResolvedValue({ allowed: true, upstreamError: false });
    vi.mocked(fetchAuthenticatedUserIdWithStatus).mockResolvedValue({ userId: null, upstreamError: false });

    const response = await sessionNotesUpsertHandler(new Request("http://localhost/api/session-notes/upsert", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify(basePayload),
    }));

    expect(response.status).toBe(403);
    expect(currentUserCanTakeClientData).toHaveBeenCalledWith(ACCESS_TOKEN, "org-1", basePayload.clientId);
    expect(currentUserIsBcbaForOrg).not.toHaveBeenCalled();
    expect(fetchAuthenticatedUserIdWithStatus).toHaveBeenCalledWith(ACCESS_TOKEN);
  });

  it("fails closed when assigned-client capability resolution has an upstream error", async () => {
    vi.mocked(resolveOrgAndRoleWithStatus).mockResolvedValue({
      organizationId: "org-1", isTherapist: false, isAdmin: false, isOrgMember: false, isSuperAdmin: false, upstreamError: false,
    });
    vi.mocked(currentUserCanTakeClientData).mockResolvedValue({ allowed: false, upstreamError: true });

    const response = await sessionNotesUpsertHandler(new Request("http://localhost/api/session-notes/upsert", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify(basePayload),
    }));

    expect(response.status).toBe(502);
    expect(currentUserIsBcbaForOrg).not.toHaveBeenCalled();
    expect(fetchAuthenticatedUserIdWithStatus).not.toHaveBeenCalled();
  });

  it("does not invoke assigned-client capability for an unknown action payload", async () => {
    vi.mocked(resolveOrgAndRoleWithStatus).mockResolvedValue({
      organizationId: "org-1", isTherapist: false, isAdmin: false, isOrgMember: false, isSuperAdmin: false, upstreamError: false,
    });
    vi.mocked(currentUserCanTakeClientData).mockResolvedValue({ allowed: false, upstreamError: true });

    const response = await sessionNotesUpsertHandler(new Request("http://localhost/api/session-notes/upsert", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ ...basePayload, action: "unknown" }),
    }));

    expect(response.status).toBe(403);
    expect(currentUserCanTakeClientData).not.toHaveBeenCalled();
    expect(currentUserIsBcbaForOrg).toHaveBeenCalledWith(ACCESS_TOKEN, "org-1");
    expect(fetchAuthenticatedUserIdWithStatus).not.toHaveBeenCalled();
  });

  it("admits an organization-scoped BCBA through the session-note authorization gate", async () => {
    vi.mocked(resolveOrgAndRoleWithStatus).mockResolvedValue({
      organizationId: "org-1",
      isTherapist: false,
      isAdmin: false,
      isOrgMember: false,
      isSuperAdmin: false,
      upstreamError: false,
    });
    vi.mocked(currentUserIsBcbaForOrg).mockResolvedValue({ allowed: true, upstreamError: false });

    const response = await sessionNotesUpsertHandler(new Request("http://localhost/api/session-notes/upsert", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({}),
    }));

    expect(response.status).toBe(400);
    expect(currentUserIsBcbaForOrg).toHaveBeenCalledWith(ACCESS_TOKEN, "org-1");
    expect(fetchAuthenticatedUserIdWithStatus).toHaveBeenCalledWith(ACCESS_TOKEN);
  });

  it("fails closed when BCBA role resolution has an upstream error", async () => {
    vi.mocked(resolveOrgAndRoleWithStatus).mockResolvedValue({
      organizationId: "org-1",
      isTherapist: false,
      isAdmin: false,
      isOrgMember: false,
      isSuperAdmin: false,
      upstreamError: false,
    });
    vi.mocked(currentUserIsBcbaForOrg).mockResolvedValue({ allowed: false, upstreamError: true });

    const response = await sessionNotesUpsertHandler(new Request("http://localhost/api/session-notes/upsert", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({}),
    }));

    expect(response.status).toBe(502);
    expect(fetchAuthenticatedUserIdWithStatus).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("preserves forbidden for users without an existing session-note role or BCBA authority", async () => {
    vi.mocked(resolveOrgAndRoleWithStatus).mockResolvedValue({
      organizationId: "org-1",
      isTherapist: false,
      isAdmin: false,
      isOrgMember: false,
      isSuperAdmin: false,
      upstreamError: false,
    });

    const response = await sessionNotesUpsertHandler(new Request("http://localhost/api/session-notes/upsert", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({}),
    }));

    expect(response.status).toBe(403);
    expect(currentUserIsBcbaForOrg).toHaveBeenCalledWith(ACCESS_TOKEN, "org-1");
    expect(fetchAuthenticatedUserIdWithStatus).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("does not make existing allowed roles depend on BCBA role resolution", async () => {
    const response = await sessionNotesUpsertHandler(new Request("http://localhost/api/session-notes/upsert", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({}),
    }));

    expect(response.status).toBe(400);
    expect(currentUserIsBcbaForOrg).not.toHaveBeenCalled();
  });

  afterEach(() => {
    if (typeof ORIGINAL_SERVICE_ROLE_KEY === "string") {
      process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_SERVICE_ROLE_KEY;
    } else {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    }
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
              targets: ["Match peer greeting in 4/5 trials"],
              target: "Match peer greeting in 4/5 trials",
              target_trials: [
                {
                  target: "Match peer greeting in 4/5 trials",
                  metric_value: 4,
                  incorrect_trials: null,
                  opportunities: 5,
                  trial_prompt_note: null,
                },
              ],
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

  it("rejects goal measurements when correct trials exceed opportunities", async () => {
    const fetchJsonMock = vi.mocked(fetchJson);
    let noteWriteCount = 0;
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
        noteWriteCount += 1;
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });

    const response = await sessionNotesUpsertHandler(
      new Request("http://localhost/api/session-notes/upsert", {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({
          ...basePayload,
          goalMeasurements: {
            [basePayload.goalIds[0]]: {
              data: {
                metric_value: 8,
                opportunities: 7,
                target: "Playwright smoke target",
              },
            },
          },
        }),
      }),
    );
    const payload = await response.json() as { code?: string; error?: string };

    expect(response.status).toBe(400);
    expect(payload.code).toBe("validation_error");
    expect(payload.error).toBe("Correct trials cannot exceed opportunities.");
    expect(noteWriteCount).toBe(0);
  });

  it("rejects target-trial measurements when correct trials exceed opportunities", async () => {
    const fetchJsonMock = vi.mocked(fetchJson);
    let noteWriteCount = 0;
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
        noteWriteCount += 1;
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });

    const response = await sessionNotesUpsertHandler(
      new Request("http://localhost/api/session-notes/upsert", {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({
          ...basePayload,
          goalMeasurements: {
            [basePayload.goalIds[0]]: {
              data: {
                targets: ["Playwright smoke target"],
                target_trials: [{
                  target: "Playwright smoke target",
                  metric_value: 8,
                  opportunities: 7,
                }],
              },
            },
          },
        }),
      }),
    );
    const payload = await response.json() as { code?: string; error?: string };

    expect(response.status).toBe(400);
    expect(payload.code).toBe("validation_error");
    expect(payload.error).toBe("Correct trials cannot exceed opportunities.");
    expect(noteWriteCount).toBe(0);
  });

  it("allows percent and duration measurements when metric values exceed opportunities", async () => {
    const fetchJsonMock = vi.mocked(fetchJson);
    const durationGoalId = "66666666-6666-4666-8666-666666666666";
    let noteWriteCount = 0;
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
        noteWriteCount += 1;
        const parsedBody = JSON.parse(String(init.body)) as {
          goal_measurements?: Record<string, SessionGoalMeasurementEntry>;
        };
        expect(parsedBody.goal_measurements?.[basePayload.goalIds[0]]?.data).toEqual(
          expect.objectContaining({
            measurement_type: "percent accuracy",
            metric_label: "Percent",
            metric_unit: "%",
            metric_value: 80,
            opportunities: 10,
          }),
        );
        expect(parsedBody.goal_measurements?.[durationGoalId]?.data).toEqual(
          expect.objectContaining({
            measurement_type: "duration",
            metric_label: "Duration",
            metric_unit: "minutes",
            metric_value: 60,
            opportunities: 1,
          }),
        );
        return { ok: true, status: 201, data: [{ id: "note-percent-duration" }] };
      }
      if (requestUrl.includes("select=id%2Cauthorization_id") && requestUrl.includes("id=eq.note-percent-duration")) {
        return { ok: true, status: 200, data: [buildSessionNoteRow("note-percent-duration")] };
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });

    const response = await sessionNotesUpsertHandler(
      new Request("http://localhost/api/session-notes/upsert", {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({
          ...basePayload,
          goalIds: [basePayload.goalIds[0], durationGoalId],
          goalsAddressed: ["Percent goal", "Duration goal"],
          goalMeasurements: {
            [basePayload.goalIds[0]]: {
              data: {
                measurement_type: "percent accuracy",
                metric_label: "Percent",
                metric_unit: "%",
                metric_value: 80,
                opportunities: 10,
              },
            },
            [durationGoalId]: {
              data: {
                measurement_type: "duration",
                metric_label: "Duration",
                metric_unit: "minutes",
                metric_value: 60,
                opportunities: 1,
              },
            },
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(noteWriteCount).toBe(1);
  });

  it("persists explicit raw trial events before saving the session note", async () => {
    const fetchJsonMock = vi.mocked(fetchJson);
    let trialEventsPostCount = 0;
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
        return { ok: true, status: 201, data: [{ id: "note-with-events" }] };
      }
      if (requestUrl.includes("/rest/v1/goal_targets?")) {
        return {
          ok: true,
          status: 200,
          data: [{
            id: targetId,
            organization_id: "org-1",
            client_id: basePayload.clientId,
            goal_id: basePayload.goalIds[0],
            measurement_type: "correctIncorrect",
          }],
        };
      }
      if (requestUrl.includes("/rest/v1/sessions?")) {
        return {
          ok: true,
          status: 200,
          data: [{
            id: basePayload.sessionId,
            organization_id: "org-1",
            client_id: basePayload.clientId,
            therapist_id: basePayload.therapistId,
          }],
        };
      }
      if (requestUrl.includes("/rest/v1/trial_events") && init?.method === "GET") {
        return { ok: true, status: 200, data: [] };
      }
      if (requestUrl.includes("/rest/v1/trial_events") && init?.method === "POST") {
        trialEventsPostCount += 1;
        const parsedBody = JSON.parse(String(init.body)) as Array<Record<string, unknown>>;
        expect(requestUrl).toBe(`${BASE_URL}/rest/v1/trial_events`);
        expect(init.headers).toEqual(expect.objectContaining({
          Prefer: "return=minimal",
        }));
        expect(parsedBody).toEqual([
          expect.objectContaining({
            organization_id: "org-1",
            client_id: basePayload.clientId,
            session_id: basePayload.sessionId,
            target_id: targetId,
            goal_id: basePayload.goalIds[0],
            therapist_id: basePayload.therapistId,
            trial_number: 1,
            response: "correct",
            prompt_level: "independent",
            value: null,
            metadata: { source: "schedule_capture", progression_version_at_capture: 7 },
            created_by: "actor-1",
          }),
          expect.objectContaining({
            trial_number: 2,
            response: "incorrect",
            prompt_level: "gestural",
          }),
        ]);
        return { ok: true, status: 201, data: [] };
      }
      if (requestUrl.includes("select=id%2Cauthorization_id") && requestUrl.includes("id=eq.note-with-events")) {
        return { ok: true, status: 200, data: [buildSessionNoteRow("note-with-events")] };
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });

    const response = await sessionNotesUpsertHandler(
      new Request("http://localhost/api/session-notes/upsert", {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({
          ...basePayload,
          trialEvents: [
            {
              target_id: targetId,
              trial_number: 1,
              response: "correct",
              prompt_level: "independent",
              metadata: { source: "schedule_capture" },
              expected_progression_version: 7,
            },
            {
              target_id: targetId,
              trial_number: 2,
              response: "incorrect",
              prompt_level: "gestural",
              expected_progression_version: 7,
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(trialEventsPostCount).toBe(1);
  });

  it("persists numeric raw trial values for duration targets before saving the session note", async () => {
    const fetchJsonMock = vi.mocked(fetchJson);
    let trialEventsPostCount = 0;
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
        return { ok: true, status: 201, data: [{ id: "note-with-duration-event" }] };
      }
      if (requestUrl.includes("/rest/v1/goal_targets?")) {
        return {
          ok: true,
          status: 200,
          data: [{
            id: targetId,
            organization_id: "org-1",
            client_id: basePayload.clientId,
            goal_id: basePayload.goalIds[0],
            measurement_type: "duration",
          }],
        };
      }
      if (requestUrl.includes("/rest/v1/sessions?")) {
        return {
          ok: true,
          status: 200,
          data: [{
            id: basePayload.sessionId,
            organization_id: "org-1",
            client_id: basePayload.clientId,
            therapist_id: basePayload.therapistId,
          }],
        };
      }
      if (requestUrl.includes("/rest/v1/trial_events") && init?.method === "GET") {
        return { ok: true, status: 200, data: [] };
      }
      if (requestUrl.includes("/rest/v1/trial_events") && init?.method === "POST") {
        trialEventsPostCount += 1;
        const parsedBody = JSON.parse(String(init.body)) as Array<Record<string, unknown>>;
        expect(parsedBody).toEqual([
          expect.objectContaining({
            organization_id: "org-1",
            client_id: basePayload.clientId,
            session_id: basePayload.sessionId,
            target_id: targetId,
            goal_id: basePayload.goalIds[0],
            therapist_id: basePayload.therapistId,
            trial_number: 1,
            response: null,
            value: 12.5,
            created_by: "actor-1",
          }),
        ]);
        return { ok: true, status: 201, data: [] };
      }
      if (requestUrl.includes("select=id%2Cauthorization_id") && requestUrl.includes("id=eq.note-with-duration-event")) {
        return { ok: true, status: 200, data: [buildSessionNoteRow("note-with-duration-event")] };
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });

    const response = await sessionNotesUpsertHandler(
      new Request("http://localhost/api/session-notes/upsert", {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({
          ...basePayload,
          trialEvents: [{
            target_id: targetId,
            trial_number: 1,
            value: 12.5,
            metadata: { source: "schedule_capture" },
          }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(trialEventsPostCount).toBe(1);
  });

  it("persists task-analysis raw trial responses before saving the session note", async () => {
    const fetchJsonMock = vi.mocked(fetchJson);
    let trialEventsPostCount = 0;
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
        return { ok: true, status: 201, data: [{ id: "note-with-task-analysis-events" }] };
      }
      if (requestUrl.includes("/rest/v1/goal_targets?")) {
        return {
          ok: true,
          status: 200,
          data: [{
            id: targetId,
            organization_id: "org-1",
            client_id: basePayload.clientId,
            goal_id: basePayload.goalIds[0],
            measurement_type: "taskAnalysis",
          }],
        };
      }
      if (requestUrl.includes("/rest/v1/sessions?")) {
        return {
          ok: true,
          status: 200,
          data: [{
            id: basePayload.sessionId,
            organization_id: "org-1",
            client_id: basePayload.clientId,
            therapist_id: basePayload.therapistId,
          }],
        };
      }
      if (requestUrl.includes("/rest/v1/trial_events") && init?.method === "GET") {
        return { ok: true, status: 200, data: [] };
      }
      if (requestUrl.includes("/rest/v1/trial_events") && init?.method === "POST") {
        trialEventsPostCount += 1;
        const parsedBody = JSON.parse(String(init.body)) as Array<Record<string, unknown>>;
        expect(parsedBody).toEqual([
          expect.objectContaining({
            target_id: targetId,
            goal_id: basePayload.goalIds[0],
            trial_number: 1,
            response: "independent",
            value: null,
            created_by: "actor-1",
          }),
          expect.objectContaining({
            target_id: targetId,
            goal_id: basePayload.goalIds[0],
            trial_number: 2,
            response: "prompted",
            value: null,
          }),
        ]);
        return { ok: true, status: 201, data: [] };
      }
      if (requestUrl.includes("select=id%2Cauthorization_id") && requestUrl.includes("id=eq.note-with-task-analysis-events")) {
        return { ok: true, status: 200, data: [buildSessionNoteRow("note-with-task-analysis-events")] };
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });

    const response = await sessionNotesUpsertHandler(
      new Request("http://localhost/api/session-notes/upsert", {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({
          ...basePayload,
          trialEvents: [
            {
              target_id: targetId,
              trial_number: 1,
              response: "independent",
              metadata: { source: "schedule_capture" },
            },
            {
              target_id: targetId,
              trial_number: 2,
              response: "prompted",
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(trialEventsPostCount).toBe(1);
  });

  it("rejects raw trial events outside the saved goal scope", async () => {
    const fetchJsonMock = vi.mocked(fetchJson);
    let noteWriteCount = 0;
    let trialEventsPostCount = 0;
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
      if (requestUrl.includes("/rest/v1/sessions?")) {
        return {
          ok: true,
          status: 200,
          data: [{
            id: basePayload.sessionId,
            organization_id: "org-1",
            client_id: basePayload.clientId,
            therapist_id: basePayload.therapistId,
          }],
        };
      }
      if (requestUrl.includes("/rest/v1/goal_targets?")) {
        return {
          ok: true,
          status: 200,
          data: [{
            id: targetId,
            organization_id: "org-1",
            client_id: basePayload.clientId,
            goal_id: "55555555-5555-4555-8555-555555555555",
            measurement_type: "correctIncorrect",
          }],
        };
      }
      if (requestUrl.endsWith("/rest/v1/client_session_notes") && init?.method === "POST") {
        noteWriteCount += 1;
      }
      if (requestUrl.includes("/rest/v1/trial_events") && init?.method === "POST") {
        trialEventsPostCount += 1;
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });

    const response = await sessionNotesUpsertHandler(
      new Request("http://localhost/api/session-notes/upsert", {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({
          ...basePayload,
          trialEvents: [{
            target_id: targetId,
            trial_number: 1,
            response: "correct",
          }],
        }),
      }),
    );
    const body = await response.json() as { error?: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("Trial-event target is outside the saved goal scope.");
    expect(noteWriteCount).toBe(0);
    expect(trialEventsPostCount).toBe(0);
  });

  it("rolls back raw trial events when session note creation fails", async () => {
    const fetchJsonMock = vi.mocked(fetchJson);
    let trialEventsPostCount = 0;
    let trialEventsDeleteCount = 0;
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
      if (requestUrl.includes("/rest/v1/goal_targets?")) {
        return {
          ok: true,
          status: 200,
          data: [{
            id: targetId,
            organization_id: "org-1",
            client_id: basePayload.clientId,
            goal_id: basePayload.goalIds[0],
            measurement_type: "correctIncorrect",
          }],
        };
      }
      if (requestUrl.includes("/rest/v1/sessions?")) {
        return {
          ok: true,
          status: 200,
          data: [{
            id: basePayload.sessionId,
            organization_id: "org-1",
            client_id: basePayload.clientId,
            therapist_id: basePayload.therapistId,
          }],
        };
      }
      if (requestUrl.includes("/rest/v1/trial_events") && init?.method === "GET") {
        return { ok: true, status: 200, data: [] };
      }
      if (requestUrl.includes("/rest/v1/trial_events") && init?.method === "POST") {
        trialEventsPostCount += 1;
        return { ok: true, status: 201, data: [] };
      }
      if (requestUrl.includes("/rest/v1/trial_events") && init?.method === "DELETE") {
        trialEventsDeleteCount += 1;
        expect(requestUrl).toContain(`organization_id=eq.org-1`);
        expect(requestUrl).toContain(`session_id=eq.${basePayload.sessionId}`);
        expect(requestUrl).toContain(`target_id.eq.${targetId}`);
        expect(requestUrl).toContain("trial_number.eq.1");
        expect(init.headers).toEqual(expect.objectContaining({
          apikey: "service-role-key",
          Authorization: "Bearer service-role-key",
          Prefer: "return=minimal",
        }));
        return { ok: true, status: 204, data: null };
      }
      if (requestUrl.endsWith("/rest/v1/client_session_notes") && init?.method === "POST") {
        return { ok: false, status: 500, data: { message: "note write failed" } };
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });

    const response = await sessionNotesUpsertHandler(
      new Request("http://localhost/api/session-notes/upsert", {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({
          ...basePayload,
          trialEvents: [{
            target_id: targetId,
            trial_number: 1,
            response: "correct",
          }],
        }),
      }),
    );

    expect(response.status).toBe(500);
    expect(trialEventsPostCount).toBe(1);
    expect(trialEventsDeleteCount).toBe(1);
  });

  it("rejects preexisting raw trial event keys before writing trial events", async () => {
    const fetchJsonMock = vi.mocked(fetchJson);
    let trialEventsPostCount = 0;
    let trialEventsDeleteCount = 0;
    let noteWriteCount = 0;
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
      if (requestUrl.includes("/rest/v1/goal_targets?")) {
        return {
          ok: true,
          status: 200,
          data: [{
            id: targetId,
            organization_id: "org-1",
            client_id: basePayload.clientId,
            goal_id: basePayload.goalIds[0],
            measurement_type: "correctIncorrect",
          }],
        };
      }
      if (requestUrl.includes("/rest/v1/sessions?")) {
        return {
          ok: true,
          status: 200,
          data: [{
            id: basePayload.sessionId,
            organization_id: "org-1",
            client_id: basePayload.clientId,
            therapist_id: basePayload.therapistId,
          }],
        };
      }
      if (requestUrl.includes("/rest/v1/trial_events") && init?.method === "GET") {
        expect(requestUrl).toContain(`session_id=eq.${basePayload.sessionId}`);
        expect(requestUrl).toContain(`target_id=in.(${targetId})`);
        expect(requestUrl).toContain("trial_number=in.(1)");
        return { ok: true, status: 200, data: [{ target_id: targetId, trial_number: 1 }] };
      }
      if (requestUrl.includes("/rest/v1/trial_events") && init?.method === "POST") {
        trialEventsPostCount += 1;
        return { ok: true, status: 201, data: [] };
      }
      if (requestUrl.includes("/rest/v1/trial_events") && init?.method === "DELETE") {
        trialEventsDeleteCount += 1;
        return { ok: true, status: 204, data: null };
      }
      if (requestUrl.endsWith("/rest/v1/client_session_notes") && init?.method === "POST") {
        noteWriteCount += 1;
        return { ok: false, status: 500, data: { message: "note write failed" } };
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });

    const response = await sessionNotesUpsertHandler(
      new Request("http://localhost/api/session-notes/upsert", {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({
          ...basePayload,
          trialEvents: [{
            target_id: targetId,
            trial_number: 1,
            response: "correct",
          }],
        }),
      }),
    );

    const body = await response.json() as { error?: string };

    expect(response.status).toBe(409);
    expect(body.error).toBe("Trial event already exists for this session target and trial number.");
    expect(noteWriteCount).toBe(0);
    expect(trialEventsPostCount).toBe(0);
    expect(trialEventsDeleteCount).toBe(0);
  });

  it("rejects duplicate raw trial event keys in the same request before writing trial events", async () => {
    const fetchJsonMock = vi.mocked(fetchJson);
    let trialEventsReadCount = 0;
    let trialEventsPostCount = 0;
    let noteWriteCount = 0;
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
      if (requestUrl.includes("/rest/v1/goal_targets?")) {
        return {
          ok: true,
          status: 200,
          data: [{
            id: targetId,
            organization_id: "org-1",
            client_id: basePayload.clientId,
            goal_id: basePayload.goalIds[0],
            measurement_type: "correctIncorrect",
          }],
        };
      }
      if (requestUrl.includes("/rest/v1/sessions?")) {
        return {
          ok: true,
          status: 200,
          data: [{
            id: basePayload.sessionId,
            organization_id: "org-1",
            client_id: basePayload.clientId,
            therapist_id: basePayload.therapistId,
          }],
        };
      }
      if (requestUrl.includes("/rest/v1/trial_events") && init?.method === "GET") {
        trialEventsReadCount += 1;
        return { ok: true, status: 200, data: [] };
      }
      if (requestUrl.includes("/rest/v1/trial_events") && init?.method === "POST") {
        trialEventsPostCount += 1;
        return { ok: true, status: 201, data: [] };
      }
      if (requestUrl.endsWith("/rest/v1/client_session_notes") && init?.method === "POST") {
        noteWriteCount += 1;
        return { ok: true, status: 201, data: [{ id: "note-duplicate-request" }] };
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });

    const response = await sessionNotesUpsertHandler(
      new Request("http://localhost/api/session-notes/upsert", {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({
          ...basePayload,
          trialEvents: [
            {
              target_id: targetId,
              trial_number: 1,
              response: "correct",
            },
            {
              target_id: targetId,
              trial_number: 1,
              response: "incorrect",
            },
          ],
        }),
      }),
    );
    const body = await response.json() as { error?: string };

    expect(response.status).toBe(409);
    expect(body.error).toBe("Duplicate trial event submitted for this session target and trial number.");
    expect(trialEventsReadCount).toBe(0);
    expect(trialEventsPostCount).toBe(0);
    expect(noteWriteCount).toBe(0);
  });

  it("rejects raw trial events before saving a note when capture access is denied", async () => {
    vi.mocked(currentUserCanCaptureTrialEvent).mockResolvedValue({
      allowed: false,
      upstreamError: false,
    });
    const fetchJsonMock = vi.mocked(fetchJson);
    let noteWriteCount = 0;
    let trialEventsPostCount = 0;
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
      if (requestUrl.includes("/rest/v1/sessions?")) {
        return {
          ok: true,
          status: 200,
          data: [{
            id: basePayload.sessionId,
            organization_id: "org-1",
            client_id: basePayload.clientId,
            therapist_id: basePayload.therapistId,
          }],
        };
      }
      if (requestUrl.endsWith("/rest/v1/client_session_notes") && init?.method === "POST") {
        noteWriteCount += 1;
      }
      if (requestUrl.includes("/rest/v1/trial_events") && init?.method === "POST") {
        trialEventsPostCount += 1;
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });

    const response = await sessionNotesUpsertHandler(
      new Request("http://localhost/api/session-notes/upsert", {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({
          ...basePayload,
          trialEvents: [{
            target_id: targetId,
            trial_number: 1,
            response: "correct",
          }],
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(noteWriteCount).toBe(0);
    expect(trialEventsPostCount).toBe(0);
    expect(currentUserCanCaptureTrialEvent).toHaveBeenCalledWith(
      ACCESS_TOKEN,
      "org-1",
      basePayload.clientId,
    );
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

  it("when billing gate relaxed, skips date/service strict checks and uses first listed service code", async () => {
    vi.mocked(resolveSessionCaptureStrictBillingPolicy).mockResolvedValue({ strict: false, upstreamError: false });
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
            status: "pending",
            start_date: "2026-01-01",
            end_date: "2026-01-31",
            services: [{ service_code: "97151", approved_units: 10 }],
          }],
        };
      }
      if (requestUrl.includes("/rest/v1/client_session_notes?select=id,is_locked")) {
        return { ok: true, status: 200, data: [] };
      }
      if (requestUrl.endsWith("/rest/v1/client_session_notes") && init?.method === "POST") {
        const parsedBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        expect(parsedBody.service_code).toBe("97151");
        return { ok: true, status: 201, data: [{ id: "note-relaxed" }] };
      }
      if (requestUrl.includes("select=id%2Cauthorization_id") && requestUrl.includes("id=eq.note-relaxed")) {
        return {
          ok: true,
          status: 200,
          data: [{
            ...buildSessionNoteRow("note-relaxed"),
            service_code: "97151",
          }],
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
          sessionDate: "2026-03-10",
          serviceCode: "97153",
        }),
      }),
    );

    expect(response.status).toBe(200);
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
          targets: ["Legacy A"],
          target: "Legacy A",
          target_trials: [{
            target: "Legacy A",
            metric_value: 2,
            incorrect_trials: 1,
            prompt_counts: [{
              prompt_type: "verbal",
              prompt_level: "full",
              correct_trials: 1,
              incorrect_trials: 0,
            }],
          }],
        },
      },
    };

    const savedAfterPatch = {
      ...existingRow,
      goal_notes: { [gidA]: "server kept skill note", [gidB]: "merged bx from client" },
      goal_measurements: {
        ...existingRow.goal_measurements,
        [gidB]: {
          version: 1,
          data: {
            metric_label: "Count",
            metric_unit: null,
            metric_value: 1,
            incorrect_trials: 1,
            targets: ["Legacy B"],
            target: "Legacy B",
            target_trials: [{
              target: "Legacy B",
              metric_value: 1,
              incorrect_trials: 1,
              prompt_counts: [{
                prompt_type: "gesture",
                prompt_level: null,
                correct_trials: 1,
                incorrect_trials: 1,
              }],
            }],
          },
        },
      },
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
        const parsedBody = JSON.parse(String(init.body)) as {
          goal_notes?: Record<string, string>;
          goal_measurements?: Record<string, { data?: { target_trials?: Array<{ prompt_counts?: unknown[] }> } }>;
        };
        expect(parsedBody.goal_notes?.[gidA]).toBe("server kept skill note");
        expect(parsedBody.goal_notes?.[gidB]).toBe("merged bx from client");
        expect(parsedBody.goal_measurements?.[gidA]?.data?.target_trials?.[0]?.prompt_counts).toEqual([{
          prompt_type: "verbal",
          prompt_level: "full",
          correct_trials: 1,
          incorrect_trials: 0,
        }]);
        expect(parsedBody.goal_measurements?.[gidB]?.data?.target_trials?.[0]?.prompt_counts).toEqual([{
          prompt_type: "gesture",
          prompt_level: null,
          correct_trials: 1,
          incorrect_trials: 1,
        }]);
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
          goalMeasurements: {
            [gidB]: {
              version: 1,
              data: {
                targets: ["Legacy B"],
                target_trials: [{
                  target: "Legacy B",
                  metric_value: 0,
                  incorrect_trials: 0,
                  prompt_counts: [
                    { prompt_type: "gesture", prompt_level: null, correct_trials: 1, incorrect_trials: 0 },
                    { prompt_type: "gesture", prompt_level: null, correct_trials: 0, incorrect_trials: 1 },
                    { prompt_type: "unknown", prompt_level: null, correct_trials: 9, incorrect_trials: 9 },
                  ],
                }],
              },
            },
          },
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

  it("falls back on code-only PGRST204 when reading existing note for merge", async () => {
    const sessionId = "99999999-9999-4999-8999-999999999999";
    const noteId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
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
              code: "PGRST204",
            },
          };
        }
        if (noteReadAttempts === 2) {
          expect(decodedUrl).not.toContain("goal_measurements");
        }
        return { ok: true, status: 200, data: [buildSessionNoteRow(noteId)] };
      }
      if (requestUrl.includes("/rest/v1/client_session_notes?id=eq.") && method === "PATCH") {
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
  });

  it("falls back on code-only PGRST204 when reading saved note after upsert", async () => {
    const noteId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
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
    expect(postSaveReads).toBeGreaterThanOrEqual(2);
  });

  it("retries insert without goal_measurements when create fails with missing-column error", async () => {
    const noteId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    let insertAttempts = 0;

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
      if (requestUrl.includes("/rest/v1/client_session_notes?select=id,is_locked")) {
        return { ok: true, status: 200, data: [] };
      }
      if (requestUrl.endsWith("/rest/v1/client_session_notes") && method === "POST") {
        insertAttempts += 1;
        const parsedBody = JSON.parse(String(init?.body ?? "{}")) as { goal_measurements?: unknown };
        if (insertAttempts === 1) {
          expect(parsedBody.goal_measurements).toBeDefined();
          return {
            ok: false,
            status: 400,
            data: {
              code: "PGRST204",
              details: "Could not find the 'goal_measurements' column of 'client_session_notes' in the schema cache",
            },
          };
        }
        expect(parsedBody.goal_measurements).toBeUndefined();
        return { ok: true, status: 201, data: [{ id: noteId }] };
      }
      if (requestUrl.includes("/rest/v1/client_session_notes?") && requestUrl.includes(`id=eq.${encodeURIComponent(noteId)}`) && method === "GET") {
        return {
          ok: true,
          status: 200,
          data: [{ ...buildSessionNoteRow(noteId), goal_measurements: null }],
        };
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
    expect(insertAttempts).toBe(2);
  });

  it("retries insert with UUID-only goal_ids when legacy uuid[] casts reject adhoc ids", async () => {
    const adhocId = "adhoc-skill-550e8400-e29b-41d4-a716-446655440000";
    const noteId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    let insertAttempts = 0;

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
      if (requestUrl.includes("/rest/v1/client_session_notes?select=id,is_locked")) {
        return { ok: true, status: 200, data: [] };
      }
      if (requestUrl.endsWith("/rest/v1/client_session_notes") && method === "POST") {
        insertAttempts += 1;
        const parsedBody = JSON.parse(String(init?.body ?? "{}")) as {
          goal_ids?: unknown;
          goals_addressed?: unknown;
        };
        if (insertAttempts === 1) {
          expect(parsedBody.goal_ids).toEqual(["44444444-4444-4444-8444-444444444444", adhocId]);
          return {
            ok: false,
            status: 400,
            data: {
              code: "22P02",
              message: "invalid input syntax for type uuid",
              details: "goal_ids contains non-uuid value",
            },
          };
        }
        expect(parsedBody.goal_ids).toEqual(["44444444-4444-4444-8444-444444444444"]);
        expect(parsedBody.goals_addressed).toEqual(["Goal A"]);
        return { ok: true, status: 201, data: [{ id: noteId }] };
      }
      if (requestUrl.includes("/rest/v1/client_session_notes?") && requestUrl.includes(`id=eq.${encodeURIComponent(noteId)}`) && method === "GET") {
        return { ok: true, status: 200, data: [buildSessionNoteRow(noteId)] };
      }
      throw new Error(`Unexpected request: ${requestUrl} ${method}`);
    });

    const response = await sessionNotesUpsertHandler(
      new Request("http://localhost/api/session-notes/upsert", {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({
          ...basePayload,
          goalIds: ["44444444-4444-4444-8444-444444444444", adhocId],
          goalsAddressed: ["Goal A", "Session target"],
          goalNotes: {
            "44444444-4444-4444-8444-444444444444": "covered",
            [adhocId]: "adhoc note",
          },
          goalMeasurements: {
            "44444444-4444-4444-8444-444444444444": {
              data: { metric_value: 4, opportunities: 5 },
            },
            [adhocId]: {
              data: { metric_value: 1 },
            },
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(insertAttempts).toBe(2);
  });

  it("retries update without goal_measurements when PATCH fails with missing-column error", async () => {
    const existingNoteId = "abababab-abab-4bab-8bab-abababababab";
    let updateAttempts = 0;

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
      if (requestUrl.includes("/rest/v1/client_session_notes?select=id,is_locked")) {
        return {
          ok: true,
          status: 200,
          data: [{ id: existingNoteId, is_locked: false }],
        };
      }
      if (requestUrl.includes(`/rest/v1/client_session_notes?id=eq.${encodeURIComponent(existingNoteId)}`) && method === "PATCH") {
        updateAttempts += 1;
        const parsedBody = JSON.parse(String(init?.body ?? "{}")) as { goal_measurements?: unknown };
        if (updateAttempts === 1) {
          expect(parsedBody.goal_measurements).toBeDefined();
          return {
            ok: false,
            status: 400,
            data: {
              code: "PGRST204",
              details: "Could not find the 'goal_measurements' column of 'client_session_notes' in the schema cache",
            },
          };
        }
        expect(parsedBody.goal_measurements).toBeUndefined();
        return { ok: true, status: 200, data: [{ id: existingNoteId }] };
      }
      if (requestUrl.includes("/rest/v1/client_session_notes?") && requestUrl.includes(`id=eq.${encodeURIComponent(existingNoteId)}`) && method === "GET") {
        return {
          ok: true,
          status: 200,
          data: [{ ...buildSessionNoteRow(existingNoteId), goal_measurements: null }],
        };
      }
      throw new Error(`Unexpected request: ${requestUrl} ${method}`);
    });

    const response = await sessionNotesUpsertHandler(
      new Request("http://localhost/api/session-notes/upsert", {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({ ...basePayload, noteId: existingNoteId }),
      }),
    );

    expect(response.status).toBe(200);
    expect(updateAttempts).toBe(2);
  });

  it("retries update with UUID-only goal_ids when legacy uuid[] casts reject adhoc ids", async () => {
    const adhocId = "adhoc-skill-7f0f6fce-9d71-44f6-b5ce-c2fc73cb036f";
    const existingNoteId = "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd";
    let updateAttempts = 0;

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
      if (requestUrl.includes("/rest/v1/client_session_notes?select=id,is_locked")) {
        return {
          ok: true,
          status: 200,
          data: [{ id: existingNoteId, is_locked: false }],
        };
      }
      if (requestUrl.includes(`/rest/v1/client_session_notes?id=eq.${encodeURIComponent(existingNoteId)}`) && method === "PATCH") {
        updateAttempts += 1;
        const parsedBody = JSON.parse(String(init?.body ?? "{}")) as {
          goal_ids?: unknown;
          goals_addressed?: unknown;
        };
        if (updateAttempts === 1) {
          expect(parsedBody.goal_ids).toEqual(["44444444-4444-4444-8444-444444444444", adhocId]);
          return {
            ok: false,
            status: 400,
            data: {
              code: "22P02",
              details: "invalid input syntax for type uuid in goal_ids",
            },
          };
        }
        expect(parsedBody.goal_ids).toEqual(["44444444-4444-4444-8444-444444444444"]);
        expect(parsedBody.goals_addressed).toEqual(["Goal A"]);
        return { ok: true, status: 200, data: [{ id: existingNoteId }] };
      }
      if (requestUrl.includes("/rest/v1/client_session_notes?") && requestUrl.includes(`id=eq.${encodeURIComponent(existingNoteId)}`) && method === "GET") {
        return { ok: true, status: 200, data: [buildSessionNoteRow(existingNoteId)] };
      }
      throw new Error(`Unexpected request: ${requestUrl} ${method}`);
    });

    const response = await sessionNotesUpsertHandler(
      new Request("http://localhost/api/session-notes/upsert", {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({
          ...basePayload,
          noteId: existingNoteId,
          goalIds: ["44444444-4444-4444-8444-444444444444", adhocId],
          goalsAddressed: ["Goal A", "Session target"],
          goalNotes: {
            "44444444-4444-4444-8444-444444444444": "covered",
            [adhocId]: "adhoc note",
          },
          goalMeasurements: {
            "44444444-4444-4444-8444-444444444444": {
              data: { metric_value: 4, opportunities: 5 },
            },
            [adhocId]: {
              data: { metric_value: 1 },
            },
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(updateAttempts).toBe(2);
  });

  it("fails closed before data access when organization billing policy lookup fails", async () => {
    vi.mocked(resolveSessionCaptureStrictBillingPolicy).mockResolvedValue({ strict: false, upstreamError: true });
    const response = await sessionNotesUpsertHandler(new Request("http://localhost/api/session-notes/upsert", {
      method: "POST", headers: HEADERS, body: JSON.stringify(basePayload),
    }));
    expect(response.status).toBe(502);
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("finalizes a locked note and target trials through one progression transaction", async () => {
    const rpcCalls: Array<{ name: string; body: Record<string, unknown> }> = [];
    vi.mocked(fetchJson).mockImplementation(async (url, init) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/rest/v1/authorizations?")) {
        return { ok: true, status: 200, data: [{
          id: basePayload.authorizationId, organization_id: "org-1", client_id: basePayload.clientId,
          status: "approved", start_date: "2026-01-01", end_date: "2026-12-31",
          services: [{ service_code: basePayload.serviceCode, approved_units: 10 }],
        }] };
      }
      if (requestUrl.includes("/rest/v1/client_session_notes?select=id,is_locked")) {
        return { ok: true, status: 200, data: [] };
      }
      if (requestUrl.includes("/rest/v1/sessions?")) {
        return { ok: true, status: 200, data: [{ id: basePayload.sessionId, organization_id: "org-1", client_id: basePayload.clientId, therapist_id: basePayload.therapistId }] };
      }
      if (requestUrl.includes("/rest/v1/goal_targets?")) {
        return { ok: true, status: 200, data: [{ id: targetId, organization_id: "org-1", client_id: basePayload.clientId, goal_id: basePayload.goalIds[0], measurement_type: "correctIncorrect" }] };
      }
      if (requestUrl.includes("/rest/v1/trial_events?select=target_id,metadata")) return { ok: true, status: 200, data: [] };
      if (requestUrl.endsWith("/rest/v1/rpc/finalize_session_note_with_progression")) {
        rpcCalls.push({ name: "finalize_session_note_with_progression", body: JSON.parse(String(init?.body)) });
        return { ok: true, status: 200, data: [{
          note: { ...buildSessionNoteRow("final-note"), is_locked: true, signed_at: "2026-03-10T17:00:00.000Z", session_id: basePayload.sessionId },
          progression_results: [{ outcome: "advanced", goal_id: basePayload.goalIds[0], target_id: targetId, previous_phase: "baseline", current_phase: "teaching", next_target_id: null, goal_status: "active", warning: null }],
        }] };
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });

    const response = await sessionNotesUpsertHandler(new Request("http://localhost/api/session-notes/upsert", {
      method: "POST", headers: HEADERS, body: JSON.stringify({
        ...basePayload, isLocked: true,
        trialEvents: [{ target_id: targetId, trial_number: 1, response: "correct", expected_progression_version: 7 }],
        organizationId: "attacker-org", actorUserId: "attacker-user", client_id: "attacker-client",
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(rpcCalls).toEqual([expect.objectContaining({ name: "finalize_session_note_with_progression" })]);
    expect(rpcCalls[0].body.target_note_id).toBeNull();
    expect(rpcCalls[0].body.expected_target_versions).toEqual([
      { target_id: targetId, progression_version: 7 },
    ]);
    expect(rpcCalls[0].body).not.toHaveProperty("organization_id");
    expect(rpcCalls[0].body).not.toHaveProperty("actor_id");
    expect(rpcCalls[0].body.note_payload).not.toEqual(expect.objectContaining({
      service_code: expect.anything(),
      session_date: expect.anything(),
      start_time: expect.anything(),
      end_time: expect.anything(),
      session_duration: expect.anything(),
    }));
    expect(body.progression_results[0]).toMatchObject({ outcome: "advanced", current_phase: "teaching" });
    expect(body.progression_warnings).toEqual([]);
  });

  it("uses capture-time versions from persisted draft trials during first finalization", async () => {
    const draftNoteId = "77777777-7777-4777-8777-777777777777";
    const rpcBodies: Record<string, unknown>[] = [];
    vi.mocked(fetchJson).mockImplementation(async (url, init) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/rest/v1/authorizations?")) return { ok: true, status: 200, data: [{ id: basePayload.authorizationId, organization_id: "org-1", client_id: basePayload.clientId, status: "approved", start_date: "2026-01-01", end_date: "2026-12-31", services: [{ service_code: basePayload.serviceCode, approved_units: 10 }] }] };
      if (requestUrl.includes("/rest/v1/client_session_notes?select=id,is_locked")) return { ok: true, status: 200, data: [{ id: draftNoteId, is_locked: false }] };
      if (requestUrl.includes("/rest/v1/sessions?")) return { ok: true, status: 200, data: [{ id: basePayload.sessionId, organization_id: "org-1", client_id: basePayload.clientId, therapist_id: basePayload.therapistId }] };
      if (requestUrl.includes("/rest/v1/trial_events?select=target_id,metadata")) {
        return { ok: true, status: 200, data: [{ target_id: targetId, metadata: { progression_version_at_capture: 7 } }] };
      }
      if (requestUrl.endsWith("/rest/v1/rpc/finalize_session_note_with_progression")) {
        rpcBodies.push(JSON.parse(String(init?.body)));
        return { ok: true, status: 200, data: [{ note: { ...buildSessionNoteRow(draftNoteId), is_locked: true }, progression_results: [] }] };
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });

    const response = await sessionNotesUpsertHandler(new Request("http://localhost/api/session-notes/upsert", {
      method: "POST", headers: HEADERS, body: JSON.stringify({ ...basePayload, noteId: draftNoteId, isLocked: true, trialEvents: [] }),
    }));

    expect(response.status).toBe(200);
    expect(rpcBodies[0].expected_target_versions).toEqual([{ target_id: targetId, progression_version: 7 }]);
  });

  it("keeps draft/save-progress on the compatible non-finalizing path", async () => {
    const urls: string[] = [];
    vi.mocked(fetchJson).mockImplementation(async (url, init) => {
      const requestUrl = String(url); urls.push(requestUrl);
      if (requestUrl.includes("/rest/v1/authorizations?")) return { ok: true, status: 200, data: [{ id: basePayload.authorizationId, organization_id: "org-1", client_id: basePayload.clientId, status: "approved", start_date: "2026-01-01", end_date: "2026-12-31", services: [{ service_code: basePayload.serviceCode, approved_units: 10 }] }] };
      if (requestUrl.includes("/rest/v1/client_session_notes?select=id,is_locked")) return { ok: true, status: 200, data: [] };
      if (requestUrl === `${BASE_URL}/rest/v1/client_session_notes` && init?.method === "POST") return { ok: true, status: 201, data: [{ id: "draft-note" }] };
      if (requestUrl.includes("id=eq.draft-note")) return { ok: true, status: 200, data: [buildSessionNoteRow("draft-note")] };
      throw new Error(`Unexpected request: ${requestUrl}`);
    });
    const response = await sessionNotesUpsertHandler(new Request("http://localhost/api/session-notes/upsert", { method: "POST", headers: HEADERS, body: JSON.stringify(basePayload) }));
    expect(response.status).toBe(200);
    expect(urls.some((url) => url.includes("finalize_session_note_with_progression"))).toBe(false);
  });

  it.each([
    [{ outcome: "criteria_incomplete", warning: "Progression criteria incomplete." }, 200, "Progression criteria incomplete."],
    [{ error: { code: "stale_target", message: `stale_target: ${targetId}|next-id|Replacement Target|Baseline` } }, 409, null],
  ])("maps finalization progression result %#", async (rpcData, expectedStatus, expectedWarning) => {
    vi.mocked(fetchJson).mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/rest/v1/authorizations?")) return { ok: true, status: 200, data: [{ id: basePayload.authorizationId, organization_id: "org-1", client_id: basePayload.clientId, status: "approved", start_date: "2026-01-01", end_date: "2026-12-31", services: [{ service_code: basePayload.serviceCode, approved_units: 10 }] }] };
      if (requestUrl.includes("/rest/v1/client_session_notes?select=id,is_locked")) return { ok: true, status: 200, data: [] };
      if (requestUrl.includes("/rest/v1/sessions?")) return { ok: true, status: 200, data: [{ id: basePayload.sessionId, organization_id: "org-1", client_id: basePayload.clientId, therapist_id: basePayload.therapistId }] };
      if (requestUrl.includes("/rest/v1/trial_events?select=target_id,metadata")) return { ok: true, status: 200, data: [] };
      if (requestUrl.endsWith("/rest/v1/rpc/finalize_session_note_with_progression")) {
        if ("error" in rpcData) return { ok: false, status: 409, data: rpcData };
        return { ok: true, status: 200, data: [{ note: { ...buildSessionNoteRow("final-note"), is_locked: true }, progression_results: [{ ...rpcData, goal_id: basePayload.goalIds[0], target_id: targetId, previous_phase: "baseline", current_phase: "baseline", next_target_id: null, goal_status: "active" }] }] };
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });
    const response = await sessionNotesUpsertHandler(new Request("http://localhost/api/session-notes/upsert", { method: "POST", headers: HEADERS, body: JSON.stringify({ ...basePayload, isLocked: true }) }));
    expect(response.status).toBe(expectedStatus);
    const responseBody = await response.json();
    if (expectedWarning) expect(responseBody.progression_warnings).toContain(expectedWarning);
    if (expectedStatus === 409) expect(responseBody.conflict).toMatchObject({
      stale_target_id: targetId, current_target_name: "Replacement Target", current_phase: "Baseline",
    });
  });

  it("returns an error without falling back to partial REST writes when finalization fails", async () => {
    const writeUrls: string[] = [];
    vi.mocked(fetchJson).mockImplementation(async (url, init) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/rest/v1/authorizations?")) return { ok: true, status: 200, data: [{ id: basePayload.authorizationId, organization_id: "org-1", client_id: basePayload.clientId, status: "approved", start_date: "2026-01-01", end_date: "2026-12-31", services: [{ service_code: basePayload.serviceCode, approved_units: 10 }] }] };
      if (requestUrl.includes("/rest/v1/client_session_notes?select=id,is_locked")) return { ok: true, status: 200, data: [] };
      if (requestUrl.includes("/rest/v1/sessions?")) return { ok: true, status: 200, data: [{ id: basePayload.sessionId, organization_id: "org-1", client_id: basePayload.clientId, therapist_id: basePayload.therapistId }] };
      if (requestUrl.includes("/rest/v1/goal_targets?")) return { ok: true, status: 200, data: [{ id: targetId, organization_id: "org-1", client_id: basePayload.clientId, goal_id: basePayload.goalIds[0], measurement_type: "correctIncorrect" }] };
      if (requestUrl.includes("/rest/v1/trial_events?select=target_id,metadata")) return { ok: true, status: 200, data: [] };
      if (init?.method === "POST" || init?.method === "PATCH") writeUrls.push(requestUrl);
      if (requestUrl.endsWith("/rest/v1/rpc/finalize_session_note_with_progression")) return { ok: false, status: 500, data: { code: "XX000", message: "transaction aborted" } };
      throw new Error(`Unexpected request: ${requestUrl}`);
    });

    const response = await sessionNotesUpsertHandler(new Request("http://localhost/api/session-notes/upsert", { method: "POST", headers: HEADERS, body: JSON.stringify({ ...basePayload, isLocked: true, trialEvents: [{ target_id: targetId, trial_number: 1, response: "correct", expected_progression_version: 7 }] }) }));
    expect(response.status).toBe(500);
    expect(writeUrls).toEqual([`${BASE_URL}/rest/v1/rpc/finalize_session_note_with_progression`]);
  });

  it("routes replay of an already locked note through the idempotent finalizer", async () => {
    const existing = { ...buildSessionNoteRow("99999999-9999-4999-8999-999999999999"), is_locked: true, signed_at: "2026-03-10T17:00:00.000Z", session_id: basePayload.sessionId };
    let rpcCount = 0;
    vi.mocked(fetchJson).mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/rest/v1/authorizations?")) return { ok: true, status: 200, data: [{ id: basePayload.authorizationId, organization_id: "org-1", client_id: basePayload.clientId, status: "approved", start_date: "2026-01-01", end_date: "2026-12-31", services: [{ service_code: basePayload.serviceCode, approved_units: 10 }] }] };
      if (requestUrl.includes("/rest/v1/client_session_notes?select=id,is_locked")) return { ok: true, status: 200, data: [{ id: existing.id, is_locked: true }] };
      if (requestUrl.endsWith("/rest/v1/rpc/finalize_session_note_with_progression")) {
        rpcCount += 1;
        return { ok: true, status: 200, data: [{ note: existing, progression_results: [{ outcome: "no_change", goal_id: basePayload.goalIds[0], target_id: targetId, previous_phase: "baseline", current_phase: "baseline", next_target_id: null, goal_status: "active", warning: null }] }] };
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });
    const response = await sessionNotesUpsertHandler(new Request("http://localhost/api/session-notes/upsert", { method: "POST", headers: HEADERS, body: JSON.stringify({ ...basePayload, noteId: existing.id, isLocked: true }) }));
    expect(response.status).toBe(200);
    expect(rpcCount).toBe(1);
    expect((await response.json()).progression_results[0].outcome).toBe("no_change");
  });
});
