import { describe, expect, it } from "vitest";
import {
  formatSessionLocalInput,
  getDefaultSessionEndTime,
  normalizeQuarterHourLocalInput,
  toUtcSessionIsoString,
} from "../time";

describe("scheduling time domain helpers", () => {
  it("formats UTC ISO values into local datetime input", () => {
    const formatted = formatSessionLocalInput("2026-03-20T15:00:00.000Z", "America/New_York");
    expect(formatted).toMatch(/^2026-03-20T/);
  });

  it("converts local datetime input to UTC ISO", () => {
    const utcIso = toUtcSessionIsoString("2026-03-20T11:00", "America/New_York");
    expect(utcIso).toBe("2026-03-20T15:00:00.000Z");
  });

  it("returns one-hour default end time", () => {
    const endTime = getDefaultSessionEndTime("2026-03-20T10:30");
    expect(endTime).toBe("2026-03-20T11:30");
  });

  it("rounds start input to nearest quarter hour and updates end", () => {
    const normalized = normalizeQuarterHourLocalInput("2026-03-20T10:07", "America/New_York");
    expect(normalized.normalizedStart.endsWith(":00") || normalized.normalizedStart.endsWith(":15")).toBe(true);
    expect(normalized.normalizedEnd).not.toBe(normalized.normalizedStart);
  });
});

