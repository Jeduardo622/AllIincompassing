import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderWithProviders, screen, userEvent } from "../../test/utils";

const mockUseScheduleDataBatch = vi.fn(() => ({
  data: {
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
    therapists: [{ id: "therapist-1", full_name: "Dr. Myles", email: "m@example.com", availability_hours: {} }],
    clients: [{ id: "client-1", full_name: "Jamie Client", email: "j@example.com", availability_hours: {} }],
  },
  isLoading: false,
  refetch: vi.fn(),
}));

const mockUseSessionsOptimized = vi.fn(() => ({
  data: [],
  isLoading: false,
  isError: false,
  error: null,
  refetch: vi.fn(),
}));

const mockUseDropdownData = vi.fn(() => ({
  data: { therapists: [], clients: [] },
  isLoading: false,
  isError: false,
  error: null,
  refetch: vi.fn(),
}));

const mockUseActiveOrganizationId = vi.fn(() => "org-1");

vi.mock("../../lib/optimizedQueries", () => ({
  useScheduleDataBatch: (...args: unknown[]) => mockUseScheduleDataBatch(...args),
  useSessionsOptimized: (...args: unknown[]) => mockUseSessionsOptimized(...args),
  useDropdownData: (...args: unknown[]) => mockUseDropdownData(...args),
}));

vi.mock("../../lib/organization", () => ({
  useActiveOrganizationId: () => mockUseActiveOrganizationId(),
}));

vi.mock("../../components/SessionModal", () => ({
  SessionModal: () => null,
}));

import { Schedule } from "../Schedule";

describe("Schedule data-load UX", () => {
  beforeEach(() => {
    mockUseActiveOrganizationId.mockReturnValue("org-1");
    mockUseScheduleDataBatch.mockReturnValue({
      data: {
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
          { id: "therapist-1", full_name: "Dr. Myles", email: "m@example.com", availability_hours: {} },
        ],
        clients: [{ id: "client-1", full_name: "Jamie Client", email: "j@example.com", availability_hours: {} }],
      },
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
      data: { therapists: [], clients: [] },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it("shows an explicit error state when the fallback sessions query fails after batch returns no usable sessions", async () => {
    const batchRefetch = vi.fn();
    const sessionsRefetch = vi.fn();
    const dropdownRefetch = vi.fn();
    mockUseScheduleDataBatch.mockReturnValue({
      data: null,
      isLoading: false,
      refetch: batchRefetch,
    });
    mockUseSessionsOptimized.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("get_sessions_optimized failed"),
      refetch: sessionsRefetch,
    });
    mockUseDropdownData.mockReturnValue({
      data: { therapists: [], clients: [] },
      isLoading: false,
      isError: false,
      error: null,
      refetch: dropdownRefetch,
    });

    renderWithProviders(<Schedule />);

    const banner = await screen.findByTestId("schedule-data-load-error");
    expect(banner).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/Couldn't load schedule/i)).toBeInTheDocument();
    expect(screen.getByText(/get_sessions_optimized failed/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^Retry$/i }));

    expect(batchRefetch).toHaveBeenCalled();
    expect(sessionsRefetch).toHaveBeenCalled();
    expect(dropdownRefetch).toHaveBeenCalled();
  });

  it("shows an explicit error state when dropdown data fails and batch payload is missing", async () => {
    mockUseScheduleDataBatch.mockReturnValue({
      data: null,
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
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("get_dropdown_data failed"),
      refetch: vi.fn(),
    });

    renderWithProviders(<Schedule />);

    expect(await screen.findByTestId("schedule-data-load-error")).toBeInTheDocument();
    expect(screen.getByText(/get_dropdown_data failed/i)).toBeInTheDocument();
  });

  it("shows an explicit empty state when schedule loads successfully but there are no sessions", async () => {
    mockUseScheduleDataBatch.mockReturnValue({
      data: {
        sessions: [],
        therapists: [{ id: "t1", full_name: "T", email: "t@e.com", availability_hours: {} }],
        clients: [{ id: "c1", full_name: "C", email: "c@e.com", availability_hours: {} }],
      },
      isLoading: false,
      refetch: vi.fn(),
    });

    renderWithProviders(<Schedule />);

    const empty = await screen.findByTestId("schedule-empty-sessions");
    expect(empty).toBeInTheDocument();
    expect(empty).toHaveAttribute("data-schedule-empty-reason", "no-sessions-in-period");
    expect(screen.getByText(/No sessions in this period/i)).toBeInTheDocument();
    expect(screen.queryByTestId("schedule-data-load-error")).not.toBeInTheDocument();
  });

  it("shows an explicit empty state when there are no sessions and no therapists or clients (no schedule data)", async () => {
    mockUseScheduleDataBatch.mockReturnValue({
      data: {
        sessions: [],
        therapists: [],
        clients: [],
      },
      isLoading: false,
      refetch: vi.fn(),
    });

    renderWithProviders(<Schedule />);

    const empty = await screen.findByTestId("schedule-empty-sessions");
    expect(empty).toHaveAttribute("data-schedule-empty-reason", "no-schedule-data");
    expect(screen.getByText(/No schedule data yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/No sessions in this period/i)).not.toBeInTheDocument();
  });

  it("shows an error when dropdown fails and batch payload omits one directory list (still depends on dropdown)", async () => {
    mockUseScheduleDataBatch.mockReturnValue({
      data: {
        sessions: [],
        therapists: [{ id: "t1", full_name: "T", email: "t@e.com", availability_hours: {} }],
        clients: [],
      },
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
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("get_dropdown_data failed for clients"),
      refetch: vi.fn(),
    });

    renderWithProviders(<Schedule />);

    expect(await screen.findByTestId("schedule-data-load-error")).toBeInTheDocument();
    expect(screen.getByText(/get_dropdown_data failed for clients/i)).toBeInTheDocument();
  });

  it("does not surface a dropdown error when batch payload already supplies therapists and clients", async () => {
    mockUseScheduleDataBatch.mockReturnValue({
      data: {
        sessions: [],
        therapists: [{ id: "t1", full_name: "T", email: "t@e.com", availability_hours: {} }],
        clients: [{ id: "c1", full_name: "C", email: "c@e.com", availability_hours: {} }],
      },
      isLoading: false,
      refetch: vi.fn(),
    });
    mockUseDropdownData.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("should not block"),
      refetch: vi.fn(),
    });

    renderWithProviders(<Schedule />);

    expect(await screen.findByTestId("schedule-empty-sessions")).toBeInTheDocument();
    expect(screen.queryByTestId("schedule-data-load-error")).not.toBeInTheDocument();
  });
});
