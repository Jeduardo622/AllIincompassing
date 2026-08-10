import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { renderWithProviders, screen, waitFor } from "../../test/utils";

const bookSessionViaApiMock = vi.fn();
const cancelSessionsMock = vi.fn();
const reactivateSessionMock = vi.fn();
const showErrorMock = vi.fn();
const showSuccessMock = vi.fn();
const buildBookSessionApiPayloadMock = vi.fn((session: unknown) => session);
const upsertClientSessionNoteForSessionMock = vi.fn();
const invalidateSessionNoteCachesAfterSessionWriteMock = vi.fn();
const completeSessionFromModalMock = vi.fn();
const checkInProgressSessionCloseReadinessMock = vi.fn();
const formatSessionNoteTimingMock = vi.fn(() => ({
  sessionDate: "2026-07-23",
  startTime: "14:00:00",
  endTime: "15:00:00",
}));

const currentSessionStart = new Date();
currentSessionStart.setHours(10, 0, 0, 0);
const currentSessionEnd = new Date(currentSessionStart);
currentSessionEnd.setHours(11, 0, 0, 0);

const originalSessionWindow = {
  start_time: currentSessionStart.toISOString(),
  end_time: currentSessionEnd.toISOString(),
};
const shiftedSessionStart = new Date(originalSessionWindow.start_time);
shiftedSessionStart.setHours(11, 15, 0, 0);
const shiftedSessionEnd = new Date(originalSessionWindow.end_time);
shiftedSessionEnd.setHours(12, 15, 0, 0);
const shiftedSessionWindow = {
  start_time: shiftedSessionStart.toISOString(),
  end_time: shiftedSessionEnd.toISOString(),
};

const futureSessionNoteWindow = {
  start_time: "2026-07-23T21:00:00.000Z",
  end_time: "2026-07-23T22:00:00.000Z",
};

const originalSessionFixture = {
  id: "session-1",
  therapist_id: "therapist-1",
  client_id: "client-1",
  program_id: "program-1",
  goal_id: "goal-1",
  start_time: originalSessionWindow.start_time,
  end_time: originalSessionWindow.end_time,
  status: "scheduled",
  started_at: null as string | null,
  notes: "Initial session",
  therapist: { id: "therapist-1", full_name: "Dr. Myles" },
  client: { id: "client-1", full_name: "Jamie Client" },
};

