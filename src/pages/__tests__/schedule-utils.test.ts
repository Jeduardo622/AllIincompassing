import { describe, expect, it } from "vitest";
import {
  buildSessionSlotIndex,
  createSessionSlotKey,
  mapWithConcurrency,
} from "../schedule-utils";
import type { Session } from "../../types";

const makeSession = (id: string, start: string): Session =>
  ({
    id,
    therapist_id: "therapist-1",
    client_id: "client-1",
    program_id: null,
    goal_id: null,
    start_time: start,
    end_time: start,
    status: "scheduled",
    location_type: "in-clinic",
    title: null,
    description: null,
    notes: null,
    rbt_notes: null,
    parent_notes: null,
    goals_addressed: [],
    interventions_used: [],
    behavior_tracking: null,
    session_rating: null,
    is_recurring: false,
    recurrence_pattern: null,
    parent_signature: null,
    therapist_signature: null,
    cancellation_reason: null,
    cancellation_note: null,
    cancellation_user_id: null,
    cancelled_at: null,
    created_at: start,
    updated_at: start,
  }) as Session;

describe("schedule-utils performance helpers", () => {
  it("indexes sessions by day+time slot key", () => {
    const sessions = [
      makeSession("s1", "2026-03-12T09:00"),
      makeSession("s2", "2026-03-12T09:00"),
      makeSession("s3", "2026-03-12T10:15"),
    ];

    const index = buildSessionSlotIndex(sessions);
    const slot = index.get(createSessionSlotKey("2026-03-12", "09:00")) ?? [];
    const otherSlot = index.get(createSessionSlotKey("2026-03-12", "10:15")) ?? [];

    expect(slot.map((session) => session.id)).toEqual(["s1", "s2"]);
    expect(otherSlot.map((session) => session.id)).toEqual(["s3"]);
  });

  it("indexes timezone-aware timestamps using local runtime slots", () => {
    const zonedStart = "2026-03-12T09:00:00.000Z";
    const index = buildSessionSlotIndex([makeSession("z1", zonedStart)]);
    const local = new Date(zonedStart);
    const month = String(local.getMonth() + 1).padStart(2, "0");
    const day = String(local.getDate()).padStart(2, "0");
    const hour = String(local.getHours()).padStart(2, "0");
    const minute = String(local.getMinutes()).padStart(2, "0");
    const expectedKey = createSessionSlotKey(`${local.getFullYear()}-${month}-${day}`, `${hour}:${minute}`);

    expect((index.get(expectedKey) ?? []).map((session) => session.id)).toEqual(["z1"]);
  });

  it("runs async jobs with bounded concurrency", async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    const output = await mapWithConcurrency(
      [1, 2, 3, 4, 5],
      async (value) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 10));
        inFlight -= 1;
        return value * 2;
      },
      2,
    );

    expect(output).toEqual([2, 4, 6, 8, 10]);
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });
});
