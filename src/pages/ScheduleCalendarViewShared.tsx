/* eslint-disable jsx-a11y/no-static-element-interactions */
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { addMinutes, differenceInMinutes, format, parseISO } from 'date-fns';
import { Clock, Edit2, Plus } from 'lucide-react';
import type { Session } from '../types';
import { buildScheduleDayLayout, type ScheduleLayoutItem } from './schedule-layout';
import { createSessionSlotKey } from './schedule-utils';
import {
  getOverlaySessionStatusClasses,
  getSessionStatusClasses,
  isScheduleSessionDragEligible,
  normalizeScheduleSessionStatus,
} from './ScheduleSessionStatusStyles';

export type ScheduleTimeSlotHandler = (timeSlot: { date: Date; time: string }) => void;
export type ScheduleEditSessionHandler = (session: Session) => void;
export type ScheduleSlotPosition = { date: Date; time: string };
export type ScheduleDropPayload = { target: ScheduleSlotPosition; draggedSessionId?: string | null };

const SLOT_DURATION_MINUTES = 15;
const SLOT_HEIGHT_PX = 40;
const OVERLAY_HORIZONTAL_INSET_PX = 4;
const OVERLAY_VERTICAL_INSET_PX = 2;
const MIN_OVERLAY_HEIGHT_PX = 20;
const CLUSTER_DIALOG_VIEWPORT_MARGIN_PX = 8;
const VISIBLE_GRID_START_HOUR = 8;
const VISIBLE_GRID_END_HOUR = 18;
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

function getClusterLabel(
  sessions: readonly Session[],
  clipping: { clippedStart: boolean; clippedEnd: boolean },
): string {
  const validTimes = sessions
    .map((session) => {
      const range = getSafeSessionRange(session);
      return range.start && range.end ? range : null;
    })
    .filter((range): range is { label: string; start: Date; end: Date } => range !== null);

  if (validTimes.length === 0) {
    return `${sessions.length} appointments, time unavailable`;
  }

  const earliest = new Date(
    validTimes.reduce((current, next) => (next.start < current ? next.start : current), validTimes[0].start),
  );
  const latest = new Date(
    validTimes.reduce((current, next) => (next.end > current ? next.end : current), validTimes[0].end),
  );
  if (clipping.clippedStart) {
    earliest.setHours(VISIBLE_GRID_START_HOUR, 0, 0, 0);
  }
  if (clipping.clippedEnd) {
    latest.setHours(VISIBLE_GRID_END_HOUR, 0, 0, 0);
  }
  return `${sessions.length} appointments, ${format(earliest, 'h:mm a')} to ${format(latest, 'h:mm a')}`;
}

function getClusterRangeLabel(
  sessions: readonly Session[],
  clipping: { clippedStart: boolean; clippedEnd: boolean },
): string {
  return getClusterLabel(sessions, clipping).replace(/^\d+ appointments, /i, '');
}

