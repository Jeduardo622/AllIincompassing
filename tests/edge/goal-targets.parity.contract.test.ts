import { beforeEach, describe, expect, it, vi } from "vitest";
import { stubDenoEnv } from "../utils/stubDeno";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "33333333-3333-4333-8333-333333333333";

stubDenoEnv((key) => {
  if (key === "CORS_ALLOWED_ORIGINS") return "https://app.example.com";
  if (key === "APP_ENV") return "production";
  return "";
});

const createRequestClientMock = vi.fn();

async function loadGoalTargetsModule() {
  vi.doMock("../../supabase/functions/_shared/database.ts", () => ({
    createRequestClient: createRequestClientMock,
  }));
  return import("../../supabase/functions/goal-targets/index.ts");
}

const buildDb = ({
  deleteCapabilityData = true,
  deleteCapabilityError = null,
  preflightData = [{ id: TARGET_ID, status: "archived" }],
  preflightError = null,
  deleteData = [{ id: TARGET_ID }],
  deleteError = null,
}: {
  deleteCapabilityData?: boolean;
  deleteCapabilityError?: { message: string } | null;
  preflightData?: Array<{ id: string; status: string }>;
  preflightError?: { code?: string; message: string } | null;
  deleteData?: Array<{ id: string }>;
  deleteError?: { code?: string; message: string } | null;
} = {}) => {
  const deleteMock = vi.fn(() => ({
    eq: vi.fn(() => ({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({
          limit: vi.fn(async () => ({ data: deleteData, error: deleteError })),
        })),
      })),
    })),
  }));
  const db = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "bcba-1" } }, error: null })),
    },
    rpc: vi.fn(async (name: string) => {
      if (name === "current_user_organization_id") return { data: ORG_ID, error: null };
      if (name === "current_user_can_delete_goal_targets") {
        return { data: deleteCapabilityData, error: deleteCapabilityError };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    }),
    from: vi.fn((table: string) => {
      if (table !== "goal_targets") throw new Error(`Unexpected table: ${table}`);
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              limit: vi.fn(async () => ({ data: preflightData, error: preflightError })),
            })),
          })),
        })),
        delete: deleteMock,
      };
    }),
  };
  return { db, deleteMock };
};

const deleteRequest = () => new Request(
  `https://edge.example.com/functions/v1/goal-targets?target_id=${TARGET_ID}`,
  { method: "DELETE", headers: { Authorization: "Bearer token" } },
);

