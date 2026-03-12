import { describe, expect, it } from "vitest";
import { __TESTING__ } from "../Reports";

describe("Reports metrics normalization", () => {
  it("normalizes SQL-style session metrics rows", () => {
    const normalized = __TESTING__.normalizeSessionMetricsData([
      {
        total_sessions: 20,
        completed_sessions: 12,
        cancelled_sessions: 4,
        no_show_sessions: 2,
        sessions_by_therapist: { "Therapist A": 10, "Therapist B": 10 },
        sessions_by_client: { "Client A": 8, "Client B": 12 },
        sessions_by_day: { Monday: 5, Tuesday: 15 },
      },
    ]);

    expect(normalized).toMatchObject({
      totalSessions: 20,
      completedSessions: 12,
      cancelledSessions: 4,
      noShowSessions: 2,
      completionRate: 60,
      sessionsByTherapist: { "Therapist A": 10, "Therapist B": 10 },
      sessionsByClient: { "Client A": 8, "Client B": 12 },
      sessionsByDayOfWeek: { Monday: 5, Tuesday: 15 },
    });
  });

  it("drops invalid counts while preserving valid aggregate entries", () => {
    const counts = __TESTING__.toCountMap({
      " Monday ": 4,
      Tuesday: "nope",
      Wednesday: 0,
    });

    expect(counts).toEqual({ Monday: 4 });
  });
});
