import { describe, it, expect } from "vitest";
import { getSessionStatusClasses } from "../ScheduleSessionStatusStyles";

describe("getSessionStatusClasses", () => {
  it("returns distinct card classes for all five statuses", () => {
    const statuses = ["scheduled", "in_progress", "completed", "cancelled", "no-show"] as const;
    const cardClasses = statuses.map((s) => getSessionStatusClasses(s).card);
    expect(new Set(cardClasses).size).toBe(5);
  });

  it("maps each status to the expected color family", () => {
    expect(getSessionStatusClasses("scheduled").card).toContain("blue");
    expect(getSessionStatusClasses("in_progress").card).toContain("emerald");
    expect(getSessionStatusClasses("completed").card).toContain("gray");
    expect(getSessionStatusClasses("cancelled").card).toContain("red");
    expect(getSessionStatusClasses("no-show").card).toContain("amber");
  });

  it("returns consistent secondary and time classes per status", () => {
    const inProgress = getSessionStatusClasses("in_progress");
    expect(inProgress.secondary).toContain("emerald");
    expect(inProgress.time).toContain("emerald");

    const cancelled = getSessionStatusClasses("cancelled");
    expect(cancelled.secondary).toContain("red");
    expect(cancelled.time).toContain("red");
  });

  it("falls back to scheduled styles for an unrecognized status", () => {
    // @ts-expect-error intentional unknown status for fallback coverage
    const result = getSessionStatusClasses("unknown_status");
    expect(result).toEqual(getSessionStatusClasses("scheduled"));
  });
});
