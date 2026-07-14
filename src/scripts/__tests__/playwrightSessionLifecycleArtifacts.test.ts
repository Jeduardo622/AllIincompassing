import { describe, expect, it } from "vitest";

import {
  assertLifecycleSessionArtifacts,
  getMissingLifecycleArtifacts,
} from "../playwrightSessionLifecycleArtifacts";

describe("playwrightSessionLifecycleArtifacts", () => {
  it("reports both missing artifacts when neither durable write exists", () => {
    expect(getMissingLifecycleArtifacts({
      sessionGoalIds: [],
      clientSessionNoteGoalNotes: [],
    })).toEqual(["session_goals", "client_session_notes"]);
  });

  it("accepts the expected durable lifecycle shape", () => {
    expect(() => assertLifecycleSessionArtifacts("after-close", {
      sessionGoalIds: ["goal-1"],
      clientSessionNoteGoalNotes: [{ "goal-1": "Persisted note" }],
    })).not.toThrow();
  });

  it("throws with the exact missing artifact names", () => {
    expect(() => assertLifecycleSessionArtifacts("before-close", {
      sessionGoalIds: ["goal-1"],
      clientSessionNoteGoalNotes: [],
    })).toThrow(
      "Lifecycle smoke before-close is missing durable artifacts: client_session_notes",
    );
  });

  it("requires persisted non-empty note coverage for every session goal", () => {
    expect(() => assertLifecycleSessionArtifacts("before-close", {
      sessionGoalIds: ["goal-1", "goal-2"],
      clientSessionNoteGoalNotes: [{ "goal-1": "Persisted", "goal-2": "  " }],
    })).toThrow(
      "Lifecycle smoke before-close is missing durable artifacts: client_session_notes.goal_notes[goal-2]",
    );
  });

  it("accepts per-goal coverage split across multiple persisted note rows", () => {
    expect(() => assertLifecycleSessionArtifacts("after-close", {
      sessionGoalIds: ["goal-1", "goal-2"],
      clientSessionNoteGoalNotes: [
        { "goal-1": "First note" },
        { "goal-2": "Second note" },
      ],
    })).not.toThrow();
  });
});
