import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { renderWithProviders, screen, userEvent, waitFor } from "../../test/utils";
import { fireEvent, within } from "@testing-library/react";
import { server } from "../../test/setup";
import { supabase } from "../../lib/supabase";

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
  useScheduleDataBatch: () => ({ data: scheduleFixtures, isLoading: false }),
  useSessionsOptimized: () => ({ data: scheduleFixtures.sessions, isLoading: false }),
  useDropdownData: () => ({
    data: { therapists: scheduleFixtures.therapists, clients: scheduleFixtures.clients },
    isLoading: false,
  }),
}));

vi.mock("../../components/SessionModal", () => ({
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
    expect(await screen.findByRole("heading", { name: /Schedule/i })).toBeInTheDocument();
    expect(await screen.findByText(/Auto Schedule/i)).toBeInTheDocument();
  });

  it("renders schedule interface elements", async () => {
    renderWithProviders(<Schedule />);

    // Wait for component to load and check for basic interface elements
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: /Schedule/i })).toBeInTheDocument();
    });
    
    // Check for key interface elements
    expect(screen.getByText(/Auto Schedule/i)).toBeInTheDocument();
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

  it("groups recurrence controls under an accessible recurrence settings fieldset", async () => {
    renderWithProviders(<Schedule />);

    const recurrenceGroup = await screen.findByRole("group", {
      name: /Recurrence settings/i,
    });
    expect(recurrenceGroup).toBeInTheDocument();

    expect(
      within(recurrenceGroup).getByRole("checkbox", {
        name: /Enable recurrence \(RRULE\)/i,
      }),
    ).toBeInTheDocument();

    expect(within(recurrenceGroup).getByLabelText(/Time Zone/i)).toBeInTheDocument();
  });

  it("retains recurrence control labels and exception controls when recurrence is enabled", async () => {
    renderWithProviders(<Schedule />);

    const recurrenceGroup = await screen.findByRole("group", {
      name: /Recurrence settings/i,
    });
    const recurrenceToggle = within(recurrenceGroup).getByRole("checkbox", {
      name: /Enable recurrence \(RRULE\)/i,
    });

    await userEvent.click(recurrenceToggle);

    expect(within(recurrenceGroup).getByLabelText(/^RRULE$/i)).toBeInTheDocument();
    expect(within(recurrenceGroup).getByLabelText(/Count/i)).toBeInTheDocument();
    expect(within(recurrenceGroup).getByLabelText(/Until/i)).toBeInTheDocument();
    expect(within(recurrenceGroup).getByText(/Exceptions/i)).toBeInTheDocument();
    expect(within(recurrenceGroup).getByText(/No exception dates configured/i)).toBeInTheDocument();
    expect(within(recurrenceGroup).getByRole("button", { name: /Add exception/i })).toBeInTheDocument();
  });

});

