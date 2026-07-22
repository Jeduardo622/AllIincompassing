/* eslint-disable jsx-a11y/no-static-element-interactions */
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { addMinutes, differenceInMinutes, format, parseISO } from 'date-fns';
import { Clock, Edit2, Plus } from 'lucide-react';
import type { Session } from '../types';
import { buildScheduleDayLayout, type ScheduleLayoutItem } from './schedule-layout';
import { createSessionSlotKey } from './schedule-utils';
import { getSessionStatusClasses, isScheduleSessionDragEligible } from './ScheduleSessionStatusStyles';

export type ScheduleTimeSlotHandler = (timeSlot: { date: Date; time: string }) => void;
export type ScheduleEditSessionHandler = (session: Session) => void;
export type ScheduleSlotPosition = { date: Date; time: string };
export type ScheduleDropPayload = { target: ScheduleSlotPosition; draggedSessionId?: string | null };

const SLOT_DURATION_MINUTES = 15;
const SLOT_HEIGHT_PX = 40;
const OVERLAY_HORIZONTAL_INSET_PX = 4;
const OVERLAY_VERTICAL_INSET_PX = 2;
const NEUTRAL_CARD_CLASSES =
  'bg-slate-100 text-slate-800 hover:bg-slate-200 dark:bg-slate-800/80 dark:text-slate-100 dark:hover:bg-slate-700/80';

function parseSlotInstant(day: Date, time: string): Date | null {
  const [hoursRaw, minutesRaw] = time.split(':');
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    return null;
  }

  const slotStart = new Date(day);
  slotStart.setHours(hours, minutes, 0, 0);
  return Number.isNaN(slotStart.getTime()) ? null : slotStart;
}

function getSessionPreviewLabel(session: Session): string {
  const start = parseISO(session.start_time);
  const end = parseISO(session.end_time);
  const clientName = session.client?.full_name?.trim() || 'Appointment';

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return `${clientName}: time unavailable`;
  }

  const durationMinutes = differenceInMinutes(end, start);
  const durationLabel = durationMinutes > 0 ? ` (${durationMinutes} min)` : '';
  return `${clientName}: ${format(start, 'h:mm a')} - ${format(end, 'h:mm a')}${durationLabel}`;
}

function doesSessionOverlapSlot(session: Session, day: Date, time: string): boolean {
  const start = parseISO(session.start_time);
  const end = parseISO(session.end_time);
  const slotStart = parseSlotInstant(day, time);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || !slotStart || end <= start) {
    return false;
  }

  const slotEnd = addMinutes(slotStart, SLOT_DURATION_MINUTES);
  return start < slotEnd && end > slotStart;
}

function getSessionDisplayName(session: Session): string {
  return session.client?.full_name?.trim() || 'Appointment';
}

function getTherapistDisplayName(session: Session): string {
  return session.therapist?.full_name?.trim() || 'Unassigned';
}

function getSafeSessionRange(session: Session): { label: string; start: Date | null; end: Date | null } {
  const start = parseISO(session.start_time);
  const end = parseISO(session.end_time);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return { label: 'Time unavailable', start: null, end: null };
  }

  return {
    label: `${format(start, 'h:mm a')} - ${format(end, 'h:mm a')}`,
    start,
    end,
  };
}

function getClusterLabel(sessions: readonly Session[]): string {
  const validTimes = sessions
    .map((session) => {
      const range = getSafeSessionRange(session);
      return range.start && range.end ? range : null;
    })
    .filter((range): range is { label: string; start: Date; end: Date } => range !== null);

  if (validTimes.length === 0) {
    return `${sessions.length} appointments, time unavailable`;
  }

  const earliest = validTimes.reduce((current, next) => (next.start < current ? next.start : current), validTimes[0].start);
  const latest = validTimes.reduce((current, next) => (next.end > current ? next.end : current), validTimes[0].end);
  return `${sessions.length} appointments, ${format(earliest, 'h:mm a')} to ${format(latest, 'h:mm a')}`;
}

