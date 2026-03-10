import React from "react";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCapturePendingScheduleEvent } from "../schedule-state";

function Harness() {
  useCapturePendingScheduleEvent();
  return null;
}

describe("useCapturePendingScheduleEvent", () => {
  afterEach(() => {
    localStorage.removeItem("pendingSchedule");
  });

  it("persists openScheduleModal detail in localStorage", () => {
    render(<Harness />);
    const detail = { clientId: "client-1", therapistId: "therapist-1" };
    document.dispatchEvent(new CustomEvent("openScheduleModal", { detail }));
    expect(JSON.parse(localStorage.getItem("pendingSchedule") ?? "{}")).toEqual(detail);
  });

  it("swallows localStorage write failures", () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    render(<Harness />);
    expect(() =>
      document.dispatchEvent(new CustomEvent("openScheduleModal", { detail: { id: "abc" } })),
    ).not.toThrow();
    setItemSpy.mockRestore();
  });
});

