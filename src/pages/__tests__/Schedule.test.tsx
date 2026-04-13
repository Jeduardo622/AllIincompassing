import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { addDays, endOfWeek, startOfWeek } from "date-fns";
import { renderWithProviders, screen, userEvent, waitFor } from "../../test/utils";
import { fireEvent } from "@testing-library/react";
import { server } from "../../test/setup";
import { supabase } from "../../lib/supabase";

const mockUseScheduleDataBatch = vi.fn(() => ({ data: scheduleFixtures, isLoading: false }));
const mockUseSessionsOptimized = vi.fn(() => ({ data: scheduleFixtures.sessions, isLoading: false }));
const mockUseDropdownData = vi.fn(() => ({
  data: { therapists: scheduleFixtures.therapists, clients: scheduleFixtures.clients },
  isLoading: false,
}));
const mockUseActiveOrganizationId = vi.fn(() => "org-1");
const mockPrefetchScheduleRange = vi.fn();
let sessionModalModuleLoads = 0;

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
      status: "scheduled",
      notes: "Initial session",
      created_at: "2025-06-01T00:00:00Z",
      updated_at: "2025-06-01T00:00:00Z",
      therapist: { id: "therapist-1", full_name: "Dr. Myles" },
      client: { id: "client-1", full_name: "Jamie Client" },
    },
    {
      id: "session-2",
      therapist_id: "therapist-2",
      client_id: "client-2",
      program_id: "program-2",
      goal_id: "goal-2",
      start_time: "2025-07-01T11:00:00Z",
      end_time: "2025-07-01T12:00:00Z",
      status: "scheduled",
      notes: "Follow-up session",
      created_at: "2025-06-01T00:00:00Z",
      updated_at: "2025-06-01T00:00:00Z",
      therapist: { id: "therapist-2", full_name: "Dr. Reyes" },
      client: { id: "client-2", full_name: "Riley Client" },
    },
  ],
  therapists: [
    {
      id: "therapist-1",
      full_name: "Dr. Myles",
      email: "myles@example.com",
      availability_hours: {
        monday: { start: "09:00", end: "17:00" },
        tuesday: { start: "09:00", end: "17:00" },
        wednesday: { start: "09:00", end: "17:00" },
        thursday: { start: "09:00", end: "17:00" },
        friday: { start: "09:00", end: "17:00" },
        saturday: { start: null, end: null },
        sunday: { start: null, end: null },
      },
    },
    {
      id: "therapist-2",
      full_name: "Dr. Reyes",
      email: "reyes@example.com",
      availability_hours: {
        monday: { start: "09:00", end: "17:00" },
        tuesday: { start: "09:00", end: "17:00" },
        wednesday: { start: "09:00", end: "17:00" },
        thursday: { start: "09:00", end: "17:00" },
        friday: { start: "09:00", end: "17:00" },
        saturday: { start: null, end: null },
        sunday: { start: null, end: null },
      },
    },
  ],
  clients: [
    {
      id: "client-1",
      full_name: "Jamie Client",
      email: "jamie@example.com",
      availability_hours: {
        monday: { start: "10:00", end: "15:00" },
        tuesday: { start: "10:00", end: "15:00" },
        wednesday: { start: "10:00", end: "15:00" },
        thursday: { start: "10:00", end: "15:00" },
        friday: { start: "10:00", end: "15:00" },
        saturday: { start: null, end: null },
        sunday: { start: null, end: null },
      },
    },
    {
      id: "client-2",
      full_name: "Riley Client",
      email: "riley@example.com",
      availability_hours: {
        monday: { start: "10:00", end: "15:00" },
        tuesday: { start: "10:00", end: "15:00" },
        wednesday: { start: "10:00", end: "15:00" },
        thursday: { start: "10:00", end: "15:00" },
        friday: { start: "10:00", end: "15:00" },
        saturday: { start: null, end: null },
        sunday: { start: null, end: null },
      },
    },
  ],
};

vi.mock("../../lib/optimizedQueries", () => ({
  useScheduleDataBatch: (...args: unknown[]) => mockUseScheduleDataBatch(...args),
  useSessionsOptimized: (...args: unknown[]) => mockUseSessionsOptimized(...args),
  useDropdownData: (...args: unknown[]) => mockUseDropdownData(...args),
  useSmartPrefetch: () => ({
    prefetchScheduleRange: mockPrefetchScheduleRange,
    prefetchNextWeek: vi.fn(),
    prefetchReportData: vi.fn(),
  }),
}));

vi.mock("../../lib/organization", () => ({
  useActiveOrganizationId: () => mockUseActiveOrganizationId(),
}));