function getSessionSourcePosition(session: Session): ScheduleSlotPosition | null {
  const start = parseISO(session.start_time);
  if (Number.isNaN(start.getTime())) {
    return null;
  }

  return {
    date: start,
    time: format(start, 'HH:mm'),
  };
}

/**
 * True when a precise pointing device (mouse, trackpad, stylus) is available.
 * Use HTML5 drag/drop in that case — even on hybrid touch laptops where `(pointer: coarse)` can still match.
 * Long-press + tap is used only when there is no fine pointer (typical phones / finger-only tablets).
 */
function useHasFinePointer(): boolean {
  const getSnapshot = () =>
    typeof window !== 'undefined' ? window.matchMedia('(any-pointer: fine)').matches : false;

  return useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window === 'undefined') {
        return () => {};
      }
      const mq = window.matchMedia('(any-pointer: fine)');
      mq.addEventListener('change', onStoreChange);
      return () => mq.removeEventListener('change', onStoreChange);
    },
    getSnapshot,
    getSnapshot,
  );
}

export const TimeSlot = React.memo(
  ({
    time,
    day,
    slotSessions,
    onCreateSession,
    onEditSession,
    allowCreateInEmptySlot = true,
    allowDragAndDrop = false,
    activeDragSessionId = null,
    activeDropSlotKey = null,
    onStartSessionDrag,
    onSessionDrop,
    onHoverSlotDuringDrag,
    onEndSessionDrag,
    previewSession,
    previewSessionId = null,
    onHoverPreviewSessionChange,
    onFocusPreviewSessionChange,
  }: {
    time: string;
    day: Date;
    slotSessions: Session[];
    onCreateSession: ScheduleTimeSlotHandler;
    onEditSession: ScheduleEditSessionHandler;
    allowCreateInEmptySlot?: boolean;
    allowDragAndDrop?: boolean;
    activeDragSessionId?: string | null;
    activeDropSlotKey?: string | null;
    onStartSessionDrag?: (session: Session, source: ScheduleSlotPosition) => void;
    onSessionDrop?: (payload: ScheduleDropPayload) => void;
    onHoverSlotDuringDrag?: (targetSlotKey: string | null) => void;
    onEndSessionDrag?: () => void;
    previewSession?: Session | null;
    previewSessionId?: string | null;
    onHoverPreviewSessionChange?: (session: Session | null) => void;
    onFocusPreviewSessionChange?: (session: Session | null) => void;
  }) => {
    const hasFinePointer = useHasFinePointer();
    const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const longPressOriginRef = useRef<{ x: number; y: number } | null>(null);
    const suppressSessionClickRef = useRef(false);

    const dayKey = useMemo(() => format(day, 'yyyy-MM-dd'), [day]);
    const slotKey = useMemo(() => createSessionSlotKey(dayKey, time), [dayKey, time]);
    const handleTimeSlotClick = useCallback(() => {
      onCreateSession({ date: day, time });
    }, [day, time, onCreateSession]);

    const handleSessionClick = useCallback(
      (event: React.MouseEvent, session: Session) => {
        event.stopPropagation();
        onEditSession(session);
      },
      [onEditSession],
    );

    const clearLongPressTimer = useCallback(() => {
      if (longPressTimerRef.current !== null) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      longPressOriginRef.current = null;
    }, []);

    useEffect(() => clearLongPressTimer, [clearLongPressTimer]);

    const enableSlotCreateChrome = allowCreateInEmptySlot;

    const handleSlotClick = useCallback(() => {
      if (!hasFinePointer && allowDragAndDrop && (!enableSlotCreateChrome || activeDragSessionId !== null)) {
        onSessionDrop?.({ target: { date: day, time }, draggedSessionId: activeDragSessionId });
        return;
      }
      if (enableSlotCreateChrome) {
        handleTimeSlotClick();
      }
    }, [
      hasFinePointer,
      allowDragAndDrop,
      activeDragSessionId,
      onSessionDrop,
      day,
      time,
      enableSlotCreateChrome,
      handleTimeSlotClick,
    ]);
    const handleSlotKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return;
        }
        event.preventDefault();
        if (allowDragAndDrop && activeDragSessionId !== null) {
          onSessionDrop?.({ target: { date: day, time } });
          return;
        }
        if (enableSlotCreateChrome) {
          handleTimeSlotClick();
          return;
        }
        if (allowDragAndDrop) {
          onSessionDrop?.({ target: { date: day, time } });
        }
      },
      [activeDragSessionId, allowDragAndDrop, day, enableSlotCreateChrome, handleTimeSlotClick, onSessionDrop, time],
    );

    const slotHasDropTarget = allowDragAndDrop && activeDropSlotKey === slotKey && activeDragSessionId !== null;
    const slotHasPreviewHighlight = previewSession ? doesSessionOverlapSlot(previewSession, day, time) : false;

    useEffect(() => {
      if (activeDragSessionId === null) {
        suppressSessionClickRef.current = false;
      }
    }, [activeDragSessionId]);

    return (
      <div
        className={`h-10 border-b border-r p-2 relative group dark:border-gray-700 transition-colors ${
          enableSlotCreateChrome
            ? "cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
            : "cursor-default"
        } ${slotHasDropTarget ? "bg-blue-50 dark:bg-blue-950/40" : ""}`}
        data-slot-key={slotKey}
        data-drop-target={slotHasDropTarget ? "true" : "false"}
        role={enableSlotCreateChrome || allowDragAndDrop ? "button" : undefined}
        tabIndex={enableSlotCreateChrome || allowDragAndDrop ? 0 : undefined}
        aria-label={
          enableSlotCreateChrome
            ? "Add session"
            : allowDragAndDrop
              ? "Drop appointment here"
            : slotSessions.length === 0
              ? "Empty time slot"
              : undefined
        }
        title={enableSlotCreateChrome ? "Add session" : undefined}
        onDragEnter={
          allowDragAndDrop
            ? () => {
                onHoverSlotDuringDrag?.(slotKey);
              }
            : undefined
        }
        onDragOver={
          allowDragAndDrop
            ? (event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                onHoverSlotDuringDrag?.(slotKey);
              }
            : undefined
        }
        onDrop={
          allowDragAndDrop
            ? (event) => {
                event.preventDefault();
                const draggedSessionId = event.dataTransfer.getData("text/plain").trim();
                onSessionDrop?.({
                  target: { date: day, time },
                  draggedSessionId: draggedSessionId.length > 0 ? draggedSessionId : null,
                });
              }
            : undefined
        }
        {...(enableSlotCreateChrome || allowDragAndDrop
          ? {
              ...(enableSlotCreateChrome || (!hasFinePointer && allowDragAndDrop)
                ? { onClick: handleSlotClick }
                : {}),
              onKeyDown: handleSlotKeyDown,
            }
          : {})}
      >
        {slotHasPreviewHighlight ? (
          <span
            aria-hidden="true"
            data-preview-slot={previewSession?.id ?? 'unknown'}
            className="pointer-events-none absolute inset-0 rounded-sm bg-blue-100/80 ring-1 ring-inset ring-blue-300 dark:bg-blue-950/40 dark:ring-blue-700"
          />
        ) : null}

        {enableSlotCreateChrome ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1 right-1 z-10 opacity-0 group-hover:opacity-100 p-1 rounded-full text-gray-500 transition-opacity dark:text-gray-400"
          >
            <Plus className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          </span>
        ) : null}

        {slotSessions.map((session) => {
          const dragEligibleSession = isScheduleSessionDragEligible(session.status);
          const statusStyles = getSessionStatusClasses(session.status);
          const touchMovePickup =
            !hasFinePointer && allowDragAndDrop && dragEligibleSession;
          const canDragWithFinePointer =
            allowDragAndDrop && hasFinePointer && dragEligibleSession;
          const previewLabel = getSessionPreviewLabel(session);
          const previewNoticeId = `schedule-session-preview-${session.id}`;
          const isPreviewActive = previewSessionId === session.id;

          const onSessionPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
            if (!touchMovePickup) {
              return;
            }
            if (event.pointerType === "mouse" && typeof event.button === "number" && event.button !== 0) {
              return;
            }
            clearLongPressTimer();
            longPressOriginRef.current = { x: Number(event.clientX), y: Number(event.clientY) };
            longPressTimerRef.current = setTimeout(() => {
              longPressTimerRef.current = null;
              longPressOriginRef.current = null;
              suppressSessionClickRef.current = true;
              onStartSessionDrag?.(session, { date: day, time });
              if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
                try {
                  navigator.vibrate(12);
                } catch {
                  /* ignore */
                }
              }
            }, 480);
          };

          const onSessionPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
            if (longPressTimerRef.current === null || !longPressOriginRef.current) {
              return;
            }
            const currentX = Number(event.clientX);
            const currentY = Number(event.clientY);
            if (
              !Number.isFinite(longPressOriginRef.current.x) ||
              !Number.isFinite(longPressOriginRef.current.y) ||
              !Number.isFinite(currentX) ||
              !Number.isFinite(currentY)
            ) {
              clearLongPressTimer();
              return;
            }
            const dx = currentX - longPressOriginRef.current.x;
            const dy = currentY - longPressOriginRef.current.y;
            if (dx * dx + dy * dy > 100) {
              clearLongPressTimer();
            }
          };

          const endLongPressTracking = (cancelActiveDrag = false) => {
            clearLongPressTimer();
            if (cancelActiveDrag && activeDragSessionId === session.id) {
              suppressSessionClickRef.current = false;
              onEndSessionDrag?.();
            }
          };

          return (
            <div
              key={session.id}
              data-session-status={session.status}
              data-session-id={session.id}
              draggable={canDragWithFinePointer}
              aria-grabbed={allowDragAndDrop && activeDragSessionId === session.id}
              aria-describedby={isPreviewActive ? previewNoticeId : undefined}
              title={
                touchMovePickup
                  ? "Press and hold to move, then tap a time slot. Tap again to cancel."
                  : undefined
              }
              onDragStart={
                canDragWithFinePointer
                  ? (event) => {
                      event.stopPropagation();
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", session.id);
                      onStartSessionDrag?.(session, { date: day, time });
                    }
                  : undefined
              }
              onDragEnd={
                canDragWithFinePointer
                  ? () => {
                      onEndSessionDrag?.();
                    }
                  : undefined
              }
              className={`${statusStyles.card} touch-manipulation rounded p-1 text-xs mb-1 group/session relative z-10 transition-colors ${
                allowDragAndDrop && dragEligibleSession
                  ? hasFinePointer
                    ? "cursor-grab active:cursor-grabbing"
                    : "cursor-pointer"
                  : "cursor-pointer"
              } ${activeDragSessionId === session.id ? "opacity-50 ring-2 ring-blue-400 ring-offset-1 dark:ring-offset-gray-900" : ""} ${isPreviewActive ? "ring-2 ring-blue-500 ring-offset-1 dark:ring-blue-400 dark:ring-offset-gray-900" : ""}`}
              role="button"
              tabIndex={0}
              data-preview-active={isPreviewActive ? "true" : "false"}
              onPointerDown={touchMovePickup ? onSessionPointerDown : undefined}
              onPointerMove={touchMovePickup ? onSessionPointerMove : undefined}
              onPointerUp={touchMovePickup ? () => endLongPressTracking() : undefined}
              onPointerCancel={touchMovePickup ? () => endLongPressTracking(true) : undefined}
              onPointerLeave={touchMovePickup ? () => endLongPressTracking() : undefined}
              onMouseEnter={() => onHoverPreviewSessionChange?.(session)}
              onMouseLeave={() => onHoverPreviewSessionChange?.(null)}
              onFocus={() => onFocusPreviewSessionChange?.(session)}
              onBlur={() => onFocusPreviewSessionChange?.(null)}
              onClick={(event) => {
                if (suppressSessionClickRef.current) {
                  event.preventDefault();
                  event.stopPropagation();
                  suppressSessionClickRef.current = false;
                  return;
                }
                if (allowDragAndDrop && activeDragSessionId === session.id) {
                  event.preventDefault();
                  event.stopPropagation();
                  onEndSessionDrag?.();
                  return;
                }
                handleSessionClick(event, session);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onEditSession(session);
                }
              }}
            >
              <div className="font-medium truncate">{session.client?.full_name}</div>
              <div className={`${statusStyles.secondary} truncate`}>{session.therapist?.full_name}</div>
              <div className={`flex items-center ${statusStyles.time}`}>
                <Clock className="w-3 h-3 mr-1" />
                {format(parseISO(session.start_time), 'h:mm a')}
              </div>

              {isPreviewActive ? (
                <div
                  id={previewNoticeId}
                  role="note"
                  className="pointer-events-none absolute left-1/2 top-0 z-20 w-max max-w-[14rem] -translate-x-1/2 -translate-y-[calc(100%+0.35rem)] rounded-md bg-gray-900 px-2 py-1 text-[11px] font-medium leading-tight text-white shadow-lg dark:bg-gray-100 dark:text-gray-900"
                >
                  {previewLabel}
                </div>
              ) : null}

              <span
                aria-hidden="true"
                className="pointer-events-none absolute top-1 right-1 opacity-0 group-hover/session:opacity-100"
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

