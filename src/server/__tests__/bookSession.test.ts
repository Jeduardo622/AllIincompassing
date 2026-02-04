import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelSessionHold,
  confirmSessionBooking,
  requestSessionHold,
} from "../../lib/sessionHolds";
import { persistSessionCptMetadata } from "../sessionCptPersistence";
import { persistSessionGoals } from "../sessionGoalsPersistence";
import type { BookSessionResult } from "../types";
import type { Session } from "../../types";

vi.mock("../../lib/sessionHolds", () => ({
  requestSessionHold: vi.fn(),
  confirmSessionBooking: vi.fn(),
  cancelSessionHold: vi.fn(),
}));

vi.mock("../sessionCptPersistence", () => ({
  persistSessionCptMetadata: vi.fn(),
}));

vi.mock("../sessionGoalsPersistence", () => ({
  persistSessionGoals: vi.fn(),
}));

const mockedRequestSessionHold = vi.mocked(requestSessionHold);
const mockedConfirmSessionBooking = vi.mocked(confirmSessionBooking);
const mockedCancelSessionHold = vi.mocked(cancelSessionHold);
const mockedPersistSessionCptMetadata = vi.mocked(persistSessionCptMetadata);
const mockedPersistSessionGoals = vi.mocked(persistSessionGoals);

const importBookSession = async () => {
  const module = await import("../bookSession");
  return module.bookSession;
};

const TEST_SUPABASE_URL = "https://testing.supabase.co";
const TEST_SUPABASE_ANON_KEY = "testing-anon-key";
const TEST_SUPABASE_EDGE_URL = "https://testing.supabase.co/functions/v1/";

const ORIGINAL_ENV = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  SUPABASE_EDGE_URL: process.env.SUPABASE_EDGE_URL,
  DEFAULT_ORGANIZATION_ID: process.env.DEFAULT_ORGANIZATION_ID,
};

const basePayload = {
  session: {
    therapist_id: "therapist-1",
    client_id: "client-1",
    program_id: "program-1",
    goal_id: "goal-1",
    start_time: "2025-01-01T10:00:00Z",
    end_time: "2025-01-01T11:00:00Z",
    status: "scheduled" as const,
  },
  startTimeOffsetMinutes: 0,
  endTimeOffsetMinutes: 0,
  timeZone: "UTC",
  accessToken: "test-access-token",
} as const;

beforeEach(async () => {
  vi.clearAllMocks();
  mockedPersistSessionCptMetadata.mockResolvedValue({ entryId: "entry-id", modifierIds: [] });
  mockedPersistSessionGoals.mockResolvedValue(undefined);

  const runtimeConfig = await import("../../lib/runtimeConfig");
  runtimeConfig.resetRuntimeSupabaseConfigForTests();

  process.env.SUPABASE_URL = TEST_SUPABASE_URL;
  process.env.SUPABASE_ANON_KEY = TEST_SUPABASE_ANON_KEY;
  process.env.SUPABASE_EDGE_URL = TEST_SUPABASE_EDGE_URL;
  process.env.DEFAULT_ORGANIZATION_ID = "5238e88b-6198-4862-80a2-dbe15bbeabdd";
});

