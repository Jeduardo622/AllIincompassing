import { describe, expect, it } from "vitest";
import { buildBookSessionApiPayload } from "../booking";

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
});

