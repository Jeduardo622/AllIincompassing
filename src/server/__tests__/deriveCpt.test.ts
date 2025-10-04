import { describe, expect, it } from "vitest";
import { deriveCptMetadata } from "../deriveCpt";

const baseSession = {
  therapist_id: "therapist-1",
  client_id: "client-1",
  start_time: "2025-01-01T10:00:00Z",
  end_time: "2025-01-01T11:00:00Z",
  status: "scheduled" as const,
};

const deriveFixtures = [
  {
    name: "individual session without payer metadata",
    session: { ...baseSession, session_type: "Individual" },
    expected: {
      code: "97153",
      modifiers: [] as string[],
      source: "session_type" as const,
      durationMinutes: 60,
    },
  },
  {
    name: "group session adds payer modifier bundle for anthem",
    session: {
      ...baseSession,
      session_type: "Group",
      payer_slug: "Anthem Blue Cross",
    },
    expected: {
      code: "97154",
      modifiers: ["HQ", "59"],
      source: "session_type" as const,
      durationMinutes: 60,
    },
  },
  {
    name: "consultation session includes caloptima bundle",
    session: {
      ...baseSession,
      session_type: " consultation ",
      payer_slug: "caloptima health",
    },
    expected: {
      code: "97156",
      modifiers: ["HO", "U8"],
      source: "session_type" as const,
      durationMinutes: 60,
    },
  },
  {
    name: "override merges payer wildcard and explicit modifiers",
    session: {
      ...baseSession,
      payer_slug: "ANTHEM BLUE CROSS",
      location_type: "telehealth",
    },
    overrides: {
      cptCode: "97155",
      modifiers: ["22", " 95 "],
    },
    expected: {
      code: "97155",
      modifiers: ["22", "95", "59"],
      source: "override" as const,
      durationMinutes: 60,
    },
  },
];

describe("deriveCptMetadata", () => {
  it.each(deriveFixtures)("derives metadata for $name", ({ session, overrides, expected }) => {
    const result = deriveCptMetadata({ session, overrides });

    const sortedModifiers = [...result.modifiers].sort();
    const expectedSorted = [...expected.modifiers].sort();

    expect(result.code).toBe(expected.code);
    expect(sortedModifiers).toEqual(expectedSorted);
    expect(result.source).toBe(expected.source);
    expect(result.durationMinutes).toBe(expected.durationMinutes);
  });

  it("adds long-duration modifier when session exceeds default threshold", () => {
    const result = deriveCptMetadata({
      session: {
        ...baseSession,
        session_type: "Individual",
        start_time: "2025-01-01T09:00:00Z",
        end_time: "2025-01-01T13:30:00Z",
      },
    });

    expect(result.modifiers).toContain("KX");
    expect(result.durationMinutes).toBe(270);
  });

  it("applies payer-specific long-duration threshold overrides", () => {
    const result = deriveCptMetadata({
      session: {
        ...baseSession,
        session_type: "Individual",
        payer_slug: "Anthem Blue Cross",
        start_time: "2025-01-01T10:00:00Z",
        end_time: "2025-01-01T12:30:00Z",
      },
    });

    expect(result.durationMinutes).toBe(150);
    expect(result.modifiers).toContain("KX");
    expect(result.modifiers).toContain("59");
  });

  it("prefers code-specific threshold overrides when provided", () => {
    const result = deriveCptMetadata({
      session: {
        ...baseSession,
        payer_slug: "anthem-blue-cross",
        start_time: "2025-01-01T10:00:00Z",
        end_time: "2025-01-01T12:10:00Z",
      },
      overrides: {
        cptCode: "97155",
      },
    });

    expect(result.durationMinutes).toBe(130);
    expect(result.modifiers).toContain("KX");
    expect(result.modifiers).toContain("59");
  });

  it("calculates duration across DST fall-back transitions", () => {
    const result = deriveCptMetadata({
      session: {
        ...baseSession,
        start_time: "2025-11-02T00:30:00-07:00",
        end_time: "2025-11-02T02:30:00-08:00",
      },
    });

    expect(result.durationMinutes).toBe(180);
  });
});
