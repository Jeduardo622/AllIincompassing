import { afterEach, describe, expect, it } from "vitest";

import { buildBookingCandidateStarts } from "../../scripts/playwright-session-lifecycle";

const originalGithubRunId = process.env.GITHUB_RUN_ID;
const originalTerminalStatus = process.env.PW_LIFECYCLE_TERMINAL_STATUS;

describe("playwright session lifecycle booking starts", () => {
  afterEach(() => {
    process.env.GITHUB_RUN_ID = originalGithubRunId;
    process.env.PW_LIFECYCLE_TERMINAL_STATUS = originalTerminalStatus;
  });

  it("offsets completed lifecycle runs from no-show runs in the same CI run", () => {
    process.env.GITHUB_RUN_ID = "28030829838";

    const noShowStarts = buildBookingCandidateStarts("no-show");
    const completedStarts = buildBookingCandidateStarts("completed");

    expect(noShowStarts[0].getHours()).toBe(13);
    expect(completedStarts[0].getHours()).toBe(15);
    expect(completedStarts[0].toISOString()).not.toBe(noShowStarts[0].toISOString());
  });
});
