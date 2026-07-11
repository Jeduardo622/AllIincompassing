import { beforeEach, describe, expect, it, vi } from "vitest";
import { goalTargetsHandler } from "../api/goal-targets";

vi.mock("../api/shared", async () => {
  const actual = await vi.importActual<typeof import("../api/shared")>("../api/shared");
  return {
    ...actual,
    currentUserCanDeleteGoalTargets: vi.fn(),
    currentUserCanManageProgramsGoals: vi.fn(),
    fetchJson: vi.fn(),
    getAccessToken: vi.fn(),
    getAccessTokenSubject: vi.fn(),
    getSupabaseConfig: vi.fn(),
    resolveOrgAndRoleWithStatus: vi.fn(),
  };
});

import {
  currentUserCanDeleteGoalTargets,
  currentUserCanManageProgramsGoals,
  fetchJson,
  getAccessToken,
  getAccessTokenSubject,
  getSupabaseConfig,
  resolveOrgAndRoleWithStatus,
} from "../api/shared";

const ACCESS_TOKEN = "token-123";
const ORG_ID = "11111111-1111-4111-8111-111111111111";
const GOAL_ID = "22222222-2222-4222-8222-222222222222";
const TARGET_ID = "33333333-3333-4333-8333-333333333333";

describe("goalTargetsHandler", () => {
  it("rejects archiving the current target before issuing a status patch", async () => {
    vi.mocked(resolveOrgAndRoleWithStatus).mockResolvedValue({ organizationId: ORG_ID, role: "bcba", upstreamError: false });
    vi.mocked(currentUserCanManageProgramsGoals).mockResolvedValue({ allowed: true, upstreamError: false });
    vi.mocked(fetchJson).mockImplementation(async (url, init) => {
      const requestUrl = String(url);
      if (init?.method === "GET" && requestUrl.includes("/rest/v1/goal_targets?select=id,is_current,status")) {
        return { ok: true, status: 200, data: [{ id: TARGET_ID, is_current: true, status: "active" }] };
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });

    const response = await goalTargetsHandler(new Request(
      `http://localhost/api/goal-targets?target_id=${TARGET_ID}`,
      { method: "PATCH", headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }, body: JSON.stringify({ status: "archived" }) },
    ));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Select another current target before archiving this target" });
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getAccessToken).mockReturnValue(ACCESS_TOKEN);
    vi.mocked(getAccessTokenSubject).mockReturnValue("user-1");
    vi.mocked(getSupabaseConfig).mockReturnValue({
      supabaseUrl: "https://example.supabase.co",
      anonKey: "anon-key",
    });
    vi.mocked(resolveOrgAndRoleWithStatus).mockResolvedValue({
      organizationId: ORG_ID,
      isTherapist: false,
      isAdmin: false,
      isOrgMember: false,
      isSuperAdmin: false,
      upstreamError: false,
    });
  });

  it("denies target creation when the program-goal capability helper rejects the caller", async () => {
    vi.mocked(currentUserCanManageProgramsGoals).mockResolvedValue({ allowed: false, upstreamError: false });

    const response = await goalTargetsHandler(
      new Request("http://localhost/api/goal-targets", {
        method: "POST",
        body: JSON.stringify({
          goal_id: GOAL_ID,
          name: "Requests break",
          measurement_type: "frequency",
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(currentUserCanManageProgramsGoals).toHaveBeenCalledWith(ACCESS_TOKEN, ORG_ID);
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("returns 502 when the program-goal capability helper cannot be validated", async () => {
    vi.mocked(currentUserCanManageProgramsGoals).mockResolvedValue({ allowed: false, upstreamError: true });

    const response = await goalTargetsHandler(
      new Request("http://localhost/api/goal-targets", {
        method: "POST",
        body: JSON.stringify({
          goal_id: GOAL_ID,
          name: "Requests break",
          measurement_type: "frequency",
        }),
      }),
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Unable to validate program-goal access" });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("loads targets without duplicating a broad role allowlist in the handler", async () => {
    vi.mocked(fetchJson).mockResolvedValue({
      ok: true,
      status: 200,
      data: [],
    });

    const response = await goalTargetsHandler(
      new Request(`http://localhost/api/goal-targets?goal_id=${GOAL_ID}`, { method: "GET" }),
    );

    expect(response.status).toBe(200);
    expect(currentUserCanManageProgramsGoals).not.toHaveBeenCalled();
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/rest/v1/goal_targets?select=*&organization_id=eq."),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("returns 400 when DELETE target_id is missing", async () => {
    const response = await goalTargetsHandler(
      new Request("http://localhost/api/goal-targets", { method: "DELETE" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "target_id is required" });
    expect(currentUserCanDeleteGoalTargets).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("returns 400 when DELETE target_id is not a UUID", async () => {
    const response = await goalTargetsHandler(
      new Request("http://localhost/api/goal-targets?target_id=not-a-uuid", { method: "DELETE" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "target_id must be a valid UUID" });
    expect(currentUserCanDeleteGoalTargets).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("denies DELETE when the exact goal-target delete capability rejects the caller", async () => {
    vi.mocked(currentUserCanDeleteGoalTargets).mockResolvedValue({ allowed: false, upstreamError: false });

    const response = await goalTargetsHandler(
      new Request(`http://localhost/api/goal-targets?target_id=${TARGET_ID}`, { method: "DELETE" }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
    expect(currentUserCanDeleteGoalTargets).toHaveBeenCalledWith(ACCESS_TOKEN, ORG_ID);
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("returns 502 when the exact goal-target delete capability cannot be validated", async () => {
    vi.mocked(currentUserCanDeleteGoalTargets).mockResolvedValue({ allowed: false, upstreamError: true });

    const response = await goalTargetsHandler(
      new Request(`http://localhost/api/goal-targets?target_id=${TARGET_ID}`, { method: "DELETE" }),
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Unable to validate goal-target delete access" });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("deletes an archived unused target through request-scoped RLS credentials", async () => {
    vi.mocked(currentUserCanDeleteGoalTargets).mockResolvedValue({ allowed: true, upstreamError: false });
    vi.mocked(fetchJson)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ id: TARGET_ID, status: "archived" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ id: TARGET_ID }],
      });

    const response = await goalTargetsHandler(
      new Request(`http://localhost/api/goal-targets?target_id=${TARGET_ID}`, { method: "DELETE" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: TARGET_ID });
    expect(fetchJson).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(
        `/rest/v1/goal_targets?select=id,status&id=eq.${TARGET_ID}&organization_id=eq.${ORG_ID}&limit=1`,
      ),
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: `Bearer ${ACCESS_TOKEN}` }),
      }),
    );
    expect(fetchJson).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(`/rest/v1/goal_targets?id=eq.${TARGET_ID}&organization_id=eq.${ORG_ID}`),
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          Prefer: "return=representation",
        }),
      }),
    );
  });

  it("returns actionable 409 when the database preserves a target with trial history", async () => {
    vi.mocked(currentUserCanDeleteGoalTargets).mockResolvedValue({ allowed: true, upstreamError: false });
    vi.mocked(fetchJson)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ id: TARGET_ID, status: "archived" }],
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        data: {
          code: "23503",
          message: "update or delete on table goal_targets violates foreign key constraint",
        },
      });

    const response = await goalTargetsHandler(
      new Request(`http://localhost/api/goal-targets?target_id=${TARGET_ID}`, { method: "DELETE" }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Goal target has trial history and cannot be deleted",
    });
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it("returns 409 without deleting when the target is not archived", async () => {
    vi.mocked(currentUserCanDeleteGoalTargets).mockResolvedValue({ allowed: true, upstreamError: false });
    vi.mocked(fetchJson).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: [{ id: TARGET_ID, status: "active" }],
    });

    const response = await goalTargetsHandler(
      new Request(`http://localhost/api/goal-targets?target_id=${TARGET_ID}`, { method: "DELETE" }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Only archived goal targets can be deleted" });
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(fetchJson).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("returns 409 when RLS preserves an archived target with an empty delete representation", async () => {
    vi.mocked(currentUserCanDeleteGoalTargets).mockResolvedValue({ allowed: true, upstreamError: false });
    vi.mocked(fetchJson)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ id: TARGET_ID, status: "archived" }],
      })
      .mockResolvedValueOnce({ ok: true, status: 200, data: [] });

    const response = await goalTargetsHandler(
      new Request(`http://localhost/api/goal-targets?target_id=${TARGET_ID}`, { method: "DELETE" }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Goal target has trial history or is no longer eligible for deletion",
    });
  });

  it("returns 404 without DELETE when the target is missing or outside the active organization", async () => {
    vi.mocked(currentUserCanDeleteGoalTargets).mockResolvedValue({ allowed: true, upstreamError: false });
    vi.mocked(fetchJson).mockResolvedValueOnce({ ok: true, status: 200, data: [] });

    const response = await goalTargetsHandler(
      new Request(`http://localhost/api/goal-targets?target_id=${TARGET_ID}`, { method: "DELETE" }),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Goal target not found" });
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(fetchJson).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("returns 502 when the same-organization target preflight fails", async () => {
    vi.mocked(currentUserCanDeleteGoalTargets).mockResolvedValue({ allowed: true, upstreamError: false });
    vi.mocked(fetchJson).mockResolvedValueOnce({
      ok: false,
      status: 503,
      data: { message: "upstream unavailable" },
    });

    const response = await goalTargetsHandler(
      new Request(`http://localhost/api/goal-targets?target_id=${TARGET_ID}`, { method: "DELETE" }),
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Failed to load goal target" });
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it("returns 502 when an eligible target DELETE fails for a non-history infrastructure error", async () => {
    vi.mocked(currentUserCanDeleteGoalTargets).mockResolvedValue({ allowed: true, upstreamError: false });
    vi.mocked(fetchJson)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ id: TARGET_ID, status: "archived" }],
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        data: { code: "08006", message: "connection failure" },
      });

    const response = await goalTargetsHandler(
      new Request(`http://localhost/api/goal-targets?target_id=${TARGET_ID}`, { method: "DELETE" }),
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Failed to delete goal target" });
  });

  it.each(["current_phase", "is_current", "progression_version", "evaluation_window_started_at"])(
    "rejects progression-owned PATCH field %s",
    async (field) => {
      vi.mocked(currentUserCanManageProgramsGoals).mockResolvedValue({ allowed: true, upstreamError: false });
      const response = await goalTargetsHandler(new Request(
        `http://localhost/api/goal-targets?target_id=${TARGET_ID}`,
        { method: "PATCH", body: JSON.stringify({ [field]: field === "progression_version" ? 2 : true }) },
      ));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "Progression state must be changed through a progression action",
      });
      expect(fetchJson).not.toHaveBeenCalled();
    },
  );

  it("rejects direct mastery through generic PATCH", async () => {
    vi.mocked(currentUserCanManageProgramsGoals).mockResolvedValue({ allowed: true, upstreamError: false });
    const response = await goalTargetsHandler(new Request(
      `http://localhost/api/goal-targets?target_id=${TARGET_ID}`,
      { method: "PATCH", body: JSON.stringify({ status: "mastered" }) },
    ));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Progression state must be changed through a progression action",
    });
  });

  it("preserves ordinary lifecycle PATCH fields", async () => {
    vi.mocked(currentUserCanManageProgramsGoals).mockResolvedValue({ allowed: true, upstreamError: false });
    vi.mocked(fetchJson).mockResolvedValue({ ok: true, status: 200, data: [{ id: TARGET_ID, name: "Updated" }] });
    const response = await goalTargetsHandler(new Request(
      `http://localhost/api/goal-targets?target_id=${TARGET_ID}`,
      { method: "PATCH", body: JSON.stringify({ name: "Updated" }) },
    ));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: TARGET_ID, name: "Updated" });
  });

  it("calls the manual override RPC with the authenticated caller token", async () => {
    vi.mocked(currentUserCanManageProgramsGoals).mockResolvedValue({ allowed: true, upstreamError: false });
    vi.mocked(fetchJson).mockResolvedValue({ ok: true, status: 200, data: [{ outcome: "manual_override" }] });
    const body = {
      action: "override_progression", target_id: TARGET_ID, target_phase: "teaching",
      current_target_id: null, reason: "Clinical review", expected_version: 2,
    };
    const response = await goalTargetsHandler(new Request("http://localhost/api/goal-targets", {
      method: "POST", body: JSON.stringify(body),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "manual_override" });
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/rest/v1/rpc/override_goal_target_progression"),
      expect.objectContaining({ method: "POST", body: JSON.stringify({
        target_goal_target_id: TARGET_ID, target_phase: "teaching",
        target_current_goal_target_id: null, reason: "Clinical review", expected_version: 2,
      }) }),
    );
  });

  it("calls the explicit manual mastery completion RPC", async () => {
    vi.mocked(currentUserCanManageProgramsGoals).mockResolvedValue({ allowed: true, upstreamError: false });
    vi.mocked(fetchJson).mockResolvedValue({ ok: true, status: 200, data: [{ outcome: "target_mastered" }] });
    const response = await goalTargetsHandler(new Request("http://localhost/api/goal-targets", {
      method: "POST", body: JSON.stringify({ action: "complete_mastery", target_id: TARGET_ID,
        reason: "Clinical review", expected_version: 2 }),
    }));
    expect(response.status).toBe(200);
    expect(fetchJson).toHaveBeenCalledWith(expect.stringContaining("/rpc/complete_goal_target_mastery"),
      expect.objectContaining({ body: JSON.stringify({ target_goal_target_id: TARGET_ID,
        reason: "Clinical review", expected_version: 2 }) }));
  });

  it("rejects an empty manual override reason before calling the database", async () => {
    vi.mocked(currentUserCanManageProgramsGoals).mockResolvedValue({ allowed: true, upstreamError: false });
    const response = await goalTargetsHandler(new Request("http://localhost/api/goal-targets", {
      method: "POST", body: JSON.stringify({ action: "override_progression", target_id: TARGET_ID,
        target_phase: "teaching", current_target_id: null, reason: " ", expected_version: 2 }),
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid request body" });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("maps a stale override version to the shared conflict envelope", async () => {
    vi.mocked(currentUserCanManageProgramsGoals).mockResolvedValue({ allowed: true, upstreamError: false });
    vi.mocked(fetchJson).mockResolvedValue({ ok: false, status: 400, data: { code: "40001", message: "stale progression version" } });
    const response = await goalTargetsHandler(new Request("http://localhost/api/goal-targets", {
      method: "POST", body: JSON.stringify({ action: "override_progression", target_id: TARGET_ID,
        target_phase: "teaching", current_target_id: null, reason: "Clinical review", expected_version: 2 }),
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Progression version conflict" });
  });

  it("loads transition history within the resolved organization", async () => {
    vi.mocked(fetchJson).mockResolvedValue({ ok: true, status: 200, data: [{ id: "transition-1" }] });
    const response = await goalTargetsHandler(new Request(
      `http://localhost/api/goal-targets?action=transition_history&target_id=${TARGET_ID}`,
    ));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ id: "transition-1" }]);
    expect(fetchJson).toHaveBeenCalledWith(expect.stringContaining(
      `/rest/v1/goal_target_transitions?select=*&organization_id=eq.${ORG_ID}&target_id=eq.${TARGET_ID}`,
    ), expect.objectContaining({ method: "GET" }));
  });

  it("writes complete structured criteria through the dedicated RPC", async () => {
    vi.mocked(currentUserCanManageProgramsGoals).mockResolvedValue({ allowed: true, upstreamError: false });
    vi.mocked(fetchJson).mockResolvedValue({ ok: true, status: 200, data: { phase: "baseline" } });
    const response = await goalTargetsHandler(new Request("http://localhost/api/goal-targets", {
      method: "PUT", body: JSON.stringify({ action: "set_criteria", target_id: TARGET_ID, phase: "baseline",
        metric: "percent_correct", comparator: "gte", threshold: 80, min_observations: 10,
        consecutive_sessions: 3, clinical_note: null, expected_version: 2 }),
    }));
    expect(response.status).toBe(200);
    expect(fetchJson).toHaveBeenCalledWith(expect.stringContaining("/rpc/set_goal_target_phase_criterion"),
      expect.objectContaining({ method: "POST" }));
  });

  it("returns criteria in clinical phase order", async () => {
    vi.mocked(fetchJson).mockResolvedValue({ ok: true, status: 200, data: [
      { phase: "mastery" }, { phase: "baseline" }, { phase: "generalization" }, { phase: "teaching" },
    ] });
    const response = await goalTargetsHandler(new Request(
      `http://localhost/api/goal-targets?action=criteria&target_id=${TARGET_ID}`,
    ));
    expect((await response.json()).map((row: { phase: string }) => row.phase)).toEqual([
      "baseline", "teaching", "generalization", "mastery",
    ]);
  });

  it("rejects unknown GET actions", async () => {
    const response = await goalTargetsHandler(new Request(
      `http://localhost/api/goal-targets?action=surprise&target_id=${TARGET_ID}`,
    ));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid action" });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it.each([
    [{ code: "42501", message: "goal target is not in scope" }, 403, "Forbidden"],
    [{ code: "40001", message: "stale or mixed target set" }, 409, "Progression version conflict"],
  ] as const)("maps progression RPC authority/conflict errors", async (data, status, error) => {
    vi.mocked(currentUserCanManageProgramsGoals).mockResolvedValue({ allowed: true, upstreamError: false });
    vi.mocked(fetchJson).mockResolvedValue({ ok: false, status: 400, data });
    const response = await goalTargetsHandler(new Request("http://localhost/api/goal-targets", {
      method: "POST", body: JSON.stringify({ action: "reorder", goal_id: GOAL_ID,
        targets: [{ target_id: TARGET_ID, expected_version: 2 }] }),
    }));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
  });

  it("rejects partially configured criteria", async () => {
    vi.mocked(currentUserCanManageProgramsGoals).mockResolvedValue({ allowed: true, upstreamError: false });
    const response = await goalTargetsHandler(new Request("http://localhost/api/goal-targets", {
      method: "POST", body: JSON.stringify({ action: "set_criteria", target_id: TARGET_ID, phase: "baseline",
        metric: "percent_correct", comparator: null, threshold: 80, min_observations: 10,
        consecutive_sessions: 3, expected_version: 2 }),
    }));
    expect(response.status).toBe(400);
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("calls deterministic reorder with parallel ids and versions", async () => {
    vi.mocked(currentUserCanManageProgramsGoals).mockResolvedValue({ allowed: true, upstreamError: false });
    vi.mocked(fetchJson).mockResolvedValue({ ok: true, status: 200, data: [] });
    const response = await goalTargetsHandler(new Request("http://localhost/api/goal-targets", {
      method: "POST", body: JSON.stringify({ action: "reorder", goal_id: GOAL_ID,
        targets: [{ target_id: TARGET_ID, expected_version: 2 }] }),
    }));
    expect(response.status).toBe(200);
    expect(fetchJson).toHaveBeenCalledWith(expect.stringContaining("/rpc/reorder_goal_targets"),
      expect.objectContaining({ body: JSON.stringify({ target_goal_id: GOAL_ID,
        ordered_target_ids: [TARGET_ID], expected_versions: [2] }) }));
  });
});
