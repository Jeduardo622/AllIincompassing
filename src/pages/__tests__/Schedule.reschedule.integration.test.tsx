import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import { addDays, format, startOfWeek } from "date-fns";
import { renderWithProviders, screen, waitFor } from "../../test/utils";
import type { Client, Session, Therapist } from "../../types";
import { createSessionSlotKey } from "../schedule-utils";

const bookSessionViaApiMock = vi.fn();
const showErrorMock = vi.fn();
const showSuccessMock = vi.fn();
let latestRescheduleHandler:
  | ((session: Session, target: { date: Date; time: string }) => void)
  | null = null;

type ScheduleStore = {
  sessions: Session[];
  therapists: Therapist[];
  clients: Client[];
};

const scheduleStoreListeners = new Set<() => void>();
let scheduleStore: ScheduleStore;

const subscribeToScheduleStore = (listener: () => void) => {
  scheduleStoreListeners.add(listener);
  return () => {
    scheduleStoreListeners.delete(listener);
  };
};

const getScheduleStoreSnapshot = () => scheduleStore;

const useScheduleStore = () =>
  useSyncExternalStore(subscribeToScheduleStore, getScheduleStoreSnapshot, getScheduleStoreSnapshot);

const setScheduleStore = (next: ScheduleStore) => {
  scheduleStore = next;
  scheduleStoreListeners.forEach((listener) => listener());
};

vi.mock("../../lib/optimizedQueries", () => ({
  useScheduleDataBatch: () => {
    const data = useScheduleStore();
    return { data, isLoading: false, isError: false, error: null };
  },
  useSessionsOptimized: () => {
    const data = useScheduleStore();
    return { data: data.sessions, isLoading: false, isError: false, error: null };
  },
  useDropdownData: () => {
    const data = useScheduleStore();
    return {
      data: { therapists: data.therapists, clients: data.clients },
      isLoading: false,
      isError: false,
      error: null,
    };
  },
  useSmartPrefetch: () => ({
    prefetchScheduleRange: vi.fn(),
    prefetchNextWeek: vi.fn(),
    prefetchReportData: vi.fn(),
  }),
}));

vi.mock("../../features/scheduling/domain/booking", () => ({
  buildBookSessionApiPayload: (session: unknown) => session,
  bookSessionViaApi: (...args: unknown[]) => bookSessionViaApiMock(...args),
}));

vi.mock("../../lib/toast", () => ({
  showError: (...args: unknown[]) => showErrorMock(...args),
  showSuccess: (...args: unknown[]) => showSuccessMock(...args),
}));

vi.mock("../ScheduleWeekView", () => ({
  ScheduleWeekView: ({
    weekDays,
    timeSlots,
    sessionSlotIndex,
    onRescheduleSession,
  }: {
    weekDays: Date[];
    timeSlots: string[];
    sessionSlotIndex: Map<string, Session[]>;
    onRescheduleSession?: (session: Session, target: { date: Date; time: string }) => void;
  }) => {
    latestRescheduleHandler = onRescheduleSession ?? null;
    const allSessions = Array.from(sessionSlotIndex.values()).flat();
    const sessionToMove = allSessions[0] ?? null;
    const targetDate = sessionToMove ? new Date(sessionToMove.start_time) : weekDays[0];

    return (
      <div data-testid="schedule-week-view-mock">
        <div data-testid="reschedule-target-date">{targetDate?.toISOString() ?? ""}</div>
        {weekDays.flatMap((day) =>
          timeSlots.map((time) => {
            const slotKey = createSessionSlotKey(format(day, "yyyy-MM-dd"), time);
            const slotSessions = sessionSlotIndex.get(slotKey) ?? [];
            return (
              <div key={slotKey} data-slot-key={slotKey}>
                {slotSessions.map((session) => (
                  <div key={session.id} data-session-id={session.id}>
                    {session.id}
                  </div>
                ))}
              </div>
            );
          }),
        )}
      </div>
    );
  },
}));

import { Schedule } from "../Schedule";

const buildOffsetTimestamp = (date: Date) => {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffsetMinutes = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absoluteOffsetMinutes / 60)).padStart(2, "0");
  const offsetRemainderMinutes = String(absoluteOffsetMinutes % 60).padStart(2, "0");
  return `${format(date, "yyyy-MM-dd'T'HH:mm:ss")}${sign}${offsetHours}:${offsetRemainderMinutes}`;
};

