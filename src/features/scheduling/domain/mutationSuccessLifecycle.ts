import {
  planScheduleMutationLifecycle,
  type ScheduleMutationLifecycleSuccessPlan,
} from "./mutationLifecyclePlan";

type MutationSuccessKind = "create-success" | "update-success";

export const applyScheduleMutationSuccessLifecycle = ({
  kind,
  invalidateQuery,
  applyResetBranch,
}: {
  kind: MutationSuccessKind;
  invalidateQuery: (
    queryKey: ScheduleMutationLifecycleSuccessPlan["invalidateQueryKeys"][number],
  ) => void;
  applyResetBranch: (
    branch: ScheduleMutationLifecycleSuccessPlan["resetBranch"],
  ) => void;
}): ScheduleMutationLifecycleSuccessPlan => {
  const plan = planScheduleMutationLifecycle({ kind });

  for (const queryKey of plan.invalidateQueryKeys) {
    invalidateQuery(queryKey);
  }

  applyResetBranch(plan.resetBranch);

  return plan;
};
