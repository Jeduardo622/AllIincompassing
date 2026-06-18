import { describe, expect, it } from "vitest";
import { formatInTimeZone } from "date-fns-tz";

import {
  buildVisibleScheduleBookingAttemptStart,
  buildVisibleScheduleBookingBaseStart,
  resolveBrowserScheduleTimeZone,
} from "../../../scripts/lib/playwright-inprogress-session-setup";

describe("playwright in-progress session setup", () => {
  it("chooses a future base start inside the rendered schedule grid timezone", () => {
    const now = new Date("2026-06-18T23:30:00.000Z");
    const timeZone = "America/Los_Angeles";

    for (let seed = 0; seed < 24; seed += 1) {
      const start = buildVisibleScheduleBookingBaseStart(now, seed, timeZone);
      const localHour = Number(formatInTimeZone(start, timeZone, "H"));

      expect(start.getTime()).toBeGreaterThan(now.getTime());
      expect(formatInTimeZone(start, timeZone, "m")).toBe("0");
      expect(formatInTimeZone(start, timeZone, "s")).toBe("0");
      expect(localHour).toBeGreaterThanOrEqual(8);
      expect(localHour).toBeLessThan(18);
    }
  });

  it("keeps retry attempts inside rendered schedule grid hours", () => {
    const timeZone = "America/Los_Angeles";
    const baseStart = new Date("2026-06-18T23:00:00.000Z");

    for (let attempt = 0; attempt < 48; attempt += 1) {
      const start = buildVisibleScheduleBookingAttemptStart(baseStart, attempt, timeZone);
      const localHour = Number(formatInTimeZone(start, timeZone, "H"));

      expect(start.getTime()).toBeGreaterThanOrEqual(baseStart.getTime());
      expect(formatInTimeZone(start, timeZone, "m")).toBe("0");
      expect(formatInTimeZone(start, timeZone, "s")).toBe("0");
      expect(localHour).toBeGreaterThanOrEqual(8);
      expect(localHour).toBeLessThan(18);
    }
  });

  it("uses the browser timezone as the schedule grid timezone source", async () => {
    await expect(resolveBrowserScheduleTimeZone({
      evaluate: async (callback: () => string | null) => callback(),
    })).resolves.toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);

    await expect(resolveBrowserScheduleTimeZone({
      evaluate: async () => "America/New_York",
    })).resolves.toBe("America/New_York");

    await expect(resolveBrowserScheduleTimeZone({
      evaluate: async () => "",
    })).resolves.toBe("UTC");
  });
});
