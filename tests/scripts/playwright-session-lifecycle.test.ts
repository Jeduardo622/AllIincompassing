import { afterEach, describe, expect, it } from "vitest";

import {
  buildBookingCandidateStarts,
  cleanupBeforeNoResponseFailure,
  isCreateSessionButtonReady,
} from "../../scripts/playwright-session-lifecycle";

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

  it("starts in a seeded future window to avoid colliding with shared hosted sessions", () => {
    process.env.GITHUB_RUN_ID = "28030829838";
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const starts = buildBookingCandidateStarts("no-show");
    const firstDayOffset = Math.round((starts[0].getTime() - today.getTime()) / (24 * 60 * 60 * 1000));

    expect(firstDayOffset).toBeGreaterThanOrEqual(21);
    expect(firstDayOffset).toBeLessThanOrEqual(41);
  });

  it("treats the Create Session button as ready only when enabled", () => {
    expect(isCreateSessionButtonReady({ disabled: null, ariaDisabled: null })).toBe(true);
    expect(isCreateSessionButtonReady({ disabled: "", ariaDisabled: null })).toBe(false);
    expect(isCreateSessionButtonReady({ disabled: null, ariaDisabled: "true" })).toBe(false);
  });

  it("does not block the no-response failure when cleanup rejects", async () => {
    const warnings: unknown[][] = [];

    await expect(
      cleanupBeforeNoResponseFailure(
        () => Promise.reject(new Error("cleanup failed")),
        (...args) => {
          warnings.push(args);
        },
      ),
    ).resolves.toBeUndefined();

    expect(warnings).toHaveLength(1);
    expect(String(warnings[0][0])).toContain("failed to clean up");
  });

  it("does not block the no-response failure when cleanup stalls", async () => {
    const warnings: unknown[][] = [];

    await expect(
      cleanupBeforeNoResponseFailure(
        () => new Promise<void>(() => undefined),
        (...args) => {
          warnings.push(args);
        },
        1,
      ),
    ).resolves.toBeUndefined();

    expect(warnings).toHaveLength(1);
    expect(String(warnings[0][0])).toContain("timed out");
  });
});
