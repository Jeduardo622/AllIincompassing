import React, { useState, useMemo, useCallback, useLayoutEffect, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO, startOfWeek, addDays, endOfWeek } from "date-fns";
import { getTimezoneOffset, fromZonedTime as zonedTimeToUtc } from "date-fns-tz";
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
import SessionModal from "../components/SessionModal";
import AutoScheduleModal from "../components/AutoScheduleModal";
import AvailabilityOverlay from "../components/AvailabilityOverlay";
import SessionFilters from "../components/SessionFilters";
import SchedulingMatrix from "../components/SchedulingMatrix";
import { useDebounce } from "../lib/performance";
import {
  useScheduleDataBatch,
  useSessionsOptimized,
  useDropdownData,
} from "../lib/optimizedQueries";
import { cancelSessions } from "../lib/sessionCancellation";
import { supabase } from "../lib/supabase";
import { showError, showSuccess } from "../lib/toast";
import { logger } from "../lib/logger/logger";
import { toError } from "../lib/logger/normalizeError";
import { useAuth } from "../lib/authContext";
import { useActiveOrganizationId } from "../lib/organization";
import type {
  BookSessionApiRequestBody,
  BookSessionApiResponse,
  BookSessionResult,
  SessionRecurrence,
} from "../server/types";

// (no module-scope event buffering)
declare global {
  interface Window { __enableOpenScheduleCapture?: boolean }
}
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const bufferToLocalStorage = (event: Event) => {
    try {
      const detail = (event as CustomEvent).detail || {};
      localStorage.setItem('pendingSchedule', JSON.stringify(detail));
    } catch {
      // ignore
    }
  };
  document.addEventListener('openScheduleModal', bufferToLocalStorage as EventListener, true);
  window.addEventListener('openScheduleModal', bufferToLocalStorage as EventListener, true);
}

interface RecurrenceFormState {
  enabled: boolean;
  rule: string;
  count?: number;
  until?: string;
  exceptions: string[];
  timeZone: string;
}

type PendingScheduleDetail = {
  start_time?: string;
};

const SESSION_HOLD_SECONDS = 5 * 60; // 5 minutes

const toPendingScheduleDetail = (value: unknown): PendingScheduleDetail | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const startTime = record.start_time;

  if (startTime !== undefined && typeof startTime !== "string") {
    return null;
  }

  return { start_time: typeof startTime === "string" ? startTime : undefined };
};

function toTimeZoneAwareIso(value: string | undefined, timeZone: string): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  try {
    if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
      const parsed = new Date(trimmed);
      return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
    }

    const utcValue = zonedTimeToUtc(trimmed, timeZone);
    return utcValue.toISOString();
  } catch (error) {
    logger.warn("Failed to normalize recurrence datetime", {
      metadata: {
        value,
        timeZone,
        failure: toError(error, "Recurrence normalization failed").message,
      },
    });
    return undefined;
  }
}

function normalizeRecurrencePayload(state: RecurrenceFormState | undefined): SessionRecurrence | undefined {
  if (!state?.enabled) {
    return undefined;
  }

  const rule = state.rule.trim();
  if (rule.length === 0) {
    return undefined;
  }

  const recurrence: SessionRecurrence = {
    rule,
    timeZone: state.timeZone,
  };

  if (typeof state.count === "number" && Number.isFinite(state.count) && state.count > 0) {
    recurrence.count = Math.trunc(state.count);
  }

  const untilIso = toTimeZoneAwareIso(state.until, state.timeZone);
  if (untilIso) {
    recurrence.until = untilIso;
  }

  const exceptionIsoValues = state.exceptions
    .map((value) => toTimeZoneAwareIso(value, state.timeZone))
    .filter((value): value is string => typeof value === "string");

  if (exceptionIsoValues.length > 0) {
    recurrence.exceptions = exceptionIsoValues;
  }

  return recurrence;
}