TimeSlot.displayName = 'TimeSlot';

function OverlaySessionCard({
  session,
  onEditSession,
  allowDragAndDrop = false,
  activeDragSessionId = null,
  onStartSessionDrag,
  onEndSessionDrag,
  className = '',
  showStatus = false,
  buttonRef,
}: {
  session: Session;
  onEditSession: ScheduleEditSessionHandler;
  allowDragAndDrop?: boolean;
  activeDragSessionId?: string | null;
  onStartSessionDrag?: (session: Session, source: ScheduleSlotPosition) => void;
  onEndSessionDrag?: () => void;
  className?: string;
  showStatus?: boolean;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  const hasFinePointer = useHasFinePointer();
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressOriginRef = useRef<{ x: number; y: number } | null>(null);
  const suppressSessionClickRef = useRef(false);
  const sourcePosition = useMemo(() => getSessionSourcePosition(session), [session]);
  const statusStyles = getSessionStatusClasses(session.status);
  const dragEligibleSession = isScheduleSessionDragEligible(session.status);
  const touchMovePickup = !hasFinePointer && allowDragAndDrop && dragEligibleSession && sourcePosition !== null;
  const canDragWithFinePointer = allowDragAndDrop && hasFinePointer && dragEligibleSession && sourcePosition !== null;
  const range = getSafeSessionRange(session);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressOriginRef.current = null;
  }, []);

  useEffect(() => clearLongPressTimer, [clearLongPressTimer]);

  useEffect(() => {
    if (activeDragSessionId === null) {
      suppressSessionClickRef.current = false;
    }
  }, [activeDragSessionId]);

  const startDrag = useCallback(() => {
    if (!sourcePosition) {
      return;
    }
    onStartSessionDrag?.(session, sourcePosition);
  }, [onStartSessionDrag, session, sourcePosition]);

  return (
    <button
      ref={buttonRef}
      type="button"
      data-session-status={session.status}
      data-session-id={session.id}
      draggable={canDragWithFinePointer}
      aria-grabbed={allowDragAndDrop && activeDragSessionId === session.id}
      title={touchMovePickup ? 'Press and hold to move, then tap a time slot. Tap again to cancel.' : undefined}
      onDragStart={
        canDragWithFinePointer
          ? (event) => {
              event.stopPropagation();
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', session.id);
              startDrag();
            }
          : undefined
      }
      onDragEnd={canDragWithFinePointer ? () => onEndSessionDrag?.() : undefined}
      onPointerDown={
        touchMovePickup
          ? (event) => {
              if (event.pointerType === 'mouse' && typeof event.button === 'number' && event.button !== 0) {
                return;
              }
              clearLongPressTimer();
              longPressOriginRef.current = { x: Number(event.clientX), y: Number(event.clientY) };
              longPressTimerRef.current = setTimeout(() => {
                longPressTimerRef.current = null;
                longPressOriginRef.current = null;
                suppressSessionClickRef.current = true;
                startDrag();
              }, 480);
            }
          : undefined
      }
      onPointerMove={
        touchMovePickup
          ? (event) => {
              if (longPressTimerRef.current === null || !longPressOriginRef.current) {
                return;
              }
              const currentX = Number(event.clientX);
              const currentY = Number(event.clientY);
              const dx = currentX - longPressOriginRef.current.x;
              const dy = currentY - longPressOriginRef.current.y;
              if (dx * dx + dy * dy > 100) {
                clearLongPressTimer();
              }
            }
          : undefined
      }
      onPointerUp={touchMovePickup ? () => clearLongPressTimer() : undefined}
      onPointerLeave={touchMovePickup ? () => clearLongPressTimer() : undefined}
      onPointerCancel={
        touchMovePickup
          ? () => {
              clearLongPressTimer();
              if (activeDragSessionId === session.id) {
                suppressSessionClickRef.current = false;
                onEndSessionDrag?.();
              }
            }
          : undefined
      }
      onClick={(event) => {
        if (suppressSessionClickRef.current) {
          event.preventDefault();
          event.stopPropagation();
          suppressSessionClickRef.current = false;
          return;
        }
        if (allowDragAndDrop && activeDragSessionId === session.id) {
          event.preventDefault();
          event.stopPropagation();
          onEndSessionDrag?.();
          return;
        }
        onEditSession(session);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onEditSession(session);
        }
      }}
      className={`${statusStyles.card} ${className} group/session relative z-10 w-full rounded px-2 py-1 text-left text-xs transition-colors ${
        allowDragAndDrop && dragEligibleSession
          ? hasFinePointer
            ? 'cursor-grab active:cursor-grabbing'
            : 'cursor-pointer'
          : 'cursor-pointer'
      } ${activeDragSessionId === session.id ? 'opacity-50 ring-2 ring-blue-400 ring-offset-1 dark:ring-offset-gray-900' : ''}`}
    >
      <div className="truncate font-medium">{getSessionDisplayName(session)}</div>
      <div className={`${statusStyles.secondary} truncate`}>{getTherapistDisplayName(session)}</div>
      <div className={`flex items-center ${statusStyles.time}`}>
        <Clock className="mr-1 h-3 w-3" />
        {range.label}
      </div>
      {showStatus ? <div className="mt-0.5 text-[11px] uppercase tracking-wide">{String(session.status).trim().toLowerCase()}</div> : null}
      <span aria-hidden="true" className="pointer-events-none absolute right-1 top-1 opacity-0 group-hover/session:opacity-100">
        <Edit2 className="h-3 w-3" />
      </span>
    </button>
  );
}

