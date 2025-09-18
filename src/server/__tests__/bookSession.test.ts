import { beforeEach, describe, expect, it, vi } from "vitest";
import { bookSession } from "../bookSession";
import {
  cancelSessionHold,
  confirmSessionBooking,
  requestSessionHold,
} from "../../lib/sessionHolds";
import type { Session } from "../../types";

vi.mock("../../lib/sessionHolds", () => ({
  requestSessionHold: vi.fn(),
  confirmSessionBooking: vi.fn(),
  cancelSessionHold: vi.fn(),
}));

const mockedRequestSessionHold = vi.mocked(requestSessionHold);
const mockedConfirmSessionBooking = vi.mocked(confirmSessionBooking);
const mockedCancelSessionHold = vi.mocked(cancelSessionHold);

const basePayload = {
  session: {
    therapist_id: "therapist-1",
    client_id: "client-1",
    start_time: "2025-01-01T10:00:00Z",
    end_time: "2025-01-01T11:00:00Z",
    status: "scheduled" as const,
  },
  startTimeOffsetMinutes: 0,
  endTimeOffsetMinutes: 0,
  timeZone: "UTC",
} as const;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("bookSession", () => {
  it("requests a hold and confirms the session", async () => {
    mockedRequestSessionHold.mockResolvedValueOnce({
      holdKey: "hold-key",
      holdId: "hold-id",
      expiresAt: "2025-01-01T00:05:00Z",
    });

    const confirmedSession: Session = {
      id: "session-1",
      client_id: basePayload.session.client_id,
      therapist_id: basePayload.session.therapist_id,
      start_time: basePayload.session.start_time,
      end_time: basePayload.session.end_time,
      status: "scheduled",
      notes: "",
      created_at: "2025-01-01T09:00:00Z",
      created_by: "user-1",
      updated_at: "2025-01-01T09:00:00Z",
      updated_by: "user-1",
      duration_minutes: 60,
    };

    mockedConfirmSessionBooking.mockResolvedValueOnce(confirmedSession);

    const result = await bookSession(basePayload);

    expect(result.session).toBe(confirmedSession);
    expect(result.hold.holdKey).toBe("hold-key");
    expect(result.cpt.code).toBe("97153");

    expect(mockedRequestSessionHold).toHaveBeenCalledWith({
      therapistId: basePayload.session.therapist_id,
      clientId: basePayload.session.client_id,
      startTime: basePayload.session.start_time,
      endTime: basePayload.session.end_time,
      sessionId: undefined,
      holdSeconds: undefined,
      idempotencyKey: undefined,
      startTimeOffsetMinutes: 0,
      endTimeOffsetMinutes: 0,
      timeZone: "UTC",
    });

    expect(mockedConfirmSessionBooking).toHaveBeenCalledWith({
      holdKey: "hold-key",
      session: expect.objectContaining({
        therapist_id: basePayload.session.therapist_id,
        status: "scheduled",
      }),
      idempotencyKey: undefined,
      startTimeOffsetMinutes: 0,
      endTimeOffsetMinutes: 0,
      timeZone: "UTC",
    });
  });

  it("releases the hold when confirmation fails", async () => {
    mockedRequestSessionHold.mockResolvedValueOnce({
      holdKey: "hold-key",
      holdId: "hold-id",
      expiresAt: "2025-01-01T00:05:00Z",
    });

    mockedConfirmSessionBooking.mockRejectedValueOnce(new Error("unable to confirm"));

    await expect(bookSession(basePayload)).rejects.toThrow("unable to confirm");
    expect(mockedCancelSessionHold).toHaveBeenCalledWith({ holdKey: "hold-key" });
  });

  it("throws when required session fields are missing", async () => {
    await expect(
      bookSession({
        ...basePayload,
        session: {
          ...basePayload.session,
          therapist_id: "",
        },
      }),
    ).rejects.toThrow(/therapist_id/);
  });
});
