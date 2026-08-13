import React from "react";
import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUseAuth = vi.fn();
const mockUseActiveOrganizationId = vi.fn();
const mockUsePayrollTime = vi.fn();
const mockUsePayrollTimesheetPeriodReview = vi.fn();
const mockUsePayrollApprovals = vi.fn();

vi.mock("../../lib/authContext", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("../../lib/organization", () => ({
  useActiveOrganizationId: () => mockUseActiveOrganizationId(),
}));

vi.mock("../../features/payroll/usePayrollTime", () => ({
  usePayrollTime: (...args: unknown[]) => mockUsePayrollTime(...args),
  usePayrollTimesheetPeriodReview: (...args: unknown[]) => mockUsePayrollTimesheetPeriodReview(...args),
}));
vi.mock("../../features/payroll/usePayrollApprovals", () => ({
  usePayrollApprovals: (...args: unknown[]) => mockUsePayrollApprovals(...args),
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

const basePeriodReviewValue = {
  payrollTimesheetPeriodQuery: {
    data: {
      state: "ok" as const,
      exportedAt: null,
      exportKind: null,
      period: {
        selectedLocalDate: "2026-08-11",
        localDate: "2026-08-11",
        periodStart: "2026-08-10",
        periodEnd: "2026-08-16",
        timezone: "America/Los_Angeles",
        policyVersionId: "99999999-9999-9999-9999-999999999999",
        rateVersions: [
          {
            id: "88888888-8888-8888-8888-888888888888",
            effectiveFrom: "2026-08-01T00:00:00.000Z",
            effectiveThrough: null,
          },
        ],
        events: [
          {
            id: "timesheet-event-1",
            source: "employee_time",
            eventType: "shift_started",
            occurredAt: "2026-08-11T16:00:00.000Z",
            createdAt: "2026-08-11T16:00:01.000Z",
            timezone: "America/Los_Angeles",
            workLocation: "office",
            workCategory: "direct_service",
          },
        ],
        timeCorrectionRequests: basePayrollDay.day.timeCorrectionRequests,
        sessionAttendanceCorrectionRequests: basePayrollDay.day.sessionAttendanceCorrectionRequests,
        exceptions: [
          {
            id: "period-exception-1",
            exceptionCode: "meal_missing",
            createdAt: "2026-08-11T18:00:00.000Z",
          },
        ],
      },
      snapshot: {
        id: "snapshot-1",
        sourceHash: "abc123",
        totals: {
          regularSeconds: 28800,
          overtimeSeconds: 7200,
          doubleTimeSeconds: 0,
          mealPremiumCents: 2000,
          grossEarningsCents: 24000,
        },
      },
    },
    isError: false,
  },
  derivePayrollTimesheetSnapshotMutation: {
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  },
};

const baseApprovalValue = {
  payrollSelfApprovalQuery: {
    data: {
      state: "ok" as const,
      selectedLocalDate: "2026-08-11",
      approval: {
        currentState: "submitted",
        submittedAt: "2026-08-11T18:30:00.000Z",
        returnedComment: "Fix the missing meal punch.",
        unresolvedBlockerCount: 1,
        snapshot: {
          id: "11111111-1111-1111-1111-111111111111",
          hash: "a".repeat(64),
          isCurrent: true,
        },
        actions: {
          canSubmit: true,
        },
        compensation: {
          grossEarningsCents: 24000,
        },
        history: [
          {
            action: "returned",
            occurredAt: "2026-08-11T18:30:00.000Z",
            comment: "Fix the missing meal punch.",
            reason: null,
            snapshotId: "11111111-1111-1111-1111-111111111111",
            snapshotHash: "a".repeat(64),
          },
        ],
      },
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  },
  submitPayrollApprovalMutation: {
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
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
    mockUsePayrollTimesheetPeriodReview.mockReset();
    mockUsePayrollApprovals.mockReset();
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
    mockUsePayrollTimesheetPeriodReview.mockReturnValue(basePeriodReviewValue);
    mockUsePayrollApprovals.mockReturnValue(baseApprovalValue);
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
    expect(screen.getAllByText(/shift started/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/session started/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/aug 11, 2026, 9:00 am/i).length).toBeGreaterThan(1);
    expect(screen.getByText(/aug 11, 2026, 9:15 am/i)).toBeInTheDocument();
    expect(screen.getByText(/pending local events/i)).toBeInTheDocument();
    expect(screen.getByText(/pending confirmation/i)).toBeInTheDocument();
    expect(screen.getAllByText(/missed_punch/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/^outside_shift$/i)).toBeInTheDocument();
    expect(screen.getByText(/^session_outside_shift$/i)).toBeInTheDocument();
    expect(screen.getByText(/current work category/i)).toBeInTheDocument();
    expect(screen.getByText(/^direct_service$/i)).toBeInTheDocument();
    expect(screen.getByText(/current work location/i)).toBeInTheDocument();
    expect(screen.getByText(/^office$/i)).toBeInTheDocument();
    expect(screen.getByText(/payroll period review/i)).toBeInTheDocument();
    expect(screen.getByText(/payroll export: not exported/i)).toBeInTheDocument();
    expect(screen.getAllByText(/\$240.00/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/meal_missing/i)).toBeInTheDocument();
    expect(screen.queryByText(/\$20\.00 from/i)).not.toBeInTheDocument();
    expect(screen.getByText(/employee approval/i)).toBeInTheDocument();
    expect(screen.getByText(/returned comment: fix the missing meal punch\./i)).toBeInTheDocument();
  });

  it("distinguishes a later adjustment export from the initial payroll export", () => {
    mockUsePayrollTimesheetPeriodReview.mockReturnValue({
      ...basePeriodReviewValue,
      payrollTimesheetPeriodQuery: {
        ...basePeriodReviewValue.payrollTimesheetPeriodQuery,
        data: {
          ...basePeriodReviewValue.payrollTimesheetPeriodQuery.data,
          exportedAt: "2026-08-12T20:00:00.000Z",
          exportKind: "adjustment",
        },
      },
    });

    renderTimePage();
    expect(screen.getByText(/payroll export: adjustment exported/i)).toBeInTheDocument();
  });

  it.each([
    ["feature_disabled", "Payroll approval is not enabled."],
    ["unsupported_policy", "Payroll approval is not supported for this employment policy."],
    ["unsupported_jurisdiction", "Payroll approval is not supported for this employment policy."],
    ["missing_prerequisite", "Payroll approval prerequisites are incomplete."],
    ["no_employment_profile", "A payroll employment profile is required before self approval can render."],
  ] as const)("renders the state-only self approval status for %s", (state, message) => {
    mockUsePayrollApprovals.mockReturnValue({
      ...baseApprovalValue,
      payrollSelfApprovalQuery: {
        ...baseApprovalValue.payrollSelfApprovalQuery,
        data: { state },
      },
    });

    renderTimePage();

    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.queryByText(/invalid payroll approval response/i)).not.toBeInTheDocument();
  });

  it("requires attestation before submitting employee approval and binds only the exact self snapshot", async () => {
    const submitApproval = vi.fn().mockResolvedValue({ idempotencyKey: "approval-submit-key" });
    mockUsePayrollApprovals.mockReturnValue({
      ...baseApprovalValue,
      submitPayrollApprovalMutation: {
        mutateAsync: submitApproval,
        isPending: false,
        isError: false,
        error: null,
      },
    });

    renderTimePage();

    const button = screen.getByRole("button", { name: /submit approval/i });
    expect(button).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox"));
    expect(button).not.toBeDisabled();
    await userEvent.click(button);

    expect(submitApproval).toHaveBeenCalledWith(expect.objectContaining({
      snapshotId: "11111111-1111-1111-1111-111111111111",
      snapshotHash: "a".repeat(64),
      attestation: true,
    }));
    expect(submitApproval.mock.calls[0]?.[0]).not.toHaveProperty("grossEarningsCents");
  });

  it("renders authoritative blocked derive exceptions returned by the mutation", async () => {
    const blockedResult = {
      state: "blocked" as const,
      snapshotId: null,
      sourceHash: "blocked-source-hash",
      lockable: false as const,
      replayed: false,
      idempotencyKey: "timesheet-blocked-key",
      period: {
        selectedLocalDate: "2026-08-11",
        periodStart: "2026-08-10",
        periodEnd: "2026-08-16",
        timezone: "America/Los_Angeles",
      },
      totals: {
        regularSeconds: 0,
        overtimeSeconds: 0,
        doubleTimeSeconds: 0,
        mealPremiumCents: 0,
        grossEarningsCents: 0,
      },
      exceptions: [
        {
          code: "meal_unresolved",
          blocking: true,
        },
      ],
    };
    const deriveSnapshot = vi.fn().mockResolvedValue(blockedResult);
    mockUsePayrollTimesheetPeriodReview.mockReturnValue({
      ...basePeriodReviewValue,
      derivePayrollTimesheetSnapshotMutation: {
        mutateAsync: deriveSnapshot,
        data: blockedResult,
        isPending: false,
        isError: false,
        error: null,
        reset: vi.fn(),
      },
    });

    renderTimePage();

    expect(screen.getByText(/payroll derivation is blocked/i)).toBeInTheDocument();
    expect(screen.getByText(/meal_unresolved/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /derive payroll snapshot/i }));

    expect(deriveSnapshot).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["missing_prerequisite", "Payroll prerequisites are incomplete."],
    ["unsupported_policy", "Monthly payroll derivation is not active."],
  ] as const)("renders %s as an authoritative blocked review state", (state, expectedMessage) => {
    mockUsePayrollTimesheetPeriodReview.mockReturnValue({
      ...basePeriodReviewValue,
      payrollTimesheetPeriodQuery: {
        ...basePeriodReviewValue.payrollTimesheetPeriodQuery,
        data: {
          state,
          period: {
            selectedLocalDate: "2026-08-11",
            timezone: "America/Los_Angeles",
            events: [],
            rateVersions: [],
            exceptions: [],
          },
          snapshot: null,
        },
      },
    });

    renderTimePage();

    expect(screen.getByText(expectedMessage)).toBeInTheDocument();
    expect(screen.getByText(/pay period boundaries unavailable/i)).toBeInTheDocument();
    expect(screen.getAllByText(/not derived/i).length).toBeGreaterThan(0);
  });

  it("renders derive transport errors on the time route", async () => {
    const deriveError = Object.assign(new Error("Payroll transport failed."), {
      code: "upstream_error",
      status: 503,
    });
    const deriveSnapshot = vi.fn().mockRejectedValue(deriveError);
    mockUsePayrollTimesheetPeriodReview.mockReturnValue({
      ...basePeriodReviewValue,
      derivePayrollTimesheetSnapshotMutation: {
        mutateAsync: deriveSnapshot,
        data: undefined,
        isPending: false,
        isError: true,
        error: deriveError,
        reset: vi.fn(),
      },
    });

    renderTimePage();

    await userEvent.click(screen.getByRole("button", { name: /derive payroll snapshot/i }));

    expect(deriveSnapshot).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/payroll transport failed/i)).toBeInTheDocument();
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

  it("keeps payroll period review disabled until bootstrap authority resolves ok self-view access", () => {
    mockUsePayrollTime.mockReturnValue({
      ...baseHookValue,
      payrollDayQuery: {
        ...baseHookValue.payrollDayQuery,
        data: undefined,
        isLoading: true,
      },
    });

    renderTimePage();

    expect(mockUsePayrollTimesheetPeriodReview).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        enabled: false,
      }),
    );
  });
});
