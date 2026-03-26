import React, { useState, useMemo, useCallback, useLayoutEffect, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO, startOfWeek, addDays, endOfWeek } from "date-fns";
import { getTimezoneOffset } from "date-fns-tz";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  Plus,
  Edit2,
  Wand2,
} from "lucide-react";
import type { Session, Therapist, Client } from "../types";
import { SessionModal } from "../components/SessionModal";
import { AutoScheduleModal } from "../components/AutoScheduleModal";
import { AvailabilityOverlay } from "../components/AvailabilityOverlay";
import { SessionFilters } from "../components/SessionFilters";
import { SchedulingMatrix } from "../components/SchedulingMatrix";
import { useDebounce } from "../lib/performance";
import {
  useScheduleDataBatch,
  useSessionsOptimized,
  useDropdownData,
} from "../lib/optimizedQueries";
import { cancelSessions } from "../lib/sessionCancellation";
import { showError, showSuccess } from "../lib/toast";
import { logger } from "../lib/logger/logger";
import { toError } from "../lib/logger/normalizeError";
import { useAuth } from "../lib/authContext";
import { useActiveOrganizationId } from "../lib/organization";
import {
  buildSessionSlotIndex,
  createSessionSlotKey,
  mapWithConcurrency,
  normalizeRecurrencePayload,
  toPendingScheduleDetail,
  type PendingScheduleDetail,
  type RecurrenceFormState,
} from "./schedule-utils";
import { useCapturePendingScheduleEvent } from "./schedule-state";
import {
  bookSessionViaApi,
  buildBookSessionApiPayload,
} from "../features/scheduling/domain/booking";
import { buildScheduleDisplayData } from "../features/scheduling/domain/displayData";
import {
  collectTherapistScopeCandidateIds,
  resolveScopedTherapistId,
} from "../features/scheduling/domain/sessionScope";
import { filterSessionsBySelectedScope } from "../features/scheduling/domain/sessionFilters";
import { shouldClearMissingSelection } from "../features/scheduling/domain/selectionGuard";
import { buildScheduleModalOpenResetPlan } from "../features/scheduling/domain/modalOpenResetPlan";
import { applyScheduleModalOpenPlan } from "../features/scheduling/domain/modalOpenPlanApply";
import { applyScheduleResetBranch } from "../features/scheduling/domain/scheduleResetBranch";
import { decideScheduleSubmitBranch } from "../features/scheduling/domain/submitBranchDecision";
import { adaptScheduleMutationError } from "../features/scheduling/domain/mutationErrorAdapter";
import { applyScheduleMutationSuccessLifecycle } from "../features/scheduling/domain/mutationSuccessLifecycle";
import {
  applyPendingScheduleDetail,
  type PendingScheduleTransitionRecorder,
} from "../features/scheduling/domain/pendingScheduleApply";

const AUTO_SCHEDULE_CONCURRENCY = 3;

export { applyPendingScheduleDetail };
export type { PendingScheduleTransitionRecorder };

export const consumePendingScheduleFromStorage = ({
  storage,
  openFromPendingSchedule,
  record,
}: {
  storage: Pick<Storage, "getItem" | "removeItem">;
  openFromPendingSchedule: (detail: PendingScheduleDetail | null) => void;
  record?: PendingScheduleTransitionRecorder;
}) => {
  const pending = storage.getItem("pendingSchedule");
  record?.({
    kind: "storage",
    name: "getItem",
    payload: pending,
  });
  if (!pending) {
    return;
  }

  let detail: PendingScheduleDetail | null = null;
  try {
    detail = toPendingScheduleDetail(JSON.parse(pending));
  } catch {
    detail = null;
  } finally {
    storage.removeItem("pendingSchedule");
    record?.({
      kind: "storage",
      name: "removeItem",
      payload: "pendingSchedule",
    });
  }

  openFromPendingSchedule(detail);
};

export const createOpenScheduleModalHandler = (
  openFromPendingSchedule: (detail: PendingScheduleDetail | null) => void,
) => {
  return (event: Event) => {
    const detail = toPendingScheduleDetail((event as CustomEvent).detail);
    openFromPendingSchedule(detail);
  };
};