describe("goal-targets Edge/server DELETE parity", () => {
  beforeEach(() => {
    vi.resetModules();
    createRequestClientMock.mockReset();
  });

  it("returns 400 for missing target_id", async () => {
    const { db, deleteMock } = buildDb();
    createRequestClientMock.mockReturnValue(db);
    const module = await loadGoalTargetsModule();

    const response = await module.handleGoalTargets(
      new Request("https://edge.example.com/functions/v1/goal-targets", {
        method: "DELETE",
        headers: { Authorization: "Bearer token" },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "target_id is required" });
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid target_id", async () => {
    const { db, deleteMock } = buildDb();
    createRequestClientMock.mockReturnValue(db);
    const module = await loadGoalTargetsModule();

    const response = await module.handleGoalTargets(
      new Request("https://edge.example.com/functions/v1/goal-targets?target_id=invalid", {
        method: "DELETE",
        headers: { Authorization: "Bearer token" },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "target_id must be a valid UUID" });
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("returns 403 when delete capability denies the caller", async () => {
    const { db, deleteMock } = buildDb({ deleteCapabilityData: false });
    createRequestClientMock.mockReturnValue(db);
    const module = await loadGoalTargetsModule();

    const response = await module.handleGoalTargets(deleteRequest());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
    expect(db.from).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("returns 502 when delete capability cannot be validated", async () => {
    const { db, deleteMock } = buildDb({
      deleteCapabilityData: false,
      deleteCapabilityError: { message: "RPC unavailable" },
    });
    createRequestClientMock.mockReturnValue(db);
    const module = await loadGoalTargetsModule();

    const response = await module.handleGoalTargets(deleteRequest());

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Unable to validate goal-target delete access" });
    expect(db.from).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("returns 409 without DELETE for a non-archived target", async () => {
    const { db, deleteMock } = buildDb({
      preflightData: [{ id: TARGET_ID, status: "active" }],
    });
    createRequestClientMock.mockReturnValue(db);
    const module = await loadGoalTargetsModule();

    const response = await module.handleGoalTargets(deleteRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Only archived goal targets can be deleted" });
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("maps FK history preservation to actionable 409", async () => {
    const { db } = buildDb({
      deleteError: { code: "23503", message: "trial_events_target_id_fkey" },
    });
    createRequestClientMock.mockReturnValue(db);
    const module = await loadGoalTargetsModule();

    const response = await module.handleGoalTargets(deleteRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Goal target has trial history and cannot be deleted",
    });
  });

  it("returns the deleted target representation on success", async () => {
    const { db, deleteMock } = buildDb();
    createRequestClientMock.mockReturnValue(db);
    const module = await loadGoalTargetsModule();

    const response = await module.handleGoalTargets(deleteRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: TARGET_ID });
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });

  it("returns 404 without DELETE for a missing or cross-organization target", async () => {
    const { db, deleteMock } = buildDb({ preflightData: [] });
    createRequestClientMock.mockReturnValue(db);
    const module = await loadGoalTargetsModule();

    const response = await module.handleGoalTargets(deleteRequest());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Goal target not found" });
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("returns 409 when RLS preserves a preflighted archived target", async () => {
    const { db, deleteMock } = buildDb({ deleteData: [] });
    createRequestClientMock.mockReturnValue(db);
    const module = await loadGoalTargetsModule();

    const response = await module.handleGoalTargets(deleteRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Goal target has trial history or is no longer eligible for deletion",
    });
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });

  it("returns 502 for target-preflight infrastructure errors", async () => {
    const { db, deleteMock } = buildDb({
      preflightError: { message: "upstream unavailable" },
    });
    createRequestClientMock.mockReturnValue(db);
    const module = await loadGoalTargetsModule();

    const response = await module.handleGoalTargets(deleteRequest());

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Failed to load goal target" });
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("returns 502 for non-history DELETE infrastructure errors", async () => {
    const { db } = buildDb({
      deleteError: { code: "08006", message: "connection failure" },
    });
    createRequestClientMock.mockReturnValue(db);
    const module = await loadGoalTargetsModule();

    const response = await module.handleGoalTargets(deleteRequest());

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Failed to delete goal target" });
  });

  const buildProgressionDb = (rpcError: { code?: string; message: string } | null = null) => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "bcba-1" } }, error: null })) },
    rpc: vi.fn(async (name: string, args?: unknown) => {
      if (name === "current_user_organization_id") return { data: ORG_ID, error: null };
      if (name === "current_user_can_manage_programs_goals") return { data: true, error: null };
      if (name === "override_goal_target_progression") {
        return { data: rpcError ? null : [{ outcome: "manual_override", target_id: TARGET_ID }], error: rpcError };
      }
      if (name === "set_goal_target_phase_criterion") {
        return { data: rpcError ? null : { phase: "baseline" }, error: rpcError };
      }
      if (name === "reorder_goal_targets") {
        return { data: rpcError ? null : [{ id: TARGET_ID, sort_order: 0 }], error: rpcError };
      }
      throw new Error(`Unexpected RPC: ${name} ${JSON.stringify(args)}`);
    }),
    from: vi.fn(),
  });

  it("exposes the same manual override success envelope as the server adapter", async () => {
    const db = buildProgressionDb();
    createRequestClientMock.mockReturnValue(db);
    const module = await loadGoalTargetsModule();
    const response = await module.handleGoalTargets(new Request("https://edge.example.com/functions/v1/goal-targets", {
      method: "POST", headers: { Authorization: "Bearer token" }, body: JSON.stringify({
        action: "override_progression", target_id: TARGET_ID, target_phase: "teaching",
        current_target_id: null, reason: "Clinical review", expected_version: 2,
      }),
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ outcome: "manual_override", target_id: TARGET_ID });
    expect(db.rpc).toHaveBeenCalledWith("override_goal_target_progression", {
      target_goal_target_id: TARGET_ID, target_phase: "teaching", target_current_goal_target_id: null,
      reason: "Clinical review", expected_version: 2,
    });
  });

  it("maps stale manual override versions to the shared 409 envelope", async () => {
    createRequestClientMock.mockReturnValue(buildProgressionDb({ code: "40001", message: "stale progression version" }));
    const module = await loadGoalTargetsModule();
    const response = await module.handleGoalTargets(new Request("https://edge.example.com/functions/v1/goal-targets", {
      method: "POST", headers: { Authorization: "Bearer token" }, body: JSON.stringify({
        action: "override_progression", target_id: TARGET_ID, target_phase: "teaching",
        current_target_id: null, reason: "Clinical review", expected_version: 2,
      }),
    }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Progression version conflict" });
  });

  it("maps database out-of-scope progression rejection to 403", async () => {
    createRequestClientMock.mockReturnValue(buildProgressionDb({ code: "42501", message: "goal target is not in scope" }));
    const module = await loadGoalTargetsModule();
    const response = await module.handleGoalTargets(new Request("https://edge.example.com/functions/v1/goal-targets", {
      method: "POST", headers: { Authorization: "Bearer token" }, body: JSON.stringify({
        action: "override_progression", target_id: TARGET_ID, target_phase: "teaching",
        current_target_id: null, reason: "Clinical review", expected_version: 2,
      }),
    }));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("denies progression actions when the management capability rejects the caller", async () => {
    const db = buildProgressionDb();
    db.rpc.mockImplementation(async (name: string) => {
      if (name === "current_user_organization_id") return { data: ORG_ID, error: null };
      if (name === "current_user_can_manage_programs_goals") return { data: false, error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    });
    createRequestClientMock.mockReturnValue(db);
    const module = await loadGoalTargetsModule();
    const response = await module.handleGoalTargets(new Request("https://edge.example.com/functions/v1/goal-targets", {
      method: "POST", headers: { Authorization: "Bearer token" }, body: JSON.stringify({
        action: "override_progression", target_id: TARGET_ID, target_phase: "teaching",
        current_target_id: null, reason: "Clinical review", expected_version: 2,
      }),
    }));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("rejects empty override reasons before the RPC", async () => {
    const db = buildProgressionDb(); createRequestClientMock.mockReturnValue(db);
    const module = await loadGoalTargetsModule();
    const response = await module.handleGoalTargets(new Request("https://edge.example.com/functions/v1/goal-targets", {
      method: "POST", headers: { Authorization: "Bearer token" }, body: JSON.stringify({
        action: "override_progression", target_id: TARGET_ID, target_phase: "teaching",
        current_target_id: null, reason: " ", expected_version: 2,
      }),
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid request body" });
    expect(db.rpc).not.toHaveBeenCalledWith("override_goal_target_progression", expect.anything());
  });

  it("writes criteria through PUT and the dedicated caller-scoped RPC", async () => {
    const db = buildProgressionDb(); createRequestClientMock.mockReturnValue(db);
    const module = await loadGoalTargetsModule();
    const response = await module.handleGoalTargets(new Request("https://edge.example.com/functions/v1/goal-targets", {
      method: "PUT", headers: { Authorization: "Bearer token" }, body: JSON.stringify({ action: "set_criteria",
        target_id: TARGET_ID, phase: "baseline", metric: "percent_correct", comparator: "gte", threshold: 80,
        min_observations: 10, consecutive_sessions: 3, clinical_note: null, expected_version: 2 }),
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ phase: "baseline" });
    expect(db.rpc).toHaveBeenCalledWith("set_goal_target_phase_criterion", expect.objectContaining({
      target_goal_target_id: TARGET_ID, target_phase: "baseline", expected_version: 2,
    }));
  });

  it("rejects partial criteria and duplicate reorder ids before RPC", async () => {
    const db = buildProgressionDb(); createRequestClientMock.mockReturnValue(db);
    const module = await loadGoalTargetsModule();
    const partial = await module.handleGoalTargets(new Request("https://edge.example.com/functions/v1/goal-targets", {
      method: "PUT", headers: { Authorization: "Bearer token" }, body: JSON.stringify({ action: "set_criteria",
        target_id: TARGET_ID, phase: "baseline", metric: "percent_correct", comparator: null, threshold: 80,
        min_observations: 10, consecutive_sessions: 3, expected_version: 2 }),
    }));
    expect(partial.status).toBe(400);
    const duplicate = await module.handleGoalTargets(new Request("https://edge.example.com/functions/v1/goal-targets", {
      method: "POST", headers: { Authorization: "Bearer token" }, body: JSON.stringify({ action: "reorder",
        goal_id: "22222222-2222-4222-8222-222222222222", targets: [
          { target_id: TARGET_ID, expected_version: 2 }, { target_id: TARGET_ID, expected_version: 2 },
        ] }),
    }));
    expect(duplicate.status).toBe(400);
    expect(db.rpc).not.toHaveBeenCalledWith("set_goal_target_phase_criterion", expect.anything());
    expect(db.rpc).not.toHaveBeenCalledWith("reorder_goal_targets", expect.anything());
  });

  it("reorders through the dedicated RPC and maps stale/full-set conflicts", async () => {
    const request = () => new Request("https://edge.example.com/functions/v1/goal-targets", {
      method: "POST", headers: { Authorization: "Bearer token" }, body: JSON.stringify({ action: "reorder",
        goal_id: "22222222-2222-4222-8222-222222222222", targets: [{ target_id: TARGET_ID, expected_version: 2 }] }),
    });
    let db = buildProgressionDb(); createRequestClientMock.mockReturnValue(db);
    let module = await loadGoalTargetsModule();
    let response = await module.handleGoalTargets(request());
    expect(response.status).toBe(200);
    expect(db.rpc).toHaveBeenCalledWith("reorder_goal_targets", {
      target_goal_id: "22222222-2222-4222-8222-222222222222", ordered_target_ids: [TARGET_ID], expected_versions: [2],
    });
    vi.resetModules(); db = buildProgressionDb({ code: "40001", message: "stale or mixed target set" });
    createRequestClientMock.mockReturnValue(db); module = await loadGoalTargetsModule(); response = await module.handleGoalTargets(request());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Progression version conflict" });
  });

  it("reads ordered criteria and rejects unknown GET actions", async () => {
    const criteriaOrder = vi.fn(async () => ({ data: [
      { phase: "mastery" }, { phase: "baseline" }, { phase: "teaching" }, { phase: "generalization" },
    ], error: null }));
    const historyOrder2 = vi.fn(async () => ({ data: [{ id: "transition-1" }], error: null }));
    const historyOrder1 = vi.fn(() => ({ order: historyOrder2 }));
    const criteriaEq2 = vi.fn(() => ({ order: criteriaOrder }));
    const firstEq = vi.fn((column: string) => column === "target_id" ? criteriaEq2() : ({
      eq: vi.fn(() => ({ order: historyOrder1 })), order: historyOrder1,
    }));
    const db = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "bcba-1" } }, error: null })) },
      rpc: vi.fn(async () => ({ data: ORG_ID, error: null })),
      from: vi.fn((table: string) => ({ select: vi.fn(() => ({
        eq: table === "goal_target_phase_criteria" ? vi.fn(() => ({ eq: firstEq })) :
          vi.fn(() => ({ eq: vi.fn(() => ({ order: historyOrder1 })) })),
      })) })),
    };
    createRequestClientMock.mockReturnValue(db);
    const module = await loadGoalTargetsModule();
    const criteria = await module.handleGoalTargets(new Request(
      `https://edge.example.com/functions/v1/goal-targets?action=criteria&target_id=${TARGET_ID}`,
      { headers: { Authorization: "Bearer token" } },
    ));
    expect((await criteria.json()).map((row: { phase: string }) => row.phase)).toEqual([
      "baseline", "teaching", "generalization", "mastery",
    ]);
    const unknown = await module.handleGoalTargets(new Request(
      `https://edge.example.com/functions/v1/goal-targets?action=surprise&target_id=${TARGET_ID}`,
      { headers: { Authorization: "Bearer token" } },
    ));
    expect(unknown.status).toBe(400);
    await expect(unknown.json()).resolves.toEqual({ error: "Invalid action" });
  });

  it("reads tenant-scoped transition history in deterministic order", async () => {
    const secondOrder = vi.fn(async () => ({ data: [{ id: "transition-1" }], error: null }));
    const firstOrder = vi.fn(() => ({ order: secondOrder }));
    const targetEq = vi.fn(() => ({ order: firstOrder }));
    const organizationEq = vi.fn(() => ({ eq: targetEq }));
    const db = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "bcba-1" } }, error: null })) },
      rpc: vi.fn(async () => ({ data: ORG_ID, error: null })),
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: organizationEq })) })),
    };
    createRequestClientMock.mockReturnValue(db);
    const module = await loadGoalTargetsModule();
    const response = await module.handleGoalTargets(new Request(
      `https://edge.example.com/functions/v1/goal-targets?action=transition_history&target_id=${TARGET_ID}`,
      { headers: { Authorization: "Bearer token" } },
    ));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([{ id: "transition-1" }]);
    expect(organizationEq).toHaveBeenCalledWith("organization_id", ORG_ID);
    expect(targetEq).toHaveBeenCalledWith("target_id", TARGET_ID);
    expect(firstOrder).toHaveBeenCalledWith("transitioned_at", { ascending: false });
    expect(secondOrder).toHaveBeenCalledWith("id", { ascending: false });
  });
});
