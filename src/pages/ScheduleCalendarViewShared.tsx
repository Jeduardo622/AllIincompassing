/* eslint-disable jsx-a11y/no-static-element-interactions */
import React, { useCallback, useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import { Clock, Edit2, Plus } from 'lucide-react';
import type { Session } from '../types';
import { createSessionSlotKey } from './schedule-utils';
import { getSessionStatusClasses } from './ScheduleSessionStatusStyles';

export type ScheduleTimeSlotHandler = (timeSlot: { date: Date; time: string }) => void;
export type ScheduleEditSessionHandler = (session: Session) => void;
export type ScheduleSlotPosition = { date: Date; time: string };
export type ScheduleDropPayload = { target: ScheduleSlotPosition; draggedSessionId?: string | null };

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
  }) => {
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
    const enableSlotCreateChrome = allowCreateInEmptySlot;
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
              ...(enableSlotCreateChrome ? { onClick: handleTimeSlotClick } : {}),
              onKeyDown: handleSlotKeyDown,
            }
          : {})}
      >
        {enableSlotCreateChrome ? (
          <span
            aria-hidden="true"
            className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 p-1 rounded-full text-gray-500 transition-opacity dark:text-gray-400"
          >
            <Plus className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          </span>
        ) : null}

        {slotSessions.map((session) => {
          const statusStyles = getSessionStatusClasses(session.status);
          return (
            <div
              key={session.id}
              data-session-status={session.status}
              data-session-id={session.id}
              draggable={allowDragAndDrop && session.status === "scheduled"}
              aria-grabbed={allowDragAndDrop && activeDragSessionId === session.id}
              onDragStart={
                allowDragAndDrop && session.status === "scheduled"
                  ? (event) => {
                      event.stopPropagation();
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", session.id);
                      onStartSessionDrag?.(session, { date: day, time });
                    }
                  : undefined
              }
              onDragEnd={
                allowDragAndDrop
                  ? () => {
                      onEndSessionDrag?.();
                    }
                  : undefined
              }
              className={`${statusStyles.card} rounded p-1 text-xs mb-1 group/session relative transition-colors ${
                allowDragAndDrop && session.status === "scheduled" ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
              } ${activeDragSessionId === session.id ? "opacity-50" : ""}`}
              role="button"
              tabIndex={0}
              onClick={(event) => handleSessionClick(event, session)}
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

TimeSlot.displayName = 'TimeSlot';

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
  }) => {
    const dayKey = useMemo(() => format(day, 'yyyy-MM-dd'), [day]);

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
            allowCreateInEmptySlot={allowCreateInEmptySlot}
            allowDragAndDrop={allowDragAndDrop}
            activeDragSessionId={activeDragSessionId}
            activeDropSlotKey={activeDropSlotKey}
            onStartSessionDrag={onStartSessionDrag}
            onSessionDrop={onSessionDrop}
            onHoverSlotDuringDrag={onHoverSlotDuringDrag}
            onEndSessionDrag={onEndSessionDrag}
          />
        ))}
      </div>
    );
  },
);

DayColumn.displayName = 'DayColumn';
