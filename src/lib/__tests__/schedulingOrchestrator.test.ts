import { describe, expect, it } from "vitest";
import { __TESTING__ } from "../../../supabase/functions/_shared/scheduling-orchestrator.ts";

describe("scheduling-orchestrator helpers", () => {
  it("builds rollback plans for hold/confirm workflows", () => {
    const holdPlan = __TESTING__.buildRollbackPlan("hold", "THERAPIST_CONFLICT", "2026-02-02T10:00:00Z", "hold-1");
    expect(holdPlan).toMatchObject({
      action: "retry_hold",
      holdKey: "hold-1",
      retryAfter: "2026-02-02T10:00:00Z",
      conflictCode: "THERAPIST_CONFLICT",
    });

    const confirmPlan = __TESTING__.buildRollbackPlan("confirm", null, null, "hold-2");
    expect(confirmPlan).toMatchObject({
      action: "retry_hold",
      holdKey: "hold-2",
    });
  });

  it("computes duration minutes safely", () => {
    expect(__TESTING__.computeDurationMinutes(null, null)).toBeNull();
    expect(
      __TESTING__.computeDurationMinutes("2026-02-02T10:00:00Z", "2026-02-02T11:30:00Z"),
    ).toBe(90);
  });

  it("builds an AI message including workflow and conflict code", () => {
    const message = __TESTING__.buildAiMessage("hold", { conflictCode: "CLIENT_CONFLICT" });
    expect(message).toContain("Scheduling delegation for hold.");
    expect(message).toContain("conflictCode=CLIENT_CONFLICT");
  });
});
