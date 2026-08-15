import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({
  approvePayrollTimesheet: vi.fn(),
  fetchPayrollReviewDetails: vi.fn(),
  fetchPayrollReviewQueue: vi.fn(),
  fetchPayrollSelfApproval: vi.fn(),
  hasPayrollReviewRouteAccess: vi.fn((capabilities) =>
    capabilities.canReviewAssigned
    || capabilities.canApproveAssigned
    || capabilities.hasOrgPayrollAccess
  ),
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
    vi.clearAllMocks();
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
      queue: [{
        employeeLabel: "Employee 1001",
        employmentProfileId: "99999999-9999-4999-8999-999999999999",
        payPeriodId: "88888888-8888-4888-8888-888888888888",
        periodStart: "2026-08-10",
        periodEnd: "2026-08-16",
        state: "submitted",
        blockerCount: 0,
        submittedAt: "2026-08-12T18:00:00.000Z",
        snapshot: {
          id: "11111111-1111-1111-1111-111111111111",
          hash: "a".repeat(64),
        },
        classifiedSeconds: { regular: 0, overtime: 0, doubleTime: 0 },
      }],
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

  it.each([
    [
      "queue state is non-ok",
      {
        state: "feature_disabled",
        selectedLocalDate: "2026-08-12",
        capabilities: {
          canReviewAssigned: true,
          canApproveAssigned: true,
          canViewCompensation: false,
          hasOrgPayrollAccess: false,
        },
        queue: [{
          snapshot: { id: "11111111-1111-1111-1111-111111111111", hash: "a".repeat(64) },
        }],
      },
    ],
    [
      "review capabilities are absent",
      {
        state: "ok",
        selectedLocalDate: "2026-08-12",
        capabilities: {
          canReviewAssigned: false,
          canApproveAssigned: false,
          canViewCompensation: false,
          hasOrgPayrollAccess: false,
        },
        queue: [{
          snapshot: { id: "11111111-1111-1111-1111-111111111111", hash: "a".repeat(64) },
        }],
      },
    ],
    [
      "the exact selected row is absent",
      {
        state: "ok",
        selectedLocalDate: "2026-08-12",
        capabilities: {
          canReviewAssigned: true,
          canApproveAssigned: false,
          canViewCompensation: false,
          hasOrgPayrollAccess: false,
        },
        queue: [{
          snapshot: { id: "22222222-2222-4222-8222-222222222222", hash: "b".repeat(64) },
        }],
      },
    ],
  ])("keeps review details disabled when %s", async (_reason, queueResponse) => {
    vi.mocked(fetchPayrollReviewQueue).mockResolvedValueOnce(queueResponse as never);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    renderWithClient(<Probe />, client);

    await waitFor(() => expect(client.getQueryState(
      payrollReviewQueueQueryKey("org-1", "user-1", "2026-08-12"),
    )?.status).toBe("success"));
    expect(fetchPayrollReviewDetails).not.toHaveBeenCalled();
    expect(client.getQueryState(
      payrollReviewDetailsQueryKey(
        "org-1",
        "user-1",
        "11111111-1111-1111-1111-111111111111",
        "a".repeat(64),
      ),
    )?.fetchStatus).toBe("idle");
  });

  it("fetches review details when org payroll access is granted without assigned-review flags", async () => {
    vi.mocked(fetchPayrollReviewQueue).mockResolvedValueOnce({
      state: "ok",
      selectedLocalDate: "2026-08-12",
      capabilities: {
        canReviewAssigned: false,
        canApproveAssigned: false,
        canViewCompensation: false,
        hasOrgPayrollAccess: true,
      },
      queue: [{
        employeeLabel: "Employee 1001",
        employmentProfileId: "99999999-9999-4999-8999-999999999999",
        payPeriodId: "88888888-8888-4888-8888-888888888888",
        periodStart: "2026-08-10",
        periodEnd: "2026-08-16",
        state: "submitted",
        blockerCount: 0,
        submittedAt: "2026-08-12T18:00:00.000Z",
        snapshot: {
          id: "11111111-1111-1111-1111-111111111111",
          hash: "a".repeat(64),
        },
        classifiedSeconds: { regular: 0, overtime: 0, doubleTime: 0 },
      }],
    } as never);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const detailsKey = payrollReviewDetailsQueryKey(
      "org-1",
      "user-1",
      "11111111-1111-1111-1111-111111111111",
      "a".repeat(64),
    );

    renderWithClient(<Probe />, client);

    await waitFor(() => expect(client.getQueryState(detailsKey)?.status).toBe("success"));
    expect(fetchPayrollReviewDetails).toHaveBeenCalledWith(expect.objectContaining({
      snapshotId: "11111111-1111-1111-1111-111111111111",
      snapshotHash: "a".repeat(64),
    }));
  });

  it("does not cache review details when compensation is rejected without capability", async () => {
    const invalidResponse = Object.assign(new Error("Invalid payroll approval response."), {
      code: "invalid_response",
      status: 502,
    });
    vi.mocked(fetchPayrollReviewDetails).mockRejectedValueOnce(invalidResponse);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const detailsKey = payrollReviewDetailsQueryKey(
      "org-1",
      "user-1",
      "11111111-1111-1111-1111-111111111111",
      "a".repeat(64),
    );

    renderWithClient(<Probe />, client);

    await waitFor(() => expect(client.getQueryState(detailsKey)?.status).toBe("error"));
    expect(client.getQueryData(detailsKey)).toBeUndefined();
    expect(client.getQueryState(detailsKey)?.error).toMatchObject({
      code: "invalid_response",
      status: 502,
    });
    expect(fetchPayrollReviewDetails).toHaveBeenCalledWith(expect.objectContaining({
      canViewCompensation: false,
    }));
  });

  it("caches compensation details only when the queue grants the capability", async () => {
    vi.mocked(fetchPayrollReviewQueue).mockResolvedValueOnce({
      state: "ok",
      selectedLocalDate: "2026-08-12",
      capabilities: {
        canReviewAssigned: true,
        canApproveAssigned: true,
        canViewCompensation: true,
        hasOrgPayrollAccess: false,
      },
      queue: [{
        employeeLabel: "Employee 1001",
        employmentProfileId: "99999999-9999-4999-8999-999999999999",
        payPeriodId: "88888888-8888-4888-8888-888888888888",
        periodStart: "2026-08-10",
        periodEnd: "2026-08-16",
        state: "submitted",
        blockerCount: 0,
        submittedAt: "2026-08-12T18:00:00.000Z",
        snapshot: {
          id: "11111111-1111-1111-1111-111111111111",
          hash: "a".repeat(64),
        },
        classifiedSeconds: { regular: 0, overtime: 0, doubleTime: 0 },
      }],
    } as never);
    vi.mocked(fetchPayrollReviewDetails).mockResolvedValueOnce({
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
      compensation: { grossEarningsCents: 123456 },
    } as never);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const detailsKey = payrollReviewDetailsQueryKey(
      "org-1",
      "user-1",
      "11111111-1111-1111-1111-111111111111",
      "a".repeat(64),
    );

    renderWithClient(<Probe />, client);

    await waitFor(() => expect(client.getQueryData(detailsKey)).toMatchObject({
      compensation: { grossEarningsCents: 123456 },
    }));
    expect(fetchPayrollReviewDetails).toHaveBeenCalledWith(expect.objectContaining({
      canViewCompensation: true,
    }));
  });
});
