import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  approvePayrollTimesheet,
  fetchPayrollReviewDetails,
  fetchPayrollReviewQueue,
  fetchPayrollSelfApproval,
  returnPayrollTimesheet,
  submitPayrollApproval,
  type PayrollScope,
} from "./api";

export const payrollTimesheetPeriodReviewQueryKey = (
  organizationId: string,
  userId: string,
  localDate: string,
) => ["payroll-timesheet-period", organizationId, userId, localDate] as const;

export const payrollSelfApprovalQueryKey = (
  organizationId: string,
  userId: string,
  localDate: string,
) => ["payroll-self-approval", organizationId, userId, localDate] as const;

export const payrollReviewQueueQueryKey = (
  organizationId: string,
  userId: string,
  localDate: string,
) => ["payroll-review-queue", organizationId, userId, localDate] as const;

export const payrollReviewDetailsQueryKey = (
  organizationId: string,
  userId: string,
  snapshotId: string,
  snapshotHash: string,
) => ["payroll-review-details", organizationId, userId, snapshotId, snapshotHash] as const;

export const invalidatePayrollApprovalDeriveContext = async (
  queryClient: QueryClient,
  scope: PayrollScope,
) => {
  await queryClient.invalidateQueries({
    queryKey: payrollTimesheetPeriodReviewQueryKey(scope.organizationId, scope.userId, scope.localDate),
  });
  await queryClient.invalidateQueries({
    queryKey: payrollSelfApprovalQueryKey(scope.organizationId, scope.userId, scope.localDate),
  });
  await queryClient.invalidateQueries({
    queryKey: payrollReviewQueueQueryKey(scope.organizationId, scope.userId, scope.localDate),
  });
};

export function usePayrollApprovals(
  scope: PayrollScope,
  options: {
    selfEnabled?: boolean;
    queueEnabled?: boolean;
    details?: { snapshotId: string; snapshotHash: string } | null;
  } = {},
) {
  const queryClient = useQueryClient();
  const selfKey = payrollSelfApprovalQueryKey(scope.organizationId, scope.userId, scope.localDate);
  const queueKey = payrollReviewQueueQueryKey(scope.organizationId, scope.userId, scope.localDate);
  const detailsKey = options.details
    ? payrollReviewDetailsQueryKey(
      scope.organizationId,
      scope.userId,
      options.details.snapshotId,
      options.details.snapshotHash,
    )
    : null;

  const payrollSelfApprovalQuery = useQuery({
    queryKey: selfKey,
    queryFn: () => fetchPayrollSelfApproval(scope),
    enabled: options.selfEnabled ?? true,
  });

  const payrollReviewQueueQuery = useQuery({
    queryKey: queueKey,
    queryFn: () => fetchPayrollReviewQueue(scope),
    enabled: options.queueEnabled ?? true,
  });

  const reviewQueue = payrollReviewQueueQuery.data;
  const requestedDetails = options.details;
  const detailsEnabled = Boolean(
    requestedDetails
    && reviewQueue?.state === "ok"
    && (reviewQueue.capabilities.canReviewAssigned || reviewQueue.capabilities.canApproveAssigned)
    && reviewQueue.queue.some((item) => (
      item.snapshot.id === requestedDetails.snapshotId
      && item.snapshot.hash === requestedDetails.snapshotHash
    )),
  );

  const payrollReviewDetailsQuery = useQuery({
    queryKey: detailsKey ?? ["payroll-review-details", "disabled"],
    queryFn: () => fetchPayrollReviewDetails({
      ...scope,
      snapshotId: options.details!.snapshotId,
      snapshotHash: options.details!.snapshotHash,
    }),
    enabled: detailsEnabled,
  });

  const submitPayrollApprovalMutation = useMutation({
    mutationFn: submitPayrollApproval,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: selfKey });
      await queryClient.invalidateQueries({
        queryKey: payrollTimesheetPeriodReviewQueryKey(scope.organizationId, scope.userId, scope.localDate),
      });
      await queryClient.invalidateQueries({ queryKey: queueKey });
      if (detailsKey) {
        await queryClient.invalidateQueries({ queryKey: detailsKey });
      }
    },
    networkMode: "always",
  });

  const approvePayrollTimesheetMutation = useMutation({
    mutationFn: approvePayrollTimesheet,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queueKey });
      if (detailsKey) {
        await queryClient.invalidateQueries({ queryKey: detailsKey });
      }
    },
    networkMode: "always",
  });

  const returnPayrollTimesheetMutation = useMutation({
    mutationFn: returnPayrollTimesheet,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queueKey });
      if (detailsKey) {
        await queryClient.invalidateQueries({ queryKey: detailsKey });
      }
    },
    networkMode: "always",
  });

  return {
    payrollSelfApprovalQuery,
    payrollReviewQueueQuery,
    payrollReviewDetailsQuery,
    submitPayrollApprovalMutation,
    approvePayrollTimesheetMutation,
    returnPayrollTimesheetMutation,
  };
}
