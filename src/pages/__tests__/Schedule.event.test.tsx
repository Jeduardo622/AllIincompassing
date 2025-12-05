import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen } from "../../test/utils";
import Schedule from "../Schedule";

// Integration test for event-based scheduling

describe("Schedule page event listener", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });
  it("opens session modal when openScheduleModal event is dispatched", async () => {
    renderWithProviders(<Schedule />);

    // Wait for the page to finish loading
    await screen.findByRole("heading", { name: /Schedule/i });

    const detail = {
      therapist_id: "t1",
      client_id: "c1",
      start_time: "2025-03-18T10:00:00Z",
      end_time: "2025-03-18T11:00:00Z",
    };

    document.dispatchEvent(new CustomEvent("openScheduleModal", { detail }));

    // Modal should open with default start time populated
    expect(await screen.findByText(/New Session/i)).toBeInTheDocument();
    const input = screen.getByLabelText(/Start Time/i) as HTMLInputElement;
    expect(input.value).not.toBe("");
  });

  it("opens modal based on pendingSchedule in localStorage", async () => {
    const detail = {
      therapist_id: "t1",
      client_id: "c1",
      start_time: "2025-03-18T10:00:00Z",
      end_time: "2025-03-18T11:00:00Z",
    };
    localStorage.setItem("pendingSchedule", JSON.stringify(detail));

    const realSetTimeout = window.setTimeout;
    const timeoutSpy = vi
      .spyOn(window, "setTimeout")
      .mockImplementation((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
        if (typeof timeout === "number" && timeout === 300) {
          if (typeof handler === "function") {
            handler(...(args as []));
          }
          return 0 as unknown as ReturnType<typeof setTimeout>;
        }
        return realSetTimeout(handler, timeout as number, ...(args as []));
      });

    try {
      renderWithProviders(<Schedule />);
      await screen.findByRole("heading", { name: /Schedule/i });
      expect(await screen.findByText(/New Session/i)).toBeInTheDocument();
      expect(localStorage.getItem("pendingSchedule")).toBeNull();
    } finally {
      timeoutSpy.mockRestore();
    }
  });
});
