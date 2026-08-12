import React from "react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({
  derivePayrollTimesheetSnapshot: vi.fn(),
  fetchPayrollDay: vi.fn(),
  fetchPayrollTimesheetPeriod: vi.fn(),
  recordTimeEvent: vi.fn(),
  recordSessionAttendance: vi.fn(),
  requestTimeCorrection: vi.fn(),
  requestSessionAttendanceCorrection: vi.fn(),
}));

vi.mock("../outbox", () => ({
  createInMemoryPayrollOutboxStore: vi.fn(() => ({ kind: "memory-store" })),
  createIndexedDbPayrollOutboxStore: vi.fn(() => ({ kind: "indexeddb-store" })),
  drainPayrollOutbox: vi.fn(async () => ({ confirmedKeys: [] })),
  enqueuePayrollOutboxEvent: vi.fn(),
  listPayrollOutboxEvents: vi.fn(async () => []),
  recoverPayrollOutbox: vi.fn(async () => undefined),
}));

import { fetchPayrollDay, fetchPayrollTimesheetPeriod } from "../api";
import {
  drainPayrollOutbox,
  listPayrollOutboxEvents,
  recoverPayrollOutbox,
} from "../outbox";
import { usePayrollDayReadOnly, usePayrollTime, usePayrollTimesheetPeriodReview } from "../usePayrollTime";

const scope = {
  organizationId: "org-1",
  userId: "user-1",
  localDate: "2026-08-11",
};

const renderWithQueryClient = (ui: React.ReactNode) => {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

function ReadOnlyProbe() {
  const query = usePayrollDayReadOnly(scope);
  return <div>{query.data?.state ?? "loading"}</div>;
}

function FullProbe() {
  const { payrollDayQuery } = usePayrollTime(scope);
  return <div>{payrollDayQuery.data?.state ?? "loading"}</div>;
}

function TimesheetProbe({ enabled }: { enabled: boolean }) {
  const { payrollTimesheetPeriodQuery } = usePayrollTimesheetPeriodReview(scope, { enabled });
  return <div>{payrollTimesheetPeriodQuery.data?.state ?? "loading"}</div>;
}

describe("usePayrollTime", () => {
  beforeEach(() => {
    vi.mocked(fetchPayrollDay).mockReset();
    vi.mocked(fetchPayrollTimesheetPeriod).mockReset();
    vi.mocked(recoverPayrollOutbox).mockClear();
    vi.mocked(drainPayrollOutbox).mockClear();
    vi.mocked(listPayrollOutboxEvents).mockClear();
    vi.mocked(fetchPayrollDay).mockResolvedValue({
      state: "ok",
      bootstrap: {
        organizationId: "org-1",
        employmentProfileId: "employment-1",
        localDate: "2026-08-11",
        employmentTimezone: "America/Los_Angeles",
        workdayStartsAt: "05:00:00",
        capabilities: {
          canViewSelf: true,
          canClockSelf: true,
          canRequestCorrectionSelf: true,
        },
      },
      day: {
        employeeTimeEvents: [],
        sessionAttendanceEvents: [],
        timeCorrectionRequests: [],
        sessionAttendanceCorrectionRequests: [],
        exceptions: [],
      },
      totals: { label: "Calculation pending" },
    });
    vi.mocked(fetchPayrollTimesheetPeriod).mockResolvedValue({
      state: "ok",
      period: {
        localDate: "2026-08-11",
        periodStart: "2026-08-10",
        periodEnd: "2026-08-16",
        timezone: "America/Los_Angeles",
        exceptions: [],
      },
      snapshot: null,
    });
    onlineManager.setOnline(true);
  });

  afterEach(() => {
    onlineManager.setOnline(true);
  });

  it("exposes a read-only payroll-day query without outbox recovery, drain, or outbox listing", async () => {
    renderWithQueryClient(<ReadOnlyProbe />);

    expect(await screen.findByText("ok")).toBeInTheDocument();
    expect(fetchPayrollDay).toHaveBeenCalledWith(scope);
    expect(recoverPayrollOutbox).not.toHaveBeenCalled();
    expect(drainPayrollOutbox).not.toHaveBeenCalled();
    expect(listPayrollOutboxEvents).not.toHaveBeenCalled();
  });

  it("retains scoped outbox recovery and drain behavior for the full page hook", async () => {
    renderWithQueryClient(<FullProbe />);

    expect(await screen.findByText("ok")).toBeInTheDocument();
    await waitFor(() => {
      expect(recoverPayrollOutbox).toHaveBeenCalledWith(expect.anything(), scope);
    });
    await waitFor(() => {
      expect(drainPayrollOutbox).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: scope.organizationId,
          userId: scope.userId,
        }),
      );
    });
    await waitFor(() => {
      expect(listPayrollOutboxEvents).toHaveBeenCalled();
    });
  });

  it("keeps payroll period review disabled until bootstrap authority enables it", async () => {
    renderWithQueryClient(<TimesheetProbe enabled={false} />);

    expect(screen.getByText("loading")).toBeInTheDocument();
    expect(fetchPayrollTimesheetPeriod).not.toHaveBeenCalled();
  });
});