function InvalidSessionFallback({ session, top }: { session: Session; top: number }) {
  return (
    <div
      className={`absolute left-1 right-1 rounded px-2 py-1 text-xs shadow-sm ${NEUTRAL_CARD_CLASSES}`}
      style={{ top }}
    >
      <div className="truncate font-medium">{getSessionDisplayName(session)}</div>
      <div className="truncate text-slate-600 dark:text-slate-300">{getTherapistDisplayName(session)}</div>
      <div className="flex items-center text-slate-700 dark:text-slate-200">
        <Clock className="mr-1 h-3 w-3" />
        Time unavailable
      </div>
    </div>
  );
}

function ScheduleOverlayItem({
  item,
  onEditSession,
  allowDragAndDrop = false,
  activeDragSessionId = null,
  onStartSessionDrag,
  onEndSessionDrag,
}: {
  item: ScheduleLayoutItem;
  onEditSession: ScheduleEditSessionHandler;
  allowDragAndDrop?: boolean;
  activeDragSessionId?: string | null;
  onStartSessionDrag?: (session: Session, source: ScheduleSlotPosition) => void;
  onEndSessionDrag?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const firstRowRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (dialogRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    firstRowRef.current?.focus();
  }, [open]);

  const style = {
    top: item.topRows * SLOT_HEIGHT_PX + OVERLAY_VERTICAL_INSET_PX,
    height: item.spanRows * SLOT_HEIGHT_PX - OVERLAY_VERTICAL_INSET_PX * 2,
    left: OVERLAY_HORIZONTAL_INSET_PX,
    right: OVERLAY_HORIZONTAL_INSET_PX,
  };

  if (item.kind === 'appointment') {
    return (
      <div
        className="pointer-events-auto absolute"
        data-layout-kind="appointment"
        data-clipped-start={item.clippedStart ? 'true' : 'false'}
        data-clipped-end={item.clippedEnd ? 'true' : 'false'}
        style={style}
      >
        <OverlaySessionCard
          session={item.session}
          onEditSession={onEditSession}
          allowDragAndDrop={allowDragAndDrop}
          activeDragSessionId={activeDragSessionId}
          onStartSessionDrag={onStartSessionDrag}
          onEndSessionDrag={onEndSessionDrag}
          className="h-full shadow-sm"
        />
      </div>
    );
  }

  const clusterLabel = getClusterLabel(item.sessions);

  return (
    <div className="pointer-events-auto absolute z-20" data-layout-kind="cluster" style={style}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `schedule-cluster-${item.sessions.map((session) => session.id).join('-')}` : undefined}
        onClick={() => setOpen((current) => !current)}
        className={`h-full w-full rounded px-2 py-1 text-left text-xs shadow-sm ${NEUTRAL_CARD_CLASSES}`}
      >
        <div className="font-medium">{item.sessions.length} appointments</div>
        <div className="truncate text-[11px]">{clusterLabel.replace(/^\d+ appointments, /i, '')}</div>
      </button>

      {open ? (
        <div
          id={`schedule-cluster-${item.sessions.map((session) => session.id).join('-')}`}
          ref={dialogRef}
          role="dialog"
          aria-label={`${item.sessions.length} overlapping appointments`}
          tabIndex={-1}
          className="absolute left-0 top-0 z-30 min-w-[16rem] max-w-[20rem] rounded-lg border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-300">{clusterLabel}</div>
          <div className="space-y-2">
            {item.sessions.map((session, index) => (
              <OverlaySessionCard
                key={session.id}
                session={session}
                onEditSession={onEditSession}
                allowDragAndDrop={allowDragAndDrop}
                activeDragSessionId={activeDragSessionId}
                onStartSessionDrag={onStartSessionDrag}
                onEndSessionDrag={onEndSessionDrag}
                className="shadow-none"
                showStatus
                buttonRef={index === 0 ? firstRowRef : undefined}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ScheduleOverlayColumn({
  day,
  scheduleSessions,
  onEditSession,
  allowDragAndDrop = false,
  activeDragSessionId = null,
  onStartSessionDrag,
  onEndSessionDrag,
  showInvalidSessions = true,
}: {
  day: Date;
  scheduleSessions: readonly Session[];
  onEditSession: ScheduleEditSessionHandler;
  allowDragAndDrop?: boolean;
  activeDragSessionId?: string | null;
  onStartSessionDrag?: (session: Session, source: ScheduleSlotPosition) => void;
  onEndSessionDrag?: () => void;
  showInvalidSessions?: boolean;
}) {
  const { items, invalidSessions } = useMemo(
    () => buildScheduleDayLayout(scheduleSessions, day),
    [day, scheduleSessions],
  );

  return (
    <div className="pointer-events-none absolute inset-0">
      {items.map((item) => (
        <ScheduleOverlayItem
          key={item.kind === 'appointment' ? item.session.id : item.sessions.map((session) => session.id).join('|')}
          item={item}
          onEditSession={onEditSession}
          allowDragAndDrop={allowDragAndDrop}
          activeDragSessionId={activeDragSessionId}
          onStartSessionDrag={onStartSessionDrag}
          onEndSessionDrag={onEndSessionDrag}
        />
      ))}

      {showInvalidSessions
        ? invalidSessions.map((session, index) => (
            <InvalidSessionFallback key={`invalid-${session.id}`} session={session} top={4 + index * 52} />
          ))
        : null}
    </div>
  );
}

export const DayColumn = React.memo(
  ({
    day,
    timeSlots,
    sessionSlotIndex,
    onCreateSession,
    onEditSession,
    allowCreateInEmptySlot = true,
    allowDragAndDrop = false,
    activeDragSessionId = null,
    activeDropSlotKey = null,
    onStartSessionDrag,
    onSessionDrop,
    onHoverSlotDuringDrag,
    onEndSessionDrag,
    previewSession,
    previewSessionId = null,
    onHoverPreviewSessionChange,
    onFocusPreviewSessionChange,
    useImprovedAppointmentLayout = false,
    scheduleSessions = [],
    showInvalidSessions = true,
  }: {
    day: Date;
    timeSlots: string[];
    sessionSlotIndex: Map<string, Session[]>;
    onCreateSession: ScheduleTimeSlotHandler;
    onEditSession: ScheduleEditSessionHandler;
    allowCreateInEmptySlot?: boolean;
    allowDragAndDrop?: boolean;
    activeDragSessionId?: string | null;
    activeDropSlotKey?: string | null;
    onStartSessionDrag?: (session: Session, source: ScheduleSlotPosition) => void;
    onSessionDrop?: (payload: ScheduleDropPayload) => void;
    onHoverSlotDuringDrag?: (targetSlotKey: string | null) => void;
    onEndSessionDrag?: () => void;
    previewSession?: Session | null;
    previewSessionId?: string | null;
    onHoverPreviewSessionChange?: (session: Session | null) => void;
    onFocusPreviewSessionChange?: (session: Session | null) => void;
    useImprovedAppointmentLayout?: boolean;
    scheduleSessions?: readonly Session[];
    showInvalidSessions?: boolean;
  }) => {
    const dayKey = useMemo(() => format(day, 'yyyy-MM-dd'), [day]);

    return (
      <div className="relative">
        {timeSlots.map((time) => (
          <TimeSlot
            key={time}
            time={time}
            day={day}
            slotSessions={useImprovedAppointmentLayout ? [] : (sessionSlotIndex.get(createSessionSlotKey(dayKey, time)) ?? [])}
            onCreateSession={onCreateSession}
            onEditSession={onEditSession}
            allowCreateInEmptySlot={allowCreateInEmptySlot}
            allowDragAndDrop={allowDragAndDrop}
            activeDragSessionId={activeDragSessionId}
            activeDropSlotKey={activeDropSlotKey}
            onStartSessionDrag={onStartSessionDrag}
            onSessionDrop={onSessionDrop}
            onHoverSlotDuringDrag={onHoverSlotDuringDrag}
            onEndSessionDrag={onEndSessionDrag}
            previewSession={previewSession}
            previewSessionId={previewSessionId}
            onHoverPreviewSessionChange={onHoverPreviewSessionChange}
            onFocusPreviewSessionChange={onFocusPreviewSessionChange}
          />
        ))}
        {useImprovedAppointmentLayout ? (
          <ScheduleOverlayColumn
            day={day}
            scheduleSessions={scheduleSessions}
            onEditSession={onEditSession}
            allowDragAndDrop={allowDragAndDrop}
            activeDragSessionId={activeDragSessionId}
            onStartSessionDrag={onStartSessionDrag}
            onEndSessionDrag={onEndSessionDrag}
            showInvalidSessions={showInvalidSessions}
          />
        ) : null}
      </div>
    );
  },
);

DayColumn.displayName = 'DayColumn';
