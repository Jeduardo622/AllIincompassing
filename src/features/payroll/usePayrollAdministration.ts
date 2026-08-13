import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchPayrollReviewDetails,
  fetchPayrollReviewQueue,
  lockPayrollTimesheet,
  resolvePayrollBlocker,
  reopenPayrollTimesheet,
  type PayrollScope,
} from "./api";
import {
  executePayrollAdministrationAction,
  fetchPayrollAdministration,
} from "./administrationApi";

export const payrollAdministrationQueryKey = (
  organizationId: string,
  userId: string,
  localDate: string,
) => ["payroll-administration", organizationId, userId, localDate] as const;

export const payrollAdministrationDetailsKey = (
  organizationId: string,
  userId: string,
  snapshotId: string,
  snapshotHash: string,
) => ["payroll-administration-review-details", organizationId, userId, snapshotId, snapshotHash] as const;

export const payrollAdministrationQueueKey = (
  organizationId: string,
  userId: string,
  localDate: string,
) => ["payroll-administration-review-queue", organizationId, userId, localDate] as const;

export function usePayrollAdministration(
  scope: PayrollScope,
  options: {
    enabled?: boolean;
    selectedReview?: { snapshotId: string; snapshotHash: string } | null;
    queueEnabled?: boolean;
  } = {},
) {
  const queryClient = useQueryClient();
  const administrationKey = payrollAdministrationQueryKey(scope.organizationId, scope.userId, scope.localDate);
  const queueKey = payrollAdministrationQueueKey(scope.organizationId, scope.userId, scope.localDate);
  const selectedReview = options.selectedReview ?? null;
  const detailsKey = selectedReview
    ? payrollAdministrationDetailsKey(
      scope.organizationId,
      scope.userId,
      selectedReview.snapshotId,
      selectedReview.snapshotHash,
    )
    : null;

  const administrationQuery = useQuery({
    queryKey: administrationKey,
    queryFn: () => fetchPayrollAdministration(scope),
    enabled: options.enabled ?? true,
  });

  const reviewQueueQuery = useQuery({
    queryKey: queueKey,
    queryFn: () => fetchPayrollReviewQueue(scope),
    enabled: options.queueEnabled ?? (options.enabled ?? true),
  });

  const reviewQueue = reviewQueueQuery.data;
  const administrationCapabilities = administrationQuery.data?.capabilities;
  const reviewDetailsEnabled = Boolean(
    selectedReview
    && administrationQuery.data?.state === "ok"
    && reviewQueue?.state === "ok"
    && reviewQueue.queue.some((item) => (
      item.snapshot.id === selectedReview.snapshotId
      && item.snapshot.hash === selectedReview.snapshotHash
    )),
  );

  const reviewDetailsQuery = useQuery({
    queryKey: detailsKey ?? ["payroll-administration-review-details", "disabled"],
    queryFn: () => fetchPayrollReviewDetails({
      ...scope,
      snapshotId: selectedReview!.snapshotId,
      snapshotHash: selectedReview!.snapshotHash,
      canViewCompensation: administrationCapabilities!.canViewCompensation,
    }),
    enabled: reviewDetailsEnabled,
  });

  const invalidateAll = async () => {
    await queryClient.invalidateQueries({ queryKey: administrationKey });
    await queryClient.invalidateQueries({ queryKey: queueKey });
    if (detailsKey) {
      await queryClient.invalidateQueries({ queryKey: detailsKey });
    }
  };

  const administrationActionMutation = useMutation({
    mutationFn: executePayrollAdministrationAction,
    onSuccess: invalidateAll,
    networkMode: "always",
  });

  const lockPayrollTimesheetMutation = useMutation({
    mutationFn: lockPayrollTimesheet,
    onSuccess: invalidateAll,
    networkMode: "always",
  });

  const reopenPayrollTimesheetMutation = useMutation({
    mutationFn: reopenPayrollTimesheet,
    onSuccess: invalidateAll,
    networkMode: "always",
  });

  const resolvePayrollBlockerMutation = useMutation({
    mutationFn: resolvePayrollBlocker,
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: administrationKey });
      await queryClient.invalidateQueries({ queryKey: queueKey });
      await queryClient.invalidateQueries({
        queryKey: payrollAdministrationDetailsKey(
          variables.organizationId,
          variables.userId,
          variables.snapshotId,
          variables.snapshotHash,
        ),
      });
    },
    networkMode: "always",
  });

  return {
    administrationQuery,
    reviewQueueQuery,
    reviewDetailsQuery,
    administrationActionMutation,
    lockPayrollTimesheetMutation,
    resolvePayrollBlockerMutation,
    reopenPayrollTimesheetMutation,
  };
}
