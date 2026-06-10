import { describe, expect, it } from "vitest";

import { resolveSessionCloseRequiredGoalIds } from "../sessionCloseRequiredGoals";

describe("resolveSessionCloseRequiredGoalIds", () => {
  it("prefers session_goals when they exist", () => {
    expect(
      resolveSessionCloseRequiredGoalIds({
        sessionGoalIds: ["goal-1", "goal-2", "goal-1"],
        primaryGoalId: "goal-primary",
      }),
    ).toEqual(["goal-1", "goal-2"]);
  });

  it("falls back to the primary session goal when session_goals are missing", () => {
    expect(
      resolveSessionCloseRequiredGoalIds({
        sessionGoalIds: [],
        primaryGoalId: "goal-primary",
      }),
    ).toEqual(["goal-primary"]);
  });

  it("returns an empty list when neither source has a usable goal id", () => {
    expect(
      resolveSessionCloseRequiredGoalIds({
        sessionGoalIds: ["", "   ", null, undefined],
        primaryGoalId: "   ",
      }),
    ).toEqual([]);
  });
});