function getDisplayStatusLabel(status: Session['status'] | string | null | undefined): string {
  const normalized = normalizeScheduleSessionStatus(status);
  switch (normalized) {
    case 'in_progress':
      return 'in progress';
    case 'no-show':
      return 'no show';
    default:
      return normalized.replace(/_/g, ' ');
  }
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

function getOverlayCardHeight(spanRows: number): number {
  const unclampedHeight = spanRows * SLOT_HEIGHT_PX - OVERLAY_VERTICAL_INSET_PX * 2;
  if (unclampedHeight <= 0) {
    return unclampedHeight;
  }

  return Math.max(unclampedHeight, MIN_OVERLAY_HEIGHT_PX);
}

function getOverlayCreatePosition(day: Date, topRows: number): ScheduleSlotPosition {
  const slotStart = new Date(day);
  slotStart.setHours(VISIBLE_GRID_START_HOUR, 0, 0, 0);
  const createStart = addMinutes(slotStart, topRows * SLOT_DURATION_MINUTES);
  return {
    date: createStart,
    time: format(createStart, 'HH:mm'),
  };
}

function getCreateSessionLabel(position: ScheduleSlotPosition): string {
  return `Add session within occupied block on ${format(position.date, 'EEEE, MMMM d, yyyy')} at ${format(
    position.date,
    'h:mm a',
  )}`;
}

function getClusterDialogPosition(triggerRect: DOMRect, dialogRect: DOMRect) {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const dialogWidth = dialogRect.width || 320;
  const dialogHeight = dialogRect.height || 240;

  const preferredLeft = triggerRect.left;
  const maxLeft = Math.max(CLUSTER_DIALOG_VIEWPORT_MARGIN_PX, viewportWidth - dialogWidth - CLUSTER_DIALOG_VIEWPORT_MARGIN_PX);
  const left = Math.min(Math.max(preferredLeft, CLUSTER_DIALOG_VIEWPORT_MARGIN_PX), maxLeft);

  const belowTop = triggerRect.bottom + CLUSTER_DIALOG_VIEWPORT_MARGIN_PX;
  const aboveTop = triggerRect.top - dialogHeight - CLUSTER_DIALOG_VIEWPORT_MARGIN_PX;
  const canFitBelow = belowTop + dialogHeight <= viewportHeight - CLUSTER_DIALOG_VIEWPORT_MARGIN_PX;
  const canFitAbove = aboveTop >= CLUSTER_DIALOG_VIEWPORT_MARGIN_PX;

  let top = belowTop;
  if (!canFitBelow && canFitAbove) {
    top = aboveTop;
  } else if (!canFitBelow) {
    top = Math.max(
      CLUSTER_DIALOG_VIEWPORT_MARGIN_PX,
      viewportHeight - dialogHeight - CLUSTER_DIALOG_VIEWPORT_MARGIN_PX,
    );
  }

  return { left, top };
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
    const emptySlotLabel = `Add session on ${format(day, 'EEEE, MMMM d, yyyy')} at ${format(
      parseSlotInstant(day, time) ?? day,
      'h:mm a',
    )}`;

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
            ? emptySlotLabel
            : allowDragAndDrop
              ? "Drop appointment here"
            : slotSessions.length === 0
              ? "Empty time slot"
              : undefined
        }
        title={enableSlotCreateChrome ? emptySlotLabel : undefined}
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
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          >
            <span className="inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-1 text-xs font-medium text-blue-700 shadow-sm dark:bg-gray-900/90 dark:text-blue-200">
              <Plus className="h-3.5 w-3.5" />
              + Add session
            </span>
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
  compact = false,
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
  compact?: boolean;
}) {
  const hasFinePointer = useHasFinePointer();
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressOriginRef = useRef<{ x: number; y: number } | null>(null);
  const suppressSessionClickRef = useRef(false);
  const sourcePosition = useMemo(() => getSessionSourcePosition(session), [session]);
  const statusStyles = getOverlaySessionStatusClasses(session.status);
  const dragEligibleSession = isScheduleSessionDragEligible(session.status);
  const touchMovePickup = !hasFinePointer && allowDragAndDrop && dragEligibleSession && sourcePosition !== null;
  const canDragWithFinePointer = allowDragAndDrop && hasFinePointer && dragEligibleSession && sourcePosition !== null;
  const range = getSafeSessionRange(session);
  const compactTimeLabel = range.start ? format(range.start, 'h:mm a') : range.label;
  const accessibleSessionDetails = `${getSessionDisplayName(session)}, ${getTherapistDisplayName(session)}, ${range.label}`;

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
      title={
        touchMovePickup
          ? 'Press and hold to move, then tap a time slot. Tap again to cancel.'
          : compact
            ? accessibleSessionDetails
            : undefined
      }
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
      } ${
        activeDragSessionId === session.id
          ? 'pointer-events-auto opacity-50 ring-2 ring-blue-400 ring-offset-1 dark:ring-offset-gray-900'
          : ''
      } ${
        compact ? 'overflow-hidden' : ''
      }`}
      data-layout-density={compact ? 'compact' : 'regular'}
      aria-label={compact ? accessibleSessionDetails : undefined}
    >
      {compact ? (
        <div className="flex min-w-0 items-center justify-between gap-1">
          <span className="truncate font-medium">{getSessionDisplayName(session)}</span>
          <span className={`shrink-0 ${statusStyles.time}`}>{compactTimeLabel}</span>
        </div>
      ) : (
        <>
          <div className="truncate font-medium">{getSessionDisplayName(session)}</div>
          <div className={`${statusStyles.secondary} truncate`}>{getTherapistDisplayName(session)}</div>
          <div className={`flex items-center ${statusStyles.time}`}>
            <Clock className="mr-1 h-3 w-3" />
            {range.label}
          </div>
        </>
      )}
      {showStatus ? (
        <div className="mt-0.5 text-[11px] uppercase tracking-wide">{getDisplayStatusLabel(session.status)}</div>
      ) : null}
      <span aria-hidden="true" className="pointer-events-none absolute right-1 top-1 opacity-0 group-hover/session:opacity-100">
        <Edit2 className="h-3 w-3" />
      </span>
    </button>
  );
}

function OccupiedBlockCreateButton({
  createPosition,
  onCreateSession,
  touchOnly = false,
}: {
  createPosition: ScheduleSlotPosition;
  onCreateSession: ScheduleTimeSlotHandler;
  touchOnly?: boolean;
}) {
  const label = getCreateSessionLabel(createPosition);

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`absolute right-1 top-1 z-30 inline-flex items-center justify-center rounded-full bg-white/95 text-blue-700 shadow-sm ring-1 ring-slate-300 transition-opacity hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:bg-slate-950/95 dark:text-blue-200 dark:ring-slate-600 ${
        touchOnly ? 'h-8 w-8' : 'h-6 w-6'
      }`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onCreateSession(createPosition);
      }}
    >
      <Plus className="h-3.5 w-3.5" />
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
  day,
  onCreateSession,
  onEditSession,
  allowCreateInOccupiedSlot = false,
  allowDragAndDrop = false,
  activeDragSessionId = null,
  onStartSessionDrag,
  onEndSessionDrag,
}: {
  item: ScheduleLayoutItem;
  day: Date;
  onCreateSession: ScheduleTimeSlotHandler;
  onEditSession: ScheduleEditSessionHandler;
  allowCreateInOccupiedSlot?: boolean;
  allowDragAndDrop?: boolean;
  activeDragSessionId?: string | null;
  onStartSessionDrag?: (session: Session, source: ScheduleSlotPosition) => void;
  onEndSessionDrag?: () => void;
}) {
  const hasFinePointer = useHasFinePointer();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const firstRowRef = useRef<HTMLButtonElement | null>(null);
  const [dialogStyle, setDialogStyle] = useState<React.CSSProperties>({
    left: CLUSTER_DIALOG_VIEWPORT_MARGIN_PX,
    top: CLUSTER_DIALOG_VIEWPORT_MARGIN_PX,
    opacity: 0,
  });

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
      triggerRef.current?.focus({ preventScroll: true });
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

  useEffect(() => {
    if (!open) {
      return;
    }

    const updateDialogPosition = () => {
      if (!triggerRef.current || !dialogRef.current) {
        return;
      }

      const nextPosition = getClusterDialogPosition(
        triggerRef.current.getBoundingClientRect(),
        dialogRef.current.getBoundingClientRect(),
      );

      setDialogStyle({
        left: nextPosition.left,
        top: nextPosition.top,
        opacity: 1,
      });
    };

    updateDialogPosition();
    window.addEventListener('resize', updateDialogPosition);
    window.addEventListener('scroll', updateDialogPosition, true);
    return () => {
      window.removeEventListener('resize', updateDialogPosition);
      window.removeEventListener('scroll', updateDialogPosition, true);
    };
  }, [open]);

  const style = {
    top: item.topRows * SLOT_HEIGHT_PX + OVERLAY_VERTICAL_INSET_PX,
    height: getOverlayCardHeight(item.spanRows),
    left: OVERLAY_HORIZONTAL_INSET_PX,
    right: OVERLAY_HORIZONTAL_INSET_PX,
  };
  const createPosition = useMemo(() => getOverlayCreatePosition(day, item.topRows), [day, item.topRows]);
  const occupiedCreateVisibilityClasses = hasFinePointer
    ? 'pointer-events-none opacity-0 transition-opacity group-hover/overlay:pointer-events-auto group-hover/overlay:opacity-100 group-focus-within/overlay:pointer-events-auto group-focus-within/overlay:opacity-100'
    : 'pointer-events-auto opacity-100';

  if (item.kind === 'appointment') {
    const compact = item.spanRows <= 1;
    return (
      <div
        className={`group/overlay absolute ${activeDragSessionId !== null ? 'pointer-events-none' : 'pointer-events-auto'} ${
          compact ? 'overflow-hidden' : ''
        }`}
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
          compact={compact}
        />
        {allowCreateInOccupiedSlot ? (
          <div className={occupiedCreateVisibilityClasses}>
            <OccupiedBlockCreateButton
              createPosition={createPosition}
              onCreateSession={onCreateSession}
              touchOnly={!hasFinePointer}
            />
          </div>
        ) : null}
      </div>
    );
  }

  const clusterLabel = getClusterLabel(item.sessions, item);
  const clusterRangeLabel = getClusterRangeLabel(item.sessions, item);

  return (
    <div
      className={`group/overlay absolute z-20 ${activeDragSessionId !== null ? 'pointer-events-none' : 'pointer-events-auto'}`}
      data-layout-kind="cluster"
      style={style}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `schedule-cluster-${item.sessions.map((session) => session.id).join('-')}` : undefined}
        onClick={() => setOpen((current) => !current)}
        className="h-full w-full overflow-hidden rounded border border-slate-300 bg-white px-2 py-1 text-left text-xs text-slate-900 shadow-sm transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="font-medium">{item.sessions.length} appointments</div>
          <span
            aria-hidden="true"
            data-testid="schedule-overlap-count"
            className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-700 px-1.5 text-[11px] font-semibold text-white dark:bg-slate-200 dark:text-slate-900"
          >
            {item.sessions.length}
          </span>
        </div>
        <div className="truncate text-[11px]">{clusterLabel.replace(/^\d+ appointments, /i, '')}</div>
      </button>

      {allowCreateInOccupiedSlot ? (
        <div className={occupiedCreateVisibilityClasses}>
          <OccupiedBlockCreateButton
            createPosition={createPosition}
            onCreateSession={onCreateSession}
            touchOnly={!hasFinePointer}
          />
        </div>
      ) : null}

      {open
        ? createPortal(
            <div
              id={`schedule-cluster-${item.sessions.map((session) => session.id).join('-')}`}
              ref={dialogRef}
              role="dialog"
              aria-label={`${item.sessions.length} overlapping appointments, ${clusterRangeLabel}`}
              tabIndex={-1}
              className="fixed z-30 max-h-[calc(100vh-1rem)] w-[calc(100vw-1rem)] min-w-0 max-w-[20rem] overflow-y-auto overscroll-contain rounded-lg border border-slate-200 bg-white p-2 shadow-xl sm:min-w-[16rem] dark:border-slate-700 dark:bg-slate-900"
              style={dialogStyle}
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
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function ScheduleOverlayColumn({
  day,
  scheduleSessions,
  onCreateSession,
  onEditSession,
  allowCreateInOccupiedSlot = false,
  allowDragAndDrop = false,
  activeDragSessionId = null,
  onStartSessionDrag,
  onEndSessionDrag,
  showInvalidSessions = true,
}: {
  day: Date;
  scheduleSessions: readonly Session[];
  onCreateSession: ScheduleTimeSlotHandler;
  onEditSession: ScheduleEditSessionHandler;
  allowCreateInOccupiedSlot?: boolean;
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
          day={day}
          onCreateSession={onCreateSession}
          onEditSession={onEditSession}
          allowCreateInOccupiedSlot={allowCreateInOccupiedSlot}
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
    allowCreateInOccupiedSlot = false,
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
    allowCreateInOccupiedSlot?: boolean;
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
        {timeSlots.map((time) => {
          const slotIsOccupied =
            useImprovedAppointmentLayout &&
            scheduleSessions.some((session) => doesSessionOverlapSlot(session, day, time));

          return (
            <TimeSlot
              key={time}
              time={time}
              day={day}
              slotSessions={useImprovedAppointmentLayout ? [] : (sessionSlotIndex.get(createSessionSlotKey(dayKey, time)) ?? [])}
              onCreateSession={onCreateSession}
              onEditSession={onEditSession}
              allowCreateInEmptySlot={allowCreateInEmptySlot && !slotIsOccupied}
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
          );
        })}
        {useImprovedAppointmentLayout ? (
          <ScheduleOverlayColumn
            day={day}
            scheduleSessions={scheduleSessions}
            onCreateSession={onCreateSession}
            onEditSession={onEditSession}
            allowCreateInOccupiedSlot={allowCreateInOccupiedSlot}
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
