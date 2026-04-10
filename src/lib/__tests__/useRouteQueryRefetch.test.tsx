import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { getRouteInvalidationKeys, useRouteQueryRefetch } from "../useRouteQueryRefetch";

const invalidateQueries = vi.fn();
let pathname = "/";

vi.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries,
  }),
}));

const HookHarness: React.FC = () => {
  useRouteQueryRefetch();
  return null;
};

describe("getRouteInvalidationKeys", () => {
  it("returns dashboard keys for the index route only", () => {
    expect(getRouteInvalidationKeys("/")).toEqual([
      ["dashboard"],
      ["session-metrics"],
      ["dropdowns"],
    ]);
  });

  it("returns scoped keys for schedule route", () => {
    expect(getRouteInvalidationKeys("/schedule")).toEqual([
      ["sessions"],
      ["sessions-batch"],
      ["dropdowns"],
    ]);
  });

  it("matches nested client routes to client-owned invalidations", () => {
    expect(getRouteInvalidationKeys("/clients/123")).toEqual([
      ["clients"],
      ["dropdowns"],
    ]);
  });

  it("returns scoped keys for reports route", () => {
    expect(getRouteInvalidationKeys("/reports/monthly")).toEqual([
      ["session-metrics"],
      ["dropdowns"],
    ]);
  });

  it("matches nested settings routes to settings-owned invalidations", () => {
    expect(getRouteInvalidationKeys("/settings/organizations")).toEqual([
      ["settings"],
    ]);
  });

  it("does not invalidate dashboard data for unrelated authenticated routes", () => {
    expect(getRouteInvalidationKeys("/documentation")).toEqual([]);
  });
});

describe("useRouteQueryRefetch", () => {
  beforeEach(() => {
    invalidateQueries.mockClear();
    pathname = "/";
  });

  it("invalidates dashboard-owned queries on the index route", () => {
    render(<HookHarness />);

    expect(invalidateQueries).toHaveBeenCalledTimes(3);
    expect(invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: ["dashboard"],
      refetchType: "active",
    });
    expect(invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: ["session-metrics"],
      refetchType: "active",
    });
    expect(invalidateQueries).toHaveBeenNthCalledWith(3, {
      queryKey: ["dropdowns"],
      refetchType: "active",
    });
  });

  it("skips invalidation for unrelated routes", () => {
    pathname = "/documentation";

    render(<HookHarness />);

    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
