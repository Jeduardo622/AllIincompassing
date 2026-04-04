import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, renderWithProviders, screen, waitFor } from "../../test/utils";
import type { Session } from "../../types";
import { Schedule } from "../Schedule";

let sessionStatus: Session["status"] = "in_progress";

const completeSessionFromModalMock = vi.fn();
const checkInProgressSessionCloseReadinessMock = vi.fn();
const showErrorMock = vi.fn();
const navigateMock = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

const buildFixtures = () => {
  const start = new Date();
  start.setHours(10, 0, 0, 0);
  const end = new Date(start);
  end.setHours(11, 0, 0, 0);

  return {
    sessions: [
      {
        id: "session-1",
        therapist_id: "therapist-1",
        client_id: "client-1",
        program_id: "program-1",
        goal_id: "goal-1",
        goal_ids: ["goal-1"],
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        status: sessionStatus,
        notes: "",
        therapist: { id: "therapist-1", full_name: "Dr. Myles" },
        client: { id: "client-1", full_name: "Jamie Client" },
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
    ],
  };
};

vi.mock("../../lib/organization", () => ({
  useActiveOrganizationId: () => "org-1",
}));

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({
            data: { status: sessionStatus },
            error: null,
          })),
        })),
      })),
    })),
  },
}));

vi.mock("../../lib/optimizedQueries", () => ({
  useScheduleDataBatch: () => {
    const fixtures = buildFixtures();
    return { data: fixtures, isLoading: false };
  },
  useSessionsOptimized: () => {
    const fixtures = buildFixtures();
    return { data: fixtures.sessions, isLoading: false };
  },
  useDropdownData: () => {
    const fixtures = buildFixtures();
    return {
      data: { therapists: fixtures.therapists, clients: fixtures.clients },
      isLoading: false,
    };
  },
}));

vi.mock("../../components/SessionModal", () => ({
  SessionModal: ({
    isOpen,
    onSubmit,
    retryHint,
    retryActionLabel,
    onRetryAction,
  }: {
    isOpen: boolean;
    onSubmit: (data: Partial<Session>) => Promise<void>;
    retryHint?: string | null;
    retryActionLabel?: string | null;
    onRetryAction?: (() => void) | undefined;
  }) =>
    isOpen ? (
      <div>
        <button type="button" onClick={() => void onSubmit({ status: "completed", notes: "Modal notes" })}>
          Submit terminal
        </button>
        {retryHint ? <p>{retryHint}</p> : null}
        {retryActionLabel && onRetryAction ? (
          <button type="button" onClick={onRetryAction}>
            {retryActionLabel}
          </button>
        ) : null}
      </div>
    ) : null,
}));

vi.mock("../../features/scheduling/domain/sessionComplete", () => ({
  completeSessionFromModal: (...args: unknown[]) => completeSessionFromModalMock(...args),
  checkInProgressSessionCloseReadiness: (...args: unknown[]) =>
    checkInProgressSessionCloseReadinessMock(...args),
  IN_PROGRESS_CLOSE_NOT_READY_MESSAGE:
    "You must complete the linked session documentation with per-goal notes before closing this in-progress session. Add per-goal notes in a client session note linked by session_id. Notes entered in this Schedule modal and overall narrative text do not satisfy this requirement.",
}));

vi.mock("../../lib/toast", async () => {
  const actual = await vi.importActual<typeof import("../../lib/toast")>("../../lib/toast");
  return {
    ...actual,
    showError: (...args: unknown[]) => showErrorMock(...args),
    showSuccess: vi.fn(),
  };
});

describe("Schedule session-close readiness precheck", { timeout: 15_000 }, () => {
  beforeEach(() => {
    sessionStatus = "in_progress";
    completeSessionFromModalMock.mockReset();
    completeSessionFromModalMock.mockResolvedValue(undefined);
    checkInProgressSessionCloseReadinessMock.mockReset();
    checkInProgressSessionCloseReadinessMock.mockResolvedValue({
      ready: true,
      requiredGoalIds: ["goal-1"],
      missingGoalIds: [],
    });
    showErrorMock.mockReset();
    navigateMock.mockReset();
  });

  it("blocks terminal submit for in_progress sessions when required per-goal notes are missing", async () => {
    checkInProgressSessionCloseReadinessMock.mockResolvedValueOnce({
      ready: false,
      requiredGoalIds: ["goal-1"],
      missingGoalIds: ["goal-1"],
    });

    renderWithProviders(<Schedule />);

    fireEvent.click(await screen.findByText("Jamie Client"));
    fireEvent.click(screen.getByRole("button", { name: "Submit terminal" }));

    await waitFor(() => {
      expect(checkInProgressSessionCloseReadinessMock).toHaveBeenCalledWith({
        sessionId: "session-1",
        organizationId: "org-1",
      });
    });
    expect(completeSessionFromModalMock).not.toHaveBeenCalled();
    expect(showErrorMock).toHaveBeenCalledWith(
      expect.stringContaining("linked session documentation with per-goal notes"),
    );
    expect(showErrorMock).not.toHaveBeenCalledWith(expect.stringMatching(/slot was just booked/i));
    expect(
      screen.getByText(/you can add these in schedule > edit session > clinical session notes/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Client Details" })).toBeInTheDocument();
  });

  it("routes to the matching client details page from blocked-close guidance", async () => {
    checkInProgressSessionCloseReadinessMock.mockResolvedValueOnce({
      ready: false,
      requiredGoalIds: ["goal-1"],
      missingGoalIds: ["goal-1"],
    });

    renderWithProviders(<Schedule />);

    fireEvent.click(await screen.findByText("Jamie Client"));
    fireEvent.click(screen.getByRole("button", { name: "Submit terminal" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open Client Details" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Open Client Details" }));

    expect(navigateMock).toHaveBeenCalledWith("/clients/client-1?tab=session-notes");
  });

  it("proceeds with completion when readiness passes", async () => {
    renderWithProviders(<Schedule />);

    fireEvent.click(await screen.findByText("Jamie Client"));
    fireEvent.click(screen.getByRole("button", { name: "Submit terminal" }));

    await waitFor(() => {
      expect(checkInProgressSessionCloseReadinessMock).toHaveBeenCalledTimes(1);
      expect(completeSessionFromModalMock).toHaveBeenCalledWith({
        sessionId: "session-1",
        outcome: "completed",
        notes: "Modal notes",
      });
    });
  });

  it("does not run precheck for non-in_progress sessions", async () => {
    sessionStatus = "scheduled";

    renderWithProviders(<Schedule />);

    fireEvent.click(await screen.findByText("Jamie Client"));
    fireEvent.click(screen.getByRole("button", { name: "Submit terminal" }));

    await waitFor(() => {
      expect(completeSessionFromModalMock).toHaveBeenCalledWith({
        sessionId: "session-1",
        outcome: "completed",
        notes: "Modal notes",
      });
    });
    expect(checkInProgressSessionCloseReadinessMock).not.toHaveBeenCalled();
  });
});