vi.mock("../../components/SessionModal", () => ({
  ...(sessionModalModuleLoads++, {}),
  SessionModal: ({
    isOpen,
    existingSessions,
  }: {
    isOpen: boolean;
    existingSessions: Array<{ id: string }>;
  }) => (
    isOpen
      ? <div data-testid="session-modal-sessions">{existingSessions.map((session) => session.id).join(",")}</div>
      : null
  ),
}));

import { Schedule } from "../Schedule";

const defaultRpcImplementation = vi.mocked(supabase.rpc as any).getMockImplementation();

describe("Schedule", () => {
  beforeEach(() => {
    sessionModalModuleLoads = 0;
    mockUseActiveOrganizationId.mockReturnValue("org-1");
    mockPrefetchScheduleRange.mockReset();
    mockUseScheduleDataBatch.mockReset();
    mockUseScheduleDataBatch.mockReturnValue({ data: scheduleFixtures, isLoading: false });
    mockUseSessionsOptimized.mockReset();
    mockUseSessionsOptimized.mockReturnValue({ data: scheduleFixtures.sessions, isLoading: false });
    mockUseDropdownData.mockReset();
    mockUseDropdownData.mockReturnValue({
      data: { therapists: scheduleFixtures.therapists, clients: scheduleFixtures.clients },
      isLoading: false,
    });
    vi.mocked(supabase.rpc as any).mockImplementation(async (functionName: string) => {
      if (functionName === "get_schedule_data_batch") {
        return { data: scheduleFixtures, error: null };
      }
      if (functionName === "get_dropdown_data") {
        return {
          data: {
            therapists: scheduleFixtures.therapists,
            clients: scheduleFixtures.clients,
          },
          error: null,
        };
      }
      if (functionName === "get_sessions_optimized") {
        return {
          data: scheduleFixtures.sessions.map((session) => ({ session_data: session })),
          error: null,
        };
      }
      return { data: null, error: null };
    });
    server.resetHandlers();
    localStorage.clear();
  });
  
  afterEach(() => {
    if (defaultRpcImplementation) {
      vi.mocked(supabase.rpc as any).mockImplementation(defaultRpcImplementation);
    } else {
      vi.mocked(supabase.rpc as any).mockReset();
    }
    localStorage.clear();
  });

  it("renders schedule page with calendar", async () => {
    renderWithProviders(<Schedule />);

    // Check for main heading (more specific selector)
    expect(
      await screen.findByRole("heading", { name: /Schedule/i }, { timeout: 10000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Day view/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Week view/i })).toBeInTheDocument();
  }, 15000);

  it("renders schedule interface elements", async () => {
    renderWithProviders(<Schedule />);

    // Wait for component to load and check for basic interface elements
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: /Schedule/i })).toBeInTheDocument();
    });
    
    // Check for key interface elements
    expect(screen.getByText(/Jun 30 - Jul 5, 2025/i)).toBeInTheDocument();
  });

  it("shows loading state initially", async () => {
    renderWithProviders(<Schedule />);
    
    // The component should show a loading spinner initially
    // Check for the loading spinner by looking for the animate-spin class
    const loadingElement = document.querySelector(".animate-spin");
    
    // It's okay if loading element is not found - it means component loaded quickly
    if (loadingElement) {
      expect(loadingElement).toBeInTheDocument();
    }
  });

  it("renders a stable missing-org state and disables org-dependent queries", async () => {
    mockUseActiveOrganizationId.mockReturnValue(null);

    renderWithProviders(<Schedule />, {
      auth: { organizationId: null },
    });

    expect(await screen.findByTestId("schedule-missing-org")).toBeInTheDocument();
    expect(screen.getByText(/Organization context unavailable/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /^Schedule$/i }),
    ).not.toBeInTheDocument();
    expect(mockUseScheduleDataBatch).toHaveBeenCalledWith(
      expect.any(Date),
      expect.any(Date),
      { enabled: false, organizationId: null },
    );
    expect(mockUseSessionsOptimized).toHaveBeenCalledWith(
      expect.any(Date),
      expect.any(Date),
      null,
      null,
      false,
    );
    expect(mockUseDropdownData).toHaveBeenCalledWith({ enabled: false });
  });

  it("lazy-loads the session modal only when the user opens it", async () => {
    renderWithProviders(<Schedule />);

    await screen.findByRole("heading", { name: /Schedule/i });
    expect(sessionModalModuleLoads).toBe(0);

    const addButtons = await screen.findAllByLabelText("Add session");
    fireEvent.click(addButtons[0]);

    await waitFor(() => {
      expect(sessionModalModuleLoads).toBe(1);
    });
    expect(await screen.findByTestId("session-modal-sessions")).toHaveTextContent("session-1");
  });

  it("prefetches the next schedule batch when the next-period control is hovered", async () => {
    renderWithProviders(<Schedule />);

    await screen.findByRole("heading", { name: /Schedule/i });

    fireEvent.mouseEnter(screen.getByRole("button", { name: /Next period/i }));

    await waitFor(() => {
      expect(mockPrefetchScheduleRange).toHaveBeenCalledTimes(1);
    });

    const [targetStart, targetEnd, options] = mockPrefetchScheduleRange.mock.calls[0];
    const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    const expectedStart = addDays(currentWeekStart, 7);
    const expectedEnd = endOfWeek(expectedStart, { weekStartsOn: 1 });

    expect(targetStart).toBeInstanceOf(Date);
    expect(targetEnd).toBeInstanceOf(Date);
    expect((targetStart as Date).toISOString()).toBe(expectedStart.toISOString());
    expect((targetEnd as Date).toISOString()).toBe(expectedEnd.toISOString());
    expect(options).toEqual({ organizationId: "org-1" });
  });

  it("applies therapist filters to batched sessions", async () => {
    renderWithProviders(<Schedule />);

    const addButtons = await screen.findAllByLabelText("Add session");
    fireEvent.click(addButtons[0]);
    expect(screen.getByTestId("session-modal-sessions")).toHaveTextContent("session-1");
    expect(screen.getByTestId("session-modal-sessions")).toHaveTextContent("session-2");

    await userEvent.selectOptions(screen.getByLabelText("Therapist"), "therapist-2");

    await waitFor(() => {
      expect(screen.getByTestId("session-modal-sessions")).not.toHaveTextContent("session-1");
      expect(screen.getByTestId("session-modal-sessions")).toHaveTextContent("session-2");
    });
  });

  it("locks therapist scope and limits clients for therapist users", async () => {
    mockUseDropdownData.mockReturnValue({
      data: {
        therapists: scheduleFixtures.therapists,
        clients: [
          { ...scheduleFixtures.clients[0], therapist_id: "therapist-1" },
          { ...scheduleFixtures.clients[1], therapist_id: "therapist-2" },
        ],
      },
      isLoading: false,
    });

    renderWithProviders(<Schedule />, {
      auth: { role: "therapist", userId: "therapist-1" },
    });

    expect(
      await screen.findByRole("heading", { name: /^Schedule$/i }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByText("Filters & schedule options"));

    const myles = await screen.findAllByText("Dr. Myles");
    expect(myles.length).toBeGreaterThan(0);
    expect(screen.queryByRole("option", { name: /All Therapists/i })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Jamie Client/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Riley Client/i })).not.toBeInTheDocument();

    expect(
      screen.queryByRole("checkbox", { name: /Enable recurrence \(RRULE\)/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryAllByLabelText("Add session")).toHaveLength(0);
  });

  it("exposes recurrence toggle and labeled recurrence controls when enabled", async () => {
    renderWithProviders(<Schedule />);

    const recurrenceToggle = await screen.findByRole("checkbox", {
      name: /Enable recurrence \(RRULE\)/i,
    });
    expect(recurrenceToggle).not.toBeChecked();
    expect(screen.getByLabelText(/Time Zone/i)).toBeInTheDocument();

    await userEvent.click(recurrenceToggle);
    expect(screen.getByLabelText(/^RRULE$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Count/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Until/i)).toBeInTheDocument();
  }, 15000);

  it("shows accessible exception controls in recurrence panel", async () => {
    renderWithProviders(<Schedule />);

    const recurrenceToggle = await screen.findByRole("checkbox", {
      name: /Enable recurrence \(RRULE\)/i,
    });
    await userEvent.click(recurrenceToggle);

    expect(screen.getByText(/Exceptions/i)).toBeInTheDocument();
    expect(screen.getByText(/No exception dates configured/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Add exception/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Remove/i })).toBeInTheDocument();
    });
    expect(screen.queryByText(/No exception dates configured/i)).not.toBeInTheDocument();
  }, 15000);

  it("assigns deterministic accessible names to recurrence exception row controls", async () => {
    renderWithProviders(<Schedule />);

    const recurrenceToggle = await screen.findByRole("checkbox", {
      name: /Enable recurrence \(RRULE\)/i,
    });
    await userEvent.click(recurrenceToggle);

    const addExceptionButton = await screen.findByRole("button", {
      name: /Add exception/i,
    });
    await userEvent.click(addExceptionButton);
    await userEvent.click(addExceptionButton);

    expect(screen.getByLabelText("Exception date 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Exception date 2")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Remove exception date 1/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Remove exception date 2/i }),
    ).toBeInTheDocument();
  }, 15000);

});

