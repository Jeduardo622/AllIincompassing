import React from "react";
import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUseAuth = vi.fn();
const mockUseActiveOrganizationId = vi.fn();
const mockUsePayrollTime = vi.fn();

vi.mock("../../lib/authContext", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("../../lib/organization", () => ({
  useActiveOrganizationId: () => mockUseActiveOrganizationId(),
}));

vi.mock("../../features/payroll/usePayrollTime", () => ({
  usePayrollTime: (...args: unknown[]) => mockUsePayrollTime(...args),
}));

import { Time } from "../Time";

const basePayrollDay = {
  state: "ok" as const,
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
    employeeTimeEvents: [
      {
        id: "event-1",
        employmentProfileId: "employment-1",
        eventType: "shift_started",
        eventAt: "2026-08-11T16:00:00.000Z",
        sourceTimezone: "America/Los_Angeles",
        workLocation: "office",
        workCategory: "direct_service",
        metadata: {},
        createdAt: "2026-08-11T16:00:01.000Z",
      },
    ],
    sessionAttendanceEvents: [
      {
        id: "attendance-1",
        employmentProfileId: "employment-1",
        sessionId: "11111111-1111-1111-1111-111111111111",
        employeeTimeEventId: "event-1",
        eventType: "session_started",
        eventAt: "2026-08-11T16:15:00.000Z",
        sourceTimezone: "America/Los_Angeles",
        workLocation: "client_site",
        metadata: {},
        createdAt: "2026-08-11T16:15:01.000Z",
      },
    ],
    timeCorrectionRequests: [
      {
        id: "correction-1",
        employmentProfileId: "employment-1",
        originalEventId: "event-1",
        reasonCode: "missed_punch",
        replacementPayload: {},
        createdAt: "2026-08-11T17:00:00.000Z",
      },
    ],
    sessionAttendanceCorrectionRequests: [
      {
        id: "attendance-correction-1",
        employmentProfileId: "employment-1",
        sessionAttendanceEventId: "attendance-1",
        reasonCode: "outside_shift",
        replacementPayload: {},
        createdAt: "2026-08-11T17:05:00.000Z",
      },
    ],
    exceptions: [
      {
        id: "exception-1",
        employmentProfileId: "employment-1",
        exceptionCode: "session_outside_shift",
        sourceSessionAttendanceEventId: "attendance-1",
        details: { note: "outside of shift" },
        createdAt: "2026-08-11T17:10:00.000Z",
      },
    ],
  },
  totals: {
    label: "Calculation pending",
  },
};

const baseHookValue = {
  payrollDayQuery: {
    data: basePayrollDay,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  },
  outboxQuery: {
    data: [],
  },
  recordTimeEventMutation: {
    mutateAsync: vi.fn(),
    isPending: false,
  },
  recordSessionAttendanceMutation: {
    mutateAsync: vi.fn(),
    isPending: false,
  },
  requestTimeCorrectionMutation: {
    mutateAsync: vi.fn(),
    isPending: false,
  },
  requestSessionAttendanceCorrectionMutation: {
    mutateAsync: vi.fn(),
    isPending: false,
  },
};

const renderTimePage = () =>
  render(
    <MemoryRouter initialEntries={["/time"]}>
      <Time />
    </MemoryRouter>,
  );

