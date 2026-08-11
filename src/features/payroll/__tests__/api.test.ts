import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api", () => ({
  callApi: vi.fn(),
}));

import { callApi } from "../../../lib/api";
import {
  fetchPayrollDay,
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
          timezone: "America/Los_Angeles",
          workLocation: "client_site",
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
        timezone: "America/Los_Angeles",
        workLocation: "client_site",
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
