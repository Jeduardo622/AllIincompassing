import { describe, expect, it, beforeEach, vi } from "vitest";
import { renderWithProviders, screen } from "../../test/utils";
import userEvent from "@testing-library/user-event";

const mockUseScheduleDataBatch = vi.fn();
const mockUseSessionsOptimized = vi.fn();
const mockUseDropdownData = vi.fn();
const mockUseActiveOrganizationId = vi.fn(() => "org-1");
let sessionModalLoadCount = 0;

vi.mock("../../lib/optimizedQueries", () => ({
  useScheduleDataBatch: (...args: unknown[]) => mockUseScheduleDataBatch(...args),
  useSessionsOptimized: (...args: unknown[]) => mockUseSessionsOptimized(...args),
  useDropdownData: (...args: unknown[]) => mockUseDropdownData(...args),
  useSmartPrefetch: () => ({
    prefetchScheduleRange: vi.fn(),
    prefetchNextWeek: vi.fn(),
    prefetchReportData: vi.fn(),
  }),
}));

vi.mock("../../lib/organization", () => ({
  useActiveOrganizationId: () => mockUseActiveOrganizationId(),
}));

vi.mock("../../components/SessionModal", () => {
  sessionModalLoadCount += 1;
  return {
    SessionModal: ({
      isOpen,
      selectedTime,
    }: {
      isOpen: boolean;
      selectedTime?: string;
    }) => (isOpen ? <div data-testid="session-modal">Session modal for {selectedTime}</div> : null),
  };
});

import { Schedule } from "../Schedule";

const scheduleFixtures = {
  sessions: [
    {
      id: "session-1",
      therapist_id: "therapist-1",
      client_id: "client-1",
      program_id: "program-1",
      goal_id: "goal-1",
      start_time: "2025-07-01T10:00:00Z",
      end_time: "2025-07-01T11:00:00Z",
      status: "scheduled" as const,
      notes: "",
      created_at: "2025-06-01T00:00:00Z",
      updated_at: "2025-06-01T00:00:00Z",
      therapist: { id: "therapist-1", full_name: "Dr. Myles" },
      client: { id: "client-1", full_name: "Jamie Client" },
    },
  ],
  therapists: [
    {
      id: "therapist-1",
      full_name: "Dr. Myles",
      email: "myles@example.com",
      availability_hours: {},
    },
  ],
  clients: [
    {
      id: "client-1",
      full_name: "Jamie Client",
      email: "jamie@example.com",
      availability_hours: {},
      service_preference: [],
    },
  ],
};

describe("Schedule lazy session modal", () => {
  beforeEach(() => {
    sessionModalLoadCount = 0;
    mockUseActiveOrganizationId.mockReturnValue("org-1");
    mockUseScheduleDataBatch.mockReturnValue({
      data: scheduleFixtures,
      isLoading: false,
      refetch: vi.fn(),
    });
    mockUseSessionsOptimized.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseDropdownData.mockReturnValue({
      data: { therapists: scheduleFixtures.therapists, clients: scheduleFixtures.clients },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it("defers loading the session editor module until a modal open path is requested", async () => {
    renderWithProviders(<Schedule />);

    await screen.findByRole("heading", { name: /Schedule/i });
    expect(sessionModalLoadCount).toBe(0);

    const addButtons = await screen.findAllByLabelText("Add session");
    await userEvent.click(addButtons[0]);

    expect(await screen.findByTestId("session-modal")).toHaveTextContent("Session modal for 08:00");
    expect(sessionModalLoadCount).toBe(1);
  });
});
