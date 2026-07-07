import { describe, expect, it } from "vitest";
import { getUpcomingReportStatus } from "../client-report-status";

describe("getUpcomingReportStatus", () => {
  it("flags a client auth end date within 30 days", () => {
    expect(getUpcomingReportStatus({
      today: "2026-07-07",
      clientAuthEndDate: "2026-08-01",
      authorizationEndDates: [],
    })).toEqual({
      upcoming: true,
      source: "client",
      endDate: "2026-08-01",
      daysRemaining: 25,
    });
  });

  it("uses the soonest active authorization date when it is earlier than the client date", () => {
    expect(getUpcomingReportStatus({
      today: "2026-07-07",
      clientAuthEndDate: "2026-08-01",
      authorizationEndDates: ["2026-07-20", "2026-10-01"],
    })).toEqual({
      upcoming: true,
      source: "authorization",
      endDate: "2026-07-20",
      daysRemaining: 13,
    });
  });

  it("does not flag expired or distant dates", () => {
    expect(getUpcomingReportStatus({
      today: "2026-07-07",
      clientAuthEndDate: "2026-09-15",
      authorizationEndDates: ["2026-07-01"],
    })).toEqual({
      upcoming: false,
      source: null,
      endDate: null,
      daysRemaining: null,
    });
  });
});