// Memoized time slot component
const TimeSlot = React.memo(
  ({
    time,
    day,
    slotSessions,
    onCreateSession,
    onEditSession,
  }: {
    time: string;
    day: Date;
    slotSessions: Session[];
    onCreateSession: (timeSlot: { date: Date; time: string }) => void;
    onEditSession: (session: Session) => void;
  }) => {
    const handleTimeSlotClick = useCallback(() => {
      onCreateSession({ date: day, time });
    }, [day, time, onCreateSession]);

    const handleSessionClick = useCallback(
      (e: React.MouseEvent, session: Session) => {
        e.stopPropagation();
        onEditSession(session);
      },
      [onEditSession],
    );

    return (
      <div
        className="h-10 border-b dark:border-gray-700 border-r dark:border-gray-700 p-2 relative group cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
        role="button"
        tabIndex={0}
        aria-label="Add session"
        title="Add session"
        onClick={handleTimeSlotClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleTimeSlotClick();
          }
        }}
      >
        <span
          aria-hidden="true"
          className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 p-1 rounded-full text-gray-500 dark:text-gray-400 transition-opacity"
        >
          <Plus className="w-4 h-4 text-gray-500 dark:text-gray-400" />
        </span>

        {slotSessions.map((session) => (
          <div
            key={session.id}
            className="bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 rounded p-1 text-xs mb-1 group/session relative cursor-pointer hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
            role="button"
            tabIndex={0}
            onClick={(e) => handleSessionClick(e, session)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onEditSession(session);
              }
            }}
          >
            <div className="font-medium truncate">
              {session.client?.full_name}
            </div>
            <div className="text-blue-600 dark:text-blue-300 truncate">
              {session.therapist?.full_name}
            </div>
            <div className="flex items-center text-blue-500 dark:text-blue-400">
              <Clock className="w-3 h-3 mr-1" />
              {format(parseISO(session.start_time), "h:mm a")}
            </div>

            <span
              aria-hidden="true"
              className="absolute top-1 right-1 opacity-0 group-hover/session:opacity-100"
            >
              <Edit2 className="w-3 h-3" />
            </span>
          </div>
        ))}
      </div>
    );
  },
);

TimeSlot.displayName = "TimeSlot";

// Memoized day column component
const DayColumn = React.memo(
  ({
    day,
    timeSlots,
    sessionSlotIndex,
    onCreateSession,
    onEditSession,
    showAvailability,
    therapists,
    clients,
  }: {
    day: Date;
    timeSlots: string[];
    sessionSlotIndex: Map<string, Session[]>;
    onCreateSession: (timeSlot: { date: Date; time: string }) => void;
    onEditSession: (session: Session) => void;
    showAvailability: boolean;
    therapists: Therapist[];
    clients: Client[];
  }) => {
    const dayKey = useMemo(() => format(day, "yyyy-MM-dd"), [day]);

    return (
      <div className="relative">
        {showAvailability && (
          <AvailabilityOverlay
            therapists={therapists}
            clients={clients}
            selectedDate={day}
            timeSlots={timeSlots}
          />
        )}

        {timeSlots.map((time) => (
          <TimeSlot
            key={time}
            time={time}
            day={day}
            slotSessions={sessionSlotIndex.get(createSessionSlotKey(dayKey, time)) ?? []}
            onCreateSession={onCreateSession}
            onEditSession={onEditSession}
          />
        ))}
      </div>
    );
  },
);

DayColumn.displayName = "DayColumn";

