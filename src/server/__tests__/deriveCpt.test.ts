import { describe, expect, it } from "vitest";
import { deriveCptMetadata } from "../deriveCpt";
import {
  LONG_DURATION_MODIFIER,
  LONG_DURATION_THRESHOLD_MINUTES,
} from "../cptRules";
import { DURATION_ROUNDING_CASES } from "../__testUtils__/cptTestVectors";
import { createPseudoRandom } from "../__testUtils__/random";

const baseSession = {
  therapist_id: "therapist-1",
  client_id: "client-1",
  start_time: "2025-01-01T10:00:00Z",
  end_time: "2025-01-01T11:00:00Z",
  status: "scheduled" as const,
};

function createSessionWithOffset(minutes: number, seconds: number) {
  const start = new Date(baseSession.start_time).getTime();
  const offsetMs = minutes * 60000 + seconds * 1000;
  const end = new Date(start + offsetMs).toISOString();
  return { ...baseSession, end_time: end };
}

describe("deriveCptMetadata", () => {
  it("returns default CPT code for individual sessions", () => {
    const result = deriveCptMetadata({ session: { ...baseSession, session_type: "Individual" } });
    expect(result.code).toBe("97153");
    expect(result.modifiers).toEqual([]);
    expect(result.source).toBe("session_type");
    expect(result.durationMinutes).toBe(60);
  });

  it("adds group modifiers when session type is group", () => {
    const result = deriveCptMetadata({
      session: {
        ...baseSession,
        session_type: "Group",
      },
    });
    expect(result.code).toBe("97154");
    expect(result.modifiers).toContain("HQ");
    expect(result.source).toBe("session_type");
  });

  it("adds telehealth modifier based on location", () => {
    const result = deriveCptMetadata({
      session: {
        ...baseSession,
        location_type: "telehealth",
      },
    });
    expect(result.modifiers).toContain("95");
    expect(result.code).toBe("97153");
  });

  it("honors CPT overrides", () => {
    const result = deriveCptMetadata({
      session: baseSession,
      overrides: {
        cptCode: "97155",
        modifiers: ["gt", " 95 "],
      },
    });
    expect(result.code).toBe("97155");
    expect(result.source).toBe("override");
    expect(result.modifiers).toEqual(["GT", "95"]);
  });

  it("adds long-duration modifier when session exceeds three hours", () => {
    const result = deriveCptMetadata({
      session: {
        ...baseSession,
        start_time: "2025-01-01T09:00:00Z",
        end_time: new Date(
          new Date("2025-01-01T09:00:00Z").getTime()
            + (LONG_DURATION_THRESHOLD_MINUTES + 90) * 60000,
        ).toISOString(),
      },
    });
    expect(result.modifiers).toContain(LONG_DURATION_MODIFIER);
    expect(result.durationMinutes).toBe(
      LONG_DURATION_THRESHOLD_MINUTES + 90,
    );
  });

  it.each(DURATION_ROUNDING_CASES)(
    "rounds duration minutes at boundary: $label",
    ({ offsetMinutes, offsetSeconds, expectedMinutes }) => {
      const session = createSessionWithOffset(offsetMinutes, offsetSeconds);
      const result = deriveCptMetadata({ session });
      expect(result.durationMinutes).toBe(expectedMinutes);
    },
  );

  it("rounds duration minutes consistently across randomized samples", () => {
    const random = createPseudoRandom(42);
    const iterations = 300;
    for (let i = 0; i < iterations; i += 1) {
      const fractionalMinutes = 1 + random() * 239;
      let wholeMinutes = Math.floor(fractionalMinutes);
      let fractionalSeconds = Math.round((fractionalMinutes - wholeMinutes) * 60);
      if (fractionalSeconds === 60) {
        wholeMinutes += 1;
        fractionalSeconds = 0;
      }
      const session = createSessionWithOffset(wholeMinutes, fractionalSeconds);
      const result = deriveCptMetadata({ session });
      const expected = Math.round(wholeMinutes + fractionalSeconds / 60);
      expect(result.durationMinutes).toBe(expected);
    }
  });
});
