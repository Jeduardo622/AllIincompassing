import { describe, expect, it } from "vitest";
import { planScheduleMutationLifecycle } from "../mutationLifecyclePlan";

describe("mutationLifecyclePlan", () => {
  it("keeps create-success reset branch distinct from update-success", () => {
    const createPlan = planScheduleMutationLifecycle({
      kind: "create-success",
    });
    const updatePlan = planScheduleMutationLifecycle({
      kind: "update-success",
    });

    expect(createPlan).toEqual({
      phase: "success",
      invalidateQueryKeys: ["sessions", "sessions-batch"],
      resetBranch: { kind: "create-success" },
    });
    expect(updatePlan).toEqual({
      phase: "success",
      invalidateQueryKeys: ["sessions", "sessions-batch"],
      resetBranch: { kind: "update-success" },
    });
  });

  it("returns conflict error plan for 409 with retry hint", () => {
    const plan = planScheduleMutationLifecycle({
      kind: "mutation-error",
      status: 409,
      retryHint: "slot conflict",
    });

    expect(plan).toEqual({
      phase: "error",
      errorKind: "conflict",
      resetBranch: {
        kind: "mutation-error",
        retryHint: "slot conflict",
        source: "409",
      },
    });
  });

  it("returns non-conflict error plan for non-409 status", () => {
    const plan = planScheduleMutationLifecycle({
      kind: "mutation-error",
      status: 500,
      retryHint: "should not pass through",
    });

    expect(plan).toEqual({
      phase: "error",
      errorKind: "non-conflict",
      resetBranch: {
        kind: "mutation-error",
        retryHint: null,
        source: "non409",
      },
    });
  });

  it("returns non-conflict error plan for undefined status", () => {
    const plan = planScheduleMutationLifecycle({
      kind: "mutation-error",
      status: undefined,
      retryHint: null,
    });

    expect(plan).toEqual({
      phase: "error",
      errorKind: "non-conflict",
      resetBranch: {
        kind: "mutation-error",
        retryHint: null,
        source: "non409",
      },
    });
  });
});