describe("bookSession", () => {
  it("requests a hold and confirms the session", async () => {
    const bookSession = await importBookSession();
    mockedRequestSessionHold.mockResolvedValueOnce({
      holdKey: "hold-key",
      holdId: "hold-id",
      startTime: basePayload.session.start_time,
      endTime: basePayload.session.end_time,
      expiresAt: "2025-01-01T00:05:00Z",
      holds: [
        {
          holdKey: "hold-key",
          holdId: "hold-id",
          startTime: basePayload.session.start_time,
          endTime: basePayload.session.end_time,
          expiresAt: "2025-01-01T00:05:00Z",
        },
      ],
    });

    const confirmedSession: Session = {
      id: "session-1",
      client_id: basePayload.session.client_id,
      therapist_id: basePayload.session.therapist_id,
      program_id: basePayload.session.program_id,
      goal_id: basePayload.session.goal_id,
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

    mockedConfirmSessionBooking.mockResolvedValueOnce({
      session: confirmedSession,
      sessions: [confirmedSession],
      roundedDurationMinutes: confirmedSession.duration_minutes ?? null,
    });

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
      accessToken: basePayload.accessToken,
      occurrences: [
        {
          startTime: basePayload.session.start_time,
          endTime: basePayload.session.end_time,
          startTimeOffsetMinutes: 0,
          endTimeOffsetMinutes: 0,
        },
      ],
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
      accessToken: basePayload.accessToken,
      occurrences: expect.arrayContaining([
        expect.objectContaining({
          holdKey: "hold-key",
          startTimeOffsetMinutes: 0,
          endTimeOffsetMinutes: 0,
        }),
      ]),
    });

    expect(mockedPersistSessionCptMetadata).toHaveBeenCalledWith({
      sessionId: confirmedSession.id,
      cpt: expect.objectContaining({ code: "97153" }),
      billedMinutes: confirmedSession.duration_minutes,
    });
  });

  it("persists payer-specific CPT metadata bundles", async () => {
    const bookSession = await importBookSession();
    mockedRequestSessionHold.mockResolvedValueOnce({
      holdKey: "hold-key",
      holdId: "hold-id",
      startTime: basePayload.session.start_time,
      endTime: basePayload.session.end_time,
      expiresAt: "2025-01-01T00:05:00Z",
      holds: [
        {
          holdKey: "hold-key",
          holdId: "hold-id",
          startTime: basePayload.session.start_time,
          endTime: basePayload.session.end_time,
          expiresAt: "2025-01-01T00:05:00Z",
        },
      ],
    });

    const confirmedSession: Session = {
      id: "session-caloptima",
      client_id: basePayload.session.client_id,
      therapist_id: basePayload.session.therapist_id,
      program_id: basePayload.session.program_id,
      goal_id: basePayload.session.goal_id,
      start_time: basePayload.session.start_time,
      end_time: basePayload.session.end_time,
      status: "scheduled",
      notes: "",
      created_at: "2025-01-01T09:00:00Z",
      created_by: "user-1",
      updated_at: "2025-01-01T09:00:00Z",
      updated_by: "user-1",
      duration_minutes: 60,
      payer_slug: "caloptima-health",
    };

    mockedConfirmSessionBooking.mockResolvedValueOnce({
      session: confirmedSession,
      sessions: [confirmedSession],
      roundedDurationMinutes: confirmedSession.duration_minutes ?? null,
    });

    const payload = {
      ...basePayload,
      session: {
        ...basePayload.session,
        session_type: "Individual",
        payer_slug: "CalOptima Health",
      },
    } as const;

    await bookSession(payload);

    expect(mockedPersistSessionCptMetadata).toHaveBeenCalledTimes(1);
    expect(mockedPersistSessionCptMetadata).toHaveBeenCalledWith({
      sessionId: confirmedSession.id,
      cpt: expect.objectContaining({
        code: "97153",
        modifiers: expect.arrayContaining(["U7", "U8"]),
      }),
      billedMinutes: confirmedSession.duration_minutes,
    });
  });

  it("releases the hold when confirmation fails", async () => {
    const bookSession = await importBookSession();
    mockedRequestSessionHold.mockResolvedValueOnce({
      holdKey: "hold-key",
      holdId: "hold-id",
      startTime: basePayload.session.start_time,
      endTime: basePayload.session.end_time,
      expiresAt: "2025-01-01T00:05:00Z",
      holds: [
        {
          holdKey: "hold-key",
          holdId: "hold-id",
          startTime: basePayload.session.start_time,
          endTime: basePayload.session.end_time,
          expiresAt: "2025-01-01T00:05:00Z",
        },
      ],
    });

    mockedConfirmSessionBooking.mockRejectedValueOnce(new Error("unable to confirm"));

    await expect(bookSession(basePayload)).rejects.toThrow("unable to confirm");
    expect(mockedCancelSessionHold).toHaveBeenCalledWith({
      holdKey: "hold-key",
      idempotencyKey: "cancel:hold-key",
      accessToken: basePayload.accessToken,
    });
    expect(mockedPersistSessionCptMetadata).not.toHaveBeenCalled();
  });

  it("throws when required session fields are missing", async () => {
    const bookSession = await importBookSession();
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
    const bookSession = await importBookSession();
    mockedRequestSessionHold.mockResolvedValueOnce({
      holdKey: "hold-key",
      holdId: "hold-id",
      startTime: basePayload.session.start_time,
      endTime: basePayload.session.end_time,
      expiresAt: "2025-01-01T00:05:00Z",
      holds: [
        {
          holdKey: "hold-key",
          holdId: "hold-id",
          startTime: basePayload.session.start_time,
          endTime: basePayload.session.end_time,
          expiresAt: "2025-01-01T00:05:00Z",
        },
      ],
    });

    const confirmedSession: Session = {
      id: "session-1",
      client_id: basePayload.session.client_id,
      therapist_id: basePayload.session.therapist_id,
      program_id: basePayload.session.program_id,
      goal_id: basePayload.session.goal_id,
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

    mockedConfirmSessionBooking.mockResolvedValueOnce({
      session: confirmedSession,
      sessions: [confirmedSession],
      roundedDurationMinutes: confirmedSession.duration_minutes ?? null,
    });
    mockedPersistSessionCptMetadata.mockRejectedValueOnce(new Error("persist failure"));

    await expect(bookSession(basePayload)).rejects.toThrow("persist failure");
    expect(mockedCancelSessionHold).not.toHaveBeenCalled();
  });

  it("forwards idempotency metadata to hold and confirm requests", async () => {
    const bookSession = await importBookSession();
    mockedRequestSessionHold.mockResolvedValueOnce({
      holdKey: "hold-key",
      holdId: "hold-id",
      startTime: basePayload.session.start_time,
      endTime: basePayload.session.end_time,
      expiresAt: "2025-01-01T00:05:00Z",
      holds: [
        {
          holdKey: "hold-key",
          holdId: "hold-id",
          startTime: basePayload.session.start_time,
          endTime: basePayload.session.end_time,
          expiresAt: "2025-01-01T00:05:00Z",
        },
      ],
    });

    const confirmedSession: Session = {
      id: "session-2",
      client_id: basePayload.session.client_id,
      therapist_id: basePayload.session.therapist_id,
      program_id: basePayload.session.program_id,
      goal_id: basePayload.session.goal_id,
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

    mockedConfirmSessionBooking.mockResolvedValueOnce({
      session: confirmedSession,
      sessions: [confirmedSession],
      roundedDurationMinutes: confirmedSession.duration_minutes ?? null,
    });

    const idempotencyKey = "booking-123";

    const requestWithIdempotency = {
      ...basePayload,
      holdSeconds: 450,
      idempotencyKey,
    } as const;

    const result = await bookSession(requestWithIdempotency);

    expect(result.session.id).toBe("session-2");

    expect(mockedRequestSessionHold).toHaveBeenCalledWith(
      expect.objectContaining({
        therapistId: basePayload.session.therapist_id,
        clientId: basePayload.session.client_id,
        holdSeconds: 450,
        idempotencyKey,
      }),
    );

    expect(mockedConfirmSessionBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        holdKey: "hold-key",
        idempotencyKey,
        accessToken: basePayload.accessToken,
      }),
    );

    expect(mockedCancelSessionHold).not.toHaveBeenCalled();
  });

  it("releases the losing hold when concurrent bookings race for the same slot", async () => {
    const bookSession = await importBookSession();
    const slotStart = "2025-01-01T10:00:00Z";
    const slotEnd = "2025-01-01T11:00:00Z";
    const therapistId = basePayload.session.therapist_id;

    const issuedHolds: Array<{ holdKey: string; clientId: string }> = [];
    const cancelledHolds: Array<{ holdKey: string; idempotencyKey?: string }> = [];
    const confirmedSlots = new Map<string, Session>();

    mockedRequestSessionHold.mockImplementation(async ({ clientId }) => {
      const nextIndex = issuedHolds.length + 1;
      const hold = {
        holdKey: `hold-${nextIndex}`,
        holdId: `hold-id-${nextIndex}`,
        startTime: slotStart,
        endTime: slotEnd,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        holds: [
          {
            holdKey: `hold-${nextIndex}`,
            holdId: `hold-id-${nextIndex}`,
            startTime: slotStart,
            endTime: slotEnd,
            expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          },
        ],
      };

      issuedHolds.push({ holdKey: hold.holdKey, clientId });
      return hold;
    });

    mockedConfirmSessionBooking.mockImplementation(async ({ holdKey, session }) => {
      const therapist = String(session.therapist_id ?? "");
      const client = String(session.client_id ?? "");
      const startTime = String(session.start_time ?? "");
      const endTime = String(session.end_time ?? "");
      const slotKey = `${therapist}:${startTime}:${endTime}`;

      if (confirmedSlots.has(slotKey)) {
        const conflictError = new Error("Slot already booked");
        (conflictError as Error & { code?: string }).code = "session_conflict";
        throw conflictError;
      }

      const confirmedSession: Session = {
        id: `session-${holdKey}`,
        therapist_id: therapist,
        client_id: client,
        start_time: startTime,
        end_time: endTime,
        status: "scheduled",
        notes: "",
        created_at: "2025-01-01T09:00:00Z",
        created_by: "user-1",
        updated_at: "2025-01-01T09:00:00Z",
        updated_by: "user-1",
        duration_minutes: 60,
      };

      confirmedSlots.set(slotKey, confirmedSession);
      return {
        session: confirmedSession,
        sessions: [confirmedSession],
        roundedDurationMinutes: confirmedSession.duration_minutes ?? null,
      };
    });

    mockedCancelSessionHold.mockImplementation(async ({ holdKey, idempotencyKey }) => {
      cancelledHolds.push({ holdKey, idempotencyKey });
      return { released: true };
    });

    const buildPayload = (clientId: string) => ({
      ...basePayload,
      session: {
        ...basePayload.session,
        therapist_id: therapistId,
        client_id: clientId,
        start_time: slotStart,
        end_time: slotEnd,
      },
    });

    const [firstResult, secondResult] = await Promise.allSettled<
      BookSessionResult
    >([
      bookSession(buildPayload("client-A")),
      bookSession(buildPayload("client-B")),
    ]);

    const outcomes = [firstResult, secondResult];
    const fulfilled = outcomes.filter(
      (outcome): outcome is PromiseFulfilledResult<BookSessionResult> =>
        outcome.status === "fulfilled",
    );
    const rejected = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(Error);
    expect((rejected[0]?.reason as Error).message).toMatch(/slot already booked/i);

    const winningHoldKey = fulfilled[0]?.value.hold.holdKey;
    expect(typeof winningHoldKey).toBe("string");

    const losingHold = issuedHolds.find(({ holdKey }) => holdKey !== winningHoldKey);
    expect(losingHold).toBeDefined();

    if (losingHold) {
      expect(cancelledHolds).toContainEqual(expect.objectContaining({
        holdKey: losingHold.holdKey,
        idempotencyKey: `cancel:${losingHold.holdKey}`,
      }));
      expect(mockedCancelSessionHold).toHaveBeenCalledWith({
        holdKey: losingHold.holdKey,
        idempotencyKey: `cancel:${losingHold.holdKey}`,
        accessToken: basePayload.accessToken,
      });
    }

    expect(mockedPersistSessionCptMetadata).toHaveBeenCalledTimes(1);
    expect(mockedPersistSessionCptMetadata).toHaveBeenCalledWith({
      sessionId: fulfilled[0]?.value.session.id,
      cpt: expect.objectContaining({ code: expect.any(String) }),
      billedMinutes: expect.any(Number),
    });
  });

  it("persists CPT metadata once per unique session id", async () => {
    const bookSession = await importBookSession();
    mockedRequestSessionHold.mockResolvedValueOnce({
      holdKey: "hold-key",
      holdId: "hold-id",
      startTime: basePayload.session.start_time,
      endTime: basePayload.session.end_time,
      expiresAt: "2025-01-01T00:05:00Z",
      holds: [
        {
          holdKey: "hold-key",
          holdId: "hold-id",
          startTime: basePayload.session.start_time,
          endTime: basePayload.session.end_time,
          expiresAt: "2025-01-01T00:05:00Z",
        },
      ],
    });

    const confirmedSession: Session = {
      id: "session-duplicate",
      client_id: basePayload.session.client_id,
      therapist_id: basePayload.session.therapist_id,
      program_id: basePayload.session.program_id,
      goal_id: basePayload.session.goal_id,
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

    mockedConfirmSessionBooking.mockResolvedValueOnce({
      session: confirmedSession,
      sessions: [
        confirmedSession,
        { ...confirmedSession },
        { ...confirmedSession, id: "session-duplicate" },
      ],
      roundedDurationMinutes: confirmedSession.duration_minutes ?? null,
    });

    await bookSession({
      ...basePayload,
      session: {
        ...basePayload.session,
        id: confirmedSession.id,
      },
    });

    expect(mockedPersistSessionCptMetadata).toHaveBeenCalledTimes(1);
    expect(mockedPersistSessionCptMetadata).toHaveBeenCalledWith({
      sessionId: confirmedSession.id,
      cpt: expect.objectContaining({ code: "97153" }),
      billedMinutes: confirmedSession.duration_minutes,
    });
  });
});

afterAll(() => {
  if (typeof ORIGINAL_ENV.SUPABASE_URL === "string") {
    process.env.SUPABASE_URL = ORIGINAL_ENV.SUPABASE_URL;
  } else {
    delete process.env.SUPABASE_URL;
  }
  if (typeof ORIGINAL_ENV.SUPABASE_ANON_KEY === "string") {
    process.env.SUPABASE_ANON_KEY = ORIGINAL_ENV.SUPABASE_ANON_KEY;
  } else {
    delete process.env.SUPABASE_ANON_KEY;
  }
  if (typeof ORIGINAL_ENV.SUPABASE_EDGE_URL === "string") {
    process.env.SUPABASE_EDGE_URL = ORIGINAL_ENV.SUPABASE_EDGE_URL;
  } else {
    delete process.env.SUPABASE_EDGE_URL;
  }
  if (typeof ORIGINAL_ENV.DEFAULT_ORGANIZATION_ID === "string") {
    process.env.DEFAULT_ORGANIZATION_ID = ORIGINAL_ENV.DEFAULT_ORGANIZATION_ID;
  } else {
    delete process.env.DEFAULT_ORGANIZATION_ID;
  }
});
