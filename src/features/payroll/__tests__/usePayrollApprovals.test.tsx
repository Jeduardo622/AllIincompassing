import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({
  approvePayrollTimesheet: vi.fn(),
  fetchPayrollReviewDetails: vi.fn(),
  fetchPayrollReviewQueue: vi.fn(),
  fetchPayrollSelfApproval: vi.fn(),
  returnPayrollTimesheet: vi.fn(),
  submitPayrollApproval: vi.fn(),
}));

import {
  approvePayrollTimesheet,
  fetchPayrollReviewDetails,
  fetchPayrollReviewQueue,
  fetchPayrollSelfApproval,
  returnPayrollTimesheet,
  submitPayrollApproval,
} from "../api";
import {
  payrollReviewDetailsQueryKey,
  payrollReviewQueueQueryKey,
  payrollSelfApprovalQueryKey,
  usePayrollApprovals,
} from "../usePayrollApprovals";

const scope = {
  organizationId: "org-1",
  userId: "user-1",
  localDate: "2026-08-12",
};

const renderWithClient = (ui: React.ReactNode, client: QueryClient) =>
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);

function Probe() {
  const approvals = usePayrollApprovals(scope, {
    details: {
      snapshotId: "11111111-1111-1111-1111-111111111111",
      snapshotHash: "a".repeat(64),
    },
  });
  return (
    <div>
      <span>{approvals.payrollSelfApprovalQuery.data?.state ?? "loading"}</span>
      <button
        type="button"
        onClick={() => void approvals.submitPayrollApprovalMutation.mutateAsync({
          ...scope,
          idempotencyKey: "submit-key",
          snapshotId: "11111111-1111-1111-1111-111111111111",
          snapshotHash: "a".repeat(64),
          attestation: true,
        })}
      >
        submit
      </button>
      <button
        type="button"
        onClick={() => void approvals.approvePayrollTimesheetMutation.mutateAsync({
          ...scope,
          idempotencyKey: "approve-key",
          snapshotId: "11111111-1111-1111-1111-111111111111",
          snapshotHash: "a".repeat(64),
        })}
      >
        approve
      </button>
      <button
        type="button"
        onClick={() => void approvals.returnPayrollTimesheetMutation.mutateAsync({
          ...scope,
          idempotencyKey: "return-key",
          snapshotId: "11111111-1111-1111-1111-111111111111",
          snapshotHash: "a".repeat(64),
          comment: "Needs correction.",
        })}
      >
        return
      </button>
    </div>
  );
}

describe("usePayrollApprovals", () => {
  beforeEach(() => {
    vi.mocked(fetchPayrollSelfApproval).mockResolvedValue({
      state: "ok",
      selectedLocalDate: "2026-08-12",
      approval: {
        currentState: "submitted",
        submittedAt: null,
        returnedComment: null,
        unresolvedBlockerCount: 0,
        snapshot: {
          id: "11111111-1111-1111-1111-111111111111",
          hash: "a".repeat(64),
          isCurrent: true,
        },
        actions: { canSubmit: true },
        history: [],
      },
    } as never);
    vi.mocked(fetchPayrollReviewQueue).mockResolvedValue({
      state: "ok",
      selectedLocalDate: "2026-08-12",
      capabilities: {
        canReviewAssigned: true,
        canApproveAssigned: true,
        canViewCompensation: false,
        hasOrgPayrollAccess: false,
      },
      queue: [],
    } as never);
    vi.mocked(fetchPayrollReviewDetails).mockResolvedValue({
      state: "ok",
      snapshotId: "11111111-1111-1111-1111-111111111111",
      snapshotHash: "a".repeat(64),
      periodStart: "2026-08-10",
      periodEnd: "2026-08-16",
      punches: [],
      classifiedSeconds: { regular: 0, overtime: 0, doubleTime: 0 },
      approvalHistory: [],
      blockers: [],
      unresolvedBlockerCount: 0,
    } as never);
    vi.mocked(submitPayrollApproval).mockResolvedValue({} as never);
    vi.mocked(approvePayrollTimesheet).mockResolvedValue({} as never);
    vi.mocked(returnPayrollTimesheet).mockResolvedValue({} as never);
  });

  it("uses exact scoped keys for self, queue, and details", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithClient(<Probe />, client);

    expect(await screen.findByText("ok")).toBeInTheDocument();
    expect(client.getQueryData(payrollSelfApprovalQueryKey("org-1", "user-1", "2026-08-12"))).toBeTruthy();
    expect(client.getQueryData(payrollReviewQueueQueryKey("org-1", "user-1", "2026-08-12"))).toBeTruthy();
    expect(client.getQueryData(payrollReviewDetailsQueryKey("org-1", "user-1", "11111111-1111-1111-1111-111111111111", "a".repeat(64)))).toBeTruthy();
  });

  it("invalidates self, period, queue, and selected details on submit", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    renderWithClient(<Probe />, client);

    await screen.findByText("ok");
    screen.getByRole("button", { name: "submit" }).click();

    await waitFor(() => expect(vi.mocked(submitPayrollApproval)).toHaveBeenCalled());
    expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: payrollSelfApprovalQueryKey("org-1", "user-1", "2026-08-12") }));
    expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: payrollReviewQueueQueryKey("org-1", "user-1", "2026-08-12") }));
    expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: payrollReviewDetailsQueryKey("org-1", "user-1", "11111111-1111-1111-1111-111111111111", "a".repeat(64)) }));
  });
});
