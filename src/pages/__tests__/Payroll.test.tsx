import React from "react";
import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUseAuth = vi.fn();
const mockUseActiveOrganizationId = vi.fn();
const mockUsePayrollAdministration = vi.fn();
const mockUsePayrollExport = vi.fn();

vi.mock("../../lib/authContext", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("../../lib/organization", () => ({
  useActiveOrganizationId: () => mockUseActiveOrganizationId(),
}));

vi.mock("../../features/payroll/usePayrollAdministration", () => ({
  usePayrollAdministration: (...args: unknown[]) => mockUsePayrollAdministration(...args),
}));

vi.mock("../../features/payroll/usePayrollExport", () => ({
  usePayrollExport: (...args: unknown[]) => mockUsePayrollExport(...args),
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
    canExportPeriod: true,
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
    latestExport: null,
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
  resolvePayrollBlockerMutation: {
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
    variables: undefined,
  },
  ...overrides,
});

const lockedAdministrationData = {
  ...administrationData,
  payPeriods: administrationData.payPeriods.map((period) => ({
    ...period,
    lockedAt: "2026-08-12T18:30:00.000Z",
  })),
};

const exportRun = {
  runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  payPeriodId: "77777777-7777-4777-8777-777777777777",
  adapterVersion: "provider-neutral-v1",
  replayed: false,
  createdAt: "2026-08-12T19:00:00.000Z",
  exportedAt: "2026-08-12T19:00:00.000Z",
  reconciliationStatus: "reconciled",
  checksumSha256: "a".repeat(64),
  rowCount: 4,
  totalRegularSeconds: 28800,
  totalOvertimeSeconds: 3600,
  totalDoubleTimeSeconds: 0,
  totalMealPremiumCents: 1500,
  totalGrossEarningsCents: 12345,
  sourceSnapshotCount: 2,
  adjustsRunId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  idempotencyKey: "export-key",
};

const latestExport = {
  runId: exportRun.runId,
  adapterVersion: exportRun.adapterVersion,
  exportedAt: exportRun.exportedAt,
  reconciliationStatus: exportRun.reconciliationStatus,
  checksumSha256: exportRun.checksumSha256,
  rowCount: exportRun.rowCount,
  totalRegularSeconds: exportRun.totalRegularSeconds,
  totalOvertimeSeconds: exportRun.totalOvertimeSeconds,
  totalDoubleTimeSeconds: exportRun.totalDoubleTimeSeconds,
  totalMealPremiumCents: exportRun.totalMealPremiumCents,
  totalGrossEarningsCents: exportRun.totalGrossEarningsCents,
  sourceSnapshotCount: exportRun.sourceSnapshotCount,
  adjustsRunId: exportRun.adjustsRunId,
};

const buildPayrollExportMock = (overrides: Record<string, unknown> = {}) => ({
  createPayrollExportMutation: {
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
    data: exportRun,
  },
  downloadPayrollExportMutation: {
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
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:payroll-export"),
      revokeObjectURL: vi.fn(),
    });
    mockUseActiveOrganizationId.mockReturnValue("org-1");
    mockUseAuth.mockReturnValue({
      user: { id: "admin-1", email: "admin@example.com" },
      loading: false,
      profileLoading: false,
    });
    mockUsePayrollAdministration.mockReturnValue(buildPayrollAdministrationMock());
    mockUsePayrollExport.mockReturnValue(buildPayrollExportMock());
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
            canExportPeriod: true,
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

  it.each([
    {
      name: "loading",
      query: { data: undefined, isLoading: true, isError: false, refetch: vi.fn() },
      expected: /loading payroll administration/i,
    },
    {
      name: "transport error",
      query: { data: undefined, isLoading: false, isError: true, refetch: vi.fn() },
      expected: /authoritative payroll administration response could not be loaded/i,
    },
    {
      name: "non-ok response",
      query: { data: { state: "feature_disabled" }, isLoading: false, isError: false, refetch: vi.fn() },
      expected: /authoritative payroll administration response could not be loaded/i,
    },
  ])("fails closed while administration is $name", ({ query, expected }) => {
    mockUsePayrollAdministration.mockReturnValue(buildPayrollAdministrationMock({
      administrationQuery: query,
    }));

    renderPage();

    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Employment" })).not.toBeInTheDocument();
  });

  it("hides compensation when canViewCompensation is false and keeps policies read-only", async () => {
    renderPage();

    expect(screen.getByText(/policy list is read-only/i)).toBeInTheDocument();
    expect(screen.queryByText(/hourly rate:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/gross earnings:/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /grant capability/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /revoke capability/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Approvals" }));
    expect(screen.queryByText(/gross earnings:/i)).not.toBeInTheDocument();
  });

  it("renders reconciled export metadata in the periods tab and offers create or reuse plus download", async () => {
    const user = userEvent.setup();
    const createMutateAsync = vi.fn();
    const downloadMutateAsync = vi.fn().mockResolvedValue({
      filename: "payroll-export-2026-08-12.csv",
      blob: new Blob(["schema_version,export_id"], { type: "text/csv" }),
    });
    mockUsePayrollAdministration.mockReturnValue(buildPayrollAdministrationMock({
      administrationQuery: {
        data: lockedAdministrationData,
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      },
    }));
    mockUsePayrollExport.mockReturnValue(buildPayrollExportMock({
      createPayrollExportMutation: {
        mutateAsync: createMutateAsync,
        isPending: false,
        error: null,
        data: exportRun,
      },
      downloadPayrollExportMutation: {
        mutateAsync: downloadMutateAsync,
        isPending: false,
        error: null,
      },
    }));

    renderPage();

    await user.click(screen.getByRole("button", { name: "Periods" }));
    expect(screen.getByText(/provider-neutral-v1/i)).toBeInTheDocument();
    expect(screen.getByText(/^reconciled$/i)).toBeInTheDocument();
    expect(screen.getByText(/row count: 4/i)).toBeInTheDocument();
    expect(screen.getByText(/source snapshots: 2/i)).toBeInTheDocument();
    expect(screen.getByText(/checksum:/i)).toBeInTheDocument();
    expect(screen.getByText(/adjustment parent: bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/i)).toBeInTheDocument();
    expect(screen.getByText(/regular total: 8\.00h/i)).toBeInTheDocument();
    expect(screen.getByText(/overtime total: 1\.00h/i)).toBeInTheDocument();
    expect(screen.getByText(/double time total: 0\.00h/i)).toBeInTheDocument();
    expect(screen.getByText(/meal premium total: \$15\.00/i)).toBeInTheDocument();
    expect(screen.getByText(/gross total: \$123\.45/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /create or reuse export/i }));
    expect(createMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      payPeriodId: "77777777-7777-4777-8777-777777777777",
      adapterVersion: "provider-neutral-v1",
    }));

    await user.click(screen.getByRole("button", { name: /download export csv/i }));
    expect(downloadMutateAsync).toHaveBeenCalledWith({
      runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
  });

  it("restores reconciled export metadata and download from the administration read model after reload", async () => {
    const downloadMutateAsync = vi.fn().mockResolvedValue({
      filename: "payroll-export-2026-08-12.csv",
      blob: new Blob(["schema_version,export_id"], { type: "text/csv" }),
    });
    mockUsePayrollAdministration.mockReturnValue(buildPayrollAdministrationMock({
      administrationQuery: {
        data: {
          ...lockedAdministrationData,
          payPeriods: lockedAdministrationData.payPeriods.map((period) => ({
            ...period,
            exportedAt: latestExport.exportedAt,
            latestExport,
          })),
        },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      },
    }));
    mockUsePayrollExport.mockReturnValue(buildPayrollExportMock({
      createPayrollExportMutation: {
        mutateAsync: vi.fn(),
        isPending: false,
        error: null,
        data: undefined,
      },
      downloadPayrollExportMutation: {
        mutateAsync: downloadMutateAsync,
        isPending: false,
        error: null,
      },
    }));

    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Periods" }));
    expect(screen.getByText(/row count: 4/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /download export csv/i }));
    expect(downloadMutateAsync).toHaveBeenCalledWith({ runId: latestExport.runId });
  });

  it("does not offer download before a reconciled server run exists", async () => {
    mockUsePayrollAdministration.mockReturnValue(buildPayrollAdministrationMock({
      administrationQuery: {
        data: lockedAdministrationData,
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      },
    }));
    mockUsePayrollExport.mockReturnValue(buildPayrollExportMock({
      createPayrollExportMutation: {
        mutateAsync: vi.fn(),
        isPending: false,
        error: null,
        data: undefined,
      },
    }));

    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Periods" }));
    expect(screen.getByText(/no export run/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /download export csv/i })).not.toBeInTheDocument();
  });

  it("stays fail-closed when administration does not grant explicit export capability", async () => {
    mockUsePayrollAdministration.mockReturnValue(buildPayrollAdministrationMock({
      administrationQuery: {
        data: {
          ...administrationData,
          capabilities: { ...administrationData.capabilities, canExportPeriod: false },
        },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      },
    }));

    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Periods" }));
    expect(screen.getByText(/export capability is unavailable/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create or reuse export/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /download export csv/i })).not.toBeInTheDocument();
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

  it("renders per-unresolved-blocker resolve controls only when exception resolution authority is granted", async () => {
    const { rerender } = renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Exceptions" }));
    expect(screen.getByLabelText(/resolve reason for timekeeping_exception/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /resolve timekeeping_exception/i })).toBeInTheDocument();

    mockUsePayrollAdministration.mockReturnValue(buildPayrollAdministrationMock({
      administrationQuery: {
        data: {
          ...administrationData,
          capabilities: {
            ...administrationData.capabilities,
            canResolveExceptions: false,
          },
        },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      },
    }));

    rerender(
      <MemoryRouter initialEntries={["/payroll"]}>
        <Payroll />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Exceptions" }));
    expect(screen.queryByLabelText(/resolve reason for timekeeping_exception/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /resolve timekeeping_exception/i })).not.toBeInTheDocument();
  });

  it("submits blocker resolution for the selected snapshot, clears reason after success, and surfaces mutation errors", async () => {
    const user = userEvent.setup();
    const resolveMutateAsync = vi.fn().mockResolvedValue({ resolutionId: "resolved-1" });
    mockUsePayrollAdministration.mockReturnValue(buildPayrollAdministrationMock({
      resolvePayrollBlockerMutation: {
        mutateAsync: resolveMutateAsync,
        isPending: false,
        error: null,
      },
    }));

    const { rerender } = renderPage();

    await user.click(screen.getByRole("button", { name: "Exceptions" }));
    const reasonField = screen.getByLabelText(/resolve reason for timekeeping_exception/i);
    const resolveButton = screen.getByRole("button", { name: /resolve timekeeping_exception/i });
    expect(resolveButton).toBeDisabled();

    await user.type(reasonField, "Verified and resolved.");
    await user.click(resolveButton);

    expect(resolveMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      snapshotId: "88888888-8888-4888-8888-888888888888",
      snapshotHash: "a".repeat(64),
      blockerType: "timekeeping_exception",
      blockerId: "99999999-9999-4999-8999-999999999999",
      resolution: "resolved",
      reason: "Verified and resolved.",
    }));
    await waitFor(() => expect(screen.getByLabelText(/resolve reason for timekeeping_exception/i)).toHaveValue(""));

    mockUsePayrollAdministration.mockReturnValue(buildPayrollAdministrationMock({
      resolvePayrollBlockerMutation: {
        mutateAsync: vi.fn().mockRejectedValue(new Error("Resolve failed.")),
        isPending: false,
        error: new Error("Resolve failed."),
        variables: {
          snapshotId: "88888888-8888-4888-8888-888888888888",
          snapshotHash: "a".repeat(64),
        },
      },
    }));
    rerender(
      <MemoryRouter initialEntries={["/payroll"]}>
        <Payroll />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Exceptions" }));
    expect(screen.getByText(/resolve failed\./i)).toBeInTheDocument();
  });

  it("preserves a failed resolve reason for its snapshot and clears the error after snapshot selection changes", async () => {
    const user = userEvent.setup();
    const resolveMutateAsync = vi.fn().mockRejectedValue(new Error("Resolve failed."));
    const secondQueueItem = {
      ...reviewQueue.queue[0],
      employeeLabel: "Employee 1002",
      employmentProfileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      payPeriodId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      snapshot: {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        hash: "b".repeat(64),
      },
    };
    mockUsePayrollAdministration.mockReturnValue(buildPayrollAdministrationMock({
      reviewQueueQuery: {
        data: { ...reviewQueue, queue: [...reviewQueue.queue, secondQueueItem] },
        isLoading: false,
        isError: false,
        error: null,
      },
      resolvePayrollBlockerMutation: {
        mutateAsync: resolveMutateAsync,
        isPending: false,
        error: new Error("Resolve failed."),
        variables: {
          snapshotId: "88888888-8888-4888-8888-888888888888",
          snapshotHash: "a".repeat(64),
        },
      },
    }));

    renderPage();
    await user.click(screen.getByRole("button", { name: "Exceptions" }));
    const reasonField = screen.getByLabelText(/resolve reason for timekeeping_exception/i);
    await user.type(reasonField, "Keep this operator rationale.");
    await user.click(screen.getByRole("button", { name: /resolve timekeeping_exception/i }));

    await waitFor(() => expect(resolveMutateAsync).toHaveBeenCalled());
    expect(reasonField).toHaveValue("Keep this operator rationale.");
    expect(screen.getByText(/resolve failed\./i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Approvals" }));
    await user.click(screen.getByRole("button", { name: /employee 1002/i }));
    await user.click(screen.getByRole("button", { name: "Exceptions" }));

    expect(screen.queryByText(/resolve failed\./i)).not.toBeInTheDocument();
  });

  it("keeps a different snapshot blocker usable while another resolution is pending", async () => {
    const user = userEvent.setup();
    const secondQueueItem = {
      ...reviewQueue.queue[0],
      employeeLabel: "Employee 1002",
      employmentProfileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      payPeriodId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      snapshot: {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        hash: "b".repeat(64),
      },
    };
    const secondReviewDetails = {
      ...reviewDetails,
      snapshotId: secondQueueItem.snapshot.id,
      snapshotHash: secondQueueItem.snapshot.hash,
      blockers: [{
        ...reviewDetails.blockers[0],
        blockerId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      }],
    };
    mockUsePayrollAdministration.mockReturnValue(buildPayrollAdministrationMock({
      reviewQueueQuery: {
        data: { ...reviewQueue, queue: [...reviewQueue.queue, secondQueueItem] },
        isLoading: false,
        isError: false,
        error: null,
      },
      reviewDetailsQuery: {
        data: secondReviewDetails,
        isLoading: false,
        isError: false,
        error: null,
      },
      resolvePayrollBlockerMutation: {
        mutateAsync: vi.fn(),
        isPending: true,
        error: null,
        variables: {
          snapshotId: reviewDetails.snapshotId,
          snapshotHash: reviewDetails.snapshotHash,
          blockerType: reviewDetails.blockers[0].blockerType,
          blockerId: reviewDetails.blockers[0].blockerId,
        },
      },
    }));

    renderPage();
    await user.click(screen.getByRole("button", { name: "Approvals" }));
    await user.click(screen.getByRole("button", { name: /employee 1002/i }));
    await user.click(screen.getByRole("button", { name: "Exceptions" }));
    await user.type(screen.getByLabelText(/resolve reason for timekeeping_exception/i), "Resolve the second blocker.");

    expect(screen.getByRole("button", { name: /resolve timekeeping_exception/i })).toBeEnabled();
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
    const reasonField = screen.getByLabelText(/reopen reason/i);
    const reasonHelp = screen.getByText(/reopen reason is required/i);
    expect(reasonField).toBeRequired();
    expect(reasonField).toHaveAttribute("aria-describedby", reasonHelp.id);

    await user.type(reasonField, "Manager confirmed the correction is complete.");
    await user.click(screen.getByRole("button", { name: /reopen period/i }));

    expect(reopenMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      snapshotId: "88888888-8888-4888-8888-888888888888",
      snapshotHash: "a".repeat(64),
      reason: "Manager confirmed the correction is complete.",
    }));
  });

  it("scopes reopen rationale to the selected snapshot and clears it after success", async () => {
    const user = userEvent.setup();
    const reopenMutateAsync = vi.fn().mockResolvedValue({ action: "reopened" });
    const secondQueueItem = {
      ...reviewQueue.queue[0],
      employeeLabel: "Employee 1002",
      employmentProfileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      payPeriodId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      snapshot: {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        hash: "b".repeat(64),
      },
    };
    const secondDetails = {
      ...reviewDetails,
      snapshotId: secondQueueItem.snapshot.id,
      snapshotHash: secondQueueItem.snapshot.hash,
    };

    mockUsePayrollAdministration.mockImplementation((...args: unknown[]) => {
      const options = args[1] as { selectedReview?: { snapshotId: string } | null } | undefined;
      return buildPayrollAdministrationMock({
        reviewQueueQuery: {
          data: { ...reviewQueue, queue: [...reviewQueue.queue, secondQueueItem] },
          isLoading: false,
          isError: false,
          error: null,
        },
        reviewDetailsQuery: {
          data: options?.selectedReview?.snapshotId === secondQueueItem.snapshot.id ? secondDetails : reviewDetails,
          isLoading: false,
          isError: false,
          error: null,
        },
        reopenPayrollTimesheetMutation: {
          mutateAsync: reopenMutateAsync,
          isPending: false,
          error: null,
        },
      });
    });

    renderPage();

    await user.click(screen.getByRole("button", { name: "Approvals" }));
    const reasonField = screen.getByLabelText(/reopen reason/i);
    await user.type(reasonField, "Reason for employee 1001");
    await user.click(screen.getByRole("button", { name: /employee 1002/i }));

    expect(screen.getByLabelText(/reopen reason/i)).toHaveValue("");

    await user.type(screen.getByLabelText(/reopen reason/i), "Reason for employee 1002");
    await user.click(screen.getByRole("button", { name: /reopen period/i }));

    expect(reopenMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      snapshotId: secondQueueItem.snapshot.id,
      snapshotHash: secondQueueItem.snapshot.hash,
      reason: "Reason for employee 1002",
    }));
    await waitFor(() => expect(screen.getByLabelText(/reopen reason/i)).toHaveValue(""));
  });

  it("hides reopen rationale controls from an administrator with lock-only authority", async () => {
    mockUsePayrollAdministration.mockReturnValue(buildPayrollAdministrationMock({
      administrationQuery: {
        data: {
          ...administrationData,
          capabilities: {
            ...administrationData.capabilities,
            canReopenPeriod: false,
          },
        },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      },
    }));

    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Approvals" }));
    expect(screen.getByRole("button", { name: /lock period/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/reopen reason/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reopen period/i })).not.toBeInTheDocument();
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
    expect(screen.getByText(/loading payroll review queue/i).closest('[role="status"]')).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Approvals" }));
    expect(screen.getByText(/loading payroll review queue/i).closest('[role="status"]')).toBeInTheDocument();
    expect(screen.getByText(/loading approval details/i).closest('[role="status"]')).toBeInTheDocument();
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
    expect(screen.getByText(/authoritative payroll review queue is unavailable/i).closest('[role="alert"]')).toBeInTheDocument();
    expect(screen.queryByText(/no pending exception rows/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Approvals" }));
    expect(screen.getByText(/authoritative payroll review queue is unavailable/i).closest('[role="alert"]')).toBeInTheDocument();
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
