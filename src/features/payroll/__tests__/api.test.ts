import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api", () => ({
  callApi: vi.fn(),
}));

import { callApi } from "../../../lib/api";
import {
  approvePayrollTimesheet,
  derivePayrollTimesheetSnapshot,
  fetchPayrollDay,
  fetchPayrollSelfApproval,
  fetchPayrollReviewDetails,
  fetchPayrollReviewQueue,
  fetchPayrollTimesheetPeriod,
  fetchSessionPayrollContext,
  lockPayrollTimesheet,
  reopenPayrollTimesheet,
  recordSessionAttendance,
  recordTimeEvent,
  resolvePayrollBlocker,
  submitPayrollApproval,
  requestSessionAttendanceCorrection,
  requestTimeCorrection,
  returnPayrollTimesheet,
} from "../api";

const mockedCallApi = vi.mocked(callApi);

const jsonResponse = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });

describe("payroll api client", () => {
  beforeEach(() => {
    mockedCallApi.mockReset();
  });

  it("fetches the payroll day with the explicit get_day action and sanitizes bootstrap arrays", async () => {
    mockedCallApi.mockResolvedValueOnce(
      jsonResponse({
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
          employeeTimeEvents: [
            {
              id: "11111111-1111-1111-1111-111111111111",
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
          sessionAttendanceEvents: undefined,
          timeCorrectionRequests: undefined,
          sessionAttendanceCorrectionRequests: [
            {
              id: "attendance-correction-1",
              employmentProfileId: "employment-1",
              sessionAttendanceEventId: "22222222-2222-2222-2222-222222222222",
              reasonCode: "outside_shift",
              replacementPayload: {},
              createdAt: "2026-08-11T17:05:00.000Z",
            },
          ],
          exceptions: undefined,
        },
        totals: {
          label: "Calculation pending",
          earningsCents: 99999,
        },
      }),
    );

    const result = await fetchPayrollDay({
      organizationId: "org-1",
      userId: "user-1",
      localDate: "2026-08-11",
    });

    expect(result).toEqual({
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
        employeeTimeEvents: [
          {
            id: "11111111-1111-1111-1111-111111111111",
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
        sessionAttendanceEvents: [],
        timeCorrectionRequests: [],
        sessionAttendanceCorrectionRequests: [
          {
            id: "attendance-correction-1",
            employmentProfileId: "employment-1",
            sessionAttendanceEventId: "22222222-2222-2222-2222-222222222222",
            reasonCode: "outside_shift",
            replacementPayload: {},
            createdAt: "2026-08-11T17:05:00.000Z",
          },
        ],
        exceptions: [],
      },
      totals: {
        label: "Calculation pending",
      },
    });

    const [path, init] = mockedCallApi.mock.calls[0] ?? [];
    expect(path).toBe("/api/payroll-time-events");
    expect(init).toEqual(
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          action: "get_day",
          localDate: "2026-08-11",
        }),
      }),
    );
  });

  it("parses explicit non-ok states even when employment bootstrap fields are nullable", async () => {
    mockedCallApi.mockResolvedValueOnce(
      jsonResponse({
        state: "no_employment_profile",
        bootstrap: {
          organizationId: "org-1",
          employmentProfileId: null,
          localDate: "2026-08-11",
          employmentTimezone: null,
          workdayStartsAt: null,
          capabilities: {
            canViewSelf: false,
            canClockSelf: false,
            canRequestCorrectionSelf: false,
          },
        },
        day: {
          employeeTimeEvents: [],
          sessionAttendanceEvents: [],
          timeCorrectionRequests: [],
          sessionAttendanceCorrectionRequests: [],
          exceptions: [],
        },
        totals: {
          label: "Calculation pending",
        },
      }),
    );

    await expect(
      fetchPayrollDay({
        organizationId: "org-1",
        userId: "user-1",
        localDate: "2026-08-11",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        state: "no_employment_profile",
        bootstrap: expect.objectContaining({
          employmentProfileId: null,
          employmentTimezone: null,
          workdayStartsAt: null,
          capabilities: {
            canViewSelf: false,
            canClockSelf: false,
            canRequestCorrectionSelf: false,
          },
        }),
      }),
    );
  });

  it("fetches payroll period review by localDate so the database owns pay-period boundaries", async () => {
    mockedCallApi.mockResolvedValueOnce(
      jsonResponse({
        state: "ok",
        period: {
          selectedLocalDate: "2026-08-11",
          periodStart: "2026-08-10",
          periodEnd: "2026-08-16",
          timezone: "America/Los_Angeles",
          rateVersions: [
            {
              id: "88888888-8888-8888-8888-888888888888",
              effectiveFrom: "2026-08-01T00:00:00.000Z",
              effectiveThrough: null,
              hourlyRateCents: 2000,
            },
          ],
          exceptions: [],
        },
        snapshot: null,
      }),
    );

    const result = await fetchPayrollTimesheetPeriod({
      organizationId: "org-1",
      userId: "user-1",
      localDate: "2026-08-11",
    });

    expect(result).toMatchObject({
      state: "ok",
      period: {
        selectedLocalDate: "2026-08-11",
        periodStart: "2026-08-10",
        periodEnd: "2026-08-16",
      },
    });
    expect(result.period.rateVersions?.[0]).not.toHaveProperty("hourlyRateCents");

    const [path, init] = mockedCallApi.mock.calls[0] ?? [];
    expect(path).toBe("/api/payroll-timesheets");
    expect(init).toEqual(
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          action: "get_period",
          selectedLocalDate: "2026-08-11",
        }),
      }),
    );
  });

  it.each(["missing_prerequisite", "unsupported_policy"] as const)(
    "preserves the authoritative %s period state when boundaries are not available",
    async (state) => {
      mockedCallApi.mockResolvedValueOnce(
        jsonResponse({
          state,
          period: {
            selectedLocalDate: "2026-08-11",
            timezone: "America/Los_Angeles",
            events: [],
            rateVersions: [],
            exceptions: [],
          },
          snapshot: null,
        }),
      );

      await expect(
        fetchPayrollTimesheetPeriod({
          organizationId: "org-1",
          userId: "user-1",
          localDate: "2026-08-11",
        }),
      ).resolves.toMatchObject({
        state,
        period: {
          selectedLocalDate: "2026-08-11",
          timezone: "America/Los_Angeles",
        },
      });
    },
  );

  it("preserves HTTP-200 blocked derive payloads with localDate, nullable sourceHash, and exact idempotency confirmation", async () => {
    mockedCallApi.mockResolvedValueOnce(
      jsonResponse(
        {
          state: "blocked",
          snapshotId: null,
          sourceHash: "blocked-source-hash",
          lockable: false,
          replayed: false,
          idempotencyKey: "timesheet-blocked-key",
          totals: {
            regularSeconds: 0,
            overtimeSeconds: 0,
            doubleTimeSeconds: 0,
            mealPremiumCents: 0,
            grossEarningsCents: 0,
          },
          period: {
            selectedLocalDate: "2026-08-11",
            periodStart: "2026-08-10",
            periodEnd: "2026-08-16",
            timezone: "America/Los_Angeles",
          },
          exceptions: [
            {
              code: "meal_unresolved",
              blocking: true,
            },
          ],
        },
        200,
        {
          "Idempotency-Key": "timesheet-blocked-key",
        },
      ),
    );

    await expect(
      derivePayrollTimesheetSnapshot({
        organizationId: "org-1",
        userId: "user-1",
        localDate: "2026-08-11",
      }, {
        selectedLocalDate: "2026-08-11",
        idempotencyKey: "timesheet-blocked-key",
      }),
    ).resolves.toMatchObject({
      state: "blocked",
      snapshotId: null,
      sourceHash: "blocked-source-hash",
      idempotencyKey: "timesheet-blocked-key",
      period: {
        selectedLocalDate: "2026-08-11",
        periodStart: "2026-08-10",
        periodEnd: "2026-08-16",
      },
      exceptions: [
        expect.objectContaining({
          code: "meal_unresolved",
          blocking: true,
        }),
      ],
    });

    const [path, init] = mockedCallApi.mock.calls[0] ?? [];
    expect(path).toBe("/api/payroll-timesheets");
    expect(init).toEqual(
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          action: "derive_snapshot",
          selectedLocalDate: "2026-08-11",
        }),
      }),
    );
    const headers = init?.headers as Record<string, string> | Headers;
    const idempotencyHeader = headers instanceof Headers ? headers.get("Idempotency-Key") : headers["Idempotency-Key"];
    expect(idempotencyHeader).toBe("timesheet-blocked-key");
  });

  it("preserves blocked derives when payroll prerequisites do not establish period boundaries", async () => {
    mockedCallApi.mockResolvedValueOnce(
      jsonResponse(
        {
          state: "blocked",
          snapshotId: null,
          sourceHash: null,
          lockable: false,
          replayed: false,
          idempotencyKey: "timesheet-prerequisite-key",
          totals: {
            regularSeconds: 0,
            overtimeSeconds: 0,
            doubleTimeSeconds: 0,
            mealPremiumCents: 0,
            grossEarningsCents: 0,
          },
          period: {
            selectedLocalDate: "2026-08-11",
            timezone: "America/Los_Angeles",
          },
          exceptions: [{ code: "missing_prerequisite", blocking: true }],
        },
        200,
        { "Idempotency-Key": "timesheet-prerequisite-key" },
      ),
    );

    await expect(
      derivePayrollTimesheetSnapshot({
        organizationId: "org-1",
        userId: "user-1",
        localDate: "2026-08-11",
      }, {
        selectedLocalDate: "2026-08-11",
        idempotencyKey: "timesheet-prerequisite-key",
      }),
    ).resolves.toMatchObject({
      state: "blocked",
      period: { selectedLocalDate: "2026-08-11" },
      exceptions: [{ code: "missing_prerequisite", blocking: true }],
    });
  });

  it("fetches session payroll context with only sessionId and parses the exact nullable fields", async () => {
    mockedCallApi.mockResolvedValueOnce(
      jsonResponse({
        state: "ok",
        sessionId: "77777777-7777-7777-7777-777777777777",
        organizationId: "88888888-8888-8888-8888-888888888888",
        employmentProfileId: "99999999-9999-9999-9999-999999999999",
        employmentTimezone: "America/Los_Angeles",
        actorIsAssignedEmployee: true,
        canClockSelf: false,
        canonicalWorkLocation: "office",
        activeShiftEventId: null,
      }),
    );

    await expect(
      fetchSessionPayrollContext("77777777-7777-7777-7777-777777777777"),
    ).resolves.toEqual({
      state: "ok",
      sessionId: "77777777-7777-7777-7777-777777777777",
      organizationId: "88888888-8888-8888-8888-888888888888",
      employmentProfileId: "99999999-9999-9999-9999-999999999999",
      employmentTimezone: "America/Los_Angeles",
      actorIsAssignedEmployee: true,
      canClockSelf: false,
      canonicalWorkLocation: "office",
      activeShiftEventId: null,
    });

    const [path, init] = mockedCallApi.mock.calls[0] ?? [];
    expect(path).toBe("/api/payroll-time-events");
    expect(init).toEqual(
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          action: "get_session_context",
          sessionId: "77777777-7777-7777-7777-777777777777",
        }),
      }),
    );
    const headers = init?.headers as Headers;
    expect(headers.get("Idempotency-Key")).toBeNull();
  });

  it("passes through explicit feature_disabled session context responses only when requested", async () => {
    mockedCallApi.mockResolvedValueOnce(
      jsonResponse({
        state: "feature_disabled",
        sessionId: "77777777-7777-7777-7777-777777777777",
        organizationId: "88888888-8888-8888-8888-888888888888",
      }),
    );

    await expect(
      fetchSessionPayrollContext("77777777-7777-7777-7777-777777777777", { allowDisabled: true }),
    ).resolves.toEqual({
      state: "feature_disabled",
      sessionId: "77777777-7777-7777-7777-777777777777",
      organizationId: "88888888-8888-8888-8888-888888888888",
    });
  });

  it("fails closed on feature_disabled session context responses unless disabled pass-through is explicit", async () => {
    mockedCallApi.mockResolvedValueOnce(
      jsonResponse({
        state: "feature_disabled",
        sessionId: "77777777-7777-7777-7777-777777777777",
        organizationId: "88888888-8888-8888-8888-888888888888",
      }),
    );

    await expect(
      fetchSessionPayrollContext("77777777-7777-7777-7777-777777777777"),
    ).rejects.toMatchObject({
      code: "invalid_response",
      status: 502,
    });
  });

  it("fails closed when session payroll context response shape drifts", async () => {
    mockedCallApi.mockResolvedValueOnce(
      jsonResponse({
        state: "feature_disabled",
        sessionId: "77777777-7777-7777-7777-777777777777",
        organizationId: "88888888-8888-8888-8888-888888888888",
        employmentTimezone: null,
      }),
    );

    await expect(
      fetchSessionPayrollContext("77777777-7777-7777-7777-777777777777"),
    ).rejects.toMatchObject({
      code: "invalid_response",
      status: 502,
    });
  });

  it("sends mutation requests with the exact occurredAt and Idempotency-Key header only", async () => {
    mockedCallApi.mockResolvedValueOnce(
      jsonResponse(
        {
          id: "event-1",
          idempotencyKey: "time-key-1",
        },
        200,
        {
          "Idempotency-Key": "time-key-1",
        },
      ),
    );

    await recordTimeEvent({
      organizationId: "org-1",
      userId: "user-1",
      localDate: "2026-08-11",
      idempotencyKey: "time-key-1",
      event: {
        occurredAt: "2026-08-11T16:00:00.123Z",
        timezone: "America/Los_Angeles",
        workLocation: "office",
        data: {
          eventType: "shift_started",
        },
      },
    });

    const [path, init] = mockedCallApi.mock.calls[0] ?? [];
    expect(path).toBe("/api/payroll-time-events");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Headers;
    expect(headers.get("Idempotency-Key")).toBe("time-key-1");
    expect(JSON.parse(String(init?.body))).toEqual({
      action: "record_time_event",
      event: {
        occurredAt: "2026-08-11T16:00:00.123Z",
        timezone: "America/Los_Angeles",
        workLocation: "office",
        data: {
          eventType: "shift_started",
        },
      },
    });
  });

  it("sends session attendance with only the server-accepted production payload", async () => {
    mockedCallApi.mockResolvedValueOnce(
      jsonResponse(
        { id: "attendance-1", idempotencyKey: "attendance-key-1" },
        200,
        { "Idempotency-Key": "attendance-key-1" },
      ),
    );

    await recordSessionAttendance({
      organizationId: "org-1",
      userId: "user-1",
      localDate: "2026-08-11",
      idempotencyKey: "attendance-key-1",
      event: {
        occurredAt: "2026-08-11T16:10:00.000Z",
        data: {
          eventType: "session_started",
          sessionId: "11111111-1111-1111-1111-111111111111",
        },
      },
    });

    const [, init] = mockedCallApi.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({
      action: "record_session_attendance",
      event: {
        occurredAt: "2026-08-11T16:10:00.000Z",
        data: {
          eventType: "session_started",
          sessionId: "11111111-1111-1111-1111-111111111111",
        },
      },
    });
  });

  it("rejects legacy session attendance authority fields instead of stripping them", async () => {
    await expect(recordSessionAttendance({
      organizationId: "org-1",
      userId: "user-1",
      localDate: "2026-08-11",
      idempotencyKey: "legacy-attendance-key",
      event: {
        occurredAt: "2026-08-11T16:10:00.000Z",
        timezone: "America/Los_Angeles",
        workLocation: "client_site",
        data: {
          eventType: "session_started",
          sessionId: "11111111-1111-1111-1111-111111111111",
          employeeTimeEventId: "22222222-2222-2222-2222-222222222222",
        },
      } as never,
    })).rejects.toThrow();

    expect(mockedCallApi).not.toHaveBeenCalled();
  });

  it("rejects forbidden authority fields recursively before network", async () => {
    await expect(
      recordSessionAttendance({
        organizationId: "org-1",
        userId: "user-1",
        localDate: "2026-08-11",
        idempotencyKey: "attendance-key-1",
        event: {
          occurredAt: "2026-08-11T16:10:00.000Z",
          timezone: "America/Los_Angeles",
          workLocation: "client_site",
          data: {
            eventType: "session_started",
            sessionId: "11111111-1111-1111-1111-111111111111",
            actorId: "malicious-user",
          },
        },
      }),
    ).rejects.toThrow(/authority/i);

    expect(mockedCallApi).not.toHaveBeenCalled();
  });

  it("fails closed when the body or response header idempotency key does not match", async () => {
    mockedCallApi.mockResolvedValueOnce(
      jsonResponse(
        {
          id: "event-1",
          idempotencyKey: "different-body-key",
        },
        200,
        {
          "Idempotency-Key": "different-header-key",
        },
      ),
    );

    await expect(
      recordTimeEvent({
        organizationId: "org-1",
        userId: "user-1",
        localDate: "2026-08-11",
        idempotencyKey: "time-key-2",
        event: {
          occurredAt: "2026-08-11T16:15:00.000Z",
          timezone: "America/Los_Angeles",
          workLocation: "office",
          data: {
            eventType: "shift_started",
          },
        },
      }),
    ).rejects.toMatchObject({
      code: "idempotency_mismatch",
      status: 502,
    });
  });

  it("normalizes state_conflict distinctly for outbox stop conditions", async () => {
    mockedCallApi.mockResolvedValueOnce(
      jsonResponse(
        {
          code: "state_conflict",
          error: "Payroll state conflict.",
          idempotencyKey: "attendance-key-conflict",
        },
        409,
        {
          "Idempotency-Key": "attendance-key-conflict",
        },
      ),
    );

    await expect(
      recordSessionAttendance({
        organizationId: "org-1",
        userId: "user-1",
        localDate: "2026-08-11",
        idempotencyKey: "attendance-key-conflict",
        event: {
          occurredAt: "2026-08-11T16:20:00.000Z",
          data: {
            eventType: "session_started",
            sessionId: "11111111-1111-1111-1111-111111111111",
          },
        },
      }),
    ).rejects.toMatchObject({
      code: "state_conflict",
      status: 409,
    });
  });

  it("preserves safe retry metadata for retryable payroll transport failures", async () => {
    mockedCallApi.mockResolvedValueOnce(
      jsonResponse(
        {
          code: "upstream_error",
          error: "Payroll transport failed.",
          retryAfter: "2026-08-11T18:00:00.000Z",
          retryAfterSeconds: 30,
          idempotencyKey: "correction-key-retry",
        },
        503,
        {
          "Idempotency-Key": "correction-key-retry",
          "Retry-After": "30",
        },
      ),
    );

    await expect(
      requestTimeCorrection({
        organizationId: "org-1",
        userId: "user-1",
        localDate: "2026-08-11",
        idempotencyKey: "correction-key-retry",
        correction: {
          data: {
            originalEventId: "22222222-2222-2222-2222-222222222222",
            reasonCode: "missed_punch",
          },
        },
      }),
    ).rejects.toMatchObject({
      status: 503,
      retryAfter: "2026-08-11T18:00:00.000Z",
      retryAfterSeconds: 30,
      code: "upstream_error",
    });
  });

  it("sends session attendance correction through the protected payroll endpoint without scope authority", async () => {
    mockedCallApi.mockResolvedValueOnce(
      jsonResponse(
        {
          id: "attendance-correction-1",
          idempotencyKey: "attendance-correction-key-1",
        },
        200,
        {
          "Idempotency-Key": "attendance-correction-key-1",
        },
      ),
    );

    await requestSessionAttendanceCorrection({
      organizationId: "org-1",
      userId: "user-1",
      localDate: "2026-08-11",
      idempotencyKey: "attendance-correction-key-1",
      correction: {
        data: {
          sessionAttendanceEventId: "33333333-3333-3333-3333-333333333333",
          reasonCode: "outside_shift",
        },
      },
    });

    const [, init] = mockedCallApi.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({
      action: "request_session_attendance_correction",
      correction: {
        data: {
          sessionAttendanceEventId: "33333333-3333-3333-3333-333333333333",
          reasonCode: "outside_shift",
        },
      },
    });
  });

  it("keeps every mutation idempotency key out of the JSON body", async () => {
    mockedCallApi.mockImplementation(async (_path, init) => {
      const key = (init?.headers as Headers).get("Idempotency-Key") ?? "";
      return jsonResponse({ id: `result-${key}`, idempotencyKey: key }, 200, {
        "Idempotency-Key": key,
      });
    });

    await recordTimeEvent({
      organizationId: "org-1",
      userId: "user-1",
      localDate: "2026-08-11",
      idempotencyKey: "time-body-key",
      event: {
        occurredAt: "2026-08-11T16:00:00.000Z",
        timezone: "America/Los_Angeles",
        workLocation: "office",
        data: { eventType: "shift_started" },
      },
    });
    await recordSessionAttendance({
      organizationId: "org-1",
      userId: "user-1",
      localDate: "2026-08-11",
      idempotencyKey: "attendance-body-key",
      event: {
        occurredAt: "2026-08-11T16:05:00.000Z",
        data: {
          eventType: "session_started",
          sessionId: "11111111-1111-1111-1111-111111111111",
        },
      },
    });
    await requestTimeCorrection({
      organizationId: "org-1",
      userId: "user-1",
      localDate: "2026-08-11",
      idempotencyKey: "correction-body-key",
      correction: {
        data: {
          originalEventId: "22222222-2222-2222-2222-222222222222",
          reasonCode: "missed_punch",
        },
      },
    });
    await requestSessionAttendanceCorrection({
      organizationId: "org-1",
      userId: "user-1",
      localDate: "2026-08-11",
      idempotencyKey: "attendance-correction-body-key",
      correction: {
        data: {
          sessionAttendanceEventId: "33333333-3333-3333-3333-333333333333",
          reasonCode: "outside_shift",
        },
      },
    });

    expect(mockedCallApi).toHaveBeenCalledTimes(4);
    for (const [, init] of mockedCallApi.mock.calls) {
      expect(JSON.parse(String(init?.body))).not.toHaveProperty("idempotencyKey");
    }
  });

  it("submits payroll approval with only snapshot transport fields and the Idempotency-Key header", async () => {
    mockedCallApi.mockResolvedValueOnce(
      jsonResponse(
        {
          transitionId: "22222222-2222-2222-2222-222222222222",
          snapshotId: "11111111-1111-1111-1111-111111111111",
          snapshotHash: "a".repeat(64),
          canonicalSnapshotHash: "a".repeat(64),
          action: "submitted",
          previousTransitionId: null,
          replayed: false,
          occurredAt: "2026-08-12T18:00:00.000Z",
          idempotencyKey: "approval-submit-key",
        },
        200,
        {
          "Idempotency-Key": "approval-submit-key",
        },
      ),
    );

    await submitPayrollApproval({
      organizationId: "org-1",
      userId: "user-1",
      localDate: "2026-08-12",
      idempotencyKey: "approval-submit-key",
      snapshotId: "11111111-1111-1111-1111-111111111111",
      snapshotHash: "a".repeat(64),
      attestation: true,
    });

    const [path, init] = mockedCallApi.mock.calls[0] ?? [];
    expect(path).toBe("/api/payroll-approvals");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Headers;
    expect(headers.get("Idempotency-Key")).toBe("approval-submit-key");
    expect(JSON.parse(String(init?.body))).toEqual({
      action: "submit",
      snapshotId: "11111111-1111-1111-1111-111111111111",
      snapshotHash: "a".repeat(64),
      attestation: true,
    });
  });

  it("fetches self approval without Idempotency-Key and fails closed on response leakage", async () => {
    mockedCallApi.mockResolvedValueOnce(
      jsonResponse({
        state: "ok",
        selectedLocalDate: "2026-08-12",
        approval: {
          currentState: "submitted",
          submittedAt: "2026-08-12T18:00:00.000Z",
          returnedComment: null,
          unresolvedBlockerCount: 0,
          snapshot: {
            id: "11111111-1111-1111-1111-111111111111",
            hash: "a".repeat(64),
            isCurrent: true,
          },
          actions: {
            canSubmit: true,
          },
          history: [],
          hourlyRateCents: 9999,
        },
      }),
    );

    await expect(fetchPayrollSelfApproval({
      organizationId: "org-1",
      userId: "user-1",
      localDate: "2026-08-12",
    })).rejects.toMatchObject({
      code: "invalid_response",
      status: 502,
    });

    const [path, init] = mockedCallApi.mock.calls[0] ?? [];
    expect(path).toBe("/api/payroll-approvals");
    const headers = init?.headers as Headers;
    expect(headers.get("Idempotency-Key")).toBeNull();
    expect(JSON.parse(String(init?.body))).toEqual({
      action: "self_approval",
      selectedLocalDate: "2026-08-12",
    });
  });

  it("fetches the review queue without Idempotency-Key and fails closed on compensation leakage", async () => {
    mockedCallApi.mockResolvedValueOnce(
      jsonResponse({
        state: "ok",
        selectedLocalDate: "2026-08-12",
        capabilities: {
          canReviewAssigned: true,
          canApproveAssigned: false,
          canViewCompensation: false,
          hasOrgPayrollAccess: false,
        },
        queue: [
          {
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
            classifiedSeconds: {
              regular: 14400,
              overtime: 0,
              doubleTime: 0,
            },
            compensation: {
              grossEarningsCents: 123456,
            },
          },
        ],
      }),
    );

    await expect(
      fetchPayrollReviewQueue({
        organizationId: "org-1",
        userId: "user-1",
        localDate: "2026-08-12",
      }),
    ).rejects.toMatchObject({
      code: "invalid_response",
      status: 502,
    });

    const [path, init] = mockedCallApi.mock.calls[0] ?? [];
    expect(path).toBe("/api/payroll-approvals");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Headers;
    expect(headers.get("Idempotency-Key")).toBeNull();
    expect(JSON.parse(String(init?.body))).toEqual({
      action: "review_queue",
      selectedLocalDate: "2026-08-12",
    });
  });

  it("rejects non-UUID review queue employment identifiers", async () => {
    mockedCallApi.mockResolvedValueOnce(
      jsonResponse({
        state: "ok",
        selectedLocalDate: "2026-08-12",
        capabilities: {
          canReviewAssigned: true,
          canApproveAssigned: false,
          canViewCompensation: false,
          hasOrgPayrollAccess: false,
        },
        queue: [{
          employeeLabel: "Employee 1001",
          employmentProfileId: "employment-1",
          payPeriodId: "88888888-8888-4888-8888-888888888888",
          periodStart: "2026-08-10",
          periodEnd: "2026-08-16",
          state: "submitted",
          blockerCount: 0,
          submittedAt: null,
          snapshot: { id: null, hash: null },
          classifiedSeconds: { regular: 0, overtime: 0, doubleTime: 0 },
        }],
      }),
    );

    await expect(fetchPayrollReviewQueue({
      organizationId: "org-1",
      userId: "user-1",
      localDate: "2026-08-12",
    })).rejects.toMatchObject({ code: "invalid_response", status: 502 });
  });

  it("rejects review detail snapshot hashes outside strict lowercase SHA-256 form before network", async () => {
    await expect(fetchPayrollReviewDetails({
      organizationId: "org-1",
      userId: "user-1",
      localDate: "2026-08-12",
      snapshotId: "11111111-1111-1111-1111-111111111111",
      snapshotHash: "A".repeat(64),
    })).rejects.toThrow();

    expect(mockedCallApi).not.toHaveBeenCalled();
  });

  it("fetches review details with exact snapshot binding and no Idempotency-Key header", async () => {
    mockedCallApi.mockResolvedValueOnce(
      jsonResponse({
        state: "ok",
        snapshotId: "11111111-1111-1111-1111-111111111111",
        snapshotHash: "a".repeat(64),
        periodStart: "2026-08-10",
        periodEnd: "2026-08-16",
        approvalHistory: [],
        punches: [],
        blockers: [],
        classifiedSeconds: {
          regular: 14400,
          overtime: 0,
          doubleTime: 0,
        },
        unresolvedBlockerCount: 0,
      }),
    );

    await expect(
      fetchPayrollReviewDetails({
        organizationId: "org-1",
        userId: "user-1",
        localDate: "2026-08-12",
        snapshotId: "11111111-1111-1111-1111-111111111111",
        snapshotHash: "a".repeat(64),
      }),
    ).resolves.toMatchObject({
      snapshotId: "11111111-1111-1111-1111-111111111111",
      snapshotHash: "a".repeat(64),
      punches: [],
      approvalHistory: [],
    });

    const [path, init] = mockedCallApi.mock.calls[0] ?? [];
    expect(path).toBe("/api/payroll-approvals");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Headers;
    expect(headers.get("Idempotency-Key")).toBeNull();
    expect(JSON.parse(String(init?.body))).toEqual({
      action: "review_details",
      snapshotId: "11111111-1111-1111-1111-111111111111",
      snapshotHash: "a".repeat(64),
    });
  });

  it("sends manager return, lock, and reopen approval actions through the protected endpoint without authority fields", async () => {
    mockedCallApi.mockImplementation(async (_path, init) => {
      const key = (init?.headers as Headers).get("Idempotency-Key") ?? "";
      const body = JSON.parse(String(init?.body)) as { action: string; snapshotId: string; snapshotHash: string };
      return jsonResponse({
        transitionId:
          body.action === "return"
            ? "77777777-7777-7777-7777-777777777777"
            : body.action === "lock"
            ? "88888888-8888-8888-8888-888888888888"
            : "99999999-9999-9999-9999-999999999999",
        snapshotId: body.snapshotId,
        snapshotHash: body.snapshotHash,
        canonicalSnapshotHash: body.snapshotHash,
        action: body.action === "return"
          ? "returned"
          : body.action === "lock"
          ? "locked"
          : "reopened",
        previousTransitionId: null,
        replayed: false,
        occurredAt: "2026-08-12T18:10:00.000Z",
        idempotencyKey: key,
      }, 200, {
        "Idempotency-Key": key,
      });
    });

    await returnPayrollTimesheet({
      organizationId: "org-1",
      userId: "user-1",
      localDate: "2026-08-12",
      idempotencyKey: "approval-return-key",
      snapshotId: "11111111-1111-1111-1111-111111111111",
      snapshotHash: "a".repeat(64),
      comment: "Needs correction.",
    });
    await lockPayrollTimesheet({
      organizationId: "org-1",
      userId: "user-1",
      localDate: "2026-08-12",
      idempotencyKey: "approval-lock-key",
      snapshotId: "11111111-1111-1111-1111-111111111111",
      snapshotHash: "a".repeat(64),
    });
    await reopenPayrollTimesheet({
      organizationId: "org-1",
      userId: "user-1",
      localDate: "2026-08-12",
      idempotencyKey: "approval-reopen-key",
      snapshotId: "11111111-1111-1111-1111-111111111111",
      snapshotHash: "a".repeat(64),
      reason: "Correction arrived after lock.",
    });

    expect(mockedCallApi).toHaveBeenCalledTimes(3);
    for (const [path, init] of mockedCallApi.mock.calls) {
      expect(path).toBe("/api/payroll-approvals");
      expect(JSON.parse(String(init?.body))).not.toHaveProperty("organizationId");
      expect(JSON.parse(String(init?.body))).not.toHaveProperty("userId");
    }
  });

  it("resolves blockers through the approval transport with exact blocker fields and no snapshot bypass", async () => {
    mockedCallApi.mockResolvedValueOnce(
      jsonResponse(
        {
          resolutionId: "44444444-4444-4444-4444-444444444444",
          blockerType: "timekeeping_exception",
          blockerId: "55555555-5555-5555-5555-555555555555",
          payPeriodId: "66666666-6666-6666-6666-666666666666",
          action: "resolved",
          previousResolutionId: null,
          replayed: false,
          occurredAt: "2026-08-12T18:05:00.000Z",
          idempotencyKey: "approval-blocker-key",
        },
        200,
        {
          "Idempotency-Key": "approval-blocker-key",
        },
      ),
    );

    await resolvePayrollBlocker({
      organizationId: "org-1",
      userId: "user-1",
      localDate: "2026-08-12",
      idempotencyKey: "approval-blocker-key",
      snapshotId: "11111111-1111-1111-1111-111111111111",
      snapshotHash: "a".repeat(64),
      blockerType: "timekeeping_exception",
      blockerId: "55555555-5555-5555-5555-555555555555",
      resolution: "resolved",
      reason: "Reviewed and corrected.",
    });

    const [path, init] = mockedCallApi.mock.calls[0] ?? [];
    expect(path).toBe("/api/payroll-approvals");
    expect(JSON.parse(String(init?.body))).toEqual({
      action: "resolve_blocker",
      snapshotId: "11111111-1111-1111-1111-111111111111",
      snapshotHash: "a".repeat(64),
      blockerType: "timekeeping_exception",
      blockerId: "55555555-5555-5555-5555-555555555555",
      resolution: "resolved",
      reason: "Reviewed and corrected.",
    });
  });

  it("fails closed when an approval success response omits the authoritative idempotency echo", async () => {
    mockedCallApi.mockResolvedValueOnce(
      jsonResponse(
        {
          transitionId: "22222222-2222-2222-2222-222222222222",
          snapshotId: "11111111-1111-1111-1111-111111111111",
          snapshotHash: "a".repeat(64),
          canonicalSnapshotHash: "a".repeat(64),
          action: "submitted",
          previousTransitionId: null,
          replayed: false,
          occurredAt: "2026-08-12T18:00:00.000Z",
        },
        200,
        {
          "Idempotency-Key": "approval-submit-key",
        },
      ),
    );

    await expect(
      submitPayrollApproval({
        organizationId: "org-1",
        userId: "user-1",
        localDate: "2026-08-12",
        idempotencyKey: "approval-submit-key",
        snapshotId: "11111111-1111-1111-1111-111111111111",
        snapshotHash: "a".repeat(64),
        attestation: true,
      }),
    ).rejects.toMatchObject({
      code: "invalid_response",
      status: 502,
    });
  });

  it("fails closed when an approval success echo mismatches the request key", async () => {
    mockedCallApi.mockResolvedValueOnce(
      jsonResponse(
        {
          resolutionId: "44444444-4444-4444-4444-444444444444",
          blockerType: "timekeeping_exception",
          blockerId: "55555555-5555-5555-5555-555555555555",
          payPeriodId: "66666666-6666-6666-6666-666666666666",
          action: "resolved",
          previousResolutionId: null,
          replayed: false,
          occurredAt: "2026-08-12T18:05:00.000Z",
          idempotencyKey: "different-body-key",
        },
        200,
        {
          "Idempotency-Key": "different-header-key",
        },
      ),
    );

    await expect(
      resolvePayrollBlocker({
        organizationId: "org-1",
        userId: "user-1",
        localDate: "2026-08-12",
        idempotencyKey: "approval-blocker-key",
        snapshotId: "11111111-1111-1111-1111-111111111111",
        snapshotHash: "a".repeat(64),
        blockerType: "timekeeping_exception",
        blockerId: "55555555-5555-5555-5555-555555555555",
        resolution: "resolved",
        reason: "Reviewed and corrected.",
      }),
    ).rejects.toMatchObject({
      code: "idempotency_mismatch",
      status: 502,
    });
  });

  it("rejects payroll approval authority injection recursively before network", async () => {
    await expect(
      approvePayrollTimesheet({
        organizationId: "org-1",
        userId: "user-1",
        localDate: "2026-08-12",
        idempotencyKey: "approval-manager-key",
        snapshotId: "11111111-1111-1111-1111-111111111111",
        snapshotHash: "a".repeat(64),
        comment: "Looks good.",
        nested: {
          actorId: "malicious-user",
        },
      } as never),
    ).rejects.toThrow(/authority/i);

    expect(mockedCallApi).not.toHaveBeenCalled();
  });

  it("surfaces feature_disabled approval responses explicitly and never treats them as retryable", async () => {
    mockedCallApi.mockResolvedValueOnce(
      jsonResponse(
        {
          code: "feature_disabled",
          error: "Payroll approval workflow is unavailable.",
          message: "Payroll approval workflow is unavailable.",
          state: "feature_disabled",
          idempotencyKey: "approval-feature-key",
        },
        403,
        {
          "Idempotency-Key": "approval-feature-key",
        },
      ),
    );

    await expect(
      lockPayrollTimesheet({
        organizationId: "org-1",
        userId: "user-1",
        localDate: "2026-08-12",
        idempotencyKey: "approval-feature-key",
        snapshotId: "11111111-1111-1111-1111-111111111111",
        snapshotHash: "a".repeat(64),
      }),
    ).rejects.toMatchObject({
      code: "feature_disabled",
      status: 403,
      state: "feature_disabled",
    });
  });

  it("fails closed when approval responses expose extra compensation data", async () => {
    mockedCallApi.mockResolvedValueOnce(
      jsonResponse(
        {
          transitionId: "22222222-2222-2222-2222-222222222222",
          snapshotId: "11111111-1111-1111-1111-111111111111",
          snapshotHash: "a".repeat(64),
          canonicalSnapshotHash: "a".repeat(64),
          action: "submitted",
          previousTransitionId: null,
          replayed: false,
          occurredAt: "2026-08-12T18:00:00.000Z",
          idempotencyKey: "approval-shape-key",
          grossEarningsCents: 999999,
        },
        200,
        {
          "Idempotency-Key": "approval-shape-key",
        },
      ),
    );

    await expect(
      submitPayrollApproval({
        organizationId: "org-1",
        userId: "user-1",
        localDate: "2026-08-12",
        idempotencyKey: "approval-shape-key",
        snapshotId: "11111111-1111-1111-1111-111111111111",
        snapshotHash: "a".repeat(64),
        attestation: true,
      }),
    ).rejects.toMatchObject({
      code: "invalid_response",
      status: 502,
    });
  });
});
