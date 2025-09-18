import { beforeEach, describe, expect, it, vi } from "vitest";
import { bookSession } from "../bookSession";
import {
  cancelSessionHold,
  confirmSessionBooking,
  requestSessionHold,
} from "../../lib/sessionHolds";
import { persistSessionCptMetadata } from "../sessionCptPersistence";
import type { Session } from "../../types";

vi.mock("../../lib/sessionHolds", () => ({
  requestSessionHold: vi.fn(),
  confirmSessionBooking: vi.fn(),
  cancelSessionHold: vi.fn(),
}));

vi.mock("../sessionCptPersistence", () => ({
  persistSessionCptMetadata: vi.fn(),
}));

const mockedRequestSessionHold = vi.mocked(requestSessionHold);
const mockedConfirmSessionBooking = vi.mocked(confirmSessionBooking);
const mockedCancelSessionHold = vi.mocked(cancelSessionHold);
const mockedPersistSessionCptMetadata = vi.mocked(persistSessionCptMetadata);

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
  mockedPersistSessionCptMetadata.mockResolvedValue({ entryId: "entry-id", modifierIds: [] });
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

    expect(mockedPersistSessionCptMetadata).toHaveBeenCalledWith({
      sessionId: confirmedSession.id,
      cpt: expect.objectContaining({ code: "97153" }),
      billedMinutes: confirmedSession.duration_minutes,
    });
  });

  it("normalizes audit metadata before confirmation", async () => {
    mockedRequestSessionHold.mockResolvedValueOnce({
      holdKey: "hold-key",
      holdId: "hold-id",
      expiresAt: "2025-01-01T00:05:00Z",
    });

    const confirmedSession: Session = {
      id: "session-2",
      client_id: basePayload.session.client_id,
      therapist_id: basePayload.session.therapist_id,
      start_time: basePayload.session.start_time,
      end_time: basePayload.session.end_time,
      status: "scheduled",
      notes: "",
      created_at: "2025-01-01T08:55:00Z",
      created_by: "user-2",
      updated_at: "2025-01-01T09:01:00Z",
      updated_by: "user-3",
      duration_minutes: 60,
    };

    mockedConfirmSessionBooking.mockResolvedValueOnce(confirmedSession);

    await bookSession({
      ...basePayload,
      session: {
        ...basePayload.session,
        created_at: " 2025-01-01T08:55:00Z ",
        created_by: " user-2 ",
        updated_at: "\t2025-01-01T09:01:00Z\n",
        updated_by: "\tuser-3\n",
      },
    });

    const confirmationCall = mockedConfirmSessionBooking.mock.calls[0]?.[0];
    expect(confirmationCall?.session.created_at).toBe("2025-01-01T08:55:00Z");
    expect(confirmationCall?.session.created_by).toBe("user-2");
    expect(confirmationCall?.session.updated_at).toBe("2025-01-01T09:01:00Z");
    expect(confirmationCall?.session.updated_by).toBe("user-3");
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
    expect(mockedPersistSessionCptMetadata).not.toHaveBeenCalled();
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

  it("bubbles persistence failures", async () => {
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
    mockedPersistSessionCptMetadata.mockRejectedValueOnce(new Error("persist failure"));

    await expect(bookSession(basePayload)).rejects.toThrow("persist failure");
    expect(mockedCancelSessionHold).not.toHaveBeenCalled();
  });

  it("generates audit metadata when session payload is missing it", async () => {
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

    const payloadWithoutAudit = {
      ...basePayload,
      session: {
        ...basePayload.session,
      },
    };

    Reflect.deleteProperty(payloadWithoutAudit.session, "created_at");
    Reflect.deleteProperty(payloadWithoutAudit.session, "created_by");
    Reflect.deleteProperty(payloadWithoutAudit.session, "updated_at");
    Reflect.deleteProperty(payloadWithoutAudit.session, "updated_by");

    await bookSession(payloadWithoutAudit);

    const confirmationCall = mockedConfirmSessionBooking.mock.calls[0]?.[0];
    expect(confirmationCall?.session.created_at).toBeDefined();
    expect(new Date(confirmationCall?.session.created_at ?? "").toISOString()).toBe(
      confirmationCall?.session.created_at,
    );
    expect(confirmationCall?.session.updated_at).toBeDefined();
    expect(new Date(confirmationCall?.session.updated_at ?? "").toISOString()).toBe(
      confirmationCall?.session.updated_at,
    );
    expect(confirmationCall?.session.created_by).toBeNull();
    expect(confirmationCall?.session.updated_by).toBeNull();
  });
});
