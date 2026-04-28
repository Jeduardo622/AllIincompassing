import { describe, expect, it } from "vitest";
import { bookSessionApiRequestBodySchema } from "../../../server/types";
import { normalizeBookRequestBodyForZod, normalizeSessionPayloadSubtree } from "../bookingRequestBodyNormalize";

describe("bookingRequestBodyNormalize", () => {
  it("removes session created_at/updated_at when they lack a timezone offset", () => {
    const raw = {
      session: {
        therapist_id: "t1",
        client_id: "c1",
        program_id: "p1",
        goal_id: "g1",
        start_time: "2025-01-01T10:00:00Z",
        end_time: "2025-01-01T11:00:00Z",
        created_at: "2025-01-01T09:00:00",
        updated_at: "2025-01-01T09:30:00",
      },
      startTimeOffsetMinutes: 0,
      endTimeOffsetMinutes: 0,
      timeZone: "UTC",
    };

    const normalized = normalizeBookRequestBodyForZod(raw) as typeof raw;
    expect(normalized.session.created_at).toBeUndefined();
    expect(normalized.session.updated_at).toBeUndefined();
    expect(bookSessionApiRequestBodySchema.safeParse(normalized).success).toBe(true);
  });

  it("filters recurrence exceptions that lack offset datetimes", () => {
    const session = normalizeSessionPayloadSubtree({
      therapist_id: "t1",
      client_id: "c1",
      program_id: "p1",
      goal_id: "g1",
      start_time: "2025-01-01T10:00:00Z",
      end_time: "2025-01-01T11:00:00Z",
      recurrence: {
        rule: "FREQ=WEEKLY;INTERVAL=1",
        exceptions: ["2025-01-08T10:00:00Z", "2025-01-15T10:00:00"],
      },
    }) as Record<string, unknown>;

    const rec = session.recurrence as { exceptions?: string[] };
    expect(rec.exceptions).toEqual(["2025-01-08T10:00:00Z"]);
  });
});
