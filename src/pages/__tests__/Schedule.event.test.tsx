import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLocation } from "react-router-dom";
import { renderWithProviders, screen, userEvent, waitFor } from "../../test/utils";

vi.mock("../../lib/optimizedQueries", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../lib/optimizedQueries")>();
  return {
    ...actual,
    useSmartPrefetch: () => ({
      prefetchScheduleRange: vi.fn(),
      prefetchNextWeek: vi.fn(),
      prefetchReportData: vi.fn(),
    }),
  };
});

vi.mock("../../components/SessionModal", () => ({
  SessionModal: ({
    isOpen,
    onClose,
  }: {
    isOpen: boolean;
    onClose: () => void;
  }) =>
    isOpen ? (
      <div data-testid="event-session-modal">
        <h2>New Session</h2>
        <label htmlFor="event-session-start-time">Start Time</label>
        <input
          id="event-session-start-time"
          aria-label="Start Time"
          defaultValue="10:00"
        />
        <button aria-label="Close session modal" onClick={onClose}>
          Close
        </button>
      </div>
    ) : null,
}));

import { Schedule } from "../Schedule";

// Integration test for event-based scheduling
function SearchProbe() {
  const location = useLocation();
  return <output data-testid="schedule-search">{location.search}</output>;
}

describe("Schedule page event listener", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });
  it("opens session modal when openScheduleModal event is dispatched", async () => {
    renderWithProviders(
      <>
        <Schedule />
        <SearchProbe />
      </>,
    );

    // Wait for the page to finish loading
    await screen.findByRole("heading", { name: /Schedule/i });

    const detail = {
      therapist_id: "t1",
      client_id: "c1",
      program_id: "program-1",
      goal_id: "goal-1",
      start_time: "2025-03-18T10:00:00Z",
      end_time: "2025-03-18T11:00:00Z",
    };

    await waitFor(() => {
      window.dispatchEvent(new CustomEvent("openScheduleModal", { detail }));
      expect(screen.getByText(/New Session/i)).toBeInTheDocument();
    });

    // Modal should open with default start time populated
    const input = screen.getByLabelText(/Start Time/i) as HTMLInputElement;
    expect(input.value).not.toBe("");
  });

  it("opens modal based on pendingSchedule in localStorage", async () => {
    const detail = {
      therapist_id: "t1",
      client_id: "c1",
      program_id: "program-1",
      goal_id: "goal-1",
      start_time: "2025-03-18T10:00:00Z",
      end_time: "2025-03-18T11:00:00Z",
    };
    localStorage.setItem("pendingSchedule", JSON.stringify(detail));

    renderWithProviders(
      <>
        <Schedule />
        <SearchProbe />
      </>,
    );
    await screen.findByRole("heading", { name: /Schedule/i });

    await waitFor(async () => {
      expect(await screen.findByText(/New Session/i)).toBeInTheDocument();
      expect(localStorage.getItem("pendingSchedule")).toBeNull();
    });
  });

  it("opens create modal when query params request URL-addressable schedule state", async () => {
    const expiresAtMs = Date.now() + 60_000;
    const startTime = encodeURIComponent("2025-03-18T10:00:00.000Z");
    renderWithProviders(
      <>
        <Schedule />
        <SearchProbe />
      </>,
      {
        router: {
          initialEntries: [
            `/?scheduleModal=create&scheduleStart=${startTime}&scheduleExp=${expiresAtMs}`,
          ],
        },
      },
    );

    await screen.findByRole("heading", { name: /Schedule/i });
    expect(await screen.findByText(/New Session/i)).toBeInTheDocument();
  });

  it("clears expired URL modal params without opening the modal", async () => {
    const expiresAtMs = Date.now() - 1_000;
    const startTime = encodeURIComponent("2025-03-18T10:00:00.000Z");
    renderWithProviders(
      <>
        <Schedule />
        <SearchProbe />
      </>,
      {
        router: {
          initialEntries: [
            `/?scheduleModal=create&scheduleStart=${startTime}&scheduleExp=${expiresAtMs}`,
          ],
        },
      },
    );

    await screen.findByRole("heading", { name: /Schedule/i });
    await waitFor(() => {
      expect(screen.getByTestId("schedule-search").textContent).toBe("");
    });
    expect(screen.queryByText(/New Session/i)).not.toBeInTheDocument();
  });

  it("removes URL modal params when modal closes", async () => {
    const expiresAtMs = Date.now() + 60_000;
    const startTime = encodeURIComponent("2025-03-18T10:00:00.000Z");
    renderWithProviders(
      <>
        <Schedule />
        <SearchProbe />
      </>,
      {
        router: {
          initialEntries: [
            `/?scheduleModal=create&scheduleStart=${startTime}&scheduleExp=${expiresAtMs}`,
          ],
        },
      },
    );

    await screen.findByRole("heading", { name: /Schedule/i });
    await screen.findByText(/New Session/i);
    await userEvent.click(screen.getByLabelText(/Close session modal/i));
    await waitFor(() => {
      expect(screen.getByTestId("schedule-search").textContent).toBe("");
    });
  });
});

