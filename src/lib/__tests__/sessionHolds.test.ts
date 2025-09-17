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
      jsonResponse({ success: true, data: { holdKey: "hold-key", holdId: "1", expiresAt: "2025-01-01T00:05:00Z" } }),
    );

    const result = await requestSessionHold({
      therapistId: "therapist",
      clientId: "client",
      startTime: "2025-01-01T00:00:00Z",
      endTime: "2025-01-01T01:00:00Z",
      startTimeOffsetMinutes: 0,
      endTimeOffsetMinutes: 0,
      timeZone: "UTC",
    });

    expect(result).toEqual({ holdKey: "hold-key", holdId: "1", expiresAt: "2025-01-01T00:05:00Z" });
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
        }),
      }),
    );
  });

  it("passes idempotency key when reserving a hold", async () => {
    mockedCallEdge.mockResolvedValueOnce(
      jsonResponse({ success: true, data: { holdKey: "hold-key", holdId: "1", expiresAt: "2025-01-01T00:05:00Z" } }),
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
    });

    expect(mockedCallEdge).toHaveBeenCalledWith(
      "sessions-hold",
      expect.objectContaining({
        headers: expect.objectContaining({ "Idempotency-Key": "unique-key" }),
      }),
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
      }),
    ).rejects.toThrow(/Therapist already booked/);
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
            duration_minutes: 60,
            location_type: null,
            session_type: null,
            rate_per_hour: null,
            total_cost: null,
          },
          roundedDurationMinutes: 60,
        },
      }),
    );

    const session = await confirmSessionBooking({
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
    });

    expect(session.id).toBe("session-1");
    expect(session.duration_minutes).toBe(60);
    expect(mockedCallEdge).toHaveBeenCalledWith(
      "sessions-confirm",
      expect.objectContaining({ method: "POST" }),
    );
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
            duration_minutes: 30,
          },
          roundedDurationMinutes: 45,
        },
      }),
    );

    const session = await confirmSessionBooking({
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
    });

    expect(session.duration_minutes).toBe(45);
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
      }),
    ).rejects.toThrow(/Hold has expired/);
  });

  it("includes idempotency key when confirming a session", async () => {
    mockedCallEdge.mockResolvedValueOnce(
      jsonResponse({ success: true, data: { session: { id: "session-1" } } }),
    );

    await confirmSessionBooking({
      holdKey: "hold-key",
      session: { id: "session-1" },
      idempotencyKey: "confirm-key",
      startTimeOffsetMinutes: 0,
      endTimeOffsetMinutes: 0,
      timeZone: "UTC",
    });

    expect(mockedCallEdge).toHaveBeenCalledWith(
      "sessions-confirm",
      expect.objectContaining({
        headers: expect.objectContaining({ "Idempotency-Key": "confirm-key" }),
      }),
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

    const result = await cancelSessionHold({ holdKey: "hold-key" });

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
    );
  });

  it("passes idempotency key when cancelling a hold", async () => {
    mockedCallEdge.mockResolvedValueOnce(jsonResponse({ success: true, data: { released: false } }));

    await cancelSessionHold({ holdKey: "hold-key", idempotencyKey: "cancel-key" });

    expect(mockedCallEdge).toHaveBeenCalledWith(
      "sessions-cancel",
      expect.objectContaining({
        headers: expect.objectContaining({ "Idempotency-Key": "cancel-key" }),
      }),
    );
  });

  it("throws when cancellation fails", async () => {
    mockedCallEdge.mockResolvedValueOnce(
      jsonResponse({ success: false, error: "Hold not found" }, 404),
    );

    await expect(cancelSessionHold({ holdKey: "missing" })).rejects.toThrow(/Hold not found/);
  });
});
