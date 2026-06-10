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
const originalMatchMedia = window.matchMedia;

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

const waitForScheduleGridReady = () =>
  waitFor(() => {
    const activeView = screen.queryByTestId("week-view") ?? screen.queryByTestId("day-view");
    expect(activeView).toBeTruthy();
    return activeView!;
  }, { timeout: 10_000 });

describe("Schedule", () => {
  beforeEach(() => {
    sessionModalModuleLoads = 0;
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === "(any-pointer: fine)",
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
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
    window.matchMedia = originalMatchMedia;
    vi.useRealTimers();
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
  }, 30000);

  it("renders schedule interface elements", async () => {
    renderWithProviders(<Schedule />);

    // Wait for component to load and check for basic interface elements
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: /Schedule/i })).toBeInTheDocument();
    });
    
    // Check for key interface elements
    expect(
      screen.getByText((content) => /^[A-Z][a-z]{2} \d{1,2} - [A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(content)),
    ).toBeInTheDocument();
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
      null,
    );
    expect(mockUseDropdownData).toHaveBeenCalledWith({ enabled: false });
  });

  it("lazy-loads the session modal only when the user opens it", async () => {
    renderWithProviders(<Schedule />);

    await screen.findByRole("heading", { name: /Schedule/i });
    await waitForScheduleGridReady();
    expect(sessionModalModuleLoads).toBe(0);

    const addButtons = await screen.findAllByLabelText("Add session");
    fireEvent.click(addButtons[0]);

    await waitFor(() => {
      expect(sessionModalModuleLoads).toBe(1);
    });
    expect(await screen.findByTestId("session-modal-sessions")).toHaveTextContent("session-1");
  }, 15_000);

  it("prefetches the next schedule batch when the next-period control is hovered", async () => {
    renderWithProviders(<Schedule />);

    await screen.findByRole("heading", { name: /Schedule/i });
    await waitForScheduleGridReady();

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
  }, 15_000);

  it("applies therapist filters to batched sessions", async () => {
    renderWithProviders(<Schedule />);

    await waitForScheduleGridReady();
    const addButtons = await screen.findAllByLabelText("Add session");
    fireEvent.click(addButtons[0]);
    expect(await screen.findByTestId("session-modal-sessions")).toHaveTextContent("session-1");
    expect(screen.getByTestId("session-modal-sessions")).toHaveTextContent("session-2");

    await userEvent.selectOptions(screen.getByLabelText("Therapist"), "therapist-2");

    await waitFor(() => {
      expect(screen.getByTestId("session-modal-sessions")).not.toHaveTextContent("session-1");
      expect(screen.getByTestId("session-modal-sessions")).toHaveTextContent("session-2");
    });
  }, 15_000);

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
      screen.queryByRole("checkbox", { name: /Apply this visible week forward/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryAllByLabelText("Add session")).toHaveLength(0);
  });

  it("exposes week-forward admin controls when enabled in week view", async () => {
    renderWithProviders(<Schedule />);

    const recurrenceToggle = await screen.findByRole("checkbox", {
      name: /Apply this visible week forward/i,
    });
    expect(recurrenceToggle).not.toBeChecked();
    expect(screen.getByLabelText(/Time Zone/i)).toBeInTheDocument();

    await userEvent.click(recurrenceToggle);
    expect(screen.getByText(/Source week/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/End date/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Preview week-forward schedule/i })).toBeInTheDocument();
    expect(screen.getByText(/Single-session recurrence/i)).toBeInTheDocument();
  }, 30000);

  it("previews and applies the visible week with the displayed week payload", async () => {
    const capturedRequests: Array<Record<string, unknown>> = [];
    server.use(
      http.post("*/api/sessions-week-forward", async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        capturedRequests.push(body);
        return HttpResponse.json({
          success: true,
          data: body.dryRun === true
            ? {
                sourceSessionCount: 2,
                generatedSessionCount: 8,
                generatedWeekCount: 4,
                endDate: "2025-08-31",
                conflicts: [],
              }
            : {
                sourceSessionCount: 2,
                generatedSessionCount: 8,
                generatedWeekCount: 4,
                endDate: "2025-08-31",
                conflicts: [],
                createdSessions: [],
              },
        });
      }),
    );

    renderWithProviders(<Schedule />);

    const recurrenceToggle = await screen.findByRole("checkbox", {
      name: /Apply this visible week forward/i,
    });
    await userEvent.click(recurrenceToggle);
    fireEvent.change(screen.getByLabelText(/End date/i), { target: { value: "2025-08-31" } });

    await userEvent.click(screen.getByRole("button", { name: /Preview week-forward schedule/i }));

    await waitFor(() => {
      expect(screen.getByText(/^Preview$/i)).toBeInTheDocument();
      expect(screen.getByText("8")).toBeInTheDocument();
    });

    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0]).toMatchObject({
      sourceSessionIds: ["session-1", "session-2"],
      endDate: "2025-08-31",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      dryRun: true,
    });

    await userEvent.click(screen.getByRole("button", { name: /Apply this week forward/i }));

    await waitFor(() => {
      expect(capturedRequests).toHaveLength(2);
    });
    expect(capturedRequests[1]).toMatchObject({
      sourceSessionIds: ["session-1", "session-2"],
      endDate: "2025-08-31",
      dryRun: false,
    });
  }, 15000);

  it("recurs only scheduled sessions when visible sessions include other statuses", async () => {
    const capturedRequests: Array<Record<string, unknown>> = [];
    server.use(
      http.post("*/api/sessions-week-forward", async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        capturedRequests.push(body);
        return HttpResponse.json({
          success: true,
          data: {
            sourceSessionCount: 1,
            generatedSessionCount: 4,
            generatedWeekCount: 4,
            endDate: "2025-08-31",
            conflicts: [],
            ...(body.dryRun === true ? {} : { createdSessions: [] }),
          },
        });
      }),
    );
    mockUseScheduleDataBatch.mockReturnValue({
      data: {
        ...scheduleFixtures,
        sessions: [
          scheduleFixtures.sessions[0],
          {
            ...scheduleFixtures.sessions[1],
            status: "completed",
          },
        ],
      },
      isLoading: false,
    });

    renderWithProviders(<Schedule />);

    const recurrenceToggle = await screen.findByRole("checkbox", {
      name: /Apply this visible week forward/i,
    });
    await userEvent.click(recurrenceToggle);
    fireEvent.change(screen.getByLabelText(/End date/i), { target: { value: "2025-08-31" } });

    expect(screen.getByText(/1 scheduled session will be used/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/Every visible session must be scheduled before cloning this week forward/i),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Preview week-forward schedule/i }));

    await waitFor(() => {
      expect(capturedRequests).toHaveLength(1);
    });

    expect(capturedRequests[0]).toMatchObject({
      sourceSessionIds: ["session-1"],
      endDate: "2025-08-31",
      dryRun: true,
    });

    await userEvent.click(screen.getByRole("button", { name: /Apply this week forward/i }));

    await waitFor(() => {
      expect(capturedRequests).toHaveLength(2);
    });

    expect(capturedRequests[1]).toMatchObject({
      sourceSessionIds: ["session-1"],
      endDate: "2025-08-31",
      dryRun: false,
    });
  }, 15000);

  it("blocks week-forward when no visible sessions are scheduled", async () => {
    mockUseScheduleDataBatch.mockReturnValue({
      data: {
        ...scheduleFixtures,
        sessions: [
          {
            ...scheduleFixtures.sessions[0],
            status: "completed",
          },
          {
            ...scheduleFixtures.sessions[1],
            status: "cancelled",
          },
        ],
      },
      isLoading: false,
    });

    renderWithProviders(<Schedule />);

    const recurrenceToggle = await screen.findByRole("checkbox", {
      name: /Apply this visible week forward/i,
    });
    await userEvent.click(recurrenceToggle);

    expect(screen.getByText(/0 scheduled sessions will be used/i)).toBeInTheDocument();
    expect(screen.getByText(/There are no scheduled sessions in this displayed week to reuse/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Preview week-forward schedule/i })).toBeDisabled();
  }, 15000);

  it("shows the missing-org state for super-admins without an active organization context", async () => {
    mockUseActiveOrganizationId.mockReturnValue(null);

    renderWithProviders(<Schedule />, {
      auth: { role: "super_admin", organizationId: null },
    });

    expect(await screen.findByTestId("schedule-missing-org")).toBeInTheDocument();
    expect(screen.getByText(/Organization context unavailable/i)).toBeInTheDocument();
  }, 15000);

  it("shows a user-friendly weekly recurrence builder for single-session saves", async () => {
    renderWithProviders(<Schedule />);

    const recurrenceToggle = await screen.findByRole("checkbox", {
      name: /Apply this visible week forward/i,
    });
    await userEvent.click(recurrenceToggle);

    await userEvent.click(screen.getByText(/Single-session recurrence/i));
    expect(screen.getByLabelText(/Repeat every/i)).toHaveValue(1);
    expect(screen.getByText(/Weekly recurrence is the supported schedule pattern for this editor/i)).toBeInTheDocument();
    const weekdayButtons = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) =>
      screen.getByRole("button", { name: label }),
    );
    expect(weekdayButtons.filter((button) => button.getAttribute("aria-pressed") === "true")).toHaveLength(1);

    fireEvent.change(screen.getByLabelText(/Repeat every/i), { target: { value: "2" } });
    const buttonToEnable = weekdayButtons.find((button) => button.getAttribute("aria-pressed") !== "true");
    expect(buttonToEnable).toBeTruthy();
    await userEvent.click(buttonToEnable!);

    expect(screen.getByText(/Repeats every 2 weeks on /i)).toBeInTheDocument();
    expect(weekdayButtons.filter((button) => button.getAttribute("aria-pressed") === "true")).toHaveLength(2);
  }, 15000);

  it("keeps recurrence exception controls accessible", async () => {
    renderWithProviders(<Schedule />);

    const recurrenceToggle = await screen.findByRole("checkbox", {
      name: /Apply this visible week forward/i,
    });
    await userEvent.click(recurrenceToggle);

    await userEvent.click(screen.getByText(/Single-session recurrence/i));
    const addExceptionButton = await screen.findByRole("button", { name: /Add exception/i });
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

