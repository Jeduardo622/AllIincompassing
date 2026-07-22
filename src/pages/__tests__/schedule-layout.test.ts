import { describe, expect, it } from "vitest";
import type { Session } from "../../types";
import { buildScheduleDayLayout } from "../schedule-layout";

const makeSession = (
  id: string,
  startTime: string,
  endTime: string,
  clientName = id,
): Session =>
  ({
    id,
    therapist_id: "therapist-1",
    client_id: `client-${id}`,
    program_id: null,
    goal_id: null,
    start_time: startTime,
    end_time: endTime,
    status: "scheduled",
    notes: "",
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    client: { id: `client-${id}`, full_name: clientName },
    therapist: { id: "therapist-1", full_name: "Dr. Rivera" },
  }) as Session;

describe("buildScheduleDayLayout", () => {
  const day = new Date(2026, 6, 22);

  it("positions same-day appointments by real 15-minute row duration", () => {
    const result = buildScheduleDayLayout([
      makeSession("session-1", "2026-07-22T09:15:00", "2026-07-22T10:45:00", "Jamie Client"),
    ], day);

    expect(result.invalidSessions).toEqual([]);
    expect(result.items).toEqual([
      {
        kind: "appointment",
        session: expect.objectContaining({ id: "session-1" }),
        topRows: 5,
        spanRows: 6,
        clippedStart: false,
        clippedEnd: false,
      },
    ]);
  });

  it("clips appointments that begin before or end after the visible grid", () => {
    const result = buildScheduleDayLayout([
      makeSession("early", "2026-07-22T07:30:00", "2026-07-22T08:30:00", "Early Bird"),
      makeSession("late", "2026-07-22T17:30:00", "2026-07-22T18:30:00", "Night Owl"),
    ], day);

    expect(result.invalidSessions).toEqual([]);
    expect(result.items).toEqual([
      {
        kind: "appointment",
        session: expect.objectContaining({ id: "early" }),
        topRows: 0,
        spanRows: 2,
        clippedStart: true,
        clippedEnd: false,
      },
      {
        kind: "appointment",
        session: expect.objectContaining({ id: "late" }),
        topRows: 38,
        spanRows: 2,
        clippedStart: false,
        clippedEnd: true,
      },
    ]);
  });

  it("groups true overlaps into one clipped cluster span", () => {
    const result = buildScheduleDayLayout([
      makeSession("session-1", "2026-07-22T09:00:00", "2026-07-22T10:00:00", "Alpha Client"),
      makeSession("session-2", "2026-07-22T09:30:00", "2026-07-22T10:30:00", "Beta Client"),
    ], day);

    expect(result.invalidSessions).toEqual([]);
    expect(result.items).toEqual([
      {
        kind: "cluster",
        sessions: [
          expect.objectContaining({ id: "session-1" }),
          expect.objectContaining({ id: "session-2" }),
        ],
        topRows: 4,
        spanRows: 6,
        clippedStart: false,
        clippedEnd: false,
      },
    ]);
  });

  it("treats transitive overlaps as a single cluster and sorts sessions by start then client name", () => {
    const result = buildScheduleDayLayout([
      makeSession("gamma", "2026-07-22T09:30:00", "2026-07-22T10:15:00", "Gamma Client"),
      makeSession("beta", "2026-07-22T09:00:00", "2026-07-22T09:45:00", "Beta Client"),
      makeSession("alpha", "2026-07-22T09:00:00", "2026-07-22T09:30:00", "Alpha Client"),
    ], day);

    expect(result.invalidSessions).toEqual([]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual({
      kind: "cluster",
      sessions: [
        expect.objectContaining({ id: "alpha" }),
        expect.objectContaining({ id: "beta" }),
        expect.objectContaining({ id: "gamma" }),
      ],
      topRows: 4,
      spanRows: 5,
      clippedStart: false,
      clippedEnd: false,
    });
  });

  it("keeps back-to-back appointments as separate items", () => {
    const result = buildScheduleDayLayout([
      makeSession("session-1", "2026-07-22T09:00:00", "2026-07-22T10:00:00", "Alpha Client"),
      makeSession("session-2", "2026-07-22T10:00:00", "2026-07-22T11:00:00", "Beta Client"),
    ], day);

    expect(result.invalidSessions).toEqual([]);
    expect(result.items).toEqual([
      {
        kind: "appointment",
        session: expect.objectContaining({ id: "session-1" }),
        topRows: 4,
        spanRows: 4,
        clippedStart: false,
        clippedEnd: false,
      },
      {
        kind: "appointment",
        session: expect.objectContaining({ id: "session-2" }),
        topRows: 8,
        spanRows: 4,
        clippedStart: false,
        clippedEnd: false,
      },
    ]);
  });

  it("excludes valid sessions that belong to another day", () => {
    const result = buildScheduleDayLayout([
      makeSession("same-day", "2026-07-22T11:00:00", "2026-07-22T11:30:00", "Same Day"),
      makeSession("other-day", "2026-07-23T11:00:00", "2026-07-23T11:30:00", "Other Day"),
    ], day);

    expect(result.invalidSessions).toEqual([]);
    expect(result.items).toEqual([
      {
        kind: "appointment",
        session: expect.objectContaining({ id: "same-day" }),
        topRows: 12,
        spanRows: 2,
        clippedStart: false,
        clippedEnd: false,
      },
    ]);
  });

  it("returns invalid and non-positive sessions instead of silently dropping them", () => {
    const result = buildScheduleDayLayout([
      makeSession("bad-start", "not-a-date", "2026-07-22T10:00:00", "Bad Start"),
      makeSession("zero-length", "2026-07-22T09:00:00", "2026-07-22T09:00:00", "Zero Length"),
      makeSession("negative", "2026-07-22T10:30:00", "2026-07-22T10:00:00", "Negative Duration"),
    ], day);

    expect(result.items).toEqual([]);
    expect(result.invalidSessions.map((session) => session.id)).toEqual([
      "bad-start",
      "zero-length",
      "negative",
    ]);
  });
});
