import { describe, expect, it } from "vitest";

import { buildLifecycleTargetPairs } from "../playwrightSessionLifecycleTargets";

describe("buildLifecycleTargetPairs", () => {
  it("uses therapist-client authorization pairs instead of a client-only cross product", () => {
    const result = buildLifecycleTargetPairs({
      therapistIds: ["therapist-a", "therapist-b"],
      clientIds: ["client-1", "client-2"],
      authorizedPairs: [
        { therapistId: "therapist-a", clientId: "client-2" },
        { therapistId: "therapist-b", clientId: "client-1" },
      ],
    });

    expect(result).toEqual([
      { therapistId: "therapist-a", clientId: "client-2" },
      { therapistId: "therapist-b", clientId: "client-1" },
    ]);
  });

  it("falls back to visible therapist-client combinations when no authorization pairs are available", () => {
    const result = buildLifecycleTargetPairs({
      therapistIds: ["therapist-a", "therapist-b"],
      clientIds: ["client-1", "client-2"],
      authorizedPairs: [],
    });

    expect(result).toEqual([
      { therapistId: "therapist-a", clientId: "client-1" },
      { therapistId: "therapist-a", clientId: "client-2" },
      { therapistId: "therapist-b", clientId: "client-1" },
      { therapistId: "therapist-b", clientId: "client-2" },
    ]);
  });

  it("drops duplicate and non-visible authorization pairs", () => {
    const result = buildLifecycleTargetPairs({
      therapistIds: ["therapist-a"],
      clientIds: ["client-1"],
      authorizedPairs: [
        { therapistId: "therapist-a", clientId: "client-1" },
        { therapistId: "therapist-a", clientId: "client-1" },
        { therapistId: "therapist-a", clientId: "client-2" },
        { therapistId: "therapist-b", clientId: "client-1" },
      ],
    });

    expect(result).toEqual([{ therapistId: "therapist-a", clientId: "client-1" }]);
  });

  it("limits authorized pairs to allowed linked therapists when provided", () => {
    const result = buildLifecycleTargetPairs({
      therapistIds: ["therapist-a", "therapist-b", "therapist-c"],
      clientIds: ["client-1", "client-2"],
      authorizedPairs: [
        { therapistId: "therapist-a", clientId: "client-1" },
        { therapistId: "therapist-b", clientId: "client-2" },
        { therapistId: "therapist-c", clientId: "client-1" },
      ],
      allowedTherapistIds: ["therapist-b"],
    });

    expect(result).toEqual([{ therapistId: "therapist-b", clientId: "client-2" }]);
  });

  it("limits fallback pairs to allowed linked therapists when no authorization pairs match", () => {
    const result = buildLifecycleTargetPairs({
      therapistIds: ["therapist-a", "therapist-b"],
      clientIds: ["client-1", "client-2"],
      authorizedPairs: [],
      allowedTherapistIds: ["therapist-b"],
    });

    expect(result).toEqual([
      { therapistId: "therapist-b", clientId: "client-1" },
      { therapistId: "therapist-b", clientId: "client-2" },
    ]);
  });
});
