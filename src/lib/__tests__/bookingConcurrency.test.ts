import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  requestSessionHold,
  confirmSessionBooking,
  cancelSessionHold,
} from "../sessionHolds";
import { cancelSessions } from "../sessionCancellation";
import type { Session } from "../../types";
import { callEdge } from "../supabase";

type MockHoldRecord = {
  holdKey: string;
  holdId: string;
  therapistId: string;
  clientId: string;
  startTime: string;
  endTime: string;
  expiresAt: string;
};

type MockSessionRecord = Session;

vi.mock("../supabase", () => ({
  callEdge: vi.fn(),
}));

const mockedCallEdge = vi.mocked(callEdge);

const activeHolds: MockHoldRecord[] = [];
const activeSessions: MockSessionRecord[] = [];
let holdSequence = 0;
let sessionSequence = 0;
const holdCleanupKeys = new Set<string>();
const sessionCleanupIds = new Set<string>();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function deriveOffsetMinutes(timeZone: string, iso: string): number {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ISO string: ${iso}`);
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);
  const timeZoneName = parts.find((part) => part.type === "timeZoneName");
  if (!timeZoneName) {
    throw new Error(`Unable to derive timezone offset for ${timeZone}`);
  }

  if (timeZoneName.value === "GMT" || timeZoneName.value === "UTC") {
    return 0;
  }

  const match = timeZoneName.value.match(/GMT([+-]?)((?:\d{1,2}))(?:[:]?((?:\d{2})))?/);
  if (!match) {
    throw new Error(`Unable to parse timezone offset: ${timeZoneName.value}`);
  }

  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? "0");

  return sign * (hours * 60 + minutes);
}

function setupEdgeMock() {
  mockedCallEdge.mockImplementation(async (path: string, init: RequestInit = {}) => {
    const rawBody = typeof init.body === "string" ? init.body : "";
    const parsedBody = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};

    if (path === "sessions-hold") {
      const occurrencePayloads = Array.isArray(parsedBody.occurrences) && parsedBody.occurrences.length > 0
        ? (parsedBody.occurrences as Array<Record<string, unknown>>)
        : [
            {
              start_time: parsedBody.start_time,
              end_time: parsedBody.end_time,
            },
          ];

      const holds = occurrencePayloads.map((occurrence) => {
        holdSequence += 1;
        const hold: MockHoldRecord = {
          holdKey: `hold-${holdSequence}`,
          holdId: `hold-id-${holdSequence}`,
          therapistId: String(parsedBody.therapist_id ?? "therapist"),
          clientId: String(parsedBody.client_id ?? "client"),
          startTime: String(occurrence.start_time ?? parsedBody.start_time ?? ""),
          endTime: String(occurrence.end_time ?? parsedBody.end_time ?? ""),
          expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        };
        activeHolds.push(hold);
        holdCleanupKeys.add(hold.holdKey);
        return {
          holdKey: hold.holdKey,
          holdId: hold.holdId,
          startTime: hold.startTime,
          endTime: hold.endTime,
          expiresAt: hold.expiresAt,
        };
      });

      const [primaryHold] = holds;

      return jsonResponse({
        success: true,
        data: {
          holdKey: primaryHold.holdKey,
          holdId: primaryHold.holdId,
          expiresAt: primaryHold.expiresAt,
          holds,
        },
      });
    }

    if (path === "sessions-confirm") {
      const occurrencePayloads = Array.isArray(parsedBody.occurrences) && parsedBody.occurrences.length > 0
        ? (parsedBody.occurrences as Array<Record<string, unknown>>)
        : [
            {
              hold_key: parsedBody.hold_key,
              session: parsedBody.session,
            },
          ];

      const confirmedSessions: MockSessionRecord[] = [];

      for (const occurrence of occurrencePayloads) {
        const holdKey = String(occurrence.hold_key ?? parsedBody.hold_key ?? "");
        const holdIndex = activeHolds.findIndex((hold) => hold.holdKey === holdKey);
        if (holdIndex === -1) {
          return jsonResponse({ success: false, error: "Hold not found" }, 404);
        }

        const hold = activeHolds.splice(holdIndex, 1)[0];
        holdCleanupKeys.delete(hold.holdKey);

        const sessionPayload = (occurrence.session ?? parsedBody.session ?? {}) as Partial<Session>;
        const slotAlreadyBooked = activeSessions.some(
          (session) =>
            session.start_time === sessionPayload.start_time &&
            session.end_time === sessionPayload.end_time &&
            session.status !== "cancelled",
        );

        if (slotAlreadyBooked) {
          activeHolds.push(hold);
          holdCleanupKeys.add(hold.holdKey);
          return jsonResponse(
            { success: false, error: "Slot already booked", code: "session_conflict" },
            409,
          );
        }

        sessionSequence += 1;
        const confirmedSession: MockSessionRecord = {
          id: `session-${sessionSequence}`,
          therapist_id: String(sessionPayload.therapist_id ?? hold.therapistId),
          client_id: String(sessionPayload.client_id ?? hold.clientId),
          start_time: String(sessionPayload.start_time ?? hold.startTime),
          end_time: String(sessionPayload.end_time ?? hold.endTime),
          status: "scheduled",
          notes: typeof sessionPayload.notes === "string" ? sessionPayload.notes : "",
          created_at: sessionPayload.created_at ?? new Date().toISOString(),
          created_by: sessionPayload.created_by ?? "test-user",
          updated_at: sessionPayload.updated_at ?? new Date().toISOString(),
          updated_by:
            sessionPayload.updated_by ?? sessionPayload.created_by ?? "test-user",
        };

        activeSessions.push(confirmedSession);
        sessionCleanupIds.add(confirmedSession.id);
        confirmedSessions.push(confirmedSession);
      }

      return jsonResponse({
        success: true,
        data: {
          session: confirmedSessions[0],
          sessions: confirmedSessions,
        },
      });
    }

    if (path === "sessions-cancel") {
      if (typeof parsedBody.hold_key === "string") {
        const holdKey = parsedBody.hold_key;
        const holdIndex = activeHolds.findIndex((hold) => hold.holdKey === holdKey);
        if (holdIndex === -1) {
          return jsonResponse({ success: true, data: { released: false } });
        }

        const [hold] = activeHolds.splice(holdIndex, 1);
        holdCleanupKeys.delete(holdKey);

        return jsonResponse({
          success: true,
          data: {
            released: true,
            hold: {
              id: hold.holdId,
              holdKey: hold.holdKey,
              therapistId: hold.therapistId,
              clientId: hold.clientId,
              startTime: hold.startTime,
              endTime: hold.endTime,
              expiresAt: hold.expiresAt,
            },
          },
        });
      }

      if (Array.isArray(parsedBody.session_ids)) {
        const sessionIds = (parsedBody.session_ids as unknown[]).map(String);
        const cancelledSessionIds: string[] = [];
        const alreadyCancelledSessionIds: string[] = [];

        sessionIds.forEach((sessionId) => {
          const index = activeSessions.findIndex((session) => session.id === sessionId);
          if (index === -1) {
            alreadyCancelledSessionIds.push(sessionId);
            return;
          }

          const [session] = activeSessions.splice(index, 1);
          sessionCleanupIds.delete(sessionId);
          cancelledSessionIds.push(session.id);
        });

        return jsonResponse({
          success: true,
          data: {
            cancelledCount: cancelledSessionIds.length,
            alreadyCancelledCount: alreadyCancelledSessionIds.length,
            totalCount: cancelledSessionIds.length + alreadyCancelledSessionIds.length,
            cancelledSessionIds,
            alreadyCancelledSessionIds,
          },
        });
      }

      return jsonResponse({ success: false, error: "Unsupported cancel payload" }, 400);
    }

    return jsonResponse({ success: false, error: `Unhandled edge path: ${path}` }, 500);
  });
}

beforeEach(() => {
  activeHolds.length = 0;
  activeSessions.length = 0;
  holdCleanupKeys.clear();
  sessionCleanupIds.clear();
  holdSequence = 0;
  sessionSequence = 0;
  mockedCallEdge.mockReset();
  setupEdgeMock();
});

afterEach(async () => {
  await Promise.all(
    Array.from(holdCleanupKeys, (holdKey) => cancelSessionHold({ holdKey })),
  );

  if (sessionCleanupIds.size > 0) {
    await cancelSessions({ sessionIds: Array.from(sessionCleanupIds), reason: "test-cleanup" });
  }

  expect(activeHolds).toHaveLength(0);
  expect(activeSessions).toHaveLength(0);
  mockedCallEdge.mockReset();
});

describe("booking concurrency", () => {
  it("allows only one confirmation when two clients compete for the same slot", async () => {
    const slotStart = "2025-07-01T15:00:00Z";
    const slotEnd = "2025-07-01T16:00:00Z";
    const therapistId = "therapist-123";

    const runFlow = async (clientId: string) => {
      const hold = await requestSessionHold({
        therapistId,
        clientId,
        startTime: slotStart,
        endTime: slotEnd,
        startTimeOffsetMinutes: 0,
        endTimeOffsetMinutes: 0,
        timeZone: "UTC",
      });

      try {
        const response = await confirmSessionBooking({
          holdKey: hold.holdKey,
          session: {
            therapist_id: therapistId,
            client_id: clientId,
            start_time: slotStart,
            end_time: slotEnd,
            notes: "",
          },
          startTimeOffsetMinutes: 0,
          endTimeOffsetMinutes: 0,
          timeZone: "UTC",
        });

        sessionCleanupIds.add(response.session.id);
        return { status: "confirmed" as const, session: response.session };
      } catch (error) {
        return { status: "conflict" as const, error: error as Error, holdKey: hold.holdKey };
      }
    };

    const [firstResult, secondResult] = await Promise.all([
      runFlow("client-A"),
      runFlow("client-B"),
    ]);

    const results = [firstResult, secondResult];
    const confirmations = results.filter((result) => result.status === "confirmed");
    const conflicts = results.filter((result) => result.status === "conflict");

    expect(confirmations).toHaveLength(1);
    expect(conflicts).toHaveLength(1);

    expect(confirmations[0]?.session).toMatchObject({
      therapist_id: therapistId,
      start_time: slotStart,
      end_time: slotEnd,
      status: "scheduled",
    });

    expect(conflicts[0]?.error).toBeInstanceOf(Error);
    expect(conflicts[0]?.error.message).toMatch(/slot already booked/i);
  });

  it("queues weekly recurrences across DST boundaries and prevents double-booking", async () => {
    const therapistId = "therapist-dst";
    const primaryClientId = "client-dst-1";
    const competitorClientId = "client-dst-2";
    const timeZone = "America/New_York";

    const occurrences = [
      { start: "2025-03-02T14:00:00Z", end: "2025-03-02T15:00:00Z" },
      { start: "2025-03-09T13:00:00Z", end: "2025-03-09T14:00:00Z" },
      { start: "2025-03-16T13:00:00Z", end: "2025-03-16T14:00:00Z" },
    ] as const;

    const occurrenceRequests = occurrences.map(({ start, end }) => ({
      startTime: start,
      endTime: end,
      startTimeOffsetMinutes: deriveOffsetMinutes(timeZone, start),
      endTimeOffsetMinutes: deriveOffsetMinutes(timeZone, end),
    }));

    const hold = await requestSessionHold({
      therapistId,
      clientId: primaryClientId,
      startTime: occurrences[0].start,
      endTime: occurrences[0].end,
      startTimeOffsetMinutes: occurrenceRequests[0].startTimeOffsetMinutes,
      endTimeOffsetMinutes: occurrenceRequests[0].endTimeOffsetMinutes,
      timeZone,
      occurrences: occurrenceRequests,
    });

    expect(hold.holds).toHaveLength(occurrenceRequests.length);
    expect(hold.startTime).toBe(occurrences[0].start);
    expect(hold.endTime).toBe(occurrences[0].end);

    const holdCallBodies = mockedCallEdge.mock.calls
      .filter(([path]) => path === "sessions-hold")
      .map(([, init]) => (typeof init?.body === "string" ? JSON.parse(init.body) : {}));
    const primaryHoldBody = holdCallBodies.find((body) => body.client_id === primaryClientId);
    expect(primaryHoldBody?.occurrences).toHaveLength(occurrenceRequests.length);
    expect(primaryHoldBody?.start_time_offset_minutes).toBe(occurrenceRequests[0].startTimeOffsetMinutes);
    expect(primaryHoldBody?.occurrences?.[1]?.start_time_offset_minutes).toBe(
      occurrenceRequests[1].startTimeOffsetMinutes,
    );

    const confirmation = await confirmSessionBooking({
      holdKey: hold.holdKey,
      session: {
        therapist_id: therapistId,
        client_id: primaryClientId,
        start_time: occurrences[0].start,
        end_time: occurrences[0].end,
      },
      startTimeOffsetMinutes: occurrenceRequests[0].startTimeOffsetMinutes,
      endTimeOffsetMinutes: occurrenceRequests[0].endTimeOffsetMinutes,
      timeZone,
      occurrences: hold.holds.map((heldOccurrence, index) => ({
        holdKey: heldOccurrence.holdKey,
        session: {
          therapist_id: therapistId,
          client_id: primaryClientId,
          start_time: occurrenceRequests[index].startTime,
          end_time: occurrenceRequests[index].endTime,
        },
        startTimeOffsetMinutes: occurrenceRequests[index].startTimeOffsetMinutes,
        endTimeOffsetMinutes: occurrenceRequests[index].endTimeOffsetMinutes,
        timeZone,
      })),
    });

    expect(confirmation.sessions).toHaveLength(occurrenceRequests.length);
    confirmation.sessions.forEach((session, index) => {
      expect(session.start_time).toBe(occurrences[index].start);
      expect(session.end_time).toBe(occurrences[index].end);
      const durationMinutes = (new Date(session.end_time).getTime() - new Date(session.start_time).getTime()) / 60000;
      expect(durationMinutes).toBe(60);
    });

    const confirmCallBodies = mockedCallEdge.mock.calls
      .filter(([path]) => path === "sessions-confirm")
      .map(([, init]) => (typeof init?.body === "string" ? JSON.parse(init.body) : {}));
    const primaryConfirmBody = confirmCallBodies.find((body) => body.hold_key === hold.holdKey);
    expect(primaryConfirmBody?.occurrences).toHaveLength(occurrenceRequests.length);
    expect(primaryConfirmBody?.occurrences?.[1]?.start_time_offset_minutes).toBe(
      occurrenceRequests[1].startTimeOffsetMinutes,
    );
    expect(primaryConfirmBody?.occurrences?.[1]?.session?.start_time).toBe(occurrenceRequests[1].startTime);

    const competingHold = await requestSessionHold({
      therapistId,
      clientId: competitorClientId,
      startTime: occurrences[0].start,
      endTime: occurrences[0].end,
      startTimeOffsetMinutes: occurrenceRequests[0].startTimeOffsetMinutes,
      endTimeOffsetMinutes: occurrenceRequests[0].endTimeOffsetMinutes,
      timeZone,
      occurrences: occurrenceRequests,
    });

    await expect(
      confirmSessionBooking({
        holdKey: competingHold.holdKey,
        session: {
          therapist_id: therapistId,
          client_id: competitorClientId,
          start_time: occurrences[0].start,
          end_time: occurrences[0].end,
        },
        startTimeOffsetMinutes: occurrenceRequests[0].startTimeOffsetMinutes,
        endTimeOffsetMinutes: occurrenceRequests[0].endTimeOffsetMinutes,
        timeZone,
        occurrences: competingHold.holds.map((heldOccurrence, index) => ({
          holdKey: heldOccurrence.holdKey,
          session: {
            therapist_id: therapistId,
            client_id: competitorClientId,
            start_time: occurrenceRequests[index].startTime,
            end_time: occurrenceRequests[index].endTime,
          },
          startTimeOffsetMinutes: occurrenceRequests[index].startTimeOffsetMinutes,
          endTimeOffsetMinutes: occurrenceRequests[index].endTimeOffsetMinutes,
          timeZone,
        })),
      }),
    ).rejects.toThrow(/slot already booked/i);
  });
});