const scheduleFixtures = {
  sessions: [{ ...originalSessionFixture }],
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

vi.mock("../../features/scheduling/domain/time", () => ({
  formatSessionNoteTiming: (...args: unknown[]) => formatSessionNoteTimingMock(...args),
}));

vi.mock("../../lib/sessionCancellation", () => ({
  cancelSessions: (...args: unknown[]) => cancelSessionsMock(...args),
}));

vi.mock("../../lib/sessionReactivation", () => ({
  reactivateSession: (...args: unknown[]) => reactivateSessionMock(...args),
}));

vi.mock("../../lib/toast", () => ({
  showError: (...args: unknown[]) => showErrorMock(...args),
  showSuccess: (...args: unknown[]) => showSuccessMock(...args),
}));

vi.mock("../../lib/session-notes", () => ({
  upsertClientSessionNoteForSession: (...args: unknown[]) =>
    upsertClientSessionNoteForSessionMock(...args),
}));

vi.mock("../../features/scheduling/domain/sessionNoteQueryInvalidation", () => ({
  invalidateSessionNoteCachesAfterSessionWrite: (...args: unknown[]) =>
    invalidateSessionNoteCachesAfterSessionWriteMock(...args),
}));

vi.mock("../../features/scheduling/domain/sessionComplete", () => ({
  completeSessionFromModal: (...args: unknown[]) => completeSessionFromModalMock(...args),
  checkInProgressSessionCloseReadiness: (...args: unknown[]) =>
    checkInProgressSessionCloseReadinessMock(...args),
  IN_PROGRESS_CLOSE_NOT_READY_MESSAGE:
    "You must complete the linked session documentation with per-goal notes before closing this in-progress session.",
}));

vi.mock("../../lib/conflictPolicy", () => ({
  buildSchedulingConflictHint: () => "conflict-hint",
}));

vi.mock("../../components/SessionModal", () => ({
  SessionModal: ({
    isOpen,
    onClose,
    onSubmit,
    onReactivate,
    onDeleteAppointment,
    session,
    retryHint,
    dataCollectionOnly,
    allowStartSession,
    canCreateSchedules,
    isReactivating,
    hideGoalCaptureFields,
    onBtAbaSessionFinalized,
  }: {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (data: Record<string, unknown>) => unknown;
    onReactivate?: (input: { session: { id: string }; start_time: string; end_time: string }) => unknown;
    onDeleteAppointment?: (input: { session: { id: string } }) => unknown;
    session?: { id: string };
    retryHint?: string | null;
    dataCollectionOnly?: boolean;
    allowStartSession?: boolean;
    canCreateSchedules?: boolean;
    isReactivating?: boolean;
    hideGoalCaptureFields?: boolean;
    onBtAbaSessionFinalized?: (result: { sessionId: string; noteId: string; status: 'completed'; progressionResults: [] }) => Promise<void>;
  }) =>
    isOpen ? (
      <div data-testid="session-modal">
        <div data-testid="modal-mode">{session ? "edit" : "create"}</div>
        <div data-testid="selected-session-id">{session?.id ?? ""}</div>
        <div data-testid="retry-hint">{retryHint ?? ""}</div>
        <div data-testid="data-collection-only">{dataCollectionOnly ? "true" : "false"}</div>
        <div data-testid="allow-start-session">{allowStartSession ? "true" : "false"}</div>
        <div data-testid="can-create-schedules">{canCreateSchedules ? "true" : "false"}</div>
        <div data-testid="reactivate-available">{session && onReactivate ? "true" : "false"}</div>
        <div data-testid="reactivating">{isReactivating ? "true" : "false"}</div>
        <div data-testid="delete-available">{session && onDeleteAppointment ? "true" : "false"}</div>
        <div data-testid="hide-goal-capture-fields">{hideGoalCaptureFields ? "true" : "false"}</div>
        <button
          aria-label="delete-appointment"
          disabled={!session || !onDeleteAppointment}
          onClick={() => {
            const result = session && onDeleteAppointment
              ? onDeleteAppointment({ session: { id: session.id } })
              : undefined;
            if (result && typeof (result as Promise<unknown>).catch === "function") {
              void (result as Promise<unknown>).catch(() => undefined);
            }
          }}
        >
          delete-appointment
        </button>
        <button
          aria-label="submit-complete-with-stale-trial"
          onClick={() => {
            const result = onSubmit({
              id: "session-1", therapist_id: "therapist-1", client_id: "client-1", program_id: "program-1", goal_id: "goal-1",
              start_time: originalSessionWindow.start_time, end_time: originalSessionWindow.end_time, status: "completed",
              session_note_goal_ids: ["goal-1"], session_note_goals_addressed: ["Goal 1"],
              session_note_goal_notes: { "goal-1": "Keep this note" }, session_note_goal_measurements: {},
              session_note_authorization_id: "auth-1", session_note_service_code: "97153", session_note_persist_requested: true,
              session_note_trial_events: [{ target_id: "88888888-8888-4888-8888-888888888888", trial_number: 1, response: "correct", expected_progression_version: 1 }],
            });
            if (result && typeof (result as Promise<unknown>).catch === "function") void (result as Promise<unknown>).catch(() => undefined);
          }}
        >complete stale</button>
        <button
          aria-label="submit-complete-with-new-trial"
          onClick={() => {
            const result = onSubmit({
              id: "session-1", therapist_id: "therapist-1", client_id: "client-1", program_id: "program-1", goal_id: "goal-1",
              start_time: originalSessionWindow.start_time, end_time: originalSessionWindow.end_time, status: "completed",
              session_note_goal_ids: ["goal-1"], session_note_goals_addressed: ["Goal 1"],
              session_note_goal_notes: { "goal-1": "Keep this note" }, session_note_goal_measurements: {},
              session_note_authorization_id: "auth-1", session_note_service_code: "97153", session_note_persist_requested: true,
              session_note_trial_events: [
                { target_id: "88888888-8888-4888-8888-888888888888", trial_number: 1, response: "correct", expected_progression_version: 1 },
                { target_id: "88888888-8888-4888-8888-888888888888", trial_number: 2, response: "incorrect", expected_progression_version: 1 },
              ],
            });
            if (result && typeof (result as Promise<unknown>).catch === "function") void (result as Promise<unknown>).catch(() => undefined);
          }}
        >complete with new trial</button>
        <button
          aria-label="submit-complete-after-discard"
          onClick={() => {
            const result = onSubmit({
              id: "session-1", therapist_id: "therapist-1", client_id: "client-1", program_id: "program-1", goal_id: "goal-1",
              start_time: originalSessionWindow.start_time, end_time: originalSessionWindow.end_time, status: "completed",
              session_note_goal_ids: ["goal-1"], session_note_goals_addressed: ["Goal 1"],
              session_note_goal_notes: { "goal-1": "Keep this note" }, session_note_goal_measurements: {},
              session_note_authorization_id: "auth-1", session_note_service_code: "97153", session_note_persist_requested: true,
            });
            if (result && typeof (result as Promise<unknown>).catch === "function") void (result as Promise<unknown>).catch(() => undefined);
          }}
        >complete retry</button>
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
          aria-label="submit-capture-persist"
          onClick={() => {
            const result = onSubmit({
              therapist_id: "therapist-1",
              client_id: "client-1",
              program_id: "program-1",
              goal_id: "goal-1",
              start_time: futureSessionNoteWindow.start_time,
              end_time: futureSessionNoteWindow.end_time,
              status: "in_progress",
              session_note_goal_ids: ["goal-1", "adhoc-skill-550e8400-e29b-41d4-a716-446655440000"],
              session_note_goals_addressed: ["Goal 1", "Session target"],
              session_note_goal_notes: {
                "goal-1": "Plan note",
                "adhoc-skill-550e8400-e29b-41d4-a716-446655440000": "Adhoc note",
              },
              session_note_goal_measurements: {
                "adhoc-skill-550e8400-e29b-41d4-a716-446655440000": {
                  version: 1,
                  data: { measurement_type: "frequency", metric_value: 1 },
                },
              },
              session_note_authorization_id: "auth-1",
              session_note_service_code: "97153",
              session_note_persist_requested: true,
              session_note_trial_events: [{
                target_id: "88888888-8888-4888-8888-888888888888",
                trial_number: 1,
                response: "correct",
                metadata: { source: "schedule_capture" },
              }],
              session_note_capture_merge_goal_ids: [
                "goal-1",
                "adhoc-skill-550e8400-e29b-41d4-a716-446655440000",
              ],
            });
            if (result && typeof (result as Promise<unknown>).catch === "function") {
              void (result as Promise<unknown>).catch(() => undefined);
            }
          }}
        >
          submit-capture-persist
        </button>
        <button
          aria-label="submit-bt-closeout-capture"
          onClick={() => void onSubmit({
            therapist_id: "therapist-1", client_id: "client-1", program_id: "program-1", goal_id: "goal-1",
            start_time: originalSessionWindow.start_time, end_time: originalSessionWindow.end_time, status: "in_progress",
            session_note_goal_ids: ["goal-1"], session_note_goals_addressed: ["Goal 1"],
            session_note_goal_notes: { "goal-1": "Plan note" }, session_note_goal_measurements: {},
            session_note_authorization_id: "auth-1", session_note_service_code: "97153",
            session_note_persist_requested: true, session_note_begin_closeout: true,
          })}
        >submit BT closeout capture</button>
        <button
          aria-label="report-bt-atomic-completion"
          onClick={() => void onBtAbaSessionFinalized?.({ sessionId: 'session-1', noteId: 'note-1', status: 'completed', progressionResults: [] })}
        >report BT atomic completion</button>
        <button
          aria-label="submit-terminal-capture"
          onClick={() => {
            const result = onSubmit({
              therapist_id: "therapist-1",
              client_id: "client-1",
              program_id: "program-1",
              goal_id: "goal-1",
              start_time: originalSessionWindow.start_time,
              end_time: originalSessionWindow.end_time,
              status: "completed",
              session_note_goal_ids: ["goal-1"],
              session_note_goals_addressed: ["Goal 1"],
              session_note_goal_notes: {
                "goal-1": "Plan note",
              },
              session_note_goal_measurements: {},
              session_note_authorization_id: "auth-1",
              session_note_service_code: "97153",
              session_note_persist_requested: true,
            });
            if (result && typeof (result as Promise<unknown>).catch === "function") {
              void (result as Promise<unknown>).catch(() => undefined);
            }
          }}
        >
          submit-terminal-capture
        </button>
        <button
          aria-label="submit-capture-persist-by-id"
          onClick={() => {
            const result = onSubmit({
              id: "session-1",
              therapist_id: "therapist-1",
              client_id: "client-1",
              program_id: "program-1",
              goal_id: "goal-1",
              start_time: futureSessionNoteWindow.start_time,
              end_time: futureSessionNoteWindow.end_time,
              status: "in_progress",
              session_note_goal_ids: ["goal-1", "adhoc-skill-550e8400-e29b-41d4-a716-446655440000"],
              session_note_goals_addressed: ["Goal 1", "Session target"],
              session_note_goal_notes: {
                "goal-1": "Plan note",
                "adhoc-skill-550e8400-e29b-41d4-a716-446655440000": "Adhoc note",
              },
              session_note_goal_measurements: {
                "adhoc-skill-550e8400-e29b-41d4-a716-446655440000": {
                  version: 1,
                  data: { measurement_type: "frequency", metric_value: 1 },
                },
              },
              session_note_authorization_id: "auth-1",
              session_note_service_code: "97153",
              session_note_persist_requested: true,
              session_note_capture_merge_goal_ids: [
                "goal-1",
                "adhoc-skill-550e8400-e29b-41d4-a716-446655440000",
              ],
            });
            if (result && typeof (result as Promise<unknown>).catch === "function") {
              void (result as Promise<unknown>).catch(() => undefined);
            }
          }}
        >
          submit-capture-persist-by-id
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
        <button
          aria-label="submit-cancel-client"
          onClick={() => {
            const result = onSubmit({
              id: session?.id,
              status: "cancelled",
              cancellation_attribution: "client",
            });
            if (result && typeof (result as Promise<unknown>).catch === "function") {
              void (result as Promise<unknown>).catch(() => undefined);
            }
          }}
        >
          submit-cancel-client
        </button>
        <button
          aria-label="reactivate-session"
          disabled={!session || !onReactivate || isReactivating}
          onClick={() => {
            const result = session && onReactivate
              ? onReactivate({
                  session,
                  start_time: originalSessionWindow.start_time,
                  end_time: originalSessionWindow.end_time,
                })
              : undefined;
            if (result && typeof (result as Promise<unknown>).catch === "function") {
              void (result as Promise<unknown>).catch(() => undefined);
            }
          }}
        >
          reactivate-session
        </button>
        <button
          aria-label="reactivate-session-shifted"
          disabled={!session || !onReactivate || isReactivating}
          onClick={() => {
            const shiftedStart = new Date(originalSessionWindow.start_time);
            shiftedStart.setHours(11, 15, 0, 0);
            const shiftedEnd = new Date(originalSessionWindow.end_time);
            shiftedEnd.setHours(12, 15, 0, 0);
            const result = session && onReactivate
              ? onReactivate({
                  session,
                  start_time: shiftedStart.toISOString(),
                  end_time: shiftedEnd.toISOString(),
                })
              : undefined;
            if (result && typeof (result as Promise<unknown>).catch === "function") {
              void (result as Promise<unknown>).catch(() => undefined);
            }
          }}
        >
          reactivate-session-shifted
        </button>
        <button aria-label="close-modal" onClick={onClose}>
          close-modal
        </button>
      </div>
    ) : null,
}));

import { Schedule } from "../Schedule";

const addSessionButtonName = /^Add session on .+ at \d{1,2}:\d{2} [AP]M$/i;

const waitForScheduleGridReady = () =>
  waitFor(() => {
    const activeView = screen.queryByTestId("week-view") ?? screen.queryByTestId("day-view");
    expect(activeView).toBeTruthy();
    return activeView!;
  }, { timeout: 10_000 });

describe("Schedule orchestration integration hardening", () => {
  const SearchProbe = () => {
    const location = useLocation();
    return <output data-testid="schedule-search">{location.search}</output>;
  };

  const resetScheduleFixture = () => {
    scheduleFixtures.sessions.splice(1);
    Object.assign(scheduleFixtures.sessions[0], originalSessionFixture);
  };

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

  it('preserves legacy BT capture mode without restoring the exact-BT start-session exception', async () => {
    renderWithProviders(<Schedule />, {
      auth: { role: 'therapist', roleAssignments: ['therapist'] },
    });
    await screen.findByRole('heading', { name: /Schedule/i });
    await waitForScheduleGridReady();
    await openExistingSessionForEdit();

    expect(await screen.findByTestId('data-collection-only')).toHaveTextContent('true');
    expect(screen.getByTestId('allow-start-session')).toHaveTextContent('false');
  });

  it.each([
    ['profile-only legacy therapist', { role: 'therapist' as const }],
    [
      'overlapping BT and therapist assignments',
      { role: 'therapist' as const, roleAssignments: ['bt', 'therapist'] },
    ],
  ])('keeps BT capture mode closed for %s', async (_label, auth) => {
    renderWithProviders(<Schedule />, { auth });
    await screen.findByRole('heading', { name: /Schedule/i });
    await waitForScheduleGridReady();
    await openExistingSessionForEdit();

    expect(await screen.findByTestId('data-collection-only')).toHaveTextContent('false');
    expect(screen.getByTestId('allow-start-session')).toHaveTextContent('false');
  });

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    resetScheduleFixture();
    formatSessionNoteTimingMock.mockReturnValue({
      sessionDate: "2026-07-23",
      startTime: "14:00:00",
      endTime: "15:00:00",
    });
    upsertClientSessionNoteForSessionMock.mockResolvedValue({
      id: "linked-note-1",
    });
    completeSessionFromModalMock.mockResolvedValue(undefined);
    checkInProgressSessionCloseReadinessMock.mockResolvedValue({
      ready: true,
      requiredGoalIds: ["goal-1"],
      missingGoalIds: [],
    });
    reactivateSessionMock.mockReset();
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

  it("does not repeat session completion when stale trials are explicitly discarded and finalization is retried", async () => {
    const stale = Object.assign(new Error("stale"), { status: 409 });
    scheduleFixtures.sessions[0].status = "in_progress";
    upsertClientSessionNoteForSessionMock
      .mockResolvedValueOnce({ id: "linked-note-1" })
      .mockRejectedValueOnce(stale)
      .mockResolvedValueOnce({ id: "linked-note-1", progression_results: [] });
    renderWithProviders(<Schedule />);
    await screen.findByRole("heading", { name: /Schedule/i });
    await waitForScheduleGridReady();
    await openExistingSessionForEdit();
    await screen.findByTestId("session-modal");
    fireEvent.click(screen.getByLabelText("submit-complete-with-stale-trial"));
    await waitFor(() => expect(upsertClientSessionNoteForSessionMock).toHaveBeenCalledTimes(2));
    expect(completeSessionFromModalMock).toHaveBeenCalledTimes(1);
    expect(checkInProgressSessionCloseReadinessMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("submit-complete-after-discard"));
    await waitFor(() => expect(upsertClientSessionNoteForSessionMock).toHaveBeenCalledTimes(3));
    expect(completeSessionFromModalMock).toHaveBeenCalledTimes(1);
    expect(checkInProgressSessionCloseReadinessMock).toHaveBeenCalledTimes(1);
    expect(upsertClientSessionNoteForSessionMock.mock.calls[1][0]).toMatchObject({
      noteId: "linked-note-1",
      isLocked: true,
    });
    expect(upsertClientSessionNoteForSessionMock.mock.calls[1][0]).not.toHaveProperty("trialEvents");
    expect(upsertClientSessionNoteForSessionMock.mock.calls[2][0]).toMatchObject({
      noteId: "linked-note-1",
      isLocked: true,
    });
    expect(upsertClientSessionNoteForSessionMock.mock.calls[2][0]).not.toHaveProperty("trialEvents");
    expect(upsertClientSessionNoteForSessionMock.mock.calls[2][0].goalNotes).toEqual({ "goal-1": "Keep this note" });
    await waitFor(() => expect(showSuccessMock).toHaveBeenCalledWith("Session marked as completed"));
    await waitFor(() => expect(screen.queryByTestId("session-modal")).not.toBeInTheDocument());
  });

  it("persists an unlocked draft before readiness and completion, then finalizes with the returned note id and without replaying trial events", async () => {
    scheduleFixtures.sessions[0].status = "in_progress";
    upsertClientSessionNoteForSessionMock
      .mockResolvedValueOnce({ id: "linked-note-1" })
      .mockResolvedValueOnce({ id: "linked-note-1", progression_results: [] });

    renderWithProviders(<Schedule />);
    await screen.findByRole("heading", { name: /Schedule/i });
    await waitForScheduleGridReady();
    await openExistingSessionForEdit();
    await screen.findByTestId("session-modal");

    fireEvent.click(screen.getByLabelText("submit-complete-with-stale-trial"));

    await waitFor(() => {
      expect(upsertClientSessionNoteForSessionMock).toHaveBeenCalledTimes(2);
      expect(checkInProgressSessionCloseReadinessMock).toHaveBeenCalledTimes(1);
      expect(completeSessionFromModalMock).toHaveBeenCalledTimes(1);
    });

    const draftCall = upsertClientSessionNoteForSessionMock.mock.calls[0][0];
    const finalizationCall = upsertClientSessionNoteForSessionMock.mock.calls[1][0];
    expect(draftCall.isLocked).toBeUndefined();
    expect(draftCall.noteId).toBeUndefined();
    expect(draftCall.trialEvents).toEqual([{
      target_id: "88888888-8888-4888-8888-888888888888",
      trial_number: 1,
      response: "correct",
      expected_progression_version: 1,
    }]);
    expect(finalizationCall.isLocked).toBe(true);
    expect(finalizationCall.noteId).toBe("linked-note-1");
    expect(finalizationCall).not.toHaveProperty("trialEvents");
    expect(
      upsertClientSessionNoteForSessionMock.mock.invocationCallOrder[0],
    ).toBeLessThan(checkInProgressSessionCloseReadinessMock.mock.invocationCallOrder[0]);
    expect(
      checkInProgressSessionCloseReadinessMock.mock.invocationCallOrder[0],
    ).toBeLessThan(completeSessionFromModalMock.mock.invocationCallOrder[0]);
    expect(
      completeSessionFromModalMock.mock.invocationCallOrder[0],
    ).toBeLessThan(upsertClientSessionNoteForSessionMock.mock.invocationCallOrder[1]);
    await waitFor(() => expect(showSuccessMock).toHaveBeenCalledWith("Session marked as completed"));
  });

  it("stops before readiness and completion when draft persistence fails", async () => {
    scheduleFixtures.sessions[0].status = "in_progress";
    upsertClientSessionNoteForSessionMock.mockRejectedValueOnce(new Error("draft failed"));

    renderWithProviders(<Schedule />);
    await screen.findByRole("heading", { name: /Schedule/i });
    await waitForScheduleGridReady();
    await openExistingSessionForEdit();
    await screen.findByTestId("session-modal");

    fireEvent.click(screen.getByLabelText("submit-complete-with-stale-trial"));

    await waitFor(() => {
      expect(upsertClientSessionNoteForSessionMock).toHaveBeenCalledTimes(1);
    });
    expect(checkInProgressSessionCloseReadinessMock).not.toHaveBeenCalled();
    expect(completeSessionFromModalMock).not.toHaveBeenCalled();
  });

  it("reuses the saved draft note id and avoids replaying trial events when completion fails before finalization", async () => {
    scheduleFixtures.sessions[0].status = "in_progress";
    completeSessionFromModalMock
      .mockRejectedValueOnce(new Error("completion failed"))
      .mockResolvedValueOnce(undefined);
    upsertClientSessionNoteForSessionMock
      .mockResolvedValueOnce({ id: "linked-note-1" })
      .mockResolvedValueOnce({ id: "linked-note-1" })
      .mockResolvedValueOnce({ id: "linked-note-1", progression_results: [] });

    renderWithProviders(<Schedule />);
    await screen.findByRole("heading", { name: /Schedule/i });
    await waitForScheduleGridReady();
    await openExistingSessionForEdit();
    await screen.findByTestId("session-modal");

    fireEvent.click(screen.getByLabelText("submit-complete-with-stale-trial"));

    await waitFor(() => {
      expect(upsertClientSessionNoteForSessionMock).toHaveBeenCalledTimes(1);
      expect(completeSessionFromModalMock).toHaveBeenCalledTimes(1);
      expect(showErrorMock).toHaveBeenCalled();
    });
    expect(checkInProgressSessionCloseReadinessMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText("submit-complete-after-discard"));

    await waitFor(() => {
      expect(upsertClientSessionNoteForSessionMock).toHaveBeenCalledTimes(3);
      expect(completeSessionFromModalMock).toHaveBeenCalledTimes(2);
    });
    expect(upsertClientSessionNoteForSessionMock.mock.calls[1][0]).toMatchObject({
      noteId: "linked-note-1",
    });
    expect(upsertClientSessionNoteForSessionMock.mock.calls[1][0]).not.toHaveProperty("trialEvents");
    expect(upsertClientSessionNoteForSessionMock.mock.calls[2][0]).toMatchObject({
      noteId: "linked-note-1",
      isLocked: true,
    });
    expect(upsertClientSessionNoteForSessionMock.mock.calls[2][0]).not.toHaveProperty("trialEvents");
    await waitFor(() => expect(showSuccessMock).toHaveBeenCalledWith("Session marked as completed"));
  });

  it("persists only trials added after an earlier draft save when completion is retried", async () => {
    scheduleFixtures.sessions[0].status = "in_progress";
    completeSessionFromModalMock
      .mockRejectedValueOnce(new Error("completion failed"))
      .mockResolvedValueOnce(undefined);
    upsertClientSessionNoteForSessionMock
      .mockResolvedValueOnce({ id: "linked-note-1" })
      .mockResolvedValueOnce({ id: "linked-note-1" })
      .mockResolvedValueOnce({ id: "linked-note-1", progression_results: [] });

    renderWithProviders(<Schedule />);
    await screen.findByRole("heading", { name: /Schedule/i });
    await waitForScheduleGridReady();
    await openExistingSessionForEdit();
    await screen.findByTestId("session-modal");

    fireEvent.click(screen.getByLabelText("submit-complete-with-stale-trial"));
    await waitFor(() => expect(completeSessionFromModalMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByLabelText("submit-complete-with-new-trial"));
    await waitFor(() => expect(upsertClientSessionNoteForSessionMock).toHaveBeenCalledTimes(3));

    expect(upsertClientSessionNoteForSessionMock.mock.calls[1][0]).toMatchObject({
      noteId: "linked-note-1",
      trialEvents: [{
        target_id: "88888888-8888-4888-8888-888888888888",
        trial_number: 2,
        response: "incorrect",
        expected_progression_version: 1,
      }],
    });
    expect(upsertClientSessionNoteForSessionMock.mock.calls[2][0]).toMatchObject({
      noteId: "linked-note-1",
      isLocked: true,
    });
    expect(upsertClientSessionNoteForSessionMock.mock.calls[2][0]).not.toHaveProperty("trialEvents");
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
    await waitForScheduleGridReady();
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

    fireEvent.click(screen.getAllByRole("button", { name: addSessionButtonName })[0]);
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
  }, 15_000);

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
    await waitForScheduleGridReady();

    fireEvent.click(screen.getAllByRole("button", { name: addSessionButtonName })[0]);
    await screen.findByTestId("session-modal");
    fireEvent.click(screen.getByLabelText("submit-create"));

    await waitFor(() => {
      expect(showErrorMock).toHaveBeenCalled();
      expect(screen.getByTestId("retry-hint")).toHaveTextContent("conflict-hint");
    });
    expect(screen.getByTestId("session-modal")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("submit-create"));

    await waitFor(() => {
      expect(bookSessionViaApiMock).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByTestId("retry-hint")).toHaveTextContent("");
    expect(screen.getByTestId("session-modal")).toBeInTheDocument();
  }, 15_000);

  it.each([
    ["admin", "admin"],
    ["super admin", "super_admin"],
  ] as const)("manual edit cancel path stays distinct and closes modal for %s", async (_label, role) => {
    renderWithProviders(<Schedule />, {
      auth: { role, organizationId: "org-1" },
    });
    await screen.findByRole("heading", { name: /Schedule/i });
    await waitForScheduleGridReady();

    await openExistingSessionForEdit();
    await screen.findByTestId("session-modal");
    expect(screen.getByTestId("modal-mode")).toHaveTextContent("edit");

    fireEvent.click(screen.getByLabelText("submit-cancel"));

    await waitFor(() => {
      expect(cancelSessionsMock).toHaveBeenCalledWith(expect.objectContaining({
        sessionIds: ["session-1"],
        reason: "cancel reason",
      }));
    });
    expect(showSuccessMock).toHaveBeenCalled();
  });

  it.each([
    ["midtier", "midtier", "true"],
    ["admin schedule", "admin_schedule", "true"],
    ["admin", "admin", "true"],
    ["bcba", "bcba", "true"],
    ["super admin", "super_admin", "true"],
    ["bt", "bt", "false"],
    ["therapist", "therapist", "false"],
  ] as const)("wires create schedules permission for %s", async (_label, role, expectedCanCreate) => {
    renderWithProviders(<Schedule />, {
      auth: { role, organizationId: "org-1" },
    });
    await screen.findByRole("heading", { name: /Schedule/i });
    await waitForScheduleGridReady();
    await openExistingSessionForEdit();
    await screen.findByTestId("session-modal");

    expect(screen.getByTestId("can-create-schedules")).toHaveTextContent(expectedCanCreate);
  });

  it.each([
    ["admin schedule", "admin_schedule", "true"],
    ["admin", "admin", "true"],
    ["bcba", "bcba", "true"],
    ["super admin", "super_admin", "true"],
    ["midtier", "midtier", "false"],
    ["bt", "bt", "false"],
    ["therapist", "therapist", "false"],
  ] as const)("wires appointment deletion authority for %s", async (_label, role, expectedCanDelete) => {
    renderWithProviders(<Schedule />, {
      auth: { role, organizationId: "org-1" },
    });
    await screen.findByRole("heading", { name: /Schedule/i });
    await waitForScheduleGridReady();
    await openExistingSessionForEdit();
    await screen.findByTestId("session-modal");

    expect(screen.getByTestId("delete-available")).toHaveTextContent(expectedCanDelete);
  });

  it("deletes the selected appointment, closes the modal, and refreshes schedule queries", async () => {
    const invalidateQueriesSpy = vi.spyOn(QueryClient.prototype, "invalidateQueries");

    renderWithProviders(<Schedule />, {
      auth: { role: "admin_schedule", organizationId: "org-1" },
    });
    await screen.findByRole("heading", { name: /Schedule/i });
    await waitForScheduleGridReady();
    await openExistingSessionForEdit();
    await screen.findByTestId("session-modal");

    fireEvent.click(screen.getByLabelText("delete-appointment"));

    await waitFor(() => {
      expect(cancelSessionsMock).toHaveBeenCalledWith({
        sessionIds: ["session-1"],
        cancellationAttribution: "staff",
      });
    });
    await waitFor(() => expect(screen.queryByTestId("session-modal")).not.toBeInTheDocument());
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ["sessions"] });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ["sessions-batch"] });
    invalidateQueriesSpy.mockRestore();
  });

  it("deletes only the appointment selected from an overlapping block", async () => {
    const overlapWindowStart = new Date(2025, 6, 2, 10, 0, 0, 0);
    const overlapWindowEnd = new Date(2025, 6, 2, 10, 30, 0, 0);
    const overlapSession = {
      ...originalSessionFixture,
      id: "session-overlap",
      start_time: overlapWindowStart.toISOString(),
      end_time: overlapWindowEnd.toISOString(),
      client: { id: "client-1", full_name: "Overlap Client" },
    };
    Object.assign(scheduleFixtures.sessions[0], {
      ...originalSessionFixture,
      start_time: overlapWindowStart.toISOString(),
      end_time: overlapWindowEnd.toISOString(),
    });
    scheduleFixtures.sessions.push(overlapSession);

    renderWithProviders(<Schedule />, {
      auth: { role: "bcba", organizationId: "org-1" },
    });
    await screen.findByRole("heading", { name: /Schedule/i });

    const overlapTrigger = await screen.findByRole("button", { name: /2 appointments/i });
    fireEvent.click(overlapTrigger);
    const overlapDialog = screen.getByRole("dialog", { name: /2 overlapping appointments/i });
    fireEvent.click(within(overlapDialog).getByRole("button", { name: /Overlap Client/i }));

    expect(await screen.findByTestId("selected-session-id")).toHaveTextContent("session-overlap");
    fireEvent.click(screen.getByLabelText("delete-appointment"));

    await waitFor(() => {
      expect(cancelSessionsMock).toHaveBeenCalledWith({
        sessionIds: ["session-overlap"],
        cancellationAttribution: "staff",
      });
    });
    expect(cancelSessionsMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["admin schedule", "admin_schedule", true],
    ["admin", "admin", true],
    ["bcba", "bcba", true],
    ["super admin", "super_admin", true],
    ["therapist", "therapist", false],
    ["BT", "bt", false],
  ] as const)("gates occupied-block create actions for %s", async (_label, role, expectedVisible) => {
    renderWithProviders(<Schedule />, {
      auth: { role, organizationId: "org-1" },
    });
    await screen.findByRole("heading", { name: /Schedule/i });
    await waitForScheduleGridReady();

    const occupiedCreateButton = screen.queryByRole("button", {
      name: /add session within occupied block/i,
    });

    if (!expectedVisible) {
      expect(occupiedCreateButton).toBeNull();
      return;
    }

    expect(occupiedCreateButton).toBeTruthy();
    fireEvent.click(occupiedCreateButton!);
    await screen.findByTestId("session-modal");

    expect(screen.getByTestId("modal-mode")).toHaveTextContent("create");
    expect(screen.getByTestId("can-create-schedules")).toHaveTextContent("true");
  });

  it.each([
    ["admin", "admin", "true"],
    ["admin schedule", "admin_schedule", "true"],
    ["bcba", "bcba", "true"],
    ["midtier", "midtier", "true"],
    ["super admin", "super_admin", "true"],
    ["therapist", "therapist", "false"],
    ["BT", "bt", "false"],
  ] as const)("wires appointment reactivation availability for %s", async (_label, role, expectedAvailable) => {
    scheduleFixtures.sessions[0].status = "cancelled";

    renderWithProviders(<Schedule />, {
      auth: { role, organizationId: "org-1" },
    });
    await screen.findByRole("heading", { name: /Schedule/i });
    await waitForScheduleGridReady();
    await openExistingSessionForEdit();
    await screen.findByTestId("session-modal");

    expect(screen.getByTestId("reactivate-available")).toHaveTextContent(expectedAvailable);
  });

  it.each(["reactivated", "already_reactivated"] as const)(
    "handles the %s outcome, refreshes caches, and closes the modal",
    async (outcome) => {
    scheduleFixtures.sessions[0].status = "cancelled";
    reactivateSessionMock.mockResolvedValueOnce({
      outcome,
      sessionId: "session-1",
    });
    const invalidateQueriesSpy = vi
      .spyOn(QueryClient.prototype, "invalidateQueries")
      .mockResolvedValue(undefined as never);

    renderWithProviders(<Schedule />, {
      auth: { role: "admin", organizationId: "org-1" },
    });
    await screen.findByRole("heading", { name: /Schedule/i });
    await waitForScheduleGridReady();
    await openExistingSessionForEdit();
    await screen.findByTestId("session-modal");

    fireEvent.click(screen.getByLabelText("reactivate-session"));

    await waitFor(() => {
      expect(reactivateSessionMock).toHaveBeenCalledWith({
        sessionId: "session-1",
        startTime: originalSessionWindow.start_time,
        endTime: originalSessionWindow.end_time,
      });
    });
    await waitFor(() => {
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ["sessions"] });
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ["sessions-batch"] });
    });
    await waitFor(() => expect(screen.queryByTestId("session-modal")).not.toBeInTheDocument());
    expect(showSuccessMock).toHaveBeenCalledWith("Appointment reactivated");

    invalidateQueriesSpy.mockRestore();
    },
  );

  it("keeps the modal open with a retry hint when reactivation hits a conflict", async () => {
    scheduleFixtures.sessions[0].status = "cancelled";
    reactivateSessionMock.mockResolvedValueOnce({
      outcome: "conflict",
      code: "THERAPIST_CONFLICT",
    });

    renderWithProviders(<Schedule />, {
      auth: { role: "admin", organizationId: "org-1" },
    });
    await screen.findByRole("heading", { name: /Schedule/i });
    await waitForScheduleGridReady();
    await openExistingSessionForEdit();
    await screen.findByTestId("session-modal");

    fireEvent.click(screen.getByLabelText("reactivate-session"));

    await waitFor(() => {
      expect(reactivateSessionMock).toHaveBeenCalledWith({
        sessionId: "session-1",
        startTime: originalSessionWindow.start_time,
        endTime: originalSessionWindow.end_time,
      });
    });
    expect(screen.getByTestId("session-modal")).toBeInTheDocument();
    expect(screen.getByTestId("retry-hint")).toHaveTextContent(
      "Original appointment time is no longer available. Choose a new time to reschedule this appointment.",
    );
    expect(showSuccessMock).not.toHaveBeenCalledWith("Appointment reactivated");
  });

  it("keeps the modal open when reactivation fails with a terminal error", async () => {
    scheduleFixtures.sessions[0].status = "cancelled";
    reactivateSessionMock.mockRejectedValueOnce(
      new Error("Authorization no longer covers the original appointment time."),
    );

    renderWithProviders(<Schedule />, {
      auth: { role: "admin", organizationId: "org-1" },
    });
    await screen.findByRole("heading", { name: /Schedule/i });
    await waitForScheduleGridReady();
    await openExistingSessionForEdit();
    await screen.findByTestId("session-modal");

    fireEvent.click(screen.getByLabelText("reactivate-session"));

    await waitFor(() => {
      expect(showErrorMock).toHaveBeenCalledWith(
        "Authorization no longer covers the original appointment time.",
      );
    });
    expect(screen.getByTestId("session-modal")).toBeInTheDocument();
  });

  it("sends the edited window directly to reactivation without a move call", async () => {
    scheduleFixtures.sessions[0].status = "cancelled";
    reactivateSessionMock
      .mockResolvedValueOnce({
        outcome: "conflict",
        code: "THERAPIST_CONFLICT",
      })
      .mockResolvedValueOnce({
        outcome: "reactivated",
        sessionId: "session-1",
      });

    renderWithProviders(<Schedule />, {
      auth: { role: "admin", organizationId: "org-1" },
    });
    await screen.findByRole("heading", { name: /Schedule/i });
    await waitForScheduleGridReady();
    await openExistingSessionForEdit();
    await screen.findByTestId("session-modal");

    fireEvent.click(screen.getByLabelText("reactivate-session"));
    await waitFor(() => {
      expect(screen.getByTestId("retry-hint")).toHaveTextContent(
        "Original appointment time is no longer available. Choose a new time to reschedule this appointment.",
      );
    });

    fireEvent.click(screen.getByLabelText("reactivate-session-shifted"));

    await waitFor(() => {
      expect(reactivateSessionMock).toHaveBeenLastCalledWith({
        sessionId: "session-1",
        startTime: shiftedSessionWindow.start_time,
        endTime: shiftedSessionWindow.end_time,
      });
    });
    expect(bookSessionViaApiMock).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId("session-modal")).not.toBeInTheDocument());
    expect(showSuccessMock).toHaveBeenCalledWith("Appointment reactivated");
  });

  it("keeps the modal open on edited-window reactivation errors and does not call book/move", async () => {
    scheduleFixtures.sessions[0].status = "cancelled";
    reactivateSessionMock.mockResolvedValueOnce({
      outcome: "conflict",
      code: "THERAPIST_CONFLICT",
    });
    reactivateSessionMock.mockRejectedValueOnce(
      new Error("Authorization no longer covers the original appointment time."),
    );

    renderWithProviders(<Schedule />, {
      auth: { role: "admin", organizationId: "org-1" },
    });
    await screen.findByRole("heading", { name: /Schedule/i });
    await waitForScheduleGridReady();
    await openExistingSessionForEdit();
    await screen.findByTestId("session-modal");

    fireEvent.click(screen.getByLabelText("reactivate-session"));
    await waitFor(() => {
      expect(screen.getByTestId("retry-hint")).toHaveTextContent(
        "Original appointment time is no longer available. Choose a new time to reschedule this appointment.",
      );
    });

    fireEvent.click(screen.getByLabelText("reactivate-session-shifted"));

    await waitFor(() => {
      expect(showErrorMock).toHaveBeenCalledWith(
        "Authorization no longer covers the original appointment time.",
      );
    });
    expect(reactivateSessionMock).toHaveBeenCalledTimes(2);
    expect(bookSessionViaApiMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("session-modal")).toBeInTheDocument();
  });

  it("retries edited-window reactivation without any book/move call after a terminal error", async () => {
    scheduleFixtures.sessions[0].status = "cancelled";
    reactivateSessionMock
      .mockResolvedValueOnce({
        outcome: "conflict",
        code: "THERAPIST_CONFLICT",
      })
      .mockRejectedValueOnce(
        new Error("Authorization no longer covers the original appointment time."),
      )
      .mockRejectedValueOnce(
        new Error("Authorization no longer covers the original appointment time."),
      );

    renderWithProviders(<Schedule />, {
      auth: { role: "admin", organizationId: "org-1" },
    });
    await screen.findByRole("heading", { name: /Schedule/i });
    await waitForScheduleGridReady();
    await openExistingSessionForEdit();
    await screen.findByTestId("session-modal");

    fireEvent.click(screen.getByLabelText("reactivate-session"));
    await waitFor(() => {
      expect(screen.getByTestId("retry-hint")).toHaveTextContent(
        "Original appointment time is no longer available. Choose a new time to reschedule this appointment.",
      );
    });

    fireEvent.click(screen.getByLabelText("reactivate-session-shifted"));
    await waitFor(() => {
      expect(showErrorMock).toHaveBeenCalledWith(
        "Authorization no longer covers the original appointment time.",
      );
    });
    expect(bookSessionViaApiMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("session-modal")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("reactivate-session-shifted"));

    await waitFor(() => {
      expect(reactivateSessionMock).toHaveBeenCalledTimes(3);
    });
    expect(reactivateSessionMock).toHaveBeenLastCalledWith({
      sessionId: "session-1",
      startTime: shiftedSessionWindow.start_time,
      endTime: shiftedSessionWindow.end_time,
    });
    expect(bookSessionViaApiMock).not.toHaveBeenCalled();
  });

  it("forwards cancellation attribution through the schedule modal boundary", async () => {
    renderWithProviders(<Schedule />, {
      auth: { role: "admin", organizationId: "org-1" },
    });
    await screen.findByRole("heading", { name: /Schedule/i });
    await waitForScheduleGridReady();

    await openExistingSessionForEdit();
    await screen.findByTestId("session-modal");
    fireEvent.click(screen.getByLabelText("submit-cancel-client"));

    await waitFor(() => {
      expect(cancelSessionsMock).toHaveBeenCalledWith({
        sessionIds: ["session-1"],
        reason: undefined,
        cancellationAttribution: "client",
      });
    });
  });

  it("falls back to staff cancellation attribution when the modal does not provide one", async () => {
    renderWithProviders(<Schedule />, {
      auth: { role: "admin", organizationId: "org-1" },
    });
    await screen.findByRole("heading", { name: /Schedule/i });
    await waitForScheduleGridReady();

    await openExistingSessionForEdit();
    await screen.findByTestId("session-modal");
    fireEvent.click(screen.getByLabelText("submit-cancel"));

    await waitFor(() => {
      expect(cancelSessionsMock).toHaveBeenCalledWith({
        sessionIds: ["session-1"],
        reason: "cancel reason",
        cancellationAttribution: "staff",
      });
    });
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

  it("manual live capture persistence upserts notes before updating the session", async () => {
    scheduleFixtures.sessions[0].status = "in_progress";

    renderWithProviders(<Schedule />);
    await screen.findByRole("heading", { name: /Schedule/i });

    await openExistingSessionForEdit();
    await screen.findByTestId("session-modal");
    expect(screen.getByTestId("modal-mode")).toHaveTextContent("edit");
    fireEvent.click(screen.getByLabelText("submit-capture-persist"));

    await waitFor(() => {
      expect(upsertClientSessionNoteForSessionMock).toHaveBeenCalledTimes(1);
      expect(bookSessionViaApiMock).toHaveBeenCalledTimes(1);
    });
    expect(formatSessionNoteTimingMock).toHaveBeenCalledWith({
      startTimeIso: futureSessionNoteWindow.start_time,
      endTimeIso: futureSessionNoteWindow.end_time,
      resolvedTimeZone: expect.any(String),
    });
    expect(upsertClientSessionNoteForSessionMock).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "session-1",
      clientId: "client-1",
      authorizationId: "auth-1",
      serviceCode: "97153",
      sessionDate: "2026-07-23",
      startTime: "14:00:00",
      endTime: "15:00:00",
      captureMergeGoalIds: [
        "goal-1",
        "adhoc-skill-550e8400-e29b-41d4-a716-446655440000",
      ],
      goalNotes: expect.objectContaining({
        "adhoc-skill-550e8400-e29b-41d4-a716-446655440000": "Adhoc note",
      }),
      trialEvents: [{
        target_id: "88888888-8888-4888-8888-888888888888",
        trial_number: 1,
        response: "correct",
        metadata: { source: "schedule_capture" },
      }],
    }));
    expect(bookSessionViaApiMock.mock.calls[0][1]).toBeUndefined();
    expect(showErrorMock).not.toHaveBeenCalled();
  });

  it("allows a BT to start an existing scheduled appointment in data-only mode", async () => {
    renderWithProviders(<Schedule />, {
      auth: { role: "bt", organizationId: "org-1" },
    });
    await screen.findByRole("heading", { name: /Schedule/i });
    await waitForScheduleGridReady();

    await openExistingSessionForEdit();
    await screen.findByTestId("session-modal");

    expect(screen.getByTestId("data-collection-only")).toHaveTextContent("true");
    expect(screen.getByTestId("allow-start-session")).toHaveTextContent("true");
  });

  it("does not allow a BT to start an appointment that already has started_at", async () => {
    scheduleFixtures.sessions[0].started_at = "2026-07-16T10:00:00.000Z";

    renderWithProviders(<Schedule />, {
      auth: { role: "bt", organizationId: "org-1" },
    });
    await screen.findByRole("heading", { name: /Schedule/i });
    await waitForScheduleGridReady();
    await openExistingSessionForEdit();

    expect(await screen.findByTestId("allow-start-session")).toHaveTextContent("false");
  });

  it.each(["in_progress", "completed", "cancelled"])(
    "does not allow a BT to start an existing %s appointment",
    async (status) => {
      scheduleFixtures.sessions[0].status = status;

      renderWithProviders(<Schedule />, {
        auth: { role: "bt", organizationId: "org-1" },
      });
      await screen.findByRole("heading", { name: /Schedule/i });
      await waitForScheduleGridReady();
      await openExistingSessionForEdit();

      expect(await screen.findByTestId("allow-start-session")).toHaveTextContent("false");
    },
  );

  it("does not allow a non-BT to use the BT start-session exception", async () => {
    renderWithProviders(<Schedule />, {
      auth: { role: "bcba", organizationId: "org-1" },
    });
    await screen.findByRole("heading", { name: /Schedule/i });
    await waitForScheduleGridReady();
    await openExistingSessionForEdit();

    expect(await screen.findByTestId("allow-start-session")).toHaveTextContent("false");
  });

  it("does not enable the BT start-session exception when there is no existing appointment", async () => {
    renderWithProviders(<Schedule />, {
      auth: { role: "admin", organizationId: "org-1" },
    });
    await screen.findByRole("heading", { name: /Schedule/i });
    await waitForScheduleGridReady();
    fireEvent.click(screen.getAllByRole("button", { name: addSessionButtonName })[0]);

    expect(await screen.findByTestId("modal-mode")).toHaveTextContent("create");
    expect(screen.getByTestId("allow-start-session")).toHaveTextContent("false");
  });

  it("BT scheduled-session capture saves clinical data without updating appointment metadata", async () => {
    renderWithProviders(<Schedule />, {
      auth: { role: "bt", organizationId: "org-1" },
    });
    await screen.findByRole("heading", { name: /Schedule/i });

    await openExistingSessionForEdit();
    await screen.findByTestId("session-modal");
    expect(screen.getByTestId("modal-mode")).toHaveTextContent("edit");
    expect(screen.getByTestId("data-collection-only")).toHaveTextContent("true");
    fireEvent.click(screen.getByLabelText("submit-capture-persist"));

    await waitFor(() => {
      expect(upsertClientSessionNoteForSessionMock).toHaveBeenCalledTimes(1);
    });
    expect(bookSessionViaApiMock).not.toHaveBeenCalled();
    expect(completeSessionFromModalMock).not.toHaveBeenCalled();
    expect(invalidateSessionNoteCachesAfterSessionWriteMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sessionId: "session-1",
        clientId: "client-1",
      }),
    );
    expect(showSuccessMock).toHaveBeenCalledWith("Session data collection saved");
    expect(showErrorMock).not.toHaveBeenCalled();
  });

  it("BT in-progress capture saves clinical data without updating or completing the appointment", async () => {
    scheduleFixtures.sessions[0].status = "in_progress";

    renderWithProviders(<Schedule />, {
      auth: { role: "bt", organizationId: "org-1" },
    });
    await screen.findByRole("heading", { name: /Schedule/i });

    await openExistingSessionForEdit();
    await screen.findByTestId("session-modal");
    expect(screen.getByTestId("data-collection-only")).toHaveTextContent("true");
    fireEvent.click(screen.getByLabelText("submit-capture-persist"));

    await waitFor(() => {
      expect(upsertClientSessionNoteForSessionMock).toHaveBeenCalledTimes(1);
    });
    expect(bookSessionViaApiMock).not.toHaveBeenCalled();
    expect(completeSessionFromModalMock).not.toHaveBeenCalled();
    expect(showSuccessMock).toHaveBeenCalledWith("Session data collection saved");
    expect(showErrorMock).not.toHaveBeenCalled();
  });

  it("BT closeout capture stays in progress and only atomic completion resets the schedule", async () => {
    scheduleFixtures.sessions[0].status = "in_progress";

    renderWithProviders(<Schedule />, {
      auth: { role: "bt", organizationId: "org-1" },
    });
    await screen.findByRole("heading", { name: /Schedule/i });

    await openExistingSessionForEdit();
    await screen.findByTestId("session-modal");
    expect(screen.getByTestId("data-collection-only")).toHaveTextContent("true");
    fireEvent.click(screen.getByLabelText("submit-bt-closeout-capture"));

    await waitFor(() => {
      expect(upsertClientSessionNoteForSessionMock).toHaveBeenCalledTimes(1);
    });
    expect(completeSessionFromModalMock).not.toHaveBeenCalled();
    expect(showSuccessMock).not.toHaveBeenCalledWith("Session data collection saved");

    fireEvent.click(screen.getByLabelText("report-bt-atomic-completion"));
    fireEvent.click(screen.getByLabelText("report-bt-atomic-completion"));
    await waitFor(() => expect(showSuccessMock).toHaveBeenCalledWith("Session marked as completed"));
    expect(showSuccessMock.mock.calls.filter(([message]) => message === "Session marked as completed")).toHaveLength(1);
    expect(bookSessionViaApiMock).not.toHaveBeenCalled();
    expect(showErrorMock).not.toHaveBeenCalled();
  });

  it("atomic BT completion closes a deep-linked modal and clears only its URL state", async () => {
    scheduleFixtures.sessions[0].status = "in_progress";
    const expiresAtMs = Date.now() + 60_000;
    let releaseRefresh!: () => void;
    const pendingRefresh = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const invalidateQueriesSpy = vi
      .spyOn(QueryClient.prototype, "invalidateQueries")
      .mockReturnValue(pendingRefresh);

    renderWithProviders(
      <>
        <Schedule />
        <SearchProbe />
      </>,
      {
        auth: { role: "bt", organizationId: "org-1" },
        router: {
          initialEntries: [
            `/?keep=1&scheduleModal=edit&scheduleSessionId=session-1&scheduleExp=${expiresAtMs}`,
          ],
        },
      },
    );

    await screen.findByTestId("session-modal");
    fireEvent.click(screen.getByLabelText("report-bt-atomic-completion"));

    await waitFor(() => {
      const params = new URLSearchParams(screen.getByTestId("schedule-search").textContent ?? "");
      expect(params.get("keep")).toBe("1");
      expect(params.has("scheduleModal")).toBe(false);
      expect(params.has("scheduleSessionId")).toBe(false);
      expect(params.has("scheduleExp")).toBe(false);
    });
    expect(screen.getByTestId("session-modal")).toBeInTheDocument();

    releaseRefresh();
    await waitFor(() => expect(screen.queryByTestId("session-modal")).not.toBeInTheDocument());
    invalidateQueriesSpy.mockRestore();
  });

  it("rejects the legacy BT completed submission path", async () => {
    scheduleFixtures.sessions[0].status = "in_progress";
    renderWithProviders(<Schedule />, { auth: { role: "bt", organizationId: "org-1" } });
    await screen.findByRole("heading", { name: /Schedule/i });
    await openExistingSessionForEdit();
    fireEvent.click(screen.getByLabelText("submit-terminal-capture"));

    await waitFor(() => expect(showErrorMock).toHaveBeenCalledWith(
      "Complete the required ABA Session Note before closing this session.",
    ));
    expect(completeSessionFromModalMock).not.toHaveBeenCalled();
  });

  it.each([
    ["admin", "admin", "true"],
    ["admin schedule", "admin_schedule", "true"],
    ["bcba", "bcba", "false"],
  ] as const)("wires goal-capture visibility for %s schedule sessions", async (_label, role, expectedHidden) => {
    renderWithProviders(<Schedule />, {
      auth: { role, organizationId: "org-1" },
    });
    await screen.findByRole("heading", { name: /Schedule/i });
    await waitForScheduleGridReady();

    fireEvent.click(screen.getAllByRole("button", { name: addSessionButtonName })[0]);
    await screen.findByTestId("session-modal");

    expect(screen.getByTestId("hide-goal-capture-fields")).toHaveTextContent(expectedHidden);
  });

  it("manual live capture persistence can resolve the edit session from submitted id", async () => {
    scheduleFixtures.sessions[0].status = "in_progress";

    renderWithProviders(<Schedule />);
    await screen.findByRole("heading", { name: /Schedule/i });
    await waitForScheduleGridReady();

    fireEvent.click(screen.getAllByRole("button", { name: addSessionButtonName })[0]);
    await screen.findByTestId("session-modal");
    expect(screen.getByTestId("modal-mode")).toHaveTextContent("create");
    fireEvent.click(screen.getByLabelText("submit-capture-persist-by-id"));

    await waitFor(() => {
      expect(upsertClientSessionNoteForSessionMock).toHaveBeenCalledTimes(1);
      expect(bookSessionViaApiMock).toHaveBeenCalledTimes(1);
    });
    expect(formatSessionNoteTimingMock).toHaveBeenCalledWith({
      startTimeIso: futureSessionNoteWindow.start_time,
      endTimeIso: futureSessionNoteWindow.end_time,
      resolvedTimeZone: expect.any(String),
    });
    expect(upsertClientSessionNoteForSessionMock).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "session-1",
      clientId: "client-1",
      authorizationId: "auth-1",
      serviceCode: "97153",
      sessionDate: "2026-07-23",
      startTime: "14:00:00",
      endTime: "15:00:00",
    }));
    expect(invalidateSessionNoteCachesAfterSessionWriteMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sessionId: "session-1",
        clientId: "client-1",
      }),
    );
    expect(bookSessionViaApiMock.mock.calls[0][1]).toBeUndefined();
    expect(showErrorMock).not.toHaveBeenCalled();
  });

  it("does not update the session when live capture persistence fails", async () => {
    scheduleFixtures.sessions[0].status = "in_progress";
    upsertClientSessionNoteForSessionMock.mockRejectedValueOnce(new Error("upsert failed"));

    renderWithProviders(<Schedule />);
    await screen.findByRole("heading", { name: /Schedule/i });
    await waitForScheduleGridReady();

    fireEvent.click(screen.getAllByRole("button", { name: addSessionButtonName })[0]);
    await screen.findByTestId("session-modal");
    fireEvent.click(screen.getByLabelText("submit-capture-persist-by-id"));

    await waitFor(() => {
      expect(upsertClientSessionNoteForSessionMock).toHaveBeenCalledTimes(1);
    });
    expect(bookSessionViaApiMock).not.toHaveBeenCalled();
  });

  it("manual close clears retry hint without success-style submission", async () => {
    bookSessionViaApiMock.mockRejectedValueOnce({
      status: 409,
      message: "Conflict",
    });

    renderWithProviders(<Schedule />);
    await screen.findByRole("heading", { name: /Schedule/i });

    fireEvent.click(screen.getAllByRole("button", { name: addSessionButtonName })[0]);
    await screen.findByTestId("session-modal");
    fireEvent.click(screen.getByLabelText("submit-create"));

    await waitFor(() => {
      expect(screen.getByTestId("retry-hint")).toHaveTextContent("conflict-hint");
    });

    fireEvent.click(screen.getByLabelText("close-modal"));
    await waitFor(() => expect(screen.queryByTestId("session-modal")).not.toBeInTheDocument());
    expect(bookSessionViaApiMock).toHaveBeenCalledTimes(1);
    expect(showSuccessMock).not.toHaveBeenCalled();
  });

  it("closing an edit modal resets parent state so the next empty-slot open is a fresh create modal", async () => {
    renderWithProviders(
      <>
        <Schedule />
        <SearchProbe />
      </>,
    );
    await screen.findByRole("heading", { name: /Schedule/i });
    await waitForScheduleGridReady();

    await openExistingSessionForEdit();
    await screen.findByTestId("session-modal");
    expect(screen.getByTestId("modal-mode")).toHaveTextContent("edit");
    expect(document.querySelectorAll('[data-testid="session-modal"]')).toHaveLength(1);
    expect(screen.getByTestId("schedule-search")).toHaveTextContent("scheduleModal=edit");

    fireEvent.click(screen.getByLabelText("close-modal"));
    await waitFor(() => {
      expect(screen.getByTestId("schedule-search")).not.toHaveTextContent("scheduleModal");
      expect(screen.queryByTestId("session-modal")).not.toBeInTheDocument();
    });
    fireEvent.click(screen.getAllByRole("button", { name: addSessionButtonName })[0]);
    await screen.findByTestId("session-modal");

    expect(screen.getByTestId("modal-mode")).toHaveTextContent("create");
    expect(screen.getByTestId("retry-hint")).toHaveTextContent("");
    expect(document.querySelectorAll('[data-testid="session-modal"]')).toHaveLength(1);
  });

});
