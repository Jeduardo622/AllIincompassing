import { describe, it, expect } from "vitest";
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

    renderWithProviders(<Schedule />);
    await screen.findByRole("heading", { name: /Schedule/i });

    expect(await screen.findByText(/New Session/i)).toBeInTheDocument();
    expect(localStorage.getItem("pendingSchedule")).toBeNull();
  });
});
