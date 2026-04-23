import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { renderWithProviders, screen, waitFor } from "../../test/utils";

const bookSessionViaApiMock = vi.fn();
const cancelSessionsMock = vi.fn();
const showErrorMock = vi.fn();
const showSuccessMock = vi.fn();
const buildBookSessionApiPayloadMock = vi.fn((session: unknown) => session);
const upsertClientSessionNoteForSessionMock = vi.fn();

const currentSessionStart = new Date();
currentSessionStart.setHours(10, 0, 0, 0);
const currentSessionEnd = new Date(currentSessionStart);
currentSessionEnd.setHours(11, 0, 0, 0);

const scheduleFixtures = {
  sessions: [
    {
      id: "session-1",
      therapist_id: "therapist-1",
      client_id: "client-1",
      program_id: "program-1",
      goal_id: "goal-1",
      start_time: currentSessionStart.toISOString(),
      end_time: currentSessionEnd.toISOString(),
      status: "scheduled",
      notes: "Initial session",
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
  useSmartPrefetch: () => ({
    prefetchScheduleRange: vi.fn(),
    prefetchNextWeek: vi.fn(),
    prefetchReportData: vi.fn(),
  }),
}));

vi.mock("../../features/scheduling/domain/booking", () => ({
  buildBookSessionApiPayload: (session: unknown) => buildBookSessionApiPayloadMock(session),
  bookSessionViaApi: (...args: unknown[]) => bookSessionViaApiMock(...args),
}));

vi.mock("../../lib/sessionCancellation", () => ({
  cancelSessions: (...args: unknown[]) => cancelSessionsMock(...args),
}));

vi.mock("../../lib/toast", () => ({
  showError: (...args: unknown[]) => showErrorMock(...args),
  showSuccess: (...args: unknown[]) => showSuccessMock(...args),
}));

vi.mock("../../lib/session-notes", () => ({
  upsertClientSessionNoteForSession: (...args: unknown[]) =>
    upsertClientSessionNoteForSessionMock(...args),
}));

vi.mock("../../lib/conflictPolicy", () => ({
  buildSchedulingConflictHint: () => "conflict-hint",
}));

vi.mock("../../components/SessionModal", () => ({
  SessionModal: ({
    isOpen,
    onClose,
    onSubmit,
    session,
    retryHint,
  }: {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (data: Record<string, unknown>) => unknown;
    session?: { id: string };
    retryHint?: string | null;
  }) =>
    isOpen ? (
      <div data-testid="session-modal">
        <div data-testid="modal-mode">{session ? "edit" : "create"}</div>
        <div data-testid="retry-hint">{retryHint ?? ""}</div>
        <button
          aria-label="submit-create"
          onClick={() => {
            const result = onSubmit({
              therapist_id: "therapist-1",
              client_id: "client-1",
              program_id: "program-1",
              goal_id: "goal-1",
              start_time: "2025-07-01T10:00:00Z",
              end_time: "2025-07-01T11:00:00Z",
              status: "scheduled",
            });
            if (result && typeof (result as Promise<unknown>).catch === "function") {
              void (result as Promise<unknown>).catch(() => undefined);
            }
          }}
        >
          submit-create
        </button>
        <button
          aria-label="submit-update"
          onClick={() => {
            const result = onSubmit({
              status: "scheduled",
            });
            if (result && typeof (result as Promise<unknown>).catch === "function") {
              void (result as Promise<unknown>).catch(() => undefined);
            }
          }}
        >
          submit-update
        </button>
        <button
          aria-label="submit-update-with-note-context"
          onClick={() => {
            const result = onSubmit({
              status: "scheduled",
              session_note_goal_ids: ["goal-1"],
              session_note_goals_addressed: ["Goal 1"],
              session_note_goal_notes: { "goal-1": "Previously saved note" },
              session_note_goal_measurements: {},
              session_note_authorization_id: "auth-1",
              session_note_service_code: "97153",
              session_note_persist_requested: false,
            });
            if (result && typeof (result as Promise<unknown>).catch === "function") {
              void (result as Promise<unknown>).catch(() => undefined);
            }
          }}
        >
          submit-update-with-note-context
        </button>
        <button
          aria-label="submit-cancel"
          onClick={() => {
            const result = onSubmit({
              status: "cancelled",
              notes: "cancel reason",
            });
            if (result && typeof (result as Promise<unknown>).catch === "function") {
              void (result as Promise<unknown>).catch(() => undefined);
            }
          }}
        >
          submit-cancel
        </button>
        <button aria-label="close-modal" onClick={onClose}>
          close-modal
        </button>
      </div>
    ) : null,
}));

