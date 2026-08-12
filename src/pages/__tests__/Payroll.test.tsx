import React from "react";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUseAuth = vi.fn();
const mockUseActiveOrganizationId = vi.fn();
const mockUsePayrollAdministration = vi.fn();

vi.mock("../../lib/authContext", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("../../lib/organization", () => ({
  useActiveOrganizationId: () => mockUseActiveOrganizationId(),
}));

vi.mock("../../features/payroll/usePayrollAdministration", () => ({
  usePayrollAdministration: (...args: unknown[]) => mockUsePayrollAdministration(...args),
}));

import { Payroll } from "../Payroll";

const administrationData = {
  state: "ok" as const,
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
  orgSettings: [{
    id: "11111111-1111-4111-8111-111111111111",
    externalPayrollOrganizationId: "org-ext-1",
    timezone: "America/Los_Angeles",
    workdayStartsAt: "00:00:00",
    workweekStartsOn: 0,
    effectiveFrom: "2026-08-01",
    effectiveThrough: null,
  }],
  policies: [{
    id: "22222222-2222-4222-8222-222222222222",
    jurisdiction: "CA",
    policyName: "California nonexempt",
    activationStatus: "active",
    supportsMonthlyNonexempt: false,
    effectiveFrom: "2026-01-01",
    effectiveThrough: null,
    mutationsReadOnlyInV1: true,
  }],
  employments: [{
    id: "33333333-3333-4333-8333-333333333333",
    userId: "44444444-4444-4444-8444-444444444444",
    employeeNumber: "EMP-1",
    payrollEmployeeId: "PAY-1",
    classification: "nonexempt",
    homeJurisdiction: "CA",
    timezone: "America/Los_Angeles",
    activeFrom: "2026-08-01",
    activeThrough: null,
    compensation: {
      hourlyRateCents: 4250,
      effectiveFrom: "2026-08-01T00:00:00Z",
      effectiveThrough: null,
    },
  }],
  payGroups: [{
    id: "55555555-5555-4555-8555-555555555555",
    name: "Biweekly Team",
    cadence: "biweekly",
    timezone: "America/Los_Angeles",
    effectiveFrom: "2026-08-01",
    effectiveThrough: null,
  }],
  generationVersions: [{
    id: "66666666-6666-4666-8666-666666666666",
    payGroupId: "55555555-5555-4555-8555-555555555555",
    cadence: "biweekly",
    startsOn: "2026-08-01",
    timezone: "America/Los_Angeles",
    effectiveFrom: "2026-08-01",
    effectiveThrough: null,
  }],
  payPeriods: [{
    id: "77777777-7777-4777-8777-777777777777",
    payGroupId: "55555555-5555-4555-8555-555555555555",
    startsOn: "2026-08-01",
    endsOn: "2026-08-14",
    lockedAt: null,
    exportedAt: null,
  }],
  bounds: {
    orgSettings: 50,
    policies: 20,
    employments: 50,
    payGroups: 50,
    generationVersions: 50,
    payPeriods: 50,
  },
};

const reviewQueue = {
  state: "ok" as const,
  selectedLocalDate: "2026-08-12",
  capabilities: {
    canReviewAssigned: true,
    canApproveAssigned: true,
    canViewCompensation: false,
    hasOrgPayrollAccess: true,
  },
  queue: [{
    employeeLabel: "Employee 1001",
    employmentProfileId: "33333333-3333-4333-8333-333333333333",
    payPeriodId: "77777777-7777-4777-8777-777777777777",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-14",
    state: "manager_approved",
    blockerCount: 1,
    submittedAt: "2026-08-12T18:00:00.000Z",
    snapshot: {
      id: "88888888-8888-4888-8888-888888888888",
      hash: "a".repeat(64),
    },
    classifiedSeconds: { regular: 28800, overtime: 3600, doubleTime: 0 },
    compensation: { grossEarningsCents: 12345 },
  }],
};

const reviewDetails = {
  state: "ok" as const,
  snapshotId: "88888888-8888-4888-8888-888888888888",
  snapshotHash: "a".repeat(64),
  periodStart: "2026-08-01",
  periodEnd: "2026-08-14",
  punches: [],
  classifiedSeconds: { regular: 28800, overtime: 3600, doubleTime: 0 },
  approvalHistory: [{
    action: "manager_approved",
    occurredAt: "2026-08-12T19:00:00.000Z",
    comment: null,
    reason: null,
    snapshotId: "88888888-8888-4888-8888-888888888888",
    snapshotHash: "a".repeat(64),
  }],
  blockers: [{
    blockerType: "timekeeping_exception",
    blockerId: "99999999-9999-4999-8999-999999999999",
    state: "open",
    createdAt: "2026-08-12T19:10:00.000Z",
  }],
  unresolvedBlockerCount: 1,
  compensation: { grossEarningsCents: 12345 },
};

const buildPayrollAdministrationMock = (overrides: Record<string, unknown> = {}) => ({
  administrationQuery: {
    data: administrationData,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  reviewQueueQuery: {
    data: reviewQueue,
    isLoading: false,
    isError: false,
    error: null,
  },
  reviewDetailsQuery: {
    data: reviewDetails,
    isLoading: false,
    isError: false,
    error: null,
  },
  administrationActionMutation: {
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
  },
  lockPayrollTimesheetMutation: {
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
  },
  reopenPayrollTimesheetMutation: {
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
  },
  ...overrides,
});

const renderPage = () => render(
  <MemoryRouter initialEntries={["/payroll"]}>
    <Payroll />
  </MemoryRouter>,
);

describe("Payroll page", () => {
  beforeEach(() => {
    mockUseActiveOrganizationId.mockReturnValue("org-1");
    mockUseAuth.mockReturnValue({
      user: { id: "admin-1", email: "admin@example.com" },
      loading: false,
      profileLoading: false,
    });
    mockUsePayrollAdministration.mockReturnValue(buildPayrollAdministrationMock());
  });

  it("renders the exact payroll administration tabs", () => {
    renderPage();

    expect(screen.getByRole("button", { name: "Employment" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pay Groups" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Periods" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exceptions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approvals" })).toBeInTheDocument();
  });

  it("fails closed when the authoritative administration capabilities grant no payroll access", () => {
    mockUsePayrollAdministration.mockReturnValue({
      ...mockUsePayrollAdministration.mock.results[0]?.value,
      administrationQuery: {
        data: {
          ...administrationData,
          capabilities: {
            ...administrationData.capabilities,
            canConfigureEmployment: false,
            canResolveExceptions: false,
            canLockPeriod: false,
            canReopenPeriod: false,
            canGeneratePeriods: false,
            canViewCompensation: false,
          },
        },
        isLoading: false,
        isError: false,
      },
      reviewQueueQuery: { data: reviewQueue },
      reviewDetailsQuery: { data: reviewDetails },
      administrationActionMutation: { mutateAsync: vi.fn(), isPending: false, error: null },
      lockPayrollTimesheetMutation: { mutateAsync: vi.fn(), isPending: false, error: null },
      reopenPayrollTimesheetMutation: { mutateAsync: vi.fn(), isPending: false, error: null },
    });

    renderPage();

    expect(screen.getByText(/did not grant access for this route/i)).toBeInTheDocument();
  });

  it("hides compensation when canViewCompensation is false and keeps policies read-only", async () => {
    renderPage();

    expect(screen.getByText(/policy list is read-only/i)).toBeInTheDocument();
    expect(screen.queryByText(/hourly rate:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/gross earnings:/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /grant capability/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /revoke capability/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /export/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Approvals" }));
    expect(screen.queryByText(/gross earnings:/i)).not.toBeInTheDocument();
  });

  it("shows blocker visibility in Exceptions and lock or reopen controls in Approvals without punch editing", async () => {
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Exceptions" }));
    expect(screen.getByText(/blocking issues: 1/i)).toBeInTheDocument();
    expect(screen.getByText(/punch editing remains disabled here/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Approvals" }));
    expect(screen.getByRole("button", { name: /lock period/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reopen period/i })).toBeInTheDocument();
    expect(screen.queryByText(/edit punch/i)).not.toBeInTheDocument();
  });

  it("requires an operator-entered reopen reason and submits the exact rationale", async () => {
    const user = userEvent.setup();
    const reopenMutateAsync = vi.fn();
    mockUsePayrollAdministration.mockReturnValue(buildPayrollAdministrationMock({
      reopenPayrollTimesheetMutation: {
        mutateAsync: reopenMutateAsync,
        isPending: false,
        error: null,
      },
    }));

    renderPage();

    await user.click(screen.getByRole("button", { name: "Approvals" }));
    expect(screen.getByRole("button", { name: /reopen period/i })).toBeDisabled();
    expect(screen.getByText(/reopen reason is required/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/reopen reason/i), "Manager confirmed the correction is complete.");
    await user.click(screen.getByRole("button", { name: /reopen period/i }));

    expect(reopenMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      snapshotId: "88888888-8888-4888-8888-888888888888",
      snapshotHash: "a".repeat(64),
      reason: "Manager confirmed the correction is complete.",
    }));
  });

  it("renders explicit loading states for approval queue and selected details", async () => {
    mockUsePayrollAdministration.mockReturnValue(buildPayrollAdministrationMock({
      reviewQueueQuery: {
        data: undefined,
        isLoading: true,
        isError: false,
        error: null,
      },
      reviewDetailsQuery: {
        data: undefined,
        isLoading: true,
        isError: false,
        error: null,
      },
    }));

    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Exceptions" }));
    expect(screen.getByText(/loading payroll review queue/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Approvals" }));
    expect(screen.getByText(/loading payroll review queue/i)).toBeInTheDocument();
    expect(screen.getByText(/loading approval details/i)).toBeInTheDocument();
  });

  it("fails closed when the review queue transport errors", async () => {
    mockUsePayrollAdministration.mockReturnValue(buildPayrollAdministrationMock({
      reviewQueueQuery: {
        data: undefined,
        isLoading: false,
        isError: true,
        error: { message: "queue transport failed" },
      },
      reviewDetailsQuery: {
        data: undefined,
        isLoading: false,
        isError: false,
        error: null,
      },
    }));

    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Exceptions" }));
    expect(screen.getByText(/authoritative payroll review queue is unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/no pending exception rows/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Approvals" }));
    expect(screen.getByText(/authoritative payroll review queue is unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/no approval rows/i)).not.toBeInTheDocument();
  });

  it("fails closed when the review queue resolves to a non-ok state", async () => {
    mockUsePayrollAdministration.mockReturnValue(buildPayrollAdministrationMock({
      reviewQueueQuery: {
        data: {
          ...reviewQueue,
          state: "feature_disabled",
          queue: [],
        },
        isLoading: false,
        isError: false,
        error: null,
      },
      reviewDetailsQuery: {
        data: undefined,
        isLoading: false,
        isError: false,
        error: null,
      },
    }));

    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Approvals" }));
    expect(screen.getByText(/authoritative payroll review queue is unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/no approval rows/i)).not.toBeInTheDocument();
  });

  it("fails closed when selected approval details transport error", async () => {
    mockUsePayrollAdministration.mockReturnValue(buildPayrollAdministrationMock({
      reviewDetailsQuery: {
        data: undefined,
        isLoading: false,
        isError: true,
        error: { message: "details transport failed" },
      },
    }));

    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Approvals" }));
    expect(screen.getByText(/authoritative approval details are unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/no approval details selected/i)).not.toBeInTheDocument();
  });

  it("fails closed when selected approval details resolve to a non-ok state", async () => {
    mockUsePayrollAdministration.mockReturnValue(buildPayrollAdministrationMock({
      reviewDetailsQuery: {
        data: {
          state: "feature_disabled",
        },
        isLoading: false,
        isError: false,
        error: null,
      },
    }));

    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Approvals" }));
    expect(screen.getByText(/authoritative approval details are unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/no approval details selected/i)).not.toBeInTheDocument();
  });

  it("preserves genuine empty states when the authoritative queue is ok but empty", async () => {
    mockUsePayrollAdministration.mockReturnValue(buildPayrollAdministrationMock({
      reviewQueueQuery: {
        data: {
          ...reviewQueue,
          queue: [],
        },
        isLoading: false,
        isError: false,
        error: null,
      },
      reviewDetailsQuery: {
        data: undefined,
        isLoading: false,
        isError: false,
        error: null,
      },
    }));

    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Exceptions" }));
    expect(screen.getByText(/no pending exception rows/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Approvals" }));
    expect(screen.getByText(/no approval rows/i)).toBeInTheDocument();
  });
});