// Memoized time slot component
const TimeSlot = React.memo(
  ({
    time,
    day,
    sessions,
    onCreateSession,
    onEditSession,
  }: {
    time: string;
    day: Date;
    sessions: Session[];
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

    // Filter sessions for this time slot
    const daySessions = useMemo(() => {
      const dayStr = format(day, "yyyy-MM-dd");
      return sessions.filter((session) => {
        const startIso = session.start_time;
        const localDate = format(parseISO(startIso), "yyyy-MM-dd");
        const localHHmm = format(parseISO(startIso), "HH:mm");
        const rawDate = typeof startIso === "string" && startIso.length >= 10 ? startIso.slice(0, 10) : undefined;
        const rawHHmm = typeof startIso === "string" && startIso.length >= 16 ? startIso.slice(11, 16) : undefined;

        const sameDay = localDate === dayStr || rawDate === dayStr;
        const sameTime = localHHmm === time || rawHHmm === time;
        return sameDay && sameTime;
      });
    }, [sessions, day, time]);

    return (
      <div
        className="h-10 border-b dark:border-gray-700 border-r dark:border-gray-700 p-2 relative group cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
        role="button"
        tabIndex={0}
        onClick={handleTimeSlotClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') handleTimeSlotClick(e as unknown as React.MouseEvent);
        }}
      >
        <button aria-label="Add session" title="Add session" className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-opacity">
          <Plus className="w-4 h-4 text-gray-500 dark:text-gray-400" />
        </button>

        {daySessions.map((session) => (
          <div
            key={session.id}
            className="bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 rounded p-1 text-xs mb-1 group/session relative cursor-pointer hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
            role="button"
            tabIndex={0}
            onClick={(e) => handleSessionClick(e, session)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') handleSessionClick(e as unknown as React.MouseEvent, session);
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

            <div className="absolute top-1 right-1 opacity-0 group-hover/session:opacity-100 flex space-x-1">
              <button
                className="p-1 rounded hover:bg-blue-300 dark:hover:bg-blue-800"
                onClick={(e) => {
                  e.stopPropagation();
                  onEditSession(session);
                }}
                aria-label="Edit session" title="Edit session"
              >
                <Edit2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  },
);

TimeSlot.displayName = "TimeSlot";

function createIdempotencyKey(): string | undefined {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch (error) {
      logger.warn("Failed to generate idempotency key", {
        metadata: {
          failure: toError(error, "Idempotency key generation failed").message,
        },
      });
    }
  }
  return undefined;
}

async function callBookSessionApi(
  payload: BookSessionApiRequestBody,
): Promise<BookSessionResult> {
  const idempotencyKey = createIdempotencyKey();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token?.trim();

  if (!accessToken) {
    throw new Error("Authentication is required to book sessions");
  }

  headers.Authorization = `Bearer ${accessToken}`;

  let response: Response;
  try {
    response = await fetch("/api/book", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  } catch (networkError) {
    logger.error("Booking API request failed", {
      error: toError(networkError, "Booking API request failed"),
      metadata: {
        endpoint: "/api/book",
      },
    });
    throw new Error("Unable to reach booking service");
  }

  let body: BookSessionApiResponse | null = null;
  try {
    body = await response.json() as BookSessionApiResponse;
  } catch (parseError) {
    logger.error("Failed to parse booking API response", {
      error: toError(parseError, "Booking API response parsing failed"),
      metadata: {
        endpoint: "/api/book",
      },
    });
  }

  if (!response.ok || !body) {
    const message = body?.error ?? "Failed to book session";
    const enhancedError = new Error(message) as Error & { status?: number; retryHint?: string };
    enhancedError.status = response.status;
    if (response.status === 409) {
      enhancedError.retryHint =
        typeof body?.hint === 'string' && body.hint.length > 0
          ? body.hint
          : 'The selected slot was just taken. Refresh the schedule or choose a different time.';
    }
    throw enhancedError;
  }

  if (!body.success || !body.data) {
    throw new Error(body.error ?? "Failed to book session");
  }

  return body.data;
}

function buildBookingPayload(
  session: Partial<Session>,
  metadata: {
    startOffsetMinutes: number;
    endOffsetMinutes: number;
    timeZone: string;
  },
  recurrenceState?: RecurrenceFormState,
): BookSessionApiRequestBody {
  const normalizedSession = {
    ...session,
    status: session.status ?? "scheduled",
  } as BookSessionApiRequestBody["session"];

  const recurrence = normalizeRecurrencePayload(recurrenceState) ?? session.recurrence ?? undefined;

  return {
    session: normalizedSession,
    startTimeOffsetMinutes: metadata.startOffsetMinutes,
    endTimeOffsetMinutes: metadata.endOffsetMinutes,
    timeZone: metadata.timeZone,
    holdSeconds: SESSION_HOLD_SECONDS,
    ...(recurrence ? { recurrence } : {}),
  };
}

// Memoized day column component
const DayColumn = React.memo(
  ({
    day,
    timeSlots,
    sessions,
    onCreateSession,
    onEditSession,
    showAvailability,
    therapists,
    clients,
  }: {
    day: Date;
    timeSlots: string[];
    sessions: Session[];
    onCreateSession: (timeSlot: { date: Date; time: string }) => void;
    onEditSession: (session: Session) => void;
    showAvailability: boolean;
    therapists: Therapist[];
    clients: Client[];
  }) => {
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
            sessions={sessions}
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
    sessions,
    onCreateSession,
    onEditSession,
    showAvailability,
    therapists,
    clients,
  }: {
    weekDays: Date[];
    timeSlots: string[];
    sessions: Session[];
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
              sessions={sessions}
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
    sessions,
    onCreateSession,
    onEditSession,
    showAvailability,
    therapists,
    clients,
  }: {
    selectedDate: Date;
    timeSlots: string[];
    sessions: Session[];
    onCreateSession: (timeSlot: { date: Date; time: string }) => void;
    onEditSession: (session: Session) => void;
    showAvailability: boolean;
    therapists: Therapist[];
    clients: Client[];
  }) => {
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
                sessions={sessions}
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

const Schedule = React.memo(() => {
  const { user, profile } = useAuth();
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

  const queryClient = useQueryClient();

  const handleScheduleMutationError = useCallback((error: unknown) => {
    const normalized = toError(error, "Schedule mutation failed");
    const status = typeof (error as { status?: number } | null | undefined)?.status === 'number'
      ? (error as { status?: number }).status
      : undefined;

    if (status === 409) {
      const hintCandidate = (error as { retryHint?: string } | null | undefined)?.retryHint;
      const hint = typeof hintCandidate === 'string' && hintCandidate.length > 0
        ? hintCandidate
        : 'The selected time slot was just booked. Refresh the schedule or choose a different time.';

      logger.warn('Schedule mutation conflict', {
        metadata: {
          hint,
          error: normalized.message,
        },
      });

      setRetryHint(hint);
      showError(`${normalized.message}. ${hint}`);
      return;
    }

    setRetryHint(null);
    showError(normalized);
  }, []);

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
    // Enable short-lived capture of events to localStorage to avoid StrictMode races
    try { window.__enableOpenScheduleCapture = true; } catch {
      /* noop */
    }
    const disable = setTimeout(() => {
      try { window.__enableOpenScheduleCapture = false; } catch {
        /* noop */
      }
    }, 6000);
    return () => {
      clearTimeout(disable);
      try { window.__enableOpenScheduleCapture = false; } catch {
        /* noop */
      }
    };
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

  useLayoutEffect(() => {
    const pending = localStorage.getItem("pendingSchedule");
    if (pending) {
      let detail: PendingScheduleDetail | null = null;
      try {
        detail = toPendingScheduleDetail(JSON.parse(pending));
      } catch {
        // ignore malformed data
      } finally {
        localStorage.removeItem("pendingSchedule");
      }

      if (detail) {
        // Defer modal open very slightly to avoid conflicting with initial filter queries in tests
        setTimeout(() => {
          try {
            if (detail?.start_time) {
              const date = parseISO(detail.start_time);
              setSelectedDate(date);
              setSelectedTimeSlot({ date, time: format(date, "HH:mm") });
            }
            setSelectedSession(undefined);
            setIsModalOpen(true);
          } catch {
            // ignore
          }
        }, 300);
      }
    }

    // Poll briefly after mount to catch pendingSchedule written shortly after (e.g., by gated capture)
    let openedFromPoll = false;
    const pollId = window.setInterval(() => {
      if (openedFromPoll) return;
      const next = localStorage.getItem('pendingSchedule');
      if (next) {
        localStorage.removeItem('pendingSchedule');
        openedFromPoll = true;
        setTimeout(() => {
          try {
            const parsed = toPendingScheduleDetail(JSON.parse(next));
            if (parsed?.start_time) {
              const dt = parseISO(parsed.start_time);
              setSelectedDate(dt);
              setSelectedTimeSlot({ date: dt, time: format(dt, 'HH:mm') });
            }
            setSelectedSession(undefined);
            setIsModalOpen(true);
          } catch {
            // ignore
          }
        }, 300);
      }
    }, 100);
    const stopPoll = () => window.clearInterval(pollId);
    const stopTimer = window.setTimeout(stopPoll, 6500);

    const handler = (e: Event) => {
      const detail = toPendingScheduleDetail((e as CustomEvent).detail);
      if (detail?.start_time) {
        const date = parseISO(detail.start_time);
        setSelectedDate(date);
        setSelectedTimeSlot({ date, time: format(date, "HH:mm") });
      }
      setSelectedSession(undefined);
      setIsModalOpen(true);
    };
    // Attach in both capture and bubble phases to avoid interference from other listeners
    document.addEventListener("openScheduleModal", handler as EventListener, true);
    window.addEventListener("openScheduleModal", handler as EventListener, true);
    document.addEventListener("openScheduleModal", handler as EventListener);
    window.addEventListener("openScheduleModal", handler as EventListener);
    return () => {
      stopPoll();
      window.clearTimeout(stopTimer);
      document.removeEventListener("openScheduleModal", handler as EventListener, true);
      window.removeEventListener("openScheduleModal", handler as EventListener, true);
      document.removeEventListener("openScheduleModal", handler as EventListener);
      window.removeEventListener("openScheduleModal", handler as EventListener);
    };
  }, []);

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

  // Fallback to individual queries if batched data is not available
  const { data: sessions = [], isLoading: isLoadingSessions } =
    useSessionsOptimized(
      weekStart,
      weekEnd,
      debouncedTherapist,
      debouncedClient,
    );

  // Use dropdown data hook for therapists and clients
  const { data: dropdownData, isLoading: isLoadingDropdowns } =
    useDropdownData();

  // Use batched data if available, otherwise use individual query results
  const displayData = {
    sessions: batchedData?.sessions || sessions,
    therapists: batchedData?.therapists || dropdownData?.therapists || [],
    clients: batchedData?.clients || dropdownData?.clients || [],
  };

  useEffect(() => {
    if (selectedTherapist) {
      return;
    }
    if (profile?.role !== 'therapist') {
      return;
    }

    const metadata = (user?.user_metadata ?? {}) as Record<string, unknown>;
    const candidateIds = new Set<string>();

    if (typeof profile?.id === 'string') {
      candidateIds.add(profile.id);
    }

    const metadataTherapistSnake = typeof metadata.therapist_id === 'string' ? metadata.therapist_id.trim() : null;
    if (metadataTherapistSnake) {
      candidateIds.add(metadataTherapistSnake);
    }

    const metadataTherapistCamel = typeof metadata.therapistId === 'string' ? metadata.therapistId.trim() : null;
    if (metadataTherapistCamel) {
      candidateIds.add(metadataTherapistCamel);
    }

    const preferences = profile?.preferences;
    if (preferences && typeof preferences === 'object') {
      const prefRecord = preferences as Record<string, unknown>;
      const prefTherapistSnake = typeof prefRecord.therapist_id === 'string' ? prefRecord.therapist_id.trim() : null;
      if (prefTherapistSnake) {
        candidateIds.add(prefTherapistSnake);
      }
      const prefTherapistCamel = typeof prefRecord.therapistId === 'string' ? prefRecord.therapistId.trim() : null;
      if (prefTherapistCamel) {
        candidateIds.add(prefTherapistCamel);
      }
    }

    const scopedMatch = displayData.therapists.find((therapist) => candidateIds.has(therapist.id));
    if (scopedMatch) {
      setSelectedTherapist(scopedMatch.id);
      setScopedTherapistId(scopedMatch.id);
    }
  }, [selectedTherapist, profile?.role, profile?.id, profile?.preferences, user, displayData.therapists]);

  useEffect(() => {
    if (
      selectedTherapist &&
      !displayData.therapists.some((therapist) => therapist.id === selectedTherapist)
    ) {
      setSelectedTherapist(null);
    }
  }, [selectedTherapist, displayData.therapists]);

  useEffect(() => {
    if (
      selectedClient &&
      !displayData.clients.some((client) => client.id === selectedClient)
    ) {
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
        !newSession.start_time ||
        !newSession.end_time
      ) {
        throw new Error("Missing required session details");
      }

      const { startOffsetMinutes, endOffsetMinutes, timeZone } =
        computeTimeMetadata(newSession);

      const bookingResult = await callBookSessionApi(
        {
          ...buildBookingPayload(newSession, {
            startOffsetMinutes,
            endOffsetMinutes,
            timeZone,
          }, recurrenceFormState),
          overrides: undefined,
        }
      );

      return bookingResult.session;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      queryClient.invalidateQueries({ queryKey: ["sessions-batch"] });
      setIsModalOpen(false);
      setSelectedSession(undefined);
      setSelectedTimeSlot(undefined);
      setRetryHint(null);
    },
    onError: (error) => {
      handleScheduleMutationError(error);
    },
  });

  const createMultipleSessionsMutation = useMutation({
    mutationFn: async (newSessions: Partial<Session>[]) => {
      const createdSessions: Session[] = [];

      for (const session of newSessions) {
        if (
          !session.therapist_id ||
          !session.client_id ||
          !session.start_time ||
          !session.end_time
        ) {
          throw new Error("Missing required session details");
        }

        const { startOffsetMinutes, endOffsetMinutes, timeZone } =
          computeTimeMetadata(session);

        const bookingResult = await callBookSessionApi(
          {
            ...buildBookingPayload(session, {
              startOffsetMinutes,
              endOffsetMinutes,
              timeZone,
            }),
            overrides: undefined,
          }
        );

        createdSessions.push(bookingResult.session);
      }

      return createdSessions;
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

      const bookingResult = await callBookSessionApi(
        {
          ...buildBookingPayload(
            { ...mergedSession, id: selectedSession.id },
            {
              startOffsetMinutes,
              endOffsetMinutes,
              timeZone,
            },
            recurrenceFormState,
          ),
          overrides: undefined,
        }
      );

      return bookingResult.session;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      queryClient.invalidateQueries({ queryKey: ["sessions-batch"] });
      setIsModalOpen(false);
      setSelectedSession(undefined);
      setRetryHint(null);
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
      setRetryHint(null);
      setSelectedTimeSlot(timeSlot);
      setSelectedSession(undefined);
      setIsModalOpen(true);
    },
    [],
  );

  const handleEditSession = useCallback((session: Session) => {
    setRetryHint(null);
    setSelectedSession(session);
    setSelectedTimeSlot(undefined);
    setIsModalOpen(true);
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
    setIsModalOpen(false);
    setRetryHint(null);
  }, []);

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
      if (selectedSession) {
        if (data.status === "cancelled") {
          const cancellationReason =
            typeof data.notes === "string" && data.notes.trim().length > 0
              ? data.notes
              : undefined;

          const result = await cancelSessionMutation.mutateAsync({
            sessionId: selectedSession.id,
            reason: cancellationReason,
          });

          showSuccess(
            result.cancelledCount > 0
              ? "Session cancelled successfully"
              : "Session was already cancelled",
          );

          setIsModalOpen(false);
          setSelectedSession(undefined);
          return;
        }

        await updateSessionMutation.mutateAsync(data);
      } else {
        await createSessionMutation.mutateAsync(data);
      }
    },
    [
      selectedSession,
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

  // Memoized date range display
  const dateRangeDisplay = useMemo(() => {
    if (view === "day") {
      return format(selectedDate, "MMMM d, yyyy");
    }
    return `${format(weekStart, "MMM d")} - ${format(addDays(weekStart, 5), "MMM d, yyyy")}`;
  }, [weekStart, selectedDate, view]);

  const isLoading = isLoadingBatch || isLoadingSessions || isLoadingDropdowns;

  if (isLoading) {
    const fallbackDisplay = {
      sessions: batchedData?.sessions || sessions,
      therapists: batchedData?.therapists || dropdownData?.therapists || [],
      clients: batchedData?.clients || dropdownData?.clients || [],
    };
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
            therapists={fallbackDisplay.therapists}
            clients={fallbackDisplay.clients}
            existingSessions={fallbackDisplay.sessions}
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
                      <input
                        type="datetime-local"
                        value={value}
                        onChange={(event) => handleRecurrenceExceptionChange(index, event.target.value)}
                        className="flex-1 rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:text-gray-200"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveRecurrenceException(index)}
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
          sessions={displayData.sessions.filter((session) => {
            const localDate = format(parseISO(session.start_time), "yyyy-MM-dd");
            const rawDate = typeof session.start_time === "string" && session.start_time.length >= 10
              ? session.start_time.slice(0, 10)
              : undefined;
            const selectedStr = format(selectedDate, "yyyy-MM-dd");
            return localDate === selectedStr || rawDate === selectedStr;
          })}
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
          sessions={displayData.sessions}
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

export default Schedule;
