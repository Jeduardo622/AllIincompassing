import { describe, expect, it } from "vitest";
import { bookSessionApiRequestBodySchema } from "../../../../server/types";
import {
  buildBookSessionApiPayload,
  buildBookingTimeMetadata,
} from "../booking";

describe("booking domain payload builder", () => {
  it("builds payload with defaults and metadata", () => {
    const payload = buildBookSessionApiPayload(
      {
        therapist_id: "11111111-1111-1111-1111-111111111111",
        client_id: "22222222-2222-2222-2222-222222222222",
        program_id: "33333333-3333-3333-3333-333333333333",
        goal_id: "44444444-4444-4444-4444-444444444444",
        start_time: "2026-03-20T15:00:00.000Z",
        end_time: "2026-03-20T16:00:00.000Z",
      } as never,
      {
        startOffsetMinutes: -240,
        endOffsetMinutes: -240,
        timeZone: "America/New_York",
      },
    );

    expect(payload.timeZone).toBe("America/New_York");
    expect(payload.holdSeconds).toBe(300);
    expect(payload.session.status).toBe("scheduled");
  });

  it("computes booking time metadata for valid session times", () => {
    const metadata = buildBookingTimeMetadata(
      {
        start_time: "2026-03-20T15:00:00.000Z",
        end_time: "2026-03-20T16:00:00.000Z",
      },
      "America/New_York",
    );

    expect(metadata.timeZone).toBe("America/New_York");
    expect(typeof metadata.startOffsetMinutes).toBe("number");
    expect(typeof metadata.endOffsetMinutes).toBe("number");
  });

  it("throws when booking time metadata is missing required timestamps", () => {
    expect(() =>
      buildBookingTimeMetadata({
        start_time: "2026-03-20T15:00:00.000Z",
      }),
    ).toThrow("Missing session start or end time");
  });

  it("throws when booking time metadata receives invalid timestamps", () => {
    expect(() =>
      buildBookingTimeMetadata({
        start_time: "not-a-date",
        end_time: "still-not-a-date",
      }),
    ).toThrow("Invalid session time provided");
  });

  it("strips naive-offset session audit timestamps so payloads match /api/book Zod rules", () => {
    const payload = buildBookSessionApiPayload(
      {
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        therapist_id: "11111111-1111-1111-1111-111111111111",
        client_id: "22222222-2222-2222-2222-222222222222",
        program_id: "33333333-3333-3333-3333-333333333333",
        goal_id: "44444444-4444-4444-4444-444444444444",
        start_time: "2026-04-28T19:00:00.000Z",
        end_time: "2026-04-28T20:00:00.000Z",
        created_at: "2026-04-01T10:00:00",
        updated_at: "2026-04-01T11:00:00",
      } as never,
      {
        startOffsetMinutes: 420,
        endOffsetMinutes: 420,
        timeZone: "America/Los_Angeles",
      },
    );

    const parsed = bookSessionApiRequestBodySchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.session.created_at).toBeUndefined();
      expect(parsed.data.session.updated_at).toBeUndefined();
    }
  });
});

