import { describe, expect, it } from "vitest";
import { getRouteInvalidationKeys } from "../useRouteQueryRefetch";

describe("getRouteInvalidationKeys", () => {
  it("returns scoped keys for schedule route", () => {
    expect(getRouteInvalidationKeys("/schedule")).toEqual([
      ["sessions"],
      ["sessions-batch"],
      ["dropdowns"],
    ]);
  });

  it("returns scoped keys for reports route", () => {
    expect(getRouteInvalidationKeys("/reports/monthly")).toEqual([
      ["session-metrics"],
      ["dropdowns"],
      ["sessions"],
    ]);
  });

  it("falls back to dashboard keys for unknown routes", () => {
    expect(getRouteInvalidationKeys("/unknown-path")).toEqual([["dashboard"]]);
  });
});