const buildScheduleStore = () => {
  const sourceDate = addDays(startOfWeek(new Date(), { weekStartsOn: 1 }), 1);
  sourceDate.setHours(10, 0, 0, 0);
  const session: Session = {
    id: "session-1",
    therapist_id: "therapist-1",
    client_id: "client-1",
    program_id: "program-1",
    goal_id: "goal-1",
    start_time: sourceDate.toISOString(),
    end_time: new Date(sourceDate.getTime() + 60 * 60 * 1000).toISOString(),
    status: "scheduled",
    notes: "Initial session",
    created_at: "2025-07-01T00:00:00.000Z",
    created_by: "user-1",
    updated_at: "2025-07-01T00:00:00.000Z",
    updated_by: "user-1",
    therapist: { id: "therapist-1", full_name: "Dr. Myles" },
    client: { id: "client-1", full_name: "Jamie Client" },
  };

  return {
    sessions: [session],
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
  } satisfies ScheduleStore;
};

const getSlotSessionIds = (container: HTMLElement, slotKey: string) => {
  const slot = container.querySelector(`[data-slot-key="${slotKey}"]`);
  if (!slot) {
    throw new Error(`Expected slot ${slotKey} to exist.`);
  }
  return Array.from(slot.querySelectorAll("[data-session-id]")).map((node) => node.getAttribute("data-session-id"));
};

describe("Schedule reschedule integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scheduleStore = buildScheduleStore();
    latestRescheduleHandler = null;
  });

  afterEach(() => {
    scheduleStoreListeners.clear();
  });

  it("keeps the moved appointment in the optimistic slot until persisted canonical timestamps catch up", async () => {
    let resolveBooking:
      | ((value: { session: Session }) => void)
      | undefined;

    bookSessionViaApiMock.mockImplementation(
      () =>
        new Promise<{ session: Session }>((resolve) => {
          resolveBooking = resolve;
        }),
    );

    const { container } = renderWithProviders(<Schedule />);

    await screen.findByRole("heading", { name: /Schedule/i });
    await waitFor(() => {
      expect(container.querySelector('[data-session-id="session-1"]')).toBeTruthy();
    });

    const sourceSession = scheduleStore.sessions[0];
    const sourceStart = new Date(sourceSession.start_time);
    const sourceSlotKey = createSessionSlotKey(
      format(sourceStart, "yyyy-MM-dd"),
      format(sourceStart, "HH:mm"),
    );
    const targetTime = "10:15";
    const targetSlotKey = createSessionSlotKey(format(sourceStart, "yyyy-MM-dd"), targetTime);
    const movedStart = new Date(sourceStart);
    movedStart.setHours(10, 15, 0, 0);
    const movedEnd = new Date(movedStart.getTime() + 60 * 60 * 1000);

    expect(latestRescheduleHandler).toBeTruthy();

    act(() => {
      latestRescheduleHandler?.(sourceSession, { date: sourceStart, time: targetTime });
    });

    await waitFor(() => {
      expect(bookSessionViaApiMock).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(getSlotSessionIds(container, sourceSlotKey)).toEqual([]);
      expect(getSlotSessionIds(container, targetSlotKey)).toEqual(["session-1"]);
    });

    resolveBooking?.({
      session: {
        ...sourceSession,
        start_time: buildOffsetTimestamp(movedStart),
        end_time: buildOffsetTimestamp(movedEnd),
      },
    });

    await waitFor(() => {
      expect(showSuccessMock).toHaveBeenCalledWith("Appointment moved");
    });

    await waitFor(() => {
      expect(getSlotSessionIds(container, sourceSlotKey)).toEqual([]);
      expect(getSlotSessionIds(container, targetSlotKey)).toEqual(["session-1"]);
    });

    act(() => {
      setScheduleStore({
        ...scheduleStore,
        sessions: [
          {
            ...sourceSession,
            start_time: buildOffsetTimestamp(movedStart),
            end_time: buildOffsetTimestamp(movedEnd),
          },
        ],
      });
    });

    await waitFor(() => {
      expect(getSlotSessionIds(container, sourceSlotKey)).toEqual([]);
      expect(getSlotSessionIds(container, targetSlotKey)).toEqual(["session-1"]);
      expect(container.querySelectorAll('[data-session-id="session-1"]')).toHaveLength(1);
    });

    expect(showErrorMock).not.toHaveBeenCalled();
  });
});
