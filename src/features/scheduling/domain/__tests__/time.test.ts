import { describe, expect, it } from "vitest";
import {
  addMinutesToLocalInput,
  diffMinutesBetweenLocalInputs,
  formatSessionLocalInput,
  formatSessionNoteTiming,
  getDefaultSessionEndTime,
  normalizeQuarterHourLocalInput,
  resolveSchedulingTimeZone,
  toUtcSessionIsoString,
} from "../time";

describe("scheduling time domain helpers", () => {
  it("formats UTC ISO values into local datetime input", () => {
    const formatted = formatSessionLocalInput("2026-03-20T15:00:00.000Z", "America/New_York");
    expect(formatted).toMatch(/^2026-03-20T/);
  });

  it("returns empty local input for missing or invalid ISO values", () => {
    expect(formatSessionLocalInput(null, "America/New_York")).toBe("");
    expect(formatSessionLocalInput(undefined, "America/New_York")).toBe("");
    expect(formatSessionLocalInput("not-a-date", "America/New_York")).toBe("");
  });

  it("converts local datetime input to UTC ISO", () => {
    const utcIso = toUtcSessionIsoString("2026-03-20T11:00", "America/New_York");
    expect(utcIso).toBe("2026-03-20T15:00:00.000Z");
  });

  it("returns empty UTC values for missing or invalid local inputs", () => {
    expect(toUtcSessionIsoString(undefined, "America/New_York")).toBe("");
    expect(toUtcSessionIsoString("not-a-date", "America/New_York")).toBe("");
  });

  it("returns one-hour default end time", () => {
    const endTime = getDefaultSessionEndTime("2026-03-20T10:30");
    expect(endTime).toBe("2026-03-20T11:30");
  });

  it("returns empty default end time when start is missing", () => {
    expect(getDefaultSessionEndTime("")).toBe("");
  });

  it("formats session-note timing in the scheduling timezone", () => {
    expect(
      formatSessionNoteTiming({
        startTimeIso: "2026-07-23T21:00:00.000Z",
        endTimeIso: "2026-07-23T22:00:00.000Z",
        resolvedTimeZone: "America/Los_Angeles",
      }),
    ).toEqual({
      sessionDate: "2026-07-23",
      startTime: "14:00:00",
      endTime: "15:00:00",
    });
  });

  it("preserves legacy UTC timing across the spring-forward DST gap", () => {
    expect(
      formatSessionNoteTiming({
        startTimeIso: "2026-03-08T09:30:00.000Z",
        endTimeIso: "2026-03-08T10:30:00.000Z",
        resolvedTimeZone: "America/Los_Angeles",
      }),
    ).toEqual({
      sessionDate: "2026-03-08",
      startTime: "09:30:00",
      endTime: "10:30:00",
    });
  });

  it("preserves legacy UTC timing across the fall-back DST overlap", () => {
    expect(
      formatSessionNoteTiming({
        startTimeIso: "2026-11-01T08:30:00.000Z",
        endTimeIso: "2026-11-01T09:30:00.000Z",
        resolvedTimeZone: "America/Los_Angeles",
      }),
    ).toEqual({
      sessionDate: "2026-11-01",
      startTime: "08:30:00",
      endTime: "09:30:00",
    });
  });

  it("preserves legacy UTC timing when local times cross midnight", () => {
    expect(
      formatSessionNoteTiming({
        startTimeIso: "2026-07-24T06:30:00.000Z",
        endTimeIso: "2026-07-24T08:30:00.000Z",
        resolvedTimeZone: "America/Los_Angeles",
      }),
    ).toEqual({
      sessionDate: "2026-07-24",
      startTime: "06:30:00",
      endTime: "08:30:00",
    });
  });

  it("rejects invalid or reversed session-note timing", () => {
    expect(() => formatSessionNoteTiming({
      startTimeIso: "not-a-date",
      endTimeIso: "2026-07-23T22:00:00.000Z",
      resolvedTimeZone: "America/Los_Angeles",
    })).toThrow("valid ISO datetimes");

    expect(() => formatSessionNoteTiming({
      startTimeIso: "2026-07-23T22:00:00.000Z",
      endTimeIso: "2026-07-23T21:00:00.000Z",
      resolvedTimeZone: "America/Los_Angeles",
    })).toThrow("later than start time");
  });

  it("resolves explicit and runtime scheduling timezones", () => {
    expect(resolveSchedulingTimeZone("America/Los_Angeles")).toBe("America/Los_Angeles");
    expect(resolveSchedulingTimeZone()).toEqual(expect.any(String));
  });

  it("calculates minute differences between local inputs", () => {
    expect(diffMinutesBetweenLocalInputs("2026-03-20T10:00", "2026-03-20T11:30", "America/New_York")).toBe(90);
    expect(diffMinutesBetweenLocalInputs("", "2026-03-20T11:30", "America/New_York")).toBeNull();
    expect(diffMinutesBetweenLocalInputs("not-a-date", "2026-03-20T11:30", "America/New_York")).toBeNull();
  });

  it("adds minutes to local datetime inputs in the scheduling timezone", () => {
    expect(addMinutesToLocalInput("2026-03-20T10:30", 45, "America/New_York")).toBe("2026-03-20T11:15");
  });

  it("rounds local input to nearest quarter hour", () => {
    const normalized = normalizeQuarterHourLocalInput("2026-03-20T10:07", "America/New_York");
    expect(normalized.endsWith(":00") || normalized.endsWith(":15")).toBe(true);
  });

  it("rounds local input across the hour when nearest quarter is next hour", () => {
    expect(normalizeQuarterHourLocalInput("2026-03-20T10:53", "America/New_York")).toBe("2026-03-20T11:00");
  });
});

