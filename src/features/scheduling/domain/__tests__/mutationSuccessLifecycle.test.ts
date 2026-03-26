import { describe, expect, it } from "vitest";
import { applyScheduleMutationSuccessLifecycle } from "../mutationSuccessLifecycle";

describe("mutationSuccessLifecycle", () => {
  it("applies create-success invalidation before reset branch", () => {
    const callOrder: string[] = [];

    const plan = applyScheduleMutationSuccessLifecycle({
      kind: "create-success",
      invalidateQuery: (queryKey) => {
        callOrder.push(`invalidate:${queryKey}`);
      },
      applyResetBranch: (branch) => {
        callOrder.push(`reset:${branch.kind}`);
      },
    });

    expect(callOrder).toEqual([
      "invalidate:sessions",
      "invalidate:sessions-batch",
      "reset:create-success",
    ]);
    expect(plan.resetBranch).toEqual({ kind: "create-success" });
  });

  it("keeps update-success reset branch distinct", () => {
    const callOrder: string[] = [];

    const plan = applyScheduleMutationSuccessLifecycle({
      kind: "update-success",
      invalidateQuery: (queryKey) => {
        callOrder.push(`invalidate:${queryKey}`);
      },
      applyResetBranch: (branch) => {
        callOrder.push(`reset:${branch.kind}`);
      },
    });

    expect(callOrder).toEqual([
      "invalidate:sessions",
      "invalidate:sessions-batch",
      "reset:update-success",
    ]);
    expect(plan.resetBranch).toEqual({ kind: "update-success" });
  });
});
