import React, { useCallback, useMemo, useRef, useState } from 'react';
import { format, parseISO } from 'date-fns';
import type { Session } from '../types';
import {
  DayColumn,
  type ScheduleDropPayload,
  type ScheduleEditSessionHandler,
  type ScheduleSlotPosition,
  type ScheduleTimeSlotHandler,
} from './ScheduleCalendarViewShared';
import { createSessionSlotKey } from './schedule-utils';

interface ScheduleWeekViewProps {
  weekDays: Date[];
  timeSlots: string[];
  sessionSlotIndex: Map<string, Session[]>;
  onCreateSession: ScheduleTimeSlotHandler;
  onEditSession: ScheduleEditSessionHandler;
  onRescheduleSession?: (session: Session, target: ScheduleSlotPosition) => void;
  allowCreateInEmptySlot?: boolean;
  allowDragAndDrop?: boolean;
}

const ScheduleWeekViewComponent: React.FC<ScheduleWeekViewProps> = ({
  weekDays,
  timeSlots,
  sessionSlotIndex,
  onCreateSession,
  onEditSession,
  onRescheduleSession,
  allowCreateInEmptySlot = true,
  allowDragAndDrop = false,
}) => {
  const [draggedSession, setDraggedSession] = useState<Session | null>(null);
  const [dropSlotKey, setDropSlotKey] = useState<string | null>(null);
  const draggedSessionRef = useRef<Session | null>(null);
  const sourceSlotKeyRef = useRef<string | null>(null);
  const sessionsById = useMemo(() => {
    const next = new Map<string, Session>();
    for (const slotSessions of sessionSlotIndex.values()) {
      for (const session of slotSessions) {
        next.set(session.id, session);
      }
    }
    return next;
  }, [sessionSlotIndex]);

  const handleStartSessionDrag = useCallback((session: Session, source: ScheduleSlotPosition) => {
    if (!allowDragAndDrop) {
      return;
    }
    const nextSourceSlotKey = createSessionSlotKey(format(source.date, 'yyyy-MM-dd'), source.time);
    draggedSessionRef.current = session;
    sourceSlotKeyRef.current = nextSourceSlotKey;
    setDraggedSession(session);
    setDropSlotKey(null);
  }, [allowDragAndDrop]);

  const clearDragState = useCallback(() => {
    draggedSessionRef.current = null;
    sourceSlotKeyRef.current = null;
    setDraggedSession(null);
    setDropSlotKey(null);
  }, []);

  const handleHoverSlotDuringDrag = useCallback((targetSlotKey: string | null) => {
    if (!allowDragAndDrop || !draggedSessionRef.current) {
      return;
    }
    setDropSlotKey(targetSlotKey);
  }, [allowDragAndDrop]);

  const handleDropOnSlot = useCallback(({ target, draggedSessionId }: ScheduleDropPayload) => {
    const sessionToMove =
      draggedSessionRef.current ??
      (draggedSessionId ? sessionsById.get(draggedSessionId) ?? null : null);
    if (!allowDragAndDrop || !sessionToMove) {
      clearDragState();
      return;
    }
    const targetKey = createSessionSlotKey(format(target.date, 'yyyy-MM-dd'), target.time);
    const fallbackSourceDate = parseISO(sessionToMove.start_time);
    const fallbackSourceKey = Number.isNaN(fallbackSourceDate.getTime())
      ? null
      : createSessionSlotKey(format(fallbackSourceDate, 'yyyy-MM-dd'), format(fallbackSourceDate, 'HH:mm'));
    const sourceKey = sourceSlotKeyRef.current ?? fallbackSourceKey;
    const shouldReschedule = targetKey !== sourceKey;
    clearDragState();
    if (shouldReschedule) {
      onRescheduleSession?.(sessionToMove, target);
    }
  }, [allowDragAndDrop, clearDragState, onRescheduleSession, sessionsById]);

  return (
    <div className="bg-white dark:bg-dark-lighter rounded-lg shadow overflow-x-auto">
      <div className="grid grid-cols-[72px_repeat(6,minmax(90px,1fr))] sm:grid-cols-7 border-b dark:border-gray-700 min-w-[620px] sm:min-w-[800px]">
        <div className="py-2 px-1.5 text-center text-sm font-medium text-gray-500 border-r dark:border-gray-700 dark:text-gray-400 sm:px-2">
          Time
        </div>
        {weekDays.map((day) => (
          <div
            key={day.toISOString()}
            className="py-2 px-1.5 text-center text-sm font-medium text-gray-900 dark:text-white sm:px-2"
          >
            <span className="sm:hidden">{format(day, 'EEE d')}</span>
            <span className="hidden sm:inline">{format(day, 'EEE MMM d')}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-[72px_repeat(6,minmax(90px,1fr))] sm:grid-cols-7 min-w-[620px] sm:min-w-[800px]">
        <div className="border-r dark:border-gray-700">
          {timeSlots.map((time) => (
            <div
              key={time}
              className="h-10 border-b p-1.5 text-xs text-gray-500 flex items-center dark:border-gray-700 dark:text-gray-400 sm:p-2 sm:text-sm"
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
            allowCreateInEmptySlot={allowCreateInEmptySlot}
            allowDragAndDrop={allowDragAndDrop}
            activeDragSessionId={draggedSession?.id ?? null}
            activeDropSlotKey={dropSlotKey}
            onStartSessionDrag={handleStartSessionDrag}
            onSessionDrop={handleDropOnSlot}
            onHoverSlotDuringDrag={handleHoverSlotDuringDrag}
            onEndSessionDrag={clearDragState}
          />
        ))}
      </div>
    </div>
  );
};

export const ScheduleWeekView = React.memo(ScheduleWeekViewComponent);
ScheduleWeekView.displayName = 'ScheduleWeekView';
