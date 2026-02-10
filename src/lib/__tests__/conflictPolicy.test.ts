import { describe, expect, it, vi } from "vitest";
import { buildSchedulingConflictHint } from "../conflictPolicy";

describe("buildSchedulingConflictHint", () => {
  it("falls back to default hint when no metadata is present", () => {
    const hint = buildSchedulingConflictHint(null, "fallback hint");
    expect(hint).toBe("fallback hint");
  });

  it("appends retry-after guidance from retryAfterSeconds", () => {
    const hint = buildSchedulingConflictHint(
      { retryHint: "Slot unavailable", retryAfterSeconds: 45 },
      "fallback hint",
    );
    expect(hint).toContain("Slot unavailable");
    expect(hint).toContain("Retry in about 45 seconds.");
  });

  it("appends rollback guidance from orchestration payload", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-10T12:00:00.000Z"));

    const hint = buildSchedulingConflictHint(
      {
        retryHint: "Conflict detected",
        retryAfter: "2026-02-10T12:02:00.000Z",
        orchestration: {
          rollbackPlan: {
            guidance: "Retry with alternate time suggestions.",
          },
        },
      },
      "fallback hint",
    );

    expect(hint).toContain("Conflict detected");
    expect(hint).toContain("Retry in about 2 minutes.");
    expect(hint).toContain("Retry with alternate time suggestions.");
    vi.useRealTimers();
  });
});
