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
});
