import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api", () => ({
  callApi: vi.fn(),
}));

import { callApi } from "../../../lib/api";
import {
  derivePayrollTimesheetSnapshot,
  fetchPayrollDay,
  fetchPayrollTimesheetPeriod,
  fetchSessionPayrollContext,
  recordSessionAttendance,
  recordTimeEvent,
  requestSessionAttendanceCorrection,
  requestTimeCorrection,
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
});
