import { describe, expect, it } from "vitest";
import { parseGoalTimelineCriteria } from "./ProgramsGoalsTab.helpers";

describe("parseGoalTimelineCriteria", () => {
  it("parses continuation lines without clobbering labeled goal fields", () => {
    expect(
      parseGoalTimelineCriteria(
        "Short-term: Request a break before escalation.\n" +
          "Use a visual cue when needed.\n" +
          "Intermediate: Generalize across two settings.\n" +
          "Long-term: Initiate independently.",
      ),
    ).toEqual({
      shortTermGoal: "Request a break before escalation.\nUse a visual cue when needed.",
      intermediateGoal: "Generalize across two settings.",
      longTermGoal: "Initiate independently.",
    });
  });
});