// Memoized week view component
const WeekView = React.memo(
  ({
    weekDays,
    timeSlots,
    sessionSlotIndex,
    onCreateSession,
    onEditSession,
    showAvailability,
    therapists,
    clients,
  }: {
    weekDays: Date[];
    timeSlots: string[];
    sessionSlotIndex: Map<string, Session[]>;
    onCreateSession: (timeSlot: { date: Date; time: string }) => void;
    onEditSession: (session: Session) => void;
    showAvailability: boolean;
    therapists: Therapist[];
    clients: Client[];
  }) => {
    return (
      <div className="bg-white dark:bg-dark-lighter rounded-lg shadow overflow-x-auto">
        <div className="grid grid-cols-7 border-b dark:border-gray-700 min-w-[800px]">
          <div className="py-2 px-2 text-center text-sm font-medium text-gray-500 dark:text-gray-400 border-r dark:border-gray-700">
            Time
          </div>
          {weekDays.map((day) => (
            <div
              key={day.toISOString()}
              className="py-2 px-2 text-center text-sm font-medium text-gray-900 dark:text-white"
            >
              {format(day, "EEE MMM d")}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 min-w-[800px]">
          <div className="border-r dark:border-gray-700">
            {timeSlots.map((time) => (
              <div
                key={time}
                className="h-10 border-b dark:border-gray-700 p-2 text-sm text-gray-500 dark:text-gray-400 flex items-center"
              >
                {time}
              </div>
            ))}
          </div>

          {weekDays.map((day) => (
            <DayColumn
              key={day.toISOString()}
              day={day}
              timeSlots={timeSlots}
              sessionSlotIndex={sessionSlotIndex}
              onCreateSession={onCreateSession}
              onEditSession={onEditSession}
              showAvailability={showAvailability}
              therapists={therapists}
              clients={clients}
            />
          ))}
        </div>
      </div>
    );
  },
);

WeekView.displayName = "WeekView";

// Memoized day view component
const DayView = React.memo(
  ({
    selectedDate,
    timeSlots,
    sessionSlotIndex,
    onCreateSession,
    onEditSession,
    showAvailability,
    therapists,
    clients,
  }: {
    selectedDate: Date;
    timeSlots: string[];
    sessionSlotIndex: Map<string, Session[]>;
    onCreateSession: (timeSlot: { date: Date; time: string }) => void;
    onEditSession: (session: Session) => void;
    showAvailability: boolean;
    therapists: Therapist[];
    clients: Client[];
  }) => {
    const selectedDateKey = useMemo(() => format(selectedDate, "yyyy-MM-dd"), [selectedDate]);

    return (
      <div
        className="bg-white dark:bg-dark-lighter rounded-lg shadow overflow-x-auto"
        data-testid="day-view"
      >
        <div className="grid grid-cols-2 border-b dark:border-gray-700">
          <div className="py-4 px-2 text-center text-sm font-medium text-gray-500 dark:text-gray-400 border-r dark:border-gray-700">
            Time
          </div>
          <div className="py-4 px-2 text-center text-sm font-medium text-gray-900 dark:text-white">
            {format(selectedDate, "EEEE, MMMM d, yyyy")}
          </div>
        </div>

        <div className="grid grid-cols-2">
          <div className="border-r dark:border-gray-700">
            {timeSlots.map((time) => (
              <div
                key={time}
                className="h-10 border-b dark:border-gray-700 p-2 text-sm text-gray-500 dark:text-gray-400 flex items-center"
              >
                {time}
              </div>
            ))}
          </div>

          <div className="relative">
            {showAvailability && (
              <AvailabilityOverlay
                therapists={therapists}
                clients={clients}
                selectedDate={selectedDate}
                timeSlots={timeSlots}
              />
            )}

            {timeSlots.map((time) => (
              <TimeSlot
                key={time}
                time={time}
                day={selectedDate}
                slotSessions={sessionSlotIndex.get(createSessionSlotKey(selectedDateKey, time)) ?? []}
                onCreateSession={onCreateSession}
                onEditSession={onEditSession}
              />
            ))}
          </div>
        </div>
      </div>
    );
  },
);

DayView.displayName = "DayView";

export const Schedule = React.memo(() => {
  useCapturePendingScheduleEvent();
  const { user, profile, effectiveRole } = useAuth();
  const activeOrganizationId = useActiveOrganizationId();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [view, setView] = useState<"day" | "week" | "matrix">("week");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAutoScheduleModalOpen, setIsAutoScheduleModalOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState<Session | undefined>();
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<
    { date: Date; time: string } | undefined
  >();
  const [showAvailability, setShowAvailability] = useState(true);
  const [selectedTherapist, setSelectedTherapist] = useState<string | null>(
    null,
  );
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const [scopedTherapistId, setScopedTherapistId] = useState<string | null>(null);
  const [scopedClientId, setScopedClientId] = useState<string | null>(null);
  const [retryHint, setRetryHint] = useState<string | null>(null);
  const [pendingAgentIdempotencyKey, setPendingAgentIdempotencyKey] = useState<string | null>(null);
  const [pendingAgentOperationId, setPendingAgentOperationId] = useState<string | null>(null);
  const [pendingTraceRequestId, setPendingTraceRequestId] = useState<string | null>(null);
  const [pendingTraceCorrelationId, setPendingTraceCorrelationId] = useState<string | null>(null);
  const lastPendingScheduleKeyRef = useRef<string | null>(null);

  const queryClient = useQueryClient();
  const scheduleResetSetters = useMemo(
    () => ({
      setIsModalOpen,
      setSelectedSession,
      setSelectedTimeSlot,
      setRetryHint,
      setPendingAgentIdempotencyKey,
      setPendingAgentOperationId,
      setPendingTraceRequestId,
      setPendingTraceCorrelationId,
    }),
    [],
  );

  const handleScheduleMutationError = useCallback((error: unknown) => {
    const adaptation = adaptScheduleMutationError(error);

    if (adaptation.lifecyclePlan.errorKind === "conflict") {
      logger.warn("Schedule mutation conflict", {
        metadata: {
          hint: adaptation.conflictLogMetadata?.hint ?? null,
          error: adaptation.conflictLogMetadata?.error ?? adaptation.normalized.message,
        },
      });

      applyScheduleResetBranch(adaptation.lifecyclePlan.resetBranch, scheduleResetSetters);
      showError(adaptation.userMessage);
      return;
    }

    applyScheduleResetBranch(adaptation.lifecyclePlan.resetBranch, scheduleResetSetters);
    showError(adaptation.userMessage);
  }, [scheduleResetSetters]);

  const userTimeZone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
    } catch (error) {
      logger.warn("Unable to resolve timezone for schedule view", {
        metadata: {
          fallback: "UTC",
          failure: toError(error, "Timezone resolution failed").message,
        },
      });
      return "UTC";
    }
  }, []);

  const [recurrenceEnabled, setRecurrenceEnabled] = useState(false);
  const [recurrenceRule, setRecurrenceRule] = useState("FREQ=WEEKLY;INTERVAL=1");
  const [recurrenceCount, setRecurrenceCount] = useState<number | undefined>();
  const [recurrenceUntil, setRecurrenceUntil] = useState("");
  const [recurrenceExceptions, setRecurrenceExceptions] = useState<string[]>([]);
  const [recurrenceTimeZone, setRecurrenceTimeZone] = useState(userTimeZone);

  useLayoutEffect(() => {
    setRecurrenceTimeZone(userTimeZone);
  }, [userTimeZone]);

  useLayoutEffect(() => {
    if (selectedSession) {
      setRecurrenceEnabled(false);
    }
  }, [selectedSession]);

  const recurrenceFormState = useMemo<RecurrenceFormState>(
    () => ({
      enabled: recurrenceEnabled,
      rule: recurrenceRule,
      count: recurrenceCount,
      until: recurrenceUntil,
      exceptions: recurrenceExceptions,
      timeZone: recurrenceTimeZone,
    }),
    [
      recurrenceEnabled,
      recurrenceRule,
      recurrenceCount,
      recurrenceUntil,
      recurrenceExceptions,
      recurrenceTimeZone,
    ],
  );

  const computeTimeMetadata = useCallback(
    (session: Partial<Session>) => {
      if (!session.start_time || !session.end_time) {
        throw new Error("Missing session start or end time");
      }

      const startDate = parseISO(session.start_time);
      const endDate = parseISO(session.end_time);

      if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
        throw new Error("Invalid session time provided");
      }

      const startOffset = Math.round(getTimezoneOffset(userTimeZone, startDate) / 60000);
      const endOffset = Math.round(getTimezoneOffset(userTimeZone, endDate) / 60000);

      return {
        startTime: session.start_time,
        endTime: session.end_time,
        startOffsetMinutes: startOffset,
        endOffsetMinutes: endOffset,
        timeZone: userTimeZone,
      };
    },
    [userTimeZone],
  );

  const openFromPendingSchedule = useCallback((detail: PendingScheduleDetail | null) => {
    applyPendingScheduleDetail({
      detail,
      lastDetailKeyRef: lastPendingScheduleKeyRef,
      setters: {
        setPendingAgentIdempotencyKey,
        setPendingAgentOperationId,
        setPendingTraceRequestId,
        setPendingTraceCorrelationId,
        setSelectedDate,
        setSelectedTimeSlot,
        setSelectedSession,
        setRetryHint,
        setIsModalOpen,
      },
    });
  }, []);

  const consumePendingSchedule = useCallback(() => {
    consumePendingScheduleFromStorage({
      storage: localStorage,
      openFromPendingSchedule,
    });
  }, [openFromPendingSchedule]);

  useLayoutEffect(() => {
    consumePendingSchedule();

    const handler = createOpenScheduleModalHandler(openFromPendingSchedule);

    document.addEventListener("openScheduleModal", handler as EventListener);
    window.addEventListener("openScheduleModal", handler as EventListener);
    return () => {
      document.removeEventListener("openScheduleModal", handler as EventListener);
      window.removeEventListener("openScheduleModal", handler as EventListener);
    };
  }, [consumePendingSchedule, openFromPendingSchedule]);

  // Memoized date calculations
  const weekStart = useMemo(
    () => startOfWeek(selectedDate, { weekStartsOn: 1 }),
    [selectedDate],
  );
  const weekEnd = useMemo(
    () => endOfWeek(selectedDate, { weekStartsOn: 1 }),
    [selectedDate],
  );

  // Debounce filter changes
  const debouncedTherapist = useDebounce(selectedTherapist, 300);
  const debouncedClient = useDebounce(selectedClient, 300);

  // PHASE 3 OPTIMIZATION: Use batched schedule data
  const { data: batchedData, isLoading: isLoadingBatch } = useScheduleDataBatch(
    weekStart,
    weekEnd,
  );

  const hasBatchedSessions = Array.isArray(batchedData?.sessions);
  const enableFallbackSessionsQuery = !isLoadingBatch && !hasBatchedSessions;

  // Fallback to individual queries if batched data is not available
  const { data: sessions = [], isLoading: isLoadingSessions } =
    useSessionsOptimized(
      weekStart,
      weekEnd,
      debouncedTherapist,
      debouncedClient,
      enableFallbackSessionsQuery,
    );

  // Use dropdown data hook for therapists and clients
  const { data: dropdownData, isLoading: isLoadingDropdowns } =
    useDropdownData();

  const filteredBatchedSessions = useMemo(() => {
    const candidateSessions = Array.isArray(batchedData?.sessions) ? batchedData.sessions : null;
    if (!candidateSessions) {
      return null;
    }

    return filterSessionsBySelectedScope(candidateSessions, {
      selectedTherapistId: selectedTherapist,
      selectedClientId: selectedClient,
    });
  }, [batchedData?.sessions, selectedTherapist, selectedClient]);

  // Use batched data if available, otherwise use individual query results
  const displayData = buildScheduleDisplayData({
    filteredBatchedSessions,
    fallbackSessions: sessions,
    batchedData,
    dropdownData,
  });

  useEffect(() => {
    if (selectedTherapist) {
      return;
    }
    if (effectiveRole !== 'therapist') {
      return;
    }

    const metadata = (user?.user_metadata ?? {}) as Record<string, unknown>;
    const candidateIds = collectTherapistScopeCandidateIds({
      profileId: profile?.id,
      userMetadata: metadata,
      preferences: profile?.preferences,
    });

    const resolvedTherapistId = resolveScopedTherapistId(
      displayData.therapists,
      candidateIds,
    );
    if (resolvedTherapistId) {
      setSelectedTherapist(resolvedTherapistId);
      setScopedTherapistId(resolvedTherapistId);
    }
  }, [selectedTherapist, effectiveRole, profile?.id, profile?.preferences, user?.user_metadata, displayData.therapists]);

  useEffect(() => {
    if (shouldClearMissingSelection(selectedTherapist, displayData.therapists)) {
      setSelectedTherapist(null);
    }
  }, [selectedTherapist, displayData.therapists]);

  useEffect(() => {
    if (shouldClearMissingSelection(selectedClient, displayData.clients)) {
      setSelectedClient(null);
    }
  }, [selectedClient, displayData.clients]);

  const handleTherapistFilterChange = useCallback((therapistId: string | null) => {
    setSelectedTherapist(therapistId);
    if (therapistId !== scopedTherapistId) {
      setScopedTherapistId(null);
    }
  }, [scopedTherapistId]);

  const handleClientFilterChange = useCallback((clientId: string | null) => {
    setSelectedClient(clientId);
    if (clientId !== scopedClientId) {
      setScopedClientId(null);
    }
  }, [scopedClientId]);

  // Optimized mutations with proper error handling
  const createSessionMutation = useMutation({
    mutationFn: async (newSession: Partial<Session>) => {
      if (
        !newSession.therapist_id ||
        !newSession.client_id ||
        !newSession.program_id ||
        !newSession.goal_id ||
        !newSession.start_time ||
        !newSession.end_time
      ) {
        throw new Error("Missing required session details");
      }

      const { startOffsetMinutes, endOffsetMinutes, timeZone } =
        computeTimeMetadata(newSession);

      const bookingResult = await bookSessionViaApi(
        {
          ...buildBookSessionApiPayload(
            newSession,
            {
            startOffsetMinutes,
            endOffsetMinutes,
            timeZone,
            },
            normalizeRecurrencePayload(recurrenceFormState) ?? newSession.recurrence ?? undefined,
          ),
          overrides: undefined,
        },
        {
          idempotencyKey: pendingAgentIdempotencyKey ?? undefined,
          agentOperationId: pendingAgentOperationId ?? undefined,
          requestId: pendingTraceRequestId ?? undefined,
          correlationId: pendingTraceCorrelationId ?? undefined,
        },
      );

      return bookingResult.session;
    },
    onSuccess: () => {
      applyScheduleMutationSuccessLifecycle({
        kind: "create-success",
        invalidateQuery: (queryKey) => {
          queryClient.invalidateQueries({ queryKey: [queryKey] });
        },
        applyResetBranch: (resetBranch) => {
          applyScheduleResetBranch(resetBranch, scheduleResetSetters);
        },
      });
    },
    onError: (error) => {
      handleScheduleMutationError(error);
    },
  });

  const createMultipleSessionsMutation = useMutation({
    mutationFn: async (newSessions: Partial<Session>[]) => {
      return mapWithConcurrency(
        newSessions,
        async (session) => {
          if (
            !session.therapist_id ||
            !session.client_id ||
            !session.program_id ||
            !session.goal_id ||
            !session.start_time ||
            !session.end_time
          ) {
            throw new Error("Missing required session details");
          }

          const { startOffsetMinutes, endOffsetMinutes, timeZone } =
            computeTimeMetadata(session);

          const bookingResult = await bookSessionViaApi(
            {
              ...buildBookSessionApiPayload(
                session,
                {
                startOffsetMinutes,
                endOffsetMinutes,
                timeZone,
                },
              ),
              overrides: undefined,
            }
          );
          return bookingResult.session;
        },
        AUTO_SCHEDULE_CONCURRENCY,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      queryClient.invalidateQueries({ queryKey: ["sessions-batch"] });
      setIsAutoScheduleModalOpen(false);
      setRetryHint(null);
    },
    onError: (error) => {
      handleScheduleMutationError(error);
    },
  });

  const updateSessionMutation = useMutation({
    mutationFn: async (updatedSession: Partial<Session>) => {
      if (!selectedSession) {
        throw new Error("No session selected for update");
      }

      const mergedSession: Session = {
        ...selectedSession,
        ...updatedSession,
      };

      if (
        !mergedSession.therapist_id ||
        !mergedSession.client_id ||
        !mergedSession.start_time ||
        !mergedSession.end_time
      ) {
        throw new Error("Missing required session details");
      }

      const { startOffsetMinutes, endOffsetMinutes, timeZone } =
        computeTimeMetadata(mergedSession);

      const bookingResult = await bookSessionViaApi(
        {
          ...buildBookSessionApiPayload(
            { ...mergedSession, id: selectedSession.id },
            {
              startOffsetMinutes,
              endOffsetMinutes,
              timeZone,
            },
            normalizeRecurrencePayload(recurrenceFormState) ?? mergedSession.recurrence ?? undefined,
          ),
          overrides: undefined,
        }
      );

      return bookingResult.session;
    },
    onSuccess: () => {
      applyScheduleMutationSuccessLifecycle({
        kind: "update-success",
        invalidateQuery: (queryKey) => {
          queryClient.invalidateQueries({ queryKey: [queryKey] });
        },
        applyResetBranch: (resetBranch) => {
          applyScheduleResetBranch(resetBranch, scheduleResetSetters);
        },
      });
    },
    onError: (error) => {
      handleScheduleMutationError(error);
    },
  });

  const cancelSessionMutation = useMutation({
    mutationFn: async ({
      sessionId,
      reason,
    }: {
      sessionId: string;
      reason?: string | null;
    }) => {
      const result = await cancelSessions({
        sessionIds: [sessionId],
        reason,
      });

      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      queryClient.invalidateQueries({ queryKey: ["sessions-batch"] });
    },
    onError: (error) => {
      showError(error);
    },
  });

  // Memoized callbacks
  const handleCreateSession = useCallback(
    (timeSlot: { date: Date; time: string }) => {
      const plan = buildScheduleModalOpenResetPlan({
        mode: "create",
        timeSlot,
      });

      applyScheduleModalOpenPlan({
        mode: "create",
        plan,
        setters: {
          setRetryHint,
          setPendingAgentIdempotencyKey,
          setPendingAgentOperationId,
          setPendingTraceRequestId,
          setPendingTraceCorrelationId,
          setSelectedTimeSlot,
          setSelectedSession,
          setIsModalOpen,
        },
      });
    },
    [],
  );

  const handleEditSession = useCallback((session: Session) => {
    const plan = buildScheduleModalOpenResetPlan({
      mode: "edit",
      session,
    });

    applyScheduleModalOpenPlan({
      mode: "edit",
      plan,
      setters: {
        setRetryHint,
        setPendingAgentIdempotencyKey,
        setPendingAgentOperationId,
        setPendingTraceRequestId,
        setPendingTraceCorrelationId,
        setSelectedSession,
        setSelectedTimeSlot,
        setIsModalOpen,
      },
    });
  }, []);

  const handleAddRecurrenceException = useCallback(() => {
    setRecurrenceExceptions((prev) => [...prev, ""]);
  }, []);

  const handleRecurrenceExceptionChange = useCallback(
    (index: number, value: string) => {
      setRecurrenceExceptions((prev) => {
        const next = [...prev];
        next[index] = value;
        return next;
      });
    },
    [],
  );

  const handleRemoveRecurrenceException = useCallback((index: number) => {
    setRecurrenceExceptions((prev) => prev.filter((_, current) => current !== index));
  }, []);

  const handleCloseSessionModal = useCallback(() => {
    applyScheduleResetBranch(
      { kind: "close-modal" },
      scheduleResetSetters,
    );
  }, [scheduleResetSetters]);

  const dismissRetryHint = useCallback(() => {
    setRetryHint(null);
  }, []);

  const _handleDeleteSession = useCallback(
    async (sessionId: string) => {
      if (window.confirm("Are you sure you want to cancel this session?")) {
        const result = await cancelSessionMutation.mutateAsync({
          sessionId,
        });

        showSuccess(
          result.cancelledCount > 0
            ? "Session cancelled successfully"
            : "Session was already cancelled",
        );
      }
    },
    [cancelSessionMutation],
  );

  const handleSubmit = useCallback(
    async (data: Partial<Session>) => {
      const decision = decideScheduleSubmitBranch({
        selectedSession,
        data,
      });

      switch (decision.kind) {
        case "edit-cancel": {
          const result = await cancelSessionMutation.mutateAsync({
            sessionId: decision.selectedSessionId,
            reason: decision.cancellationReason,
          });

          showSuccess(
            result.cancelledCount > 0
              ? "Session cancelled successfully"
              : "Session was already cancelled",
          );

          applyScheduleResetBranch(
            { kind: "submit-cancel" },
            scheduleResetSetters,
          );
          return;
        }
        case "edit-update": {
          await updateSessionMutation.mutateAsync(data);
          return;
        }
        case "create": {
          await createSessionMutation.mutateAsync(data);
          return;
        }
        default: {
          const _exhaustiveCheck: never = decision;
          return _exhaustiveCheck;
        }
      }
    },
    [
      selectedSession,
      scheduleResetSetters,
      cancelSessionMutation,
      updateSessionMutation,
      createSessionMutation,
    ],
  );

  const handleAutoSchedule = useCallback(
    async (sessions: Partial<Session>[]) => {
      await createMultipleSessionsMutation.mutateAsync(sessions);
    },
    [createMultipleSessionsMutation],
  );

  const handleDateNavigation = useCallback(
    (direction: "prev" | "next") => {
      setSelectedDate((d) => {
        // If in day view, move by 1 day; otherwise, move by 7 days (week)
        const daysToAdd = view === "day" ? 1 : 7;
        return addDays(d, direction === "prev" ? -daysToAdd : daysToAdd);
      });
    },
    [view],
  );

  const handleViewChange = useCallback((newView: "day" | "week" | "matrix") => {
    setView(newView);
  }, []);

  const toggleAvailability = useCallback(() => {
    setShowAvailability((prev) => !prev);
  }, []);

  // Memoized time slots generation
  const timeSlots = useMemo(() => {
    const slots = [];
    for (let hour = 8; hour < 18; hour++) {
      for (let minute = 0; minute < 60; minute += 15) {
        const hourStr = hour.toString().padStart(2, "0");
        const minuteStr = minute.toString().padStart(2, "0");
        slots.push(`${hourStr}:${minuteStr}`);
      }
    }
    return slots;
  }, []);

  // Memoized week days generation
  const weekDays = useMemo(() => {
    return Array.from(
      { length: 6 },
      (
        _,
        i, // Monday to Saturday
      ) => addDays(weekStart, i),
    );
  }, [weekStart]);

  const sessionSlotIndex = useMemo(
    () => buildSessionSlotIndex(displayData.sessions),
    [displayData.sessions],
  );

  // Memoized date range display
  const dateRangeDisplay = useMemo(() => {
    if (view === "day") {
      return format(selectedDate, "MMMM d, yyyy");
    }
    return `${format(weekStart, "MMM d")} - ${format(addDays(weekStart, 5), "MMM d, yyyy")}`;
  }, [weekStart, selectedDate, view]);

  const hasBatchedData = Boolean(batchedData);
  const isLoading = isLoadingBatch || (!hasBatchedData && (isLoadingSessions || isLoadingDropdowns));

  if (isLoading) {
    return (
      <div className="h-full relative">
        <div className="h-full flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
        {isModalOpen && (
          <SessionModal
            isOpen={isModalOpen}
            onClose={handleCloseSessionModal}
            onSubmit={handleSubmit}
            session={selectedSession}
            selectedDate={selectedTimeSlot?.date}
            selectedTime={selectedTimeSlot?.time}
            therapists={displayData.therapists}
            clients={displayData.clients}
            existingSessions={displayData.sessions}
            timeZone={userTimeZone}
            defaultTherapistId={selectedTherapist}
            defaultClientId={selectedClient}
            retryHint={retryHint}
            onRetryHintDismiss={dismissRetryHint}
          />
        )}
      </div>
    );
  }

  return (
    <div className="h-full">
      {!activeOrganizationId && (
        <div className="mb-6 rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-amber-800 dark:text-amber-100">
          <p className="font-medium">Organization context unavailable</p>
          <p className="mt-1 text-sm opacity-80">
            The schedule is scoped per organization. Impersonate a tenant or contact an administrator before booking sessions.
          </p>
        </div>
      )}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Schedule
        </h1>

        <div className="flex items-center space-x-4">
          <button
            onClick={() => setIsAutoScheduleModalOpen(true)}
            className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-md shadow-sm hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 flex items-center transition-colors"
          >
            <Wand2 className="w-4 h-4 mr-2" />
            Auto Schedule
          </button>

          <div className="flex items-center space-x-2">
            <button
              aria-label="Previous period"
              onClick={() => handleDateNavigation("prev")}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
            >
              <ChevronLeft aria-hidden="true" className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-2">
              <CalendarIcon className="w-5 h-5 text-gray-500 dark:text-gray-400" />
              <span className="font-medium text-gray-900 dark:text-white min-w-[200px] text-center">
                {dateRangeDisplay}
              </span>
            </div>

            <button
              aria-label="Next period"
              onClick={() => handleDateNavigation("next")}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
            >
              <ChevronRight aria-hidden="true" className="w-5 h-5" />
            </button>
          </div>

          <div className="flex rounded-lg shadow-sm">
            <button
              onClick={() => handleViewChange("day")}
              aria-pressed={view === "day"}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                view === "day"
                  ? "bg-blue-600 text-white"
                  : "bg-white dark:bg-dark-lighter text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              } border border-gray-300 dark:border-gray-600 rounded-l-lg`}
              aria-label="Day view"
            >
              Day
            </button>
            <button
              onClick={() => handleViewChange("week")}
              aria-pressed={view === "week"}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                view === "week"
                  ? "bg-blue-600 text-white"
                  : "bg-white dark:bg-dark-lighter text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              } border-t border-b border-gray-300 dark:border-gray-600`}
              aria-label="Week view"
            >
              Week
            </button>
            <button
              onClick={() => handleViewChange("matrix")}
              aria-pressed={view === "matrix"}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                view === "matrix"
                  ? "bg-blue-600 text-white"
                  : "bg-white dark:bg-dark-lighter text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              } border border-gray-300 dark:border-gray-600 rounded-r-lg`}
              aria-label="Matrix view"
            >
              Matrix
            </button>
          </div>

          <button
            onClick={toggleAvailability}
            aria-pressed={showAvailability}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              showAvailability
                ? "bg-green-600 text-white"
                : "bg-white dark:bg-dark-lighter text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
            } border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm`}
          >
            Show Availability
          </button>
        </div>
      </div>

      <SessionFilters
        therapists={displayData.therapists}
        clients={displayData.clients}
        selectedTherapist={selectedTherapist}
        selectedClient={selectedClient}
        onTherapistChange={handleTherapistFilterChange}
        onClientChange={handleClientFilterChange}
        scopedTherapistId={scopedTherapistId}
        scopedClientId={scopedClientId}
      />

      <div className="mt-6 bg-white dark:bg-dark-lighter border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm p-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <label className="inline-flex items-center text-sm font-medium text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              className="mr-2 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              checked={recurrenceEnabled}
              onChange={(event) => setRecurrenceEnabled(event.target.checked)}
            />
            Enable recurrence (RRULE)
          </label>

          <div className="flex items-center gap-2 w-full md:w-auto">
            <label htmlFor="recurrence-timezone" className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Time Zone
            </label>
            <input
              id="recurrence-timezone"
              type="text"
              value={recurrenceTimeZone}
              onChange={(event) => setRecurrenceTimeZone(event.target.value)}
              placeholder="America/New_York"
              className="flex-1 md:flex-none md:w-64 rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:text-gray-200"
            />
          </div>
        </div>

        {recurrenceEnabled && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label htmlFor="recurrence-rrule" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                RRULE
              </label>
              <input
                id="recurrence-rrule"
                type="text"
                value={recurrenceRule}
                onChange={(event) => setRecurrenceRule(event.target.value)}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:text-gray-200"
                placeholder="FREQ=WEEKLY;BYDAY=MO,WE;INTERVAL=1"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Provide a valid RFC 5545 RRULE string. Weekly rules support automatic timezone-aware scheduling.
              </p>
            </div>

            <div>
              <label htmlFor="recurrence-count" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Count
              </label>
              <input
                id="recurrence-count"
                type="number"
                min="1"
                value={typeof recurrenceCount === "number" ? recurrenceCount : ""}
                onChange={(event) => {
                  const { value } = event.target;
                  if (value.trim().length === 0) {
                    setRecurrenceCount(undefined);
                    return;
                  }

                  const parsed = Number(value);
                  setRecurrenceCount(Number.isNaN(parsed) ? undefined : parsed);
                }}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:text-gray-200"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Limit the number of occurrences. Leave blank to rely on the RRULE or end date.
              </p>
            </div>

            <div>
              <label htmlFor="recurrence-until" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Until
              </label>
              <input
                id="recurrence-until"
                type="datetime-local"
                value={recurrenceUntil}
                onChange={(event) => setRecurrenceUntil(event.target.value)}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:text-gray-200"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Optional end date in the selected time zone.
              </p>
            </div>

            <div className="md:col-span-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Exceptions
                </span>
                <button
                  type="button"
                  onClick={handleAddRecurrenceException}
                  className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 focus:outline-none"
                >
                  Add exception
                </button>
              </div>

              {recurrenceExceptions.length === 0 ? (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  No exception dates configured.
                </p>
              ) : (
                <div className="space-y-2">
                  {recurrenceExceptions.map((value, index) => (
                    <div key={`recurrence-exception-${index}`} className="flex items-center gap-2">
                      <label
                        htmlFor={`recurrence-exception-input-${index}`}
                        className="sr-only"
                      >
                        Exception date {index + 1}
                      </label>
                      <input
                        id={`recurrence-exception-input-${index}`}
                        type="datetime-local"
                        value={value}
                        onChange={(event) => handleRecurrenceExceptionChange(index, event.target.value)}
                        className="flex-1 rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:text-gray-200"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveRecurrenceException(index)}
                        aria-label={`Remove exception date ${index + 1}`}
                        className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-red-600 hover:text-red-700 focus:outline-none"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {view === "matrix" ? (
        <SchedulingMatrix
          therapists={displayData.therapists}
          clients={displayData.clients}
          selectedDate={selectedDate}
          onTimeSlotClick={(time) =>
            handleCreateSession({ date: selectedDate, time })
          }
        />
      ) : view === "day" ? (
        <DayView
          selectedDate={selectedDate}
          timeSlots={timeSlots}
          sessionSlotIndex={sessionSlotIndex}
          onCreateSession={handleCreateSession}
          onEditSession={handleEditSession}
          showAvailability={showAvailability}
          therapists={displayData.therapists}
          clients={displayData.clients}
        />
      ) : (
        <WeekView
          weekDays={weekDays}
          timeSlots={timeSlots}
          sessionSlotIndex={sessionSlotIndex}
          onCreateSession={handleCreateSession}
          onEditSession={handleEditSession}
          showAvailability={showAvailability}
          therapists={displayData.therapists}
          clients={displayData.clients}
        />
      )}

      {isModalOpen && (
        <SessionModal
          isOpen={isModalOpen}
          onClose={handleCloseSessionModal}
          onSubmit={handleSubmit}
          session={selectedSession}
          selectedDate={selectedTimeSlot?.date}
          selectedTime={selectedTimeSlot?.time}
          therapists={displayData.therapists}
          clients={displayData.clients}
          existingSessions={displayData.sessions}
          timeZone={userTimeZone}
          defaultTherapistId={selectedTherapist}
          defaultClientId={selectedClient}
          retryHint={retryHint}
          onRetryHintDismiss={dismissRetryHint}
        />
      )}

      {isAutoScheduleModalOpen && (
        <AutoScheduleModal
          isOpen={isAutoScheduleModalOpen}
          onClose={() => setIsAutoScheduleModalOpen(false)}
          onSchedule={handleAutoSchedule}
          therapists={displayData.therapists}
          clients={displayData.clients}
          existingSessions={displayData.sessions}
        />
      )}
    </div>
  );
});

Schedule.displayName = "Schedule";
