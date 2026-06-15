import { describe, expect, it } from "vitest";

import {
  assertLifecycleSessionArtifacts,
  getMissingLifecycleArtifacts,
} from "../playwrightSessionLifecycleArtifacts";

describe("playwrightSessionLifecycleArtifacts", () => {
  it("reports both missing artifacts when neither durable write exists", () => {
    expect(getMissingLifecycleArtifacts({
      sessionGoalsCount: 0,
      clientSessionNotesCount: 0,
    })).toEqual(["session_goals", "client_session_notes"]);
  });

  it("accepts the expected durable lifecycle shape", () => {
    expect(() => assertLifecycleSessionArtifacts("after-close", {
      sessionGoalsCount: 1,
      clientSessionNotesCount: 1,
    })).not.toThrow();
  });

  it("throws with the exact missing artifact names", () => {
    expect(() => assertLifecycleSessionArtifacts("before-close", {
      sessionGoalsCount: 1,
      clientSessionNotesCount: 0,
    })).toThrow(
      "Lifecycle smoke before-close is missing durable artifacts: client_session_notes",
    );
  });
});
