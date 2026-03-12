import { describe, expect, it } from "vitest";
import { __TESTING__ } from "../ReportsSummary";

describe("ReportsSummary metric coercion helpers", () => {
  it("coerces first row from RPC table response", () => {
    const row = __TESTING__.coerceMetricsRow([
      { total_sessions: 10, completed_sessions: 6 },
      { total_sessions: 100 },
    ]);

    expect(row).toMatchObject({ total_sessions: 10, completed_sessions: 6 });
  });

  it("normalizes JSON aggregate keys and values", () => {
    const map = __TESTING__.toCountMap({
      " Monday ": 7,
      Tuesday: 3,
      Wednesday: null,
    });

    expect(map).toEqual({ Monday: 7, Tuesday: 3 });
  });
});
