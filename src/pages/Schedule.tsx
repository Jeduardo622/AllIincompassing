import React, {
  useState,
  useMemo,
  useCallback,
  useLayoutEffect,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO, startOfWeek, addDays, endOfWeek } from "date-fns";
import { getTimezoneOffset } from "date-fns-tz";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Clock,
  Plus,
  Edit2,
  AlertCircle,
  CalendarX,
} from "lucide-react";
import type { Session, Client } from "../types";
import {
  SessionModal,
  type SessionModalSubmitData,
  type SessionModalClinicalNotesPayload,
} from "../components/SessionModal";
import { SessionFilters } from "../components/SessionFilters";
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
import { supabase } from "../lib/supabase";
import { fetchLinkedClientIdsForTherapist } from "../lib/clients/therapistClientScope";
import { upsertClientSessionNoteForSession } from "../lib/session-notes";
import {
  buildSessionSlotIndex,
  createSessionSlotKey,
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
import { invalidateSessionNoteCachesAfterSessionWrite } from "../features/scheduling/domain/sessionNoteQueryInvalidation";
import {
  checkInProgressSessionCloseReadiness,
  completeSessionFromModal,
  IN_PROGRESS_CLOSE_NOT_READY_MESSAGE,
} from "../features/scheduling/domain/sessionComplete";
import {
  applyPendingScheduleDetail,
  type PendingScheduleTransitionRecorder,
} from "../features/scheduling/domain/pendingScheduleApply";
import {
  applyScheduleModalSearchParams,
  clearScheduleModalSearchParams,
  parseScheduleModalSearchParams,
  SCHEDULE_MODAL_URL_TTL_MS,
} from "./schedule-modal-url-state";

const MISSING_NOTES_RETRY_HINT =
  "Before closing this in-progress session, complete a linked clinical session note for this session and add per-goal note text for each worked goal. You can add these in Schedule > Edit Session > Clinical Session Notes, or in Client Details > Session Notes.";
const AUTO_SCHEDULE_CONCURRENCY = 3;
const _scheduleBoundedConcurrencyMarker = AUTO_SCHEDULE_CONCURRENCY;

type ScheduleSubmitData = SessionModalSubmitData;

const stripClinicalNoteFields = (data: ScheduleSubmitData): Partial<Session> => {
  const {
    session_note_narrative: _sessionNoteNarrative,
    session_note_goal_notes: _sessionNoteGoalNotes,
    session_note_goal_ids: _sessionNoteGoalIds,
    session_note_goals_addressed: _sessionNoteGoalsAddressed,
    session_note_authorization_id: _sessionNoteAuthorizationId,
    session_note_service_code: _sessionNoteServiceCode,
    ...sessionPayload
  } = data;
  return sessionPayload;
};

const buildClinicalNoteDraft = (
  data: SessionModalClinicalNotesPayload,
): {
  narrative: string;
  goalNotes: Record<string, string>;
  goalIds: string[];
  goalsAddressed: string[];
  authorizationId: string;
  serviceCode: string;
} | null => {
  const narrative = data.session_note_narrative?.trim() ?? "";
  const goalNotes = Object.fromEntries(
    Object.entries(data.session_note_goal_notes ?? {})
      .map(([goalId, noteText]) => [goalId, noteText.trim()])
      .filter(([, noteText]) => noteText.length > 0),
  );
  const goalIds = Array.isArray(data.session_note_goal_ids)
    ? data.session_note_goal_ids.filter((goalId) => typeof goalId === "string" && goalId.trim().length > 0)
    : [];
  const goalsAddressed = Array.isArray(data.session_note_goals_addressed)
    ? data.session_note_goals_addressed
        .map((goalLabel) => goalLabel.trim())
        .filter((goalLabel) => goalLabel.length > 0)
    : [];
  const authorizationId = data.session_note_authorization_id?.trim() ?? "";
  const serviceCode = data.session_note_service_code?.trim() ?? "";
  if (
    narrative.length === 0 &&
    Object.keys(goalNotes).length === 0
  ) {
    return null;
  }
  return {
    narrative,
    goalNotes,
    goalIds,
    goalsAddressed,
    authorizationId,
    serviceCode,
  };
};

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

const SESSION_STATUS_STYLES: Record<
  Session["status"],
  { card: string; secondary: string; time: string }
> = {
  scheduled: {
    card: "bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 hover:bg-blue-200 dark:hover:bg-blue-900/50",
    secondary: "text-blue-600 dark:text-blue-300",
    time: "text-blue-500 dark:text-blue-400",
  },
  in_progress: {
    card: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-200 dark:hover:bg-emerald-900/50",
    secondary: "text-emerald-600 dark:text-emerald-300",
    time: "text-emerald-500 dark:text-emerald-400",
  },
  completed: {
    card: "bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700",
    secondary: "text-gray-400 dark:text-gray-500",
    time: "text-gray-400 dark:text-gray-500",
  },
  cancelled: {
    card: "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/30",
    secondary: "text-red-500 dark:text-red-400",
    time: "text-red-400 dark:text-red-500",
  },
  "no-show": {
    card: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30",
    secondary: "text-amber-600 dark:text-amber-400",
    time: "text-amber-500 dark:text-amber-500",
  },
};

export function getSessionStatusClasses(
  status: Session["status"],
): { card: string; secondary: string; time: string } {
  return SESSION_STATUS_STYLES[status] ?? SESSION_STATUS_STYLES.scheduled;
}

/**
 * Prefer batch directory rows when non-empty (batch drives ordering and membership), but overlay
 * dropdown rows by id so richer dropdown fields (e.g. `availability_hours` from
 * `get_dropdown_data`) win for client-side conflict checks when batch rows omit or duplicate keys.
 */
function mergeScheduleDirectoryLists<T extends { id?: string }>(
  batchList: T[] | null | undefined,
  dropdownList: T[] | null | undefined,
): T[] {
  const batch = batchList ?? [];
  const dropdown = dropdownList ?? [];
  if (batch.length === 0) {
    return dropdown;
  }
  if (dropdown.length === 0) {
    return batch;
  }
  const dropdownById = new Map(
    dropdown
      .filter((item): item is T & { id: string } => typeof item.id === "string" && item.id.trim().length > 0)
      .map((item) => [item.id, item] as const),
  );
  return batch.map((row) => {
    if (typeof row.id !== "string" || row.id.trim().length === 0) {
      return row;
    }
    const rich = dropdownById.get(row.id);
    return rich ? ({ ...row, ...rich } as T) : row;
  });
}

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

        {slotSessions.map((session) => {
          const statusStyles = getSessionStatusClasses(session.status);
          return (
            <div
              key={session.id}
              data-session-status={session.status}
              className={`${statusStyles.card} rounded p-1 text-xs mb-1 group/session relative cursor-pointer transition-colors`}
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
              <div className={`${statusStyles.secondary} truncate`}>
                {session.therapist?.full_name}
              </div>
              <div className={`flex items-center ${statusStyles.time}`}>
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
          );
        })}
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
  }: {
    day: Date;
    timeSlots: string[];
    sessionSlotIndex: Map<string, Session[]>;
    onCreateSession: (timeSlot: { date: Date; time: string }) => void;
    onEditSession: (session: Session) => void;
  }) => {
    const dayKey = useMemo(() => format(day, "yyyy-MM-dd"), [day]);

    return (
      <div className="relative">
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
  }: {
    weekDays: Date[];
    timeSlots: string[];
    sessionSlotIndex: Map<string, Session[]>;
    onCreateSession: (timeSlot: { date: Date; time: string }) => void;
    onEditSession: (session: Session) => void;
  }) => {
    return (
      <div className="bg-white dark:bg-dark-lighter rounded-lg shadow overflow-x-auto">
        <div className="grid grid-cols-[72px_repeat(6,minmax(90px,1fr))] sm:grid-cols-7 border-b dark:border-gray-700 min-w-[620px] sm:min-w-[800px]">
          <div className="py-2 px-1.5 sm:px-2 text-center text-sm font-medium text-gray-500 dark:text-gray-400 border-r dark:border-gray-700">
            Time
          </div>
          {weekDays.map((day) => (
            <div
              key={day.toISOString()}
              className="py-2 px-1.5 sm:px-2 text-center text-sm font-medium text-gray-900 dark:text-white"
            >
              <span className="sm:hidden">{format(day, "EEE d")}</span>
              <span className="hidden sm:inline">{format(day, "EEE MMM d")}</span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-[72px_repeat(6,minmax(90px,1fr))] sm:grid-cols-7 min-w-[620px] sm:min-w-[800px]">
          <div className="border-r dark:border-gray-700">
            {timeSlots.map((time) => (
              <div
                key={time}
                className="h-10 border-b dark:border-gray-700 p-1.5 sm:p-2 text-xs sm:text-sm text-gray-500 dark:text-gray-400 flex items-center"
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
  }: {
    selectedDate: Date;
    timeSlots: string[];
    sessionSlotIndex: Map<string, Session[]>;
    onCreateSession: (timeSlot: { date: Date; time: string }) => void;
    onEditSession: (session: Session) => void;
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
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  useCapturePendingScheduleEvent();
  const { user, profile, effectiveRole } = useAuth();
  const activeOrganizationId = useActiveOrganizationId();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [view, setView] = useState<"day" | "week">("week");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState<Session | undefined>();
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<
    { date: Date; time: string } | undefined
  >();
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
  const [retryActionLabel, setRetryActionLabel] = useState<string | null>(null);
  const lastPendingScheduleKeyRef = useRef<string | null>(null);
  const lastAppliedUrlModalKeyRef = useRef<string | null>(null);
  const attemptedUrlSessionLookupRef = useRef<Set<string>>(new Set());
  const wasModalOpenRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (typeof window.matchMedia !== "function") {
      return;
    }

    if (window.matchMedia("(max-width: 767px)").matches) {
      setView("day");
    }
  }, []);

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
    setRetryActionLabel(null);
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

  const writeModalUrlState = useCallback(
    (state: { mode: "create"; startTimeIso: string } | { mode: "edit"; sessionId: string }) => {
      const params = applyScheduleModalSearchParams(searchParams, {
        ...state,
        expiresAtMs: Date.now() + SCHEDULE_MODAL_URL_TTL_MS,
      });
      setSearchParams(params, { replace: true });
      const parsed = parseScheduleModalSearchParams(params);
      lastAppliedUrlModalKeyRef.current = parsed.kind === "ready" ? parsed.key : null;
    },
    [searchParams, setSearchParams],
  );

  const openFromPendingSchedule = useCallback((detail: PendingScheduleDetail | null) => {
    const transition = applyPendingScheduleDetail({
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

    if (transition.decision === "apply" && transition.prefill) {
      writeModalUrlState({
        mode: "create",
        startTimeIso: transition.prefill.date.toISOString(),
      });
    }
  }, [writeModalUrlState]);

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
  const {
    data: batchedData,
    isLoading: isLoadingBatch,
    refetch: refetchScheduleBatch,
  } = useScheduleDataBatch(weekStart, weekEnd, { enabled: !!activeOrganizationId });

  const hasBatchedSessions = Array.isArray(batchedData?.sessions);
  const enableFallbackSessionsQuery =
    !isLoadingBatch && !hasBatchedSessions && !!activeOrganizationId;

  // Fallback to individual queries if batched data is not available
  const {
    data: sessions = [],
    isLoading: isLoadingSessions,
    isError: isSessionsError,
    error: sessionsQueryError,
    refetch: refetchSessions,
  } = useSessionsOptimized(
    weekStart,
    weekEnd,
    debouncedTherapist,
    debouncedClient,
    enableFallbackSessionsQuery,
  );

  // Use dropdown data hook for therapists and clients
  const {
    data: dropdownData,
    isLoading: isLoadingDropdowns,
    isError: isDropdownError,
    error: dropdownQueryError,
    refetch: refetchDropdowns,
  } = useDropdownData({ enabled: !!activeOrganizationId });

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

  // Use batched data if available, otherwise use individual query results; merge directory lists so empty batch arrays do not mask dropdown results.
  const displayData = useMemo(() => {
    const base = buildScheduleDisplayData({
      filteredBatchedSessions,
      fallbackSessions: sessions,
      batchedData,
      dropdownData,
    });
    return {
      ...base,
      therapists: mergeScheduleDirectoryLists(
        batchedData?.therapists,
        dropdownData?.therapists,
      ),
      clients: mergeScheduleDirectoryLists(batchedData?.clients, dropdownData?.clients),
    };
  }, [
    filteredBatchedSessions,
    sessions,
    batchedData,
    dropdownData,
  ]);

  /** Batch RPC returns `null` on failure (see optimizedQueries). Directory lists merge batch + dropdown (`displayData`); surface dropdown errors whenever either list still depends on `useDropdownData`. */
  const batchTherapistCount = Array.isArray(batchedData?.therapists)
    ? batchedData.therapists.length
    : 0;
  const batchClientCount = Array.isArray(batchedData?.clients) ? batchedData.clients.length : 0;
  const directoryLoadRequiresDropdown =
    batchTherapistCount === 0 || batchClientCount === 0;

  const sessionsPathFailed = enableFallbackSessionsQuery && isSessionsError;
  const dropdownPathFailed =
    !!activeOrganizationId && isDropdownError && directoryLoadRequiresDropdown;
  const scheduleDataLoadFailed = sessionsPathFailed || dropdownPathFailed;

  const scheduleDataLoadErrorMessage = useMemo(() => {
    if (sessionsPathFailed && sessionsQueryError) {
      return toError(sessionsQueryError, "Sessions could not be loaded").message;
    }
    if (dropdownPathFailed && dropdownQueryError) {
      return toError(dropdownQueryError, "Schedule filters could not be loaded").message;
    }
    return "Schedule data could not be loaded. Try again in a moment.";
  }, [sessionsPathFailed, dropdownPathFailed, sessionsQueryError, dropdownQueryError]);

  const handleRetryScheduleDataLoad = useCallback(() => {
    void refetchScheduleBatch();
    void refetchSessions();
    void refetchDropdowns();
  }, [refetchScheduleBatch, refetchSessions, refetchDropdowns]);

  const showEmptySessionsState = displayData.sessions.length === 0;
  const therapistScopedView = effectiveRole === "therapist";

  const scheduleEmptyReason = useMemo(() => {
    if (displayData.therapists.length === 0 && displayData.clients.length === 0) {
      return "no-schedule-data" as const;
    }
    return "no-sessions-in-period" as const;
  }, [displayData.therapists.length, displayData.clients.length]);

  useEffect(() => {
    if (selectedTherapist) {
      return;
    }
    if (!therapistScopedView) {
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
  }, [selectedTherapist, therapistScopedView, profile?.id, profile?.preferences, user?.user_metadata, displayData.therapists]);

  useEffect(() => {
    if (!therapistScopedView || !scopedTherapistId) {
      return;
    }
    if (selectedTherapist !== scopedTherapistId) {
      setSelectedTherapist(scopedTherapistId);
    }
  }, [therapistScopedView, scopedTherapistId, selectedTherapist]);

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
    if (therapistScopedView) {
      return;
    }
    setSelectedTherapist(therapistId);
    if (therapistId !== scopedTherapistId) {
      setScopedTherapistId(null);
    }
  }, [scopedTherapistId, therapistScopedView]);

  const handleClientFilterChange = useCallback((clientId: string | null) => {
    setSelectedClient(clientId);
    if (clientId !== scopedClientId) {
      setScopedClientId(null);
    }
  }, [scopedClientId]);

  const visibleTherapists = useMemo(() => {
    if (!therapistScopedView || !scopedTherapistId) {
      return displayData.therapists;
    }
    return displayData.therapists.filter((therapist) => therapist.id === scopedTherapistId);
  }, [displayData.therapists, therapistScopedView, scopedTherapistId]);

  const therapistLinkedClientIdsQuery = useQuery({
    queryKey: ["therapist-linked-client-ids", scopedTherapistId, activeOrganizationId],
    queryFn: async () => {
      if (!scopedTherapistId) {
        return [];
      }
      return fetchLinkedClientIdsForTherapist(supabase, scopedTherapistId);
    },
    enabled: therapistScopedView && !!scopedTherapistId && !!activeOrganizationId,
  });

  const visibleClients = useMemo(() => {
    if (!therapistScopedView) {
      return displayData.clients;
    }
    const scopedId = selectedTherapist ?? scopedTherapistId;
    if (!scopedId) {
      return displayData.clients;
    }
    const scheduledClientIds = new Set(
      displayData.sessions
        .filter((session) => session.therapist_id === scopedId)
        .map((session) => session.client_id),
    );
    // Until link IDs resolve, keep prior behavior (primary + sessions) so the dropdown does not flash empty.
    const linkedIds = therapistLinkedClientIdsQuery.data;
    const linkedSet = linkedIds ? new Set(linkedIds) : null;
    return displayData.clients.filter((client) => {
      const maybeTherapistId =
        (client as Client & { therapist_id?: string | null }).therapist_id ?? null;
      const linkedMatch = linkedSet ? linkedSet.has(client.id) : false;
      return maybeTherapistId === scopedId || scheduledClientIds.has(client.id) || linkedMatch;
    });
  }, [
    displayData.clients,
    displayData.sessions,
    therapistScopedView,
    selectedTherapist,
    scopedTherapistId,
    therapistLinkedClientIdsQuery.data,
  ]);
  const scopedTherapistDisplayName = useMemo(() => {
    const scopedId = selectedTherapist ?? scopedTherapistId;
    if (!scopedId) {
      return "Current Therapist";
    }
    const match = visibleTherapists.find((therapist) => therapist.id === scopedId);
    return match?.full_name ?? "Current Therapist";
  }, [selectedTherapist, scopedTherapistId, visibleTherapists]);

  const isScheduleShellNarrow = useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return () => {};
      }
      const mq = window.matchMedia("(max-width: 639px)");
      mq.addEventListener("change", onStoreChange);
      return () => mq.removeEventListener("change", onStoreChange);
    },
    () =>
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(max-width: 639px)").matches
        : false,
    () => false,
  );

  const mobileScheduleOptionsSummary = useMemo(() => {
    const tzShort = recurrenceTimeZone.includes("/")
      ? recurrenceTimeZone.split("/").slice(-2).join("/")
      : recurrenceTimeZone;
    const parts: string[] = [];
    parts.push(view === "day" ? "Day view" : "Week view");
    parts.push(tzShort);
    if (recurrenceEnabled) {
      parts.push("Recurrence on");
    }
    if (therapistScopedView) {
      parts.push("My clients");
    } else {
      const t = selectedTherapist
        ? (visibleTherapists.find((x) => x.id === selectedTherapist)?.full_name ?? "Therapist")
        : "All therapists";
      const c = selectedClient
        ? (visibleClients.find((x) => x.id === selectedClient)?.full_name ?? "Client")
        : "All clients";
      parts.push(t);
      parts.push(c);
    }
    return parts.join(" · ");
  }, [
    view,
    recurrenceTimeZone,
    recurrenceEnabled,
    therapistScopedView,
    selectedTherapist,
    selectedClient,
    visibleTherapists,
    visibleClients,
  ]);

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
      if (selectedSession?.id && selectedSession.client_id) {
        invalidateSessionNoteCachesAfterSessionWrite(queryClient, {
          sessionId: selectedSession.id,
          clientId: selectedSession.client_id,
          organizationId: activeOrganizationId,
        });
      }
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

  const completeSessionMutation = useMutation({
    mutationFn: async ({
      sessionId,
      outcome,
      notes,
    }: {
      sessionId: string;
      outcome: "completed" | "no-show";
      notes?: string | null;
    }) => {
      await completeSessionFromModal({ sessionId, outcome, notes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      queryClient.invalidateQueries({ queryKey: ["sessions-batch"] });
    },
    onError: (error) => {
      handleScheduleMutationError(error);
    },
  });

  // Memoized callbacks
  const handleCreateSession = useCallback(
    (
      timeSlot: { date: Date; time: string },
      options?: { syncUrl?: boolean },
    ) => {
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
      setRetryActionLabel(null);

      const [hours, minutes] = timeSlot.time.split(":").map((part) => Number(part));
      const startTime = new Date(timeSlot.date);
      startTime.setHours(
        Number.isFinite(hours) ? hours : 0,
        Number.isFinite(minutes) ? minutes : 0,
        0,
        0,
      );
      if (options?.syncUrl !== false) {
        writeModalUrlState({
          mode: "create",
          startTimeIso: startTime.toISOString(),
        });
      }
    },
    [writeModalUrlState],
  );

  const handleEditSession = useCallback((
    session: Session,
    options?: { syncUrl?: boolean },
  ) => {
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
    setRetryActionLabel(null);
    if (options?.syncUrl !== false) {
      writeModalUrlState({
        mode: "edit",
        sessionId: session.id,
      });
    }
  }, [writeModalUrlState]);

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
    setRetryActionLabel(null);
    applyScheduleResetBranch(
      { kind: "close-modal" },
      scheduleResetSetters,
    );
  }, [scheduleResetSetters]);

  useEffect(() => {
    if (wasModalOpenRef.current && !isModalOpen) {
      const params = clearScheduleModalSearchParams(searchParams);
      setSearchParams(params, { replace: true });
      lastAppliedUrlModalKeyRef.current = null;
    }
    wasModalOpenRef.current = isModalOpen;
  }, [isModalOpen, searchParams, setSearchParams]);

  const handleSessionStarted = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["sessions"] });
    queryClient.invalidateQueries({ queryKey: ["sessions-batch"] });
  }, [queryClient]);

  const dismissRetryHint = useCallback(() => {
    setRetryActionLabel(null);
    setRetryHint(null);
  }, []);

  const handleOpenLinkedSessionDocumentation = useCallback(() => {
    if (!selectedSession?.client_id) {
      return;
    }
    navigate(`/clients/${selectedSession.client_id}?tab=session-notes`);
  }, [navigate, selectedSession?.client_id]);

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
    async (data: ScheduleSubmitData) => {
      const sessionPayload = stripClinicalNoteFields(data);
      const clinicalNoteDraft = buildClinicalNoteDraft(data);
      const decision = decideScheduleSubmitBranch({
        selectedSession,
        data: sessionPayload,
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
        case "edit-complete": {
          let liveInProgress = selectedSession?.status === "in_progress";
          if (!liveInProgress) {
            const { data: liveRow, error: liveError } = await supabase
              .from("sessions")
              .select("status")
              .eq("id", decision.selectedSessionId)
              .maybeSingle();
            if (liveError) {
              logger.warn("Live session status lookup failed for close-readiness gate", {
                metadata: {
                  sessionId: decision.selectedSessionId,
                  reason: liveError.message,
                },
              });
            } else {
              liveInProgress = liveRow?.status === "in_progress";
            }
          }
          if (liveInProgress) {
            try {
              const readiness = await checkInProgressSessionCloseReadiness({
                sessionId: decision.selectedSessionId,
                organizationId: activeOrganizationId,
              });
              if (!readiness.ready) {
                setRetryHint(MISSING_NOTES_RETRY_HINT);
                setRetryActionLabel("Open Client Details");
                showError(IN_PROGRESS_CLOSE_NOT_READY_MESSAGE);
                return;
              }
            } catch (error) {
              logger.warn("Session close readiness precheck failed; falling back to backend enforcement", {
                metadata: {
                  sessionId: decision.selectedSessionId,
                  reason: toError(error, "Session close readiness precheck failed").message,
                },
              });
            }
          }

          await completeSessionMutation.mutateAsync({
            sessionId: decision.selectedSessionId,
            outcome: "completed",
            notes: decision.notes,
          });
          showSuccess("Session marked as completed");
          applyScheduleResetBranch({ kind: "submit-cancel" }, scheduleResetSetters);
          return;
        }
        case "edit-no-show": {
          let liveInProgressNoShow = selectedSession?.status === "in_progress";
          if (!liveInProgressNoShow) {
            const { data: liveRowNs, error: liveErrorNs } = await supabase
              .from("sessions")
              .select("status")
              .eq("id", decision.selectedSessionId)
              .maybeSingle();
            if (liveErrorNs) {
              logger.warn("Live session status lookup failed for close-readiness gate", {
                metadata: {
                  sessionId: decision.selectedSessionId,
                  reason: liveErrorNs.message,
                },
              });
            } else {
              liveInProgressNoShow = liveRowNs?.status === "in_progress";
            }
          }
          if (liveInProgressNoShow) {
            try {
              const readiness = await checkInProgressSessionCloseReadiness({
                sessionId: decision.selectedSessionId,
                organizationId: activeOrganizationId,
              });
              if (!readiness.ready) {
                setRetryHint(MISSING_NOTES_RETRY_HINT);
                setRetryActionLabel("Open Client Details");
                showError(IN_PROGRESS_CLOSE_NOT_READY_MESSAGE);
                return;
              }
            } catch (error) {
              logger.warn("Session close readiness precheck failed; falling back to backend enforcement", {
                metadata: {
                  sessionId: decision.selectedSessionId,
                  reason: toError(error, "Session close readiness precheck failed").message,
                },
              });
            }
          }

          await completeSessionMutation.mutateAsync({
            sessionId: decision.selectedSessionId,
            outcome: "no-show",
            notes: decision.notes,
          });
          showSuccess("Session marked as no-show");
          applyScheduleResetBranch({ kind: "submit-cancel" }, scheduleResetSetters);
          return;
        }
        case "edit-update": {
          if (selectedSession && clinicalNoteDraft) {
            if (!activeOrganizationId) {
              throw new Error("Organization context is required to save clinical session notes.");
            }
            if (!user?.id) {
              throw new Error("Sign in again before saving clinical session notes.");
            }
            if (!clinicalNoteDraft.authorizationId || !clinicalNoteDraft.serviceCode) {
              throw new Error(
                "Authorization and service code are required to save clinical session notes from schedule.",
              );
            }
            await upsertClientSessionNoteForSession({
              sessionId: selectedSession.id,
              clientId: sessionPayload.client_id ?? selectedSession.client_id,
              authorizationId: clinicalNoteDraft.authorizationId,
              therapistId: sessionPayload.therapist_id ?? selectedSession.therapist_id,
              organizationId: activeOrganizationId,
              actorUserId: user.id,
              serviceCode: clinicalNoteDraft.serviceCode,
              sessionDate: format(parseISO(sessionPayload.start_time ?? selectedSession.start_time), "yyyy-MM-dd"),
              startTime: format(parseISO(sessionPayload.start_time ?? selectedSession.start_time), "HH:mm:ss"),
              endTime: format(parseISO(sessionPayload.end_time ?? selectedSession.end_time), "HH:mm:ss"),
              goalsAddressed: clinicalNoteDraft.goalsAddressed,
              goalIds: clinicalNoteDraft.goalIds,
              goalNotes: clinicalNoteDraft.goalNotes,
              narrative: clinicalNoteDraft.narrative,
            });
          }
          await updateSessionMutation.mutateAsync(sessionPayload);
          return;
        }
        case "create": {
          await createSessionMutation.mutateAsync(sessionPayload);
          return;
        }
        case "create-blocked": {
          showError(`Cannot create a session with status '${decision.blockedStatus}'. New sessions must start as scheduled.`);
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
      user?.id,
      activeOrganizationId,
      scheduleResetSetters,
      cancelSessionMutation,
      completeSessionMutation,
      updateSessionMutation,
      createSessionMutation,
    ],
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

  const handleViewChange = useCallback((newView: "day" | "week") => {
    setView(newView);
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

  useEffect(() => {
    const parsed = parseScheduleModalSearchParams(searchParams);
    if (parsed.kind === "none") {
      lastAppliedUrlModalKeyRef.current = null;
      return;
    }

    if (parsed.kind === "expired" || parsed.kind === "invalid") {
      const params = clearScheduleModalSearchParams(searchParams);
      setSearchParams(params, { replace: true });
      lastAppliedUrlModalKeyRef.current = null;
      return;
    }

    if (lastAppliedUrlModalKeyRef.current === parsed.key) {
      return;
    }

    if (parsed.state.mode === "create") {
      const date = parseISO(parsed.state.startTimeIso);
      handleCreateSession(
        {
          date,
          time: format(date, "HH:mm"),
        },
        { syncUrl: false },
      );
      lastAppliedUrlModalKeyRef.current = parsed.key;
      return;
    }

    if (isLoading) {
      return;
    }

    const sessionPool = Array.isArray(batchedData?.sessions) ? batchedData.sessions : displayData.sessions;
    const sessionId = parsed.state.sessionId;
    const session = sessionPool.find((item) => item.id === sessionId);
    if (session) {
      handleEditSession(session, { syncUrl: false });
      lastAppliedUrlModalKeyRef.current = parsed.key;
      attemptedUrlSessionLookupRef.current.delete(sessionId);
      return;
    }

    if (!activeOrganizationId) {
      return;
    }

    if (attemptedUrlSessionLookupRef.current.has(sessionId)) {
      const params = clearScheduleModalSearchParams(searchParams);
      setSearchParams(params, { replace: true });
      lastAppliedUrlModalKeyRef.current = null;
      return;
    }

    attemptedUrlSessionLookupRef.current.add(sessionId);
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("sessions")
        .select("*")
        .eq("id", sessionId)
        .eq("organization_id", activeOrganizationId)
        .maybeSingle();
      if (cancelled) {
        return;
      }
      if (!error && data) {
        handleEditSession(data as Session, { syncUrl: false });
        lastAppliedUrlModalKeyRef.current = parsed.key;
        return;
      }
      const params = clearScheduleModalSearchParams(searchParams);
      setSearchParams(params, { replace: true });
      lastAppliedUrlModalKeyRef.current = null;
    })();
    return () => {
      cancelled = true;
    };
  }, [
    searchParams,
    setSearchParams,
    isLoading,
    activeOrganizationId,
    batchedData?.sessions,
    displayData.sessions,
    handleCreateSession,
    handleEditSession,
  ]);

  if (!activeOrganizationId) {
    return (
      <div
        className="h-full flex items-center justify-center"
        data-testid="schedule-missing-org"
      >
        <div className="text-center max-w-sm">
          <p className="font-medium text-gray-900 dark:text-white">
            Organization context unavailable
          </p>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            The schedule is scoped per organization. Impersonate a tenant or
            contact an administrator.
          </p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="h-full relative" aria-busy="true">
        <div
          className="h-full flex items-center justify-center"
          role="status"
          aria-live="polite"
          data-testid="schedule-loading"
        >
          <span className="sr-only">Loading schedule…</span>
          <div
            className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"
            aria-hidden="true"
          />
        </div>
        {isModalOpen && (
          <SessionModal
            isOpen={isModalOpen}
            onClose={handleCloseSessionModal}
            onSubmit={handleSubmit}
            session={selectedSession}
            selectedDate={selectedTimeSlot?.date}
            selectedTime={selectedTimeSlot?.time}
            therapists={visibleTherapists}
            clients={visibleClients}
            existingSessions={displayData.sessions}
            timeZone={userTimeZone}
            defaultTherapistId={selectedTherapist}
            defaultClientId={selectedClient}
            retryHint={retryHint}
            onRetryHintDismiss={dismissRetryHint}
            retryActionLabel={retryActionLabel}
            onRetryAction={retryActionLabel ? handleOpenLinkedSessionDocumentation : undefined}
            onSessionStarted={handleSessionStarted}
          />
        )}
      </div>
    );
  }

  if (scheduleDataLoadFailed) {
    return (
      <div className="h-full relative">
        <div
          className="h-full flex items-center justify-center px-4"
          data-testid="schedule-data-load-error"
          role="alert"
          aria-labelledby="schedule-data-load-error-title"
          aria-describedby="schedule-data-load-error-description"
        >
          <div className="text-center max-w-md">
            <AlertCircle
              className="mx-auto h-10 w-10 text-amber-500"
              aria-hidden="true"
            />
            <h2
              id="schedule-data-load-error-title"
              className="mt-4 text-lg font-semibold text-gray-900 dark:text-white"
            >
              Couldn&apos;t load schedule
            </h2>
            <p
              id="schedule-data-load-error-description"
              className="mt-2 text-sm text-gray-500 dark:text-gray-400"
            >
              {scheduleDataLoadErrorMessage}
            </p>
            <button
              type="button"
              onClick={handleRetryScheduleDataLoad}
              className="mt-6 inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
            >
              Retry
            </button>
          </div>
        </div>
        {isModalOpen && (
          <SessionModal
            isOpen={isModalOpen}
            onClose={handleCloseSessionModal}
            onSubmit={handleSubmit}
            session={selectedSession}
            selectedDate={selectedTimeSlot?.date}
            selectedTime={selectedTimeSlot?.time}
            therapists={visibleTherapists}
            clients={visibleClients}
            existingSessions={displayData.sessions}
            timeZone={userTimeZone}
            defaultTherapistId={selectedTherapist}
            defaultClientId={selectedClient}
            retryHint={retryHint}
            onRetryHintDismiss={dismissRetryHint}
            retryActionLabel={retryActionLabel}
            onRetryAction={retryActionLabel ? handleOpenLinkedSessionDocumentation : undefined}
            onSessionStarted={handleSessionStarted}
          />
        )}
      </div>
    );
  }

  const schedulePageHeader = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Schedule</h1>
      <div className="flex flex-col gap-3 min-[400px]:flex-row min-[400px]:items-center min-[400px]:space-x-4">
        <div className="flex items-center justify-center space-x-2">
          <button
            aria-label="Previous period"
            onClick={() => handleDateNavigation("prev")}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
          >
            <ChevronLeft aria-hidden="true" className="w-5 h-5" />
          </button>

          <div className="flex min-w-0 items-center space-x-2">
            <CalendarIcon className="h-5 w-5 shrink-0 text-gray-500 dark:text-gray-400" />
            <span className="min-w-0 text-center text-sm font-medium text-gray-900 dark:text-white sm:min-w-[200px] sm:text-base">
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

        <div className="flex justify-center min-[400px]:justify-end">
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
              } border border-gray-300 dark:border-gray-600 rounded-r-lg`}
              aria-label="Week view"
            >
              Week
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const therapistScopeSection =
    therapistScopedView ? (
      <section
        className="bg-white dark:bg-dark-lighter border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm p-4"
        aria-label="Therapist schedule scope"
      >
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          My Clients
        </div>
        <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <p className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Therapist</p>
            <div className="w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-800 dark:border-gray-600 dark:bg-dark dark:text-gray-100">
              {scopedTherapistDisplayName}
            </div>
          </div>
          <div>
            <label
              htmlFor="therapist-client-scope-filter"
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Client
            </label>
            <select
              id="therapist-client-scope-filter"
              value={selectedClient || ""}
              onChange={(event) => handleClientFilterChange(event.target.value || null)}
              className="w-full rounded-md border-gray-300 bg-white shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-dark dark:text-gray-200"
            >
              <option value="">All My Clients ({visibleClients.length})</option>
              {visibleClients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.full_name} - {(client.service_preference ?? []).join(", ")}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>
    ) : null;

  const sessionFiltersBlock = !therapistScopedView ? (
    <SessionFilters
      therapists={visibleTherapists}
      clients={visibleClients}
      selectedTherapist={selectedTherapist}
      selectedClient={selectedClient}
      onTherapistChange={handleTherapistFilterChange}
      onClientChange={handleClientFilterChange}
      scopedTherapistId={scopedTherapistId}
      scopedClientId={scopedClientId}
      therapistLocked={therapistScopedView}
    />
  ) : null;

  const renderScheduleRecurrenceFieldset = (marginClass: string) => (
    <fieldset
      className={`${marginClass ? `${marginClass} ` : ""}bg-white dark:bg-dark-lighter border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm p-4`}
    >
        <legend className="sr-only">Recurrence settings</legend>
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
      </fieldset>
  );

  return (
    <div className="h-full">
      {isScheduleShellNarrow ? (
        <>
          <div className="mb-3">{schedulePageHeader}</div>
          <details className="group mb-4 rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-dark-lighter">
            <summary className="flex cursor-pointer list-none items-start gap-2 px-3 py-2.5 text-left [&::-webkit-details-marker]:hidden">
              <ChevronDown
                className="mt-0.5 h-5 w-5 shrink-0 text-gray-500 transition-transform group-open:rotate-180 dark:text-gray-400"
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-gray-900 dark:text-white">Filters & schedule options</div>
                <p className="mt-0.5 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">
                  {mobileScheduleOptionsSummary}
                </p>
              </div>
            </summary>
            <div className="space-y-4 border-t border-gray-200 px-3 pb-4 pt-3 dark:border-gray-700">
              {therapistScopeSection}
              {sessionFiltersBlock}
              {renderScheduleRecurrenceFieldset("")}
            </div>
          </details>
        </>
      ) : (
        <>
          <div className="mb-6 space-y-4">
            {schedulePageHeader}
            {therapistScopeSection}
          </div>
          {sessionFiltersBlock}
          {renderScheduleRecurrenceFieldset("mt-6")}
        </>
      )}

      {showEmptySessionsState ? (
        <div
          className="mt-6 flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 py-16 text-center dark:border-gray-600 dark:bg-gray-900/40"
          data-testid="schedule-empty-sessions"
          data-schedule-empty-reason={scheduleEmptyReason}
          role="status"
          aria-live="polite"
        >
          <CalendarX
            className="h-12 w-12 text-gray-400 dark:text-gray-500"
            aria-hidden="true"
          />
          {scheduleEmptyReason === "no-schedule-data" ? (
            <>
              <h2 className="mt-4 text-base font-medium text-gray-900 dark:text-white">
                No schedule data yet
              </h2>
              <p className="mt-2 max-w-sm text-sm text-gray-500 dark:text-gray-400">
                There are no therapists or clients for this organization. Add team members and clients, then book sessions from the schedule.
              </p>
            </>
          ) : (
            <>
              <h2 className="mt-4 text-base font-medium text-gray-900 dark:text-white">
                No sessions in this period
              </h2>
              <p className="mt-2 max-w-sm text-sm text-gray-500 dark:text-gray-400">
                There are no sessions for this date range and filters. Try another period or adjust filters.
              </p>
            </>
          )}
        </div>
      ) : view === "day" ? (
        <DayView
          selectedDate={selectedDate}
          timeSlots={timeSlots}
          sessionSlotIndex={sessionSlotIndex}
          onCreateSession={handleCreateSession}
          onEditSession={handleEditSession}
        />
      ) : (
        <WeekView
          weekDays={weekDays}
          timeSlots={timeSlots}
          sessionSlotIndex={sessionSlotIndex}
          onCreateSession={handleCreateSession}
          onEditSession={handleEditSession}
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
          therapists={visibleTherapists}
          clients={visibleClients}
          existingSessions={displayData.sessions}
          timeZone={userTimeZone}
          defaultTherapistId={selectedTherapist}
          defaultClientId={selectedClient}
          retryHint={retryHint}
          onRetryHintDismiss={dismissRetryHint}
          retryActionLabel={retryActionLabel}
          onRetryAction={retryActionLabel ? handleOpenLinkedSessionDocumentation : undefined}
          onSessionStarted={handleSessionStarted}
        />
      )}

    </div>
  );
});

Schedule.displayName = "Schedule";
