import React from "react";
import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
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

  it("keeps needs-attention rows out of derived state and pending confirmation", () => {
    mockUsePayrollTime.mockReturnValue({
      ...baseHookValue,
      payrollDayQuery: {
        ...baseHookValue.payrollDayQuery,
        data: {
          ...basePayrollDay,
          day: {
            ...basePayrollDay.day,
            employeeTimeEvents: [
              ...basePayrollDay.day.employeeTimeEvents,
              {
                ...basePayrollDay.day.employeeTimeEvents[0],
                id: "55555555-5555-4555-8555-555555555555",
                eventType: "meal_started",
                eventAt: "2026-08-11T17:00:00.000Z",
              },
            ],
          },
        },
      },
      outboxQuery: {
        data: [
          {
            storageKey: '["org-1","user-1","failed-shift-end"]',
            organizationId: "org-1",
            userId: "user-1",
            localDate: "2026-08-11",
            idempotencyKey: "failed-shift-end",
            action: "record_time_event",
            occurredAt: "2026-08-11T18:00:00.000Z",
            enqueueSequence: 1,
            enqueuedAt: "2026-08-11T18:00:01.000Z",
            state: "needs_attention",
            safeCode: "state_conflict",
            payload: {
              occurredAt: "2026-08-11T18:00:00.000Z",
              timezone: "America/Los_Angeles",
              workLocation: "home",
              data: {
                eventType: "shift_ended",
                workCategory: "administration",
              },
            },
          },
        ],
      },
    });

    renderTimePage();

    const activeShiftCard = screen.getByText(/^active shift$/i).parentElement?.parentElement;
    expect(activeShiftCard).not.toBeNull();
    expect(within(activeShiftCard as HTMLElement).getByText(/aug 11, 2026, 9:00 am/i)).toBeInTheDocument();
    expect(screen.getByText(/^running$/i)).toBeInTheDocument();
    expect(screen.getByText(/^direct_service$/i)).toBeInTheDocument();
    expect(screen.getByText(/^office$/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /needs attention/i })).toBeInTheDocument();
    expect(screen.getByText(/state_conflict/i)).toBeInTheDocument();
    expect(screen.queryByText(/pending confirmation/i)).not.toBeInTheDocument();
  });

  it("creates distinct action identity and timestamps at each click", async () => {
    vi.useFakeTimers();
    try {
      const recordTimeEvent = vi.fn().mockResolvedValue({ idempotencyKey: "confirmed" });
      mockUsePayrollTime.mockReturnValue({
        ...baseHookValue,
        recordTimeEventMutation: {
          mutateAsync: recordTimeEvent,
          isPending: false,
        },
      });
      vi.setSystemTime(new Date("2026-08-11T18:00:00.000Z"));
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      renderTimePage();

      vi.setSystemTime(new Date("2026-08-11T18:05:00.000Z"));
      await user.click(screen.getByRole("button", { name: /^start meal$/i }));
      vi.setSystemTime(new Date("2026-08-11T18:06:00.000Z"));
      await user.click(screen.getByRole("button", { name: /switch to administration/i }));

      const firstInput = recordTimeEvent.mock.calls[0]?.[0];
      const secondInput = recordTimeEvent.mock.calls[1]?.[0];
      expect(firstInput.event.occurredAt).toBe("2026-08-11T18:05:00.000Z");
      expect(secondInput.event.occurredAt).toBe("2026-08-11T18:06:00.000Z");
      expect(firstInput.idempotencyKey).not.toBe(secondInput.idempotencyKey);
    } finally {
      vi.useRealTimers();
    }
  });

  it("submits corrections for the explicitly chosen employee and attendance records", async () => {
    const requestTimeCorrection = vi.fn().mockResolvedValue({ idempotencyKey: "time-correction" });
    const requestAttendanceCorrection = vi.fn().mockResolvedValue({ idempotencyKey: "attendance-correction" });
    const chosenEmployeeEventId = "22222222-2222-4222-8222-222222222222";
    const chosenAttendanceEventId = "33333333-3333-4333-8333-333333333333";
    mockUsePayrollTime.mockReturnValue({
      ...baseHookValue,
      payrollDayQuery: {
        ...baseHookValue.payrollDayQuery,
        data: {
          ...basePayrollDay,
          day: {
            ...basePayrollDay.day,
            employeeTimeEvents: [
              ...basePayrollDay.day.employeeTimeEvents,
              {
                ...basePayrollDay.day.employeeTimeEvents[0],
                id: chosenEmployeeEventId,
                eventType: "meal_started",
                eventAt: "2026-08-11T16:30:00.000Z",
              },
            ],
            sessionAttendanceEvents: [
              ...basePayrollDay.day.sessionAttendanceEvents,
              {
                ...basePayrollDay.day.sessionAttendanceEvents[0],
                id: chosenAttendanceEventId,
                sessionId: "44444444-4444-4444-8444-444444444444",
                employeeTimeEventId: chosenEmployeeEventId,
                eventType: "session_ended",
                eventAt: "2026-08-11T16:45:00.000Z",
              },
            ],
          },
        },
      },
      requestTimeCorrectionMutation: {
        mutateAsync: requestTimeCorrection,
        isPending: false,
      },
      requestSessionAttendanceCorrectionMutation: {
        mutateAsync: requestAttendanceCorrection,
        isPending: false,
      },
    });

    renderTimePage();

    await userEvent.click(screen.getByRole("button", { name: /request payroll correction for meal started/i }));
    await userEvent.click(screen.getByRole("button", { name: /request session attendance correction for session ended/i }));

    expect(requestTimeCorrection.mock.calls[0]?.[0].correction.data.originalEventId).toBe(chosenEmployeeEventId);
    expect(requestAttendanceCorrection.mock.calls[0]?.[0].correction.data.sessionAttendanceEventId).toBe(chosenAttendanceEventId);
    expect(screen.getByRole("heading", { name: /payroll correction history/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /session attendance correction history/i })).toBeInTheDocument();
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