describe("Time page", () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
    mockUseActiveOrganizationId.mockReset();
    mockUsePayrollTime.mockReset();
    mockUseActiveOrganizationId.mockReturnValue("org-1");
    mockUseAuth.mockReturnValue({
      user: {
        id: "user-1",
        email: "bt@example.com",
      },
      profileLoading: false,
      loading: false,
    });
    mockUsePayrollTime.mockReturnValue(baseHookValue);
  });

  it("renders the explicit loading state", () => {
    mockUsePayrollTime.mockReturnValue({
      ...baseHookValue,
      payrollDayQuery: {
        ...baseHookValue.payrollDayQuery,
        data: undefined,
        isLoading: true,
      },
    });

    renderTimePage();

    expect(screen.getByText(/loading timekeeping/i)).toBeInTheDocument();
  });

  it("renders the retryable transport error state", async () => {
    const refetch = vi.fn();
    mockUsePayrollTime.mockReturnValue({
      ...baseHookValue,
      payrollDayQuery: {
        ...baseHookValue.payrollDayQuery,
        data: undefined,
        isError: true,
        error: { message: "transport failed" },
        refetch,
      },
    });

    renderTimePage();
    await userEvent.click(screen.getByRole("button", { name: /retry payroll request/i }));

    expect(screen.getByText(/payroll timekeeping is temporarily unavailable/i)).toBeInTheDocument();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("renders feature-disabled, unsupported-jurisdiction, and no-employment states without invalidating nullable bootstrap fields", () => {
    const { rerender } = render(
      <MemoryRouter initialEntries={["/time"]}>
        <Time />
      </MemoryRouter>,
    );

    mockUsePayrollTime.mockReturnValue({
      ...baseHookValue,
      payrollDayQuery: {
        ...baseHookValue.payrollDayQuery,
        data: {
          ...basePayrollDay,
          state: "feature_disabled",
        },
      },
    });
    rerender(
      <MemoryRouter initialEntries={["/time"]}>
        <Time />
      </MemoryRouter>,
    );
    expect(screen.getByText(/timekeeping is not enabled/i)).toBeInTheDocument();

    mockUsePayrollTime.mockReturnValue({
      ...baseHookValue,
      payrollDayQuery: {
        ...baseHookValue.payrollDayQuery,
        data: {
          ...basePayrollDay,
          state: "unsupported_jurisdiction",
        },
      },
    });
    rerender(
      <MemoryRouter initialEntries={["/time"]}>
        <Time />
      </MemoryRouter>,
    );
    expect(screen.getByText(/not supported for your employment jurisdiction/i)).toBeInTheDocument();

    mockUsePayrollTime.mockReturnValue({
      ...baseHookValue,
      payrollDayQuery: {
        ...baseHookValue.payrollDayQuery,
        data: {
          ...basePayrollDay,
          state: "no_employment_profile",
          bootstrap: {
            ...basePayrollDay.bootstrap,
            employmentProfileId: null,
            employmentTimezone: null,
            workdayStartsAt: null,
            capabilities: {
              canViewSelf: false,
              canClockSelf: false,
              canRequestCorrectionSelf: false,
            },
          },
        },
      },
    });
    rerender(
      <MemoryRouter initialEntries={["/time"]}>
        <Time />
      </MemoryRouter>,
    );
    expect(screen.getByText(/no active payroll employment profile/i)).toBeInTheDocument();
  });

  it("renders confirmed history, pending local history, corrections, exceptions, current state, and calculation pending totals", () => {
    mockUsePayrollTime.mockReturnValue({
      ...baseHookValue,
      outboxQuery: {
        data: [
          {
            idempotencyKey: "pending-shift-end",
            action: "record_time_event",
            occurredAt: "2026-08-11T18:00:00.000Z",
            state: "pending",
            safeCode: null,
            payload: {
              occurredAt: "2026-08-11T18:00:00.000Z",
              timezone: "America/Los_Angeles",
              workLocation: "office",
              data: {
                eventType: "shift_ended",
              },
            },
          },
        ],
      },
    });

    renderTimePage();

    expect(screen.getByText(/calculation pending/i)).toBeInTheDocument();
    expect(screen.getByText(/shift started/i)).toBeInTheDocument();
    expect(screen.getByText(/session started/i)).toBeInTheDocument();
    expect(screen.getByText(/pending local events/i)).toBeInTheDocument();
    expect(screen.getByText(/pending confirmation/i)).toBeInTheDocument();
    expect(screen.getByText(/missed_punch/i)).toBeInTheDocument();
    expect(screen.getByText(/^outside_shift$/i)).toBeInTheDocument();
    expect(screen.getByText(/^session_outside_shift$/i)).toBeInTheDocument();
    expect(screen.getByText(/current work category/i)).toBeInTheDocument();
    expect(screen.getByText(/^direct_service$/i)).toBeInTheDocument();
    expect(screen.getByText(/current work location/i)).toBeInTheDocument();
    expect(screen.getByText(/^office$/i)).toBeInTheDocument();
  });

  it("uses the bootstrap local date after the protected authority reports a different employment-local day", async () => {
    const firstResponse = {
      ...baseHookValue,
      payrollDayQuery: {
        ...baseHookValue.payrollDayQuery,
        data: {
          ...basePayrollDay,
          bootstrap: {
            ...basePayrollDay.bootstrap,
            localDate: "2026-08-12",
          },
        },
      },
    };

    mockUsePayrollTime
      .mockReturnValueOnce(firstResponse)
      .mockImplementation(({ localDate }: { localDate: string }) =>
        localDate === "2026-08-12" ? firstResponse : baseHookValue,
      );

    renderTimePage();

    await waitFor(() => {
      expect(
        mockUsePayrollTime.mock.calls.some(
          ([arg]) =>
            typeof arg === "object" &&
            arg !== null &&
            "localDate" in (arg as Record<string, unknown>) &&
            (arg as { localDate?: string }).localDate === "2026-08-12",
        ),
      ).toBe(true);
    });
  });
});
