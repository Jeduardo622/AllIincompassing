import { describe, expect, it } from "vitest";
import { buildTargetsByGoalId, parseGoalTimelineCriteria } from "./ProgramsGoalsTab.helpers";
import type { GoalTarget } from "../../types";

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

describe("buildTargetsByGoalId", () => {
  it("groups target-level measurement definitions under their parent goals", () => {
    const baseTarget = {
      id: "target-a",
      organization_id: "org-1",
      client_id: "client-1",
      goal_id: "goal-1",
      name: "Requests break",
      measurement_type: "frequency",
      graph_config: { defaultChart: "line" },
      status: "active",
      sort_order: 2,
      created_at: "2026-07-03T17:00:00.000Z",
      updated_at: "2026-07-03T17:00:00.000Z",
    } satisfies GoalTarget;

    expect(
      buildTargetsByGoalId([
        baseTarget,
        {
          ...baseTarget,
          id: "target-b",
          name: "Tolerates denied access",
          measurement_type: "duration",
          sort_order: 1,
        },
        {
          ...baseTarget,
          id: "target-c",
          goal_id: "goal-2",
          name: "Transitions independently",
          measurement_type: "correctIncorrect",
        },
      ]),
    ).toEqual({
      "goal-1": [
        expect.objectContaining({ id: "target-b", measurement_type: "duration" }),
        expect.objectContaining({ id: "target-a", measurement_type: "frequency" }),
      ],
      "goal-2": [expect.objectContaining({ id: "target-c", measurement_type: "correctIncorrect" })],
    });
  });
});