import { Schedule } from "../Schedule";

describe("Schedule orchestration integration hardening", () => {
  const openExistingSessionForEdit = async () => {
    await waitFor(() => {
      expect(document.querySelector("[data-session-status]")).toBeTruthy();
    });
    const sessionCard = document.querySelector("[data-session-status]") as HTMLElement | null;
    if (!sessionCard) {
      throw new Error("Expected at least one rendered session card.");
    }
    fireEvent.click(sessionCard);
  };

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    upsertClientSessionNoteForSessionMock.mockResolvedValue({
      id: "linked-note-1",
    });
    bookSessionViaApiMock.mockResolvedValue({
      session: {
        id: "created-session",
      },
    });
    cancelSessionsMock.mockResolvedValue({
      cancelledCount: 1,
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("pending-schedule create forwards metadata and does not reuse it on next manual create", async () => {
    localStorage.setItem(
      "pendingSchedule",
      JSON.stringify({
        idempotency_key: "idem-1",
        agent_operation_id: "op-1",
        trace_request_id: "req-1",
        trace_correlation_id: "corr-1",
        start_time: "2025-07-01T10:00:00Z",
      }),
    );

    renderWithProviders(<Schedule />);
    await screen.findByRole("heading", { name: /Schedule/i });
    await screen.findByTestId("session-modal");
    expect(localStorage.getItem("pendingSchedule")).toBeNull();

    fireEvent.click(screen.getByLabelText("submit-create"));

    await waitFor(() => {
      expect(bookSessionViaApiMock).toHaveBeenCalledTimes(1);
    });
    expect(bookSessionViaApiMock.mock.calls[0][1]).toEqual({
      idempotencyKey: "idem-1",
      agentOperationId: "op-1",
      requestId: "req-1",
      correlationId: "corr-1",
    });

    await waitFor(() => {
      expect(screen.queryByTestId("session-modal")).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByLabelText("Add session")[0]);
    await screen.findByTestId("session-modal");
    fireEvent.click(screen.getByLabelText("submit-create"));

    await waitFor(() => {
      expect(bookSessionViaApiMock).toHaveBeenCalledTimes(2);
    });
    expect(bookSessionViaApiMock.mock.calls[1][1]).toEqual({
      idempotencyKey: undefined,
      agentOperationId: undefined,
      requestId: undefined,
      correlationId: undefined,
    });
  });

  it("create 409 keeps modal open and sets retry hint distinct from non-409", async () => {
    bookSessionViaApiMock.mockRejectedValueOnce({
      status: 409,
      message: "Conflict",
    });
    bookSessionViaApiMock.mockRejectedValueOnce({
      status: 500,
      message: "Server error",
    });

    renderWithProviders(<Schedule />);
    await screen.findByRole("heading", { name: /Schedule/i });

    fireEvent.click(screen.getAllByLabelText("Add session")[0]);
    await screen.findByTestId("session-modal");
    fireEvent.click(screen.getByLabelText("submit-create"));

    await waitFor(() => {
      expect(showErrorMock).toHaveBeenCalled();
    });
    expect(screen.getByTestId("retry-hint")).toHaveTextContent("conflict-hint");
    expect(screen.getByTestId("session-modal")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("submit-create"));

    await waitFor(() => {
      expect(bookSessionViaApiMock).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByTestId("retry-hint")).toHaveTextContent("");
    expect(screen.getByTestId("session-modal")).toBeInTheDocument();
  });

  it("manual edit cancel path stays distinct and closes modal", async () => {
    renderWithProviders(<Schedule />);
    await screen.findByRole("heading", { name: /Schedule/i });

    await openExistingSessionForEdit();
    await screen.findByTestId("session-modal");
    expect(screen.getByTestId("modal-mode")).toHaveTextContent("edit");

    fireEvent.click(screen.getByLabelText("submit-cancel"));

    await waitFor(() => {
      expect(cancelSessionsMock).toHaveBeenCalledWith({
        sessionIds: ["session-1"],
        reason: "cancel reason",
      });
    });
    expect(showSuccessMock).toHaveBeenCalled();
  });

  it("manual edit update success path stays distinct from create", async () => {
    renderWithProviders(<Schedule />);
    await screen.findByRole("heading", { name: /Schedule/i });

    await openExistingSessionForEdit();
    await screen.findByTestId("session-modal");
    fireEvent.click(screen.getByLabelText("submit-update"));

    await waitFor(() => {
      expect(bookSessionViaApiMock).toHaveBeenCalledTimes(1);
    });
    expect(bookSessionViaApiMock.mock.calls[0][1]).toBeUndefined();
  });

  it("manual edit update 409 error keeps modal/edit context and sets retry hint", async () => {
    bookSessionViaApiMock.mockRejectedValueOnce({
      status: 409,
      message: "Conflict",
    });

    renderWithProviders(<Schedule />);
    await screen.findByRole("heading", { name: /Schedule/i });

    await openExistingSessionForEdit();
    await screen.findByTestId("session-modal");
    expect(screen.getByTestId("modal-mode")).toHaveTextContent("edit");

    fireEvent.click(screen.getByLabelText("submit-update"));

    await waitFor(() => {
      expect(showErrorMock).toHaveBeenCalled();
    });

    expect(bookSessionViaApiMock).toHaveBeenCalledTimes(1);
    expect(bookSessionViaApiMock.mock.calls[0][1]).toBeUndefined();
    expect(screen.getByTestId("session-modal")).toBeInTheDocument();
    expect(screen.getByTestId("modal-mode")).toHaveTextContent("edit");
    expect(screen.getByTestId("retry-hint")).toHaveTextContent("conflict-hint");
    expect(showSuccessMock).not.toHaveBeenCalled();
    expect(cancelSessionsMock).not.toHaveBeenCalled();
  });

  it("manual edit update non-409 error keeps modal/edit context and clears retry hint", async () => {
    bookSessionViaApiMock.mockRejectedValueOnce({
      status: 500,
      message: "Server error",
    });

    renderWithProviders(<Schedule />);
    await screen.findByRole("heading", { name: /Schedule/i });

    await openExistingSessionForEdit();
    await screen.findByTestId("session-modal");
    expect(screen.getByTestId("modal-mode")).toHaveTextContent("edit");

    fireEvent.click(screen.getByLabelText("submit-update"));

    await waitFor(() => {
      expect(showErrorMock).toHaveBeenCalled();
    });

    expect(bookSessionViaApiMock).toHaveBeenCalledTimes(1);
    expect(bookSessionViaApiMock.mock.calls[0][1]).toBeUndefined();
    expect(screen.getByTestId("session-modal")).toBeInTheDocument();
    expect(screen.getByTestId("modal-mode")).toHaveTextContent("edit");
    expect(screen.getByTestId("retry-hint")).toHaveTextContent("");
    expect(showSuccessMock).not.toHaveBeenCalled();
    expect(cancelSessionsMock).not.toHaveBeenCalled();
  });

  it("manual scheduled update ignores unchanged linked note context unless capture persistence was requested", async () => {
    renderWithProviders(<Schedule />);
    await screen.findByRole("heading", { name: /Schedule/i });

    await openExistingSessionForEdit();
    await screen.findByTestId("session-modal");
    fireEvent.click(screen.getByLabelText("submit-update-with-note-context"));

    await waitFor(() => {
      expect(bookSessionViaApiMock).toHaveBeenCalledTimes(1);
    });

    expect(upsertClientSessionNoteForSessionMock).not.toHaveBeenCalled();
    expect(bookSessionViaApiMock.mock.calls[0][1]).toBeUndefined();
    expect(showErrorMock).not.toHaveBeenCalled();
  });

  it("manual close clears retry hint without success-style submission", async () => {
    bookSessionViaApiMock.mockRejectedValueOnce({
      status: 409,
      message: "Conflict",
    });

    renderWithProviders(<Schedule />);
    await screen.findByRole("heading", { name: /Schedule/i });

    fireEvent.click(screen.getAllByLabelText("Add session")[0]);
    await screen.findByTestId("session-modal");
    fireEvent.click(screen.getByLabelText("submit-create"));

    await waitFor(() => {
      expect(screen.getByTestId("retry-hint")).toHaveTextContent("conflict-hint");
    });

    fireEvent.click(screen.getByLabelText("close-modal"));
    await waitFor(() => {
      expect(screen.getByTestId("retry-hint")).toHaveTextContent("");
    });
    expect(bookSessionViaApiMock).toHaveBeenCalledTimes(1);
  });
});
