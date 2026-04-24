import { describe, expect, it } from "vitest";
import type { Session } from "../../types";
import { reconcileOptimisticSessionMoves } from "../schedule-utils";

const buildSession = (start_time: string, end_time: string): Session => ({
  id: "session-1",
  therapist_id: "therapist-1",
  client_id: "client-1",
  program_id: "program-1",
  goal_id: "goal-1",
  start_time,
  end_time,
  status: "scheduled",
  notes: "Initial session",
  created_at: "2025-07-01T00:00:00.000Z",
  created_by: "user-1",
  updated_at: "2025-07-01T00:00:00.000Z",
  updated_by: "user-1",
  therapist: { id: "therapist-1", full_name: "Dr. Myles" },
  client: { id: "client-1", full_name: "Jamie Client" },
});

describe("reconcileOptimisticSessionMoves", () => {
  it("keeps an optimistic move while persisted sessions still show the old slot", () => {
    const optimisticMoves = {
      "session-1": {
        start_time: "2025-07-01T17:15:00.000Z",
        end_time: "2025-07-01T18:15:00.000Z",
      },
    };

    const persistedSessions = [
      buildSession("2025-07-01T17:00:00.000Z", "2025-07-01T18:00:00.000Z"),
    ];

    expect(reconcileOptimisticSessionMoves(optimisticMoves, persistedSessions)).toEqual(optimisticMoves);
  });

  it("clears an optimistic move once persisted sessions catch up to the moved instant", () => {
    const optimisticMoves = {
      "session-1": {
        start_time: "2025-07-01T17:15:00.000Z",
        end_time: "2025-07-01T18:15:00.000Z",
      },
    };

    const persistedSessions = [
      buildSession("2025-07-01T10:15:00-07:00", "2025-07-01T11:15:00-07:00"),
    ];

    expect(reconcileOptimisticSessionMoves(optimisticMoves, persistedSessions)).toEqual({});
  });
});
