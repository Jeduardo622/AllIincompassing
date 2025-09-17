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

function setupEdgeMock() {
  mockedCallEdge.mockImplementation(async (path: string, init: RequestInit = {}) => {
    const rawBody = typeof init.body === "string" ? init.body : "";
    const parsedBody = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};

    if (path === "sessions-hold") {
      holdSequence += 1;
      const hold: MockHoldRecord = {
        holdKey: `hold-${holdSequence}`,
        holdId: `hold-id-${holdSequence}`,
        therapistId: String(parsedBody.therapist_id ?? "therapist"),
        clientId: String(parsedBody.client_id ?? "client"),
        startTime: String(parsedBody.start_time ?? ""),
        endTime: String(parsedBody.end_time ?? ""),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      };
      activeHolds.push(hold);
      holdCleanupKeys.add(hold.holdKey);
      return jsonResponse({
        success: true,
        data: { holdKey: hold.holdKey, holdId: hold.holdId, expiresAt: hold.expiresAt },
      });
    }

    if (path === "sessions-confirm") {
      const holdKey = String(parsedBody.hold_key ?? "");
      const holdIndex = activeHolds.findIndex((hold) => hold.holdKey === holdKey);
      if (holdIndex === -1) {
        return jsonResponse({ success: false, error: "Hold not found" }, 404);
      }

      const hold = activeHolds.splice(holdIndex, 1)[0];
      holdCleanupKeys.delete(hold.holdKey);

      const sessionPayload = (parsedBody.session ?? {}) as Partial<Session>;
      const slotAlreadyBooked = activeSessions.some(
        (session) =>
          session.start_time === sessionPayload.start_time &&
          session.end_time === sessionPayload.end_time &&
          session.status !== "cancelled",
      );

      if (slotAlreadyBooked) {
        // Put the hold back so the caller can release it explicitly.
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

      return jsonResponse({ success: true, data: { session: confirmedSession } });
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
        const session = await confirmSessionBooking({
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

        sessionCleanupIds.add(session.id);
        return { status: "confirmed" as const, session };
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
});
