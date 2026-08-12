import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../administrationApi", () => ({
  executePayrollAdministrationAction: vi.fn(),
  fetchPayrollAdministration: vi.fn(),
}));

vi.mock("../api", () => ({
  fetchPayrollReviewDetails: vi.fn(),
  fetchPayrollReviewQueue: vi.fn(),
  lockPayrollTimesheet: vi.fn(),
  reopenPayrollTimesheet: vi.fn(),
}));

import {
  executePayrollAdministrationAction,
  fetchPayrollAdministration,
} from "../administrationApi";
import {
  fetchPayrollReviewDetails,
  fetchPayrollReviewQueue,
  lockPayrollTimesheet,
  reopenPayrollTimesheet,
} from "../api";
import {
  payrollAdministrationDetailsKey,
  payrollAdministrationQueryKey,
  payrollAdministrationQueueKey,
  usePayrollAdministration,
} from "../usePayrollAdministration";

const scope = {
  organizationId: "org-1",
  userId: "user-1",
  localDate: "2026-08-12",
};

function Probe() {
  const payrollAdministration = usePayrollAdministration(scope, {
    selectedReview: {
      snapshotId: "11111111-1111-1111-1111-111111111111",
      snapshotHash: "a".repeat(64),
    },
  });
  return (
    <div>
      <span>{payrollAdministration.administrationQuery.data?.state ?? "loading"}</span>
      <button
        type="button"
        onClick={() => void payrollAdministration.administrationActionMutation.mutateAsync({
          idempotencyKey: "admin-key",
          action: {
            action: "generate_periods",
            payGroupId: "22222222-2222-4222-8222-222222222222",
            from: "2026-08-01",
            to: "2026-08-31",
          },
        })}
      >
        admin-action
      </button>
      <button
        type="button"
        onClick={() => void payrollAdministration.lockPayrollTimesheetMutation.mutateAsync({
          ...scope,
          idempotencyKey: "lock-key",
          snapshotId: "11111111-1111-1111-1111-111111111111",
          snapshotHash: "a".repeat(64),
        })}
      >
        lock
      </button>
      <button
        type="button"
        onClick={() => void payrollAdministration.reopenPayrollTimesheetMutation.mutateAsync({
          ...scope,
          idempotencyKey: "reopen-key",
          snapshotId: "11111111-1111-1111-1111-111111111111",
          snapshotHash: "a".repeat(64),
          reason: "Need correction.",
        })}
      >
        reopen
      </button>
    </div>
  );
}

describe("usePayrollAdministration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchPayrollAdministration).mockResolvedValue({
      state: "ok",
      selectedLocalDate: "2026-08-12",
      capabilities: {
        canConfigureEmployment: true,
        canResolveExceptions: true,
        canLockPeriod: true,
        canReopenPeriod: true,
        canGeneratePeriods: true,
        canViewCompensation: false,
        canManagePolicyMutations: false,
      },
      orgSettings: [],
      policies: [],
      employments: [],
      payGroups: [],
      generationVersions: [],
      payPeriods: [],
      bounds: {
        orgSettings: 50,
        policies: 20,
        employments: 50,
        payGroups: 50,
        generationVersions: 50,
        payPeriods: 50,
      },
    } as never);
    vi.mocked(fetchPayrollReviewQueue).mockResolvedValue({
      state: "ok",
      selectedLocalDate: "2026-08-12",
      capabilities: {
        canReviewAssigned: true,
        canApproveAssigned: true,
        canViewCompensation: false,
        hasOrgPayrollAccess: true,
      },
      queue: [{
        employeeLabel: "Employee 1",
        employmentProfileId: "99999999-9999-4999-8999-999999999999",
        payPeriodId: "88888888-8888-4888-8888-888888888888",
        periodStart: "2026-08-01",
        periodEnd: "2026-08-14",
        state: "manager_approved",
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
      periodStart: "2026-08-01",
      periodEnd: "2026-08-14",
      punches: [],
      classifiedSeconds: { regular: 0, overtime: 0, doubleTime: 0 },
      approvalHistory: [],
      blockers: [],
      unresolvedBlockerCount: 0,
    } as never);
    vi.mocked(executePayrollAdministrationAction).mockResolvedValue({ action: "generate_periods", payGroupId: "22222222-2222-4222-8222-222222222222", generatedCount: 2, replayed: false, idempotencyKey: "admin-key" } as never);
    vi.mocked(lockPayrollTimesheet).mockResolvedValue({} as never);
    vi.mocked(reopenPayrollTimesheet).mockResolvedValue({} as never);
  });

  it("uses exact scoped keys for administration, queue, and details", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("ok")).toBeInTheDocument();
    expect(client.getQueryData(payrollAdministrationQueryKey("org-1", "user-1", "2026-08-12"))).toBeTruthy();
    expect(client.getQueryData(payrollAdministrationQueueKey("org-1", "user-1", "2026-08-12"))).toBeTruthy();
    expect(client.getQueryData(payrollAdministrationDetailsKey("org-1", "user-1", "11111111-1111-1111-1111-111111111111", "a".repeat(64)))).toBeTruthy();
  });

  it("invalidates administration, queue, and selected details after administration mutations", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );

    await screen.findByText("ok");
    screen.getByRole("button", { name: "admin-action" }).click();

    await waitFor(() => expect(vi.mocked(executePayrollAdministrationAction)).toHaveBeenCalled());
    expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: payrollAdministrationQueryKey("org-1", "user-1", "2026-08-12") }));
    expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: payrollAdministrationQueueKey("org-1", "user-1", "2026-08-12") }));
    expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: payrollAdministrationDetailsKey("org-1", "user-1", "11111111-1111-1111-1111-111111111111", "a".repeat(64)) }));
  });

  it("invalidates the same scoped queries after lock and reopen", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );

    await screen.findByText("ok");
    screen.getByRole("button", { name: "lock" }).click();
    screen.getByRole("button", { name: "reopen" }).click();

    await waitFor(() => expect(vi.mocked(lockPayrollTimesheet)).toHaveBeenCalled());
    await waitFor(() => expect(vi.mocked(reopenPayrollTimesheet)).toHaveBeenCalled());
    expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: payrollAdministrationQueryKey("org-1", "user-1", "2026-08-12") }));
    expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: payrollAdministrationQueueKey("org-1", "user-1", "2026-08-12") }));
  });
});
