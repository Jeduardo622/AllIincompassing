import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  cancelSessionHold,
  confirmSessionBooking,
  requestSessionHold,
} from "../sessionHolds";
import { callEdge } from "../supabase";

vi.mock("../supabase", () => ({
  callEdge: vi.fn(),
}));

const mockedCallEdge = vi.mocked(callEdge);
const ACCESS_TOKEN = "edge-access-token";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  mockedCallEdge.mockReset();
});

describe("session holds API helpers", () => {
  it("requests a hold and returns hold metadata", async () => {
    mockedCallEdge.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: {
          holdKey: "hold-key",
          holdId: "1",
          expiresAt: "2025-01-01T00:05:00Z",
          holds: [
            {
              holdKey: "hold-key",
              holdId: "1",
              startTime: "2025-01-01T00:00:00Z",
              endTime: "2025-01-01T01:00:00Z",
              expiresAt: "2025-01-01T00:05:00Z",
            },
          ],
        },
      }),
    );

    const result = await requestSessionHold({
      therapistId: "therapist",
      clientId: "client",
      startTime: "2025-01-01T00:00:00Z",
      endTime: "2025-01-01T01:00:00Z",
      startTimeOffsetMinutes: 0,
      endTimeOffsetMinutes: 0,
      timeZone: "UTC",
      accessToken: ACCESS_TOKEN,
    });

    expect(result).toEqual({
      holdKey: "hold-key",
      holdId: "1",
      startTime: "2025-01-01T00:00:00Z",
      endTime: "2025-01-01T01:00:00Z",
      expiresAt: "2025-01-01T00:05:00Z",
      holds: [
        {
          holdKey: "hold-key",
          holdId: "1",
          startTime: "2025-01-01T00:00:00Z",
          endTime: "2025-01-01T01:00:00Z",
          expiresAt: "2025-01-01T00:05:00Z",
        },
      ],
    });
    expect(mockedCallEdge).toHaveBeenCalledWith(
      "sessions-hold",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          therapist_id: "therapist",
          client_id: "client",
          start_time: "2025-01-01T00:00:00Z",
          end_time: "2025-01-01T01:00:00Z",
          session_id: null,
          hold_seconds: 300,
          start_time_offset_minutes: 0,
          end_time_offset_minutes: 0,
          time_zone: "UTC",
          occurrences: [
            {
              start_time: "2025-01-01T00:00:00Z",
              end_time: "2025-01-01T01:00:00Z",
              start_time_offset_minutes: 0,
              end_time_offset_minutes: 0,
            },
          ],
        }),
      }),
      { accessToken: ACCESS_TOKEN },
    );
  });

  it("passes idempotency key when reserving a hold", async () => {
    mockedCallEdge.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: {
          holdKey: "hold-key",
          holdId: "1",
          expiresAt: "2025-01-01T00:05:00Z",
          holds: [
            {
              holdKey: "hold-key",
              holdId: "1",
              startTime: "2025-01-01T00:00:00Z",
              endTime: "2025-01-01T01:00:00Z",
              expiresAt: "2025-01-01T00:05:00Z",
            },
          ],
        },
      }),
    );

    await requestSessionHold({
      therapistId: "therapist",
      clientId: "client",
      startTime: "2025-01-01T00:00:00Z",
      endTime: "2025-01-01T01:00:00Z",
      idempotencyKey: "unique-key",
      startTimeOffsetMinutes: 0,
      endTimeOffsetMinutes: 0,
      timeZone: "UTC",
      accessToken: ACCESS_TOKEN,
    });

    expect(mockedCallEdge).toHaveBeenCalledWith(
      "sessions-hold",
      expect.objectContaining({
        headers: expect.objectContaining({ "Idempotency-Key": "unique-key" }),
      }),
      { accessToken: ACCESS_TOKEN },
    );
  });

  it("throws when a hold cannot be created", async () => {
    mockedCallEdge.mockResolvedValueOnce(
      jsonResponse({ success: false, error: "Therapist already booked" }, 409),
    );

    await expect(
      requestSessionHold({
        therapistId: "therapist",
        clientId: "client",
        startTime: "2025-01-01T00:00:00Z",
        endTime: "2025-01-01T01:00:00Z",
        startTimeOffsetMinutes: 0,
        endTimeOffsetMinutes: 0,
        timeZone: "UTC",
        accessToken: ACCESS_TOKEN,
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("Therapist already booked"),
      status: 409,
    });
  });

  it("exposes retry metadata when a therapist conflict occurs", async () => {
    const retryAfter = "2025-01-01T00:10:00Z";
    mockedCallEdge.mockResolvedValueOnce(
      jsonResponse({
        success: false,
        error: "Therapist already has a session during this time.",
        code: "THERAPIST_CONFLICT",
        retryAfter,
        retryAfterSeconds: 120,
      }, 409),
    );

    await expect(
      requestSessionHold({
        therapistId: "therapist",
        clientId: "client",
        startTime: "2025-01-01T00:00:00Z",
        endTime: "2025-01-01T01:00:00Z",
        startTimeOffsetMinutes: 0,
        endTimeOffsetMinutes: 0,
        timeZone: "UTC",
        accessToken: ACCESS_TOKEN,
      }),
    ).rejects.toMatchObject({
      code: "THERAPIST_CONFLICT",
      retryAfter,
      retryAfterSeconds: 120,
    });
  });

  it("rejects a second hold when the slot is already reserved", async () => {
    mockedCallEdge
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: { holdKey: "hold-1", holdId: "1", expiresAt: "2025-01-01T00:05:00Z" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            success: false,
            error: "Therapist already has a hold during this time.",
            code: "THERAPIST_HOLD_CONFLICT",
          },
          409,
        ),
      );

    const holdRequest = {
      therapistId: "therapist",
      clientId: "client",
      startTime: "2025-01-01T00:00:00Z",
      endTime: "2025-01-01T01:00:00Z",
      startTimeOffsetMinutes: 0,
      endTimeOffsetMinutes: 0,
      timeZone: "UTC",
      accessToken: ACCESS_TOKEN,
    } as const;

    const [firstResult, secondResult] = await Promise.allSettled([
      requestSessionHold({ ...holdRequest }),
      requestSessionHold({ ...holdRequest }),
    ]);

    const fulfilled = [firstResult, secondResult].filter(
      (result): result is PromiseFulfilledResult<unknown> => result.status === "fulfilled",
    );
    const rejected = [firstResult, secondResult].filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(Error);
    expect(rejected[0]?.reason.message).toMatch(/hold/);
    expect(mockedCallEdge).toHaveBeenCalledTimes(2);
  });

  it("confirms a session when hold is valid", async () => {
    mockedCallEdge.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: {
          session: {
            id: "session-1",
            therapist_id: "therapist",
            client_id: "client",
            start_time: "2025-01-01T00:00:00Z",
            end_time: "2025-01-01T01:00:00Z",
            status: "scheduled",
            notes: null,
            created_at: "2025-01-01T00:00:00Z",
            created_by: "user-1",
            updated_at: "2025-01-01T00:00:00Z",
            updated_by: "user-1",
            duration_minutes: 60,
            location_type: null,
            session_type: null,
            rate_per_hour: null,
            total_cost: null,
          },
          sessions: [
            {
              id: "session-1",
              therapist_id: "therapist",
              client_id: "client",
              start_time: "2025-01-01T00:00:00Z",
              end_time: "2025-01-01T01:00:00Z",
              status: "scheduled",
              notes: null,
              created_at: "2025-01-01T00:00:00Z",
              created_by: "user-1",
              updated_at: "2025-01-01T00:00:00Z",
              updated_by: "user-1",
              duration_minutes: 60,
              location_type: null,
              session_type: null,
              rate_per_hour: null,
              total_cost: null,
            },
          ],
          roundedDurationMinutes: 60,
        },
      }),
    );

    const response = await confirmSessionBooking({
      holdKey: "hold-key",
      session: {
        therapist_id: "therapist",
        client_id: "client",
        start_time: "2025-01-01T00:00:00Z",
        end_time: "2025-01-01T01:00:00Z",
      },
      startTimeOffsetMinutes: 0,
      endTimeOffsetMinutes: 0,
      timeZone: "UTC",
      accessToken: ACCESS_TOKEN,
    });

    expect(response.session.id).toBe("session-1");
    expect(response.session.duration_minutes).toBe(60);
    expect(response.sessions).toHaveLength(1);
    expect(mockedCallEdge).toHaveBeenCalledWith(
      "sessions-confirm",
      expect.objectContaining({ method: "POST" }),
      { accessToken: ACCESS_TOKEN },
    );
  });

  it("surfaces retry metadata when confirmation conflicts with an existing session", async () => {
    const retryAfter = "2025-01-01T01:30:00Z";
    mockedCallEdge.mockResolvedValueOnce(
      jsonResponse({
        success: false,
        error: "Therapist already has a session during this time.",
        code: "THERAPIST_CONFLICT",
        retryAfter,
        retryAfterSeconds: 300,
      }, 409),
    );

    await expect(
      confirmSessionBooking({
        holdKey: "hold-key",
        session: {
          therapist_id: "therapist",
          client_id: "client",
          start_time: "2025-01-01T00:00:00Z",
          end_time: "2025-01-01T01:00:00Z",
        },
        startTimeOffsetMinutes: 0,
        endTimeOffsetMinutes: 0,
        timeZone: "UTC",
        accessToken: ACCESS_TOKEN,
      }),
    ).rejects.toMatchObject({
      code: "THERAPIST_CONFLICT",
      retryAfter,
      retryAfterSeconds: 300,
    });
  });

  it("normalizes duration_minutes using roundedDurationMinutes when provided", async () => {
    mockedCallEdge.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: {
          session: {
            id: "session-2",
            therapist_id: "therapist",
            client_id: "client",
            start_time: "2025-01-01T02:00:00Z",
            end_time: "2025-01-01T02:50:00Z",
            status: "scheduled",
            notes: null,
            created_at: "2025-01-01T01:50:00Z",
            created_by: "user-2",
            updated_at: "2025-01-01T01:50:00Z",
            updated_by: "user-2",
            duration_minutes: 30,
          },
          sessions: [
            {
              id: "session-2",
              therapist_id: "therapist",
              client_id: "client",
              start_time: "2025-01-01T02:00:00Z",
              end_time: "2025-01-01T02:50:00Z",
              status: "scheduled",
              notes: null,
              created_at: "2025-01-01T01:50:00Z",
              created_by: "user-2",
              updated_at: "2025-01-01T01:50:00Z",
              updated_by: "user-2",
              duration_minutes: 30,
            },
          ],
          roundedDurationMinutes: 45,
        },
      }),
    );

    const response = await confirmSessionBooking({
      holdKey: "hold-key",
      session: {
        therapist_id: "therapist",
        client_id: "client",
        start_time: "2025-01-01T02:00:00Z",
        end_time: "2025-01-01T02:50:00Z",
        duration_minutes: 30,
      },
      startTimeOffsetMinutes: 0,
      endTimeOffsetMinutes: 0,
      timeZone: "UTC",
      accessToken: ACCESS_TOKEN,
    });

    expect(response.session.duration_minutes).toBe(45);
  });

  describe("duration rounding compliance", () => {
    const startTime = "2025-01-01T03:00:00Z";

    const computeEndTime = (minutes: number) => {
      const startDate = new Date(startTime);
      const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
      const endDate = new Date(startDate.getTime() + safeMinutes * 60_000);
      return endDate.toISOString();
    };

    const roundingScenarios = [
      {
        rawDuration: 52,
        roundedDuration: 45,
        label: "rounds 52 minutes down to the previous quarter hour",
      },
      {
        rawDuration: 53,
        roundedDuration: 60,
        label: "rounds 53 minutes up to the next quarter hour",
      },
      {
        rawDuration: 68,
        roundedDuration: 75,
        label: "rounds 68 minutes up to the next quarter hour",
      },
      {
        rawDuration: 93,
        roundedDuration: 90,
        label: "rounds 93 minutes down to the nearest quarter hour",
      },
      {
        rawDuration: -5,
        roundedDuration: 15,
        label: "guards against negative inputs by enforcing the minimum quarter hour",
      },
    ] as const;

    it.each(roundingScenarios)(
      "$label",
      async ({ rawDuration, roundedDuration }) => {
        const endTime = computeEndTime(rawDuration);

        mockedCallEdge.mockResolvedValueOnce(
          jsonResponse({
            success: true,
            data: {
              session: {
                id: `session-${rawDuration}`,
                therapist_id: "therapist",
                client_id: "client",
                start_time: startTime,
                end_time: endTime,
                status: "scheduled",
                notes: null,
                created_at: "2025-01-01T02:55:00Z",
                duration_minutes: rawDuration,
              },
              roundedDurationMinutes: roundedDuration,
            },
          }),
        );

        const response = await confirmSessionBooking({
          holdKey: "hold-key",
          session: {
            therapist_id: "therapist",
            client_id: "client",
            start_time: startTime,
            end_time: endTime,
            duration_minutes: rawDuration,
          },
          startTimeOffsetMinutes: 0,
          endTimeOffsetMinutes: 0,
          timeZone: "UTC",
          accessToken: ACCESS_TOKEN,
        });

        expect(response.session.duration_minutes).toBe(roundedDuration);
        expect(response.session).toEqual(
          expect.objectContaining({
            duration_minutes: roundedDuration,
            client_id: "client",
            therapist_id: "therapist",
            start_time: startTime,
            end_time: endTime,
          }),
        );
      },
    );
  });

  it("throws when confirmation fails due to expiration", async () => {
    mockedCallEdge.mockResolvedValueOnce(
      jsonResponse({ success: false, error: "Hold has expired" }, 410),
    );

    await expect(
      confirmSessionBooking({
        holdKey: "expired-key",
        session: {
          therapist_id: "therapist",
          client_id: "client",
          start_time: "2025-01-01T00:00:00Z",
          end_time: "2025-01-01T01:00:00Z",
        },
        startTimeOffsetMinutes: 0,
        endTimeOffsetMinutes: 0,
        timeZone: "UTC",
        accessToken: ACCESS_TOKEN,
      }),
    ).rejects.toThrow(/Hold has expired/);
  });

  it("includes idempotency key when confirming a session", async () => {
    mockedCallEdge.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: {
          session: {
            id: "session-1",
            therapist_id: "therapist",
            client_id: "client",
            start_time: "2025-01-01T00:00:00Z",
            end_time: "2025-01-01T01:00:00Z",
            status: "scheduled",
            notes: null,
            created_at: "2025-01-01T00:00:00Z",
            created_by: "user-3",
            updated_at: "2025-01-01T00:00:00Z",
            updated_by: "user-3",
            duration_minutes: 60,
          },
        },
      }),
    );

    await confirmSessionBooking({
      holdKey: "hold-key",
      session: { id: "session-1" },
      idempotencyKey: "confirm-key",
      startTimeOffsetMinutes: 0,
      endTimeOffsetMinutes: 0,
      timeZone: "UTC",
      accessToken: ACCESS_TOKEN,
    });

    expect(mockedCallEdge).toHaveBeenCalledWith(
      "sessions-confirm",
      expect.objectContaining({
        headers: expect.objectContaining({ "Idempotency-Key": "confirm-key" }),
      }),
      { accessToken: ACCESS_TOKEN },
    );
  });

  it("cancels a hold and returns hold metadata", async () => {
    mockedCallEdge.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: {
          released: true,
          hold: {
            id: "1",
            holdKey: "hold-key",
            therapistId: "therapist",
            clientId: "client",
            startTime: "2025-01-01T00:00:00Z",
            endTime: "2025-01-01T01:00:00Z",
            expiresAt: "2025-01-01T00:05:00Z",
          },
        },
      }),
    );

    const result = await cancelSessionHold({ holdKey: "hold-key", accessToken: ACCESS_TOKEN });

    expect(result).toEqual({
      released: true,
      hold: {
        id: "1",
        holdKey: "hold-key",
        therapistId: "therapist",
        clientId: "client",
        startTime: "2025-01-01T00:00:00Z",
        endTime: "2025-01-01T01:00:00Z",
        expiresAt: "2025-01-01T00:05:00Z",
      },
    });
    expect(mockedCallEdge).toHaveBeenCalledWith(
      "sessions-cancel",
      expect.objectContaining({ method: "POST" }),
      { accessToken: ACCESS_TOKEN },
    );
  });

  it("passes idempotency key when cancelling a hold", async () => {
    mockedCallEdge.mockResolvedValueOnce(jsonResponse({ success: true, data: { released: false } }));

    await cancelSessionHold({
      holdKey: "hold-key",
      idempotencyKey: "cancel-key",
      accessToken: ACCESS_TOKEN,
    });

    expect(mockedCallEdge).toHaveBeenCalledWith(
      "sessions-cancel",
      expect.objectContaining({
        headers: expect.objectContaining({ "Idempotency-Key": "cancel-key" }),
      }),
      { accessToken: ACCESS_TOKEN },
    );
  });

  it("throws when cancellation fails", async () => {
    mockedCallEdge.mockResolvedValueOnce(
      jsonResponse({ success: false, error: "Hold not found" }, 404),
    );

    await expect(
      cancelSessionHold({ holdKey: "missing", accessToken: ACCESS_TOKEN }),
    ).rejects.toThrow(/Hold not found/);
  });
});
