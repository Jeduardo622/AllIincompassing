import { describe, expect, it } from "vitest";
import { deriveCptMetadata } from "../deriveCpt";

const baseSession = {
  therapist_id: "therapist-1",
  client_id: "client-1",
  start_time: "2025-01-01T10:00:00Z",
  end_time: "2025-01-01T11:00:00Z",
  status: "scheduled" as const,
};

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
        end_time: "2025-01-01T13:30:00Z",
      },
    });
    expect(result.modifiers).toContain("KX");
    expect(result.durationMinutes).toBe(270);
  });
});
