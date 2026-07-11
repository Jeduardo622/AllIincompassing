import { afterEach, describe, expect, it } from "vitest";

import {
  buildBookingCandidateStarts,
  buildBookingConflictWindowFilters,
  cleanupBeforeNoResponseFailure,
  filterNonOverlappingBookingStarts,
  hasReachedLifecyclePairAttemptLimit,
  isCreateSessionButtonReady,
  isExpectedAlreadyStartedResponse,
  shouldTryNextLifecyclePairAfterAttempts,
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

  it("accepts only the explicit hosted ALREADY_STARTED recovery contract", () => {
    const body = JSON.stringify({ rpcCode: "ALREADY_STARTED" });
    expect(isExpectedAlreadyStartedResponse(true, 409, body)).toBe(true);
    expect(isExpectedAlreadyStartedResponse(false, 409, body)).toBe(false);
    expect(isExpectedAlreadyStartedResponse(true, 409, JSON.stringify({ rpcCode: "INVALID_STATUS" }))).toBe(false);
    expect(isExpectedAlreadyStartedResponse(true, 500, body)).toBe(false);
  });

  it("filters booking starts that overlap occupied sessions or holds", () => {
    const starts = [
      new Date("2026-08-06T16:00:00.000Z"),
      new Date("2026-08-06T18:00:00.000Z"),
      new Date("2026-08-06T20:00:00.000Z"),
    ];

    const available = filterNonOverlappingBookingStarts(starts, 60 * 60 * 1000, [
      {
        start_time: "2026-08-06T16:30:00.000Z",
        end_time: "2026-08-06T17:30:00.000Z",
      },
      {
        start_time: "2026-08-06T19:00:00.000Z",
        end_time: "2026-08-06T20:30:00.000Z",
      },
    ]);

    expect(available.map((start) => start.toISOString())).toEqual(["2026-08-06T18:00:00.000Z"]);
  });

  it("keeps adjacent booking starts and ignores malformed occupied ranges", () => {
    const starts = [
      new Date("2026-08-06T16:00:00.000Z"),
      new Date("2026-08-06T17:00:00.000Z"),
    ];

    const available = filterNonOverlappingBookingStarts(starts, 60 * 60 * 1000, [
      {
        start_time: "2026-08-06T15:00:00.000Z",
        end_time: "2026-08-06T16:00:00.000Z",
      },
      {
        start_time: "not-a-date",
        end_time: "2026-08-06T17:30:00.000Z",
      },
      {
        start_time: "2026-08-06T18:00:00.000Z",
        end_time: "2026-08-06T19:00:00.000Z",
      },
    ]);

    expect(available.map((start) => start.toISOString())).toEqual([
      "2026-08-06T16:00:00.000Z",
      "2026-08-06T17:00:00.000Z",
    ]);
  });

  it("builds the hosted conflict preflight filters used for sessions and active holds", () => {
    expect(
      buildBookingConflictWindowFilters({
        therapistId: "therapist-123",
        clientId: "client-456",
        minStartIso: "2026-08-06T16:00:00.000Z",
        maxEndIso: "2026-08-20T21:00:00.000Z",
        nowIso: "2026-07-04T22:00:00.000Z",
      }),
    ).toEqual({
      participantFilter: "therapist_id.eq.therapist-123,client_id.eq.client-456",
      minStartIso: "2026-08-06T16:00:00.000Z",
      maxEndIso: "2026-08-20T21:00:00.000Z",
      activeHoldExpiresAfterIso: "2026-07-04T22:00:00.000Z",
    });
  });

  it("tries the next lifecycle target pair when every available start was blocked in the UI", () => {
    expect(
      shouldTryNextLifecyclePairAfterAttempts({
        attemptedStartCount: 3,
        blockedAttemptCount: 3,
        payloadStatus: null,
      }),
    ).toBe(true);

    expect(
      shouldTryNextLifecyclePairAfterAttempts({
        attemptedStartCount: 3,
        blockedAttemptCount: 2,
        payloadStatus: null,
      }),
    ).toBe(false);
  });

  it("bounds hosted lifecycle target pair attempts", () => {
    expect(hasReachedLifecyclePairAttemptLimit({ attemptedPairCount: 2, maxPairAttempts: 3 })).toBe(false);
    expect(hasReachedLifecyclePairAttemptLimit({ attemptedPairCount: 3, maxPairAttempts: 3 })).toBe(true);
    expect(hasReachedLifecyclePairAttemptLimit({ attemptedPairCount: 1, maxPairAttempts: 0 })).toBe(true);
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
