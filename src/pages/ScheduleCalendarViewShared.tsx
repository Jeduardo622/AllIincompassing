import React, { useCallback, useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import { Clock, Edit2, Plus } from 'lucide-react';
import type { Session } from '../types';
import { createSessionSlotKey } from './schedule-utils';
import { getSessionStatusClasses } from './ScheduleSessionStatusStyles';

export type ScheduleTimeSlotHandler = (timeSlot: { date: Date; time: string }) => void;
export type ScheduleEditSessionHandler = (session: Session) => void;

export const TimeSlot = React.memo(
  ({
    time,
    day,
    slotSessions,
    onCreateSession,
    onEditSession,
    allowCreateInEmptySlot = true,
  }: {
    time: string;
    day: Date;
    slotSessions: Session[];
    onCreateSession: ScheduleTimeSlotHandler;
    onEditSession: ScheduleEditSessionHandler;
    allowCreateInEmptySlot?: boolean;
  }) => {
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

    return (
      <div
        className={`h-10 border-b border-r p-2 relative group dark:border-gray-700 ${
          enableSlotCreateChrome
            ? "cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
            : "cursor-default"
        }`}
        role={enableSlotCreateChrome ? "button" : undefined}
        tabIndex={enableSlotCreateChrome ? 0 : undefined}
        aria-label={
          enableSlotCreateChrome
            ? "Add session"
            : slotSessions.length === 0
              ? "Empty time slot"
              : undefined
        }
        title={enableSlotCreateChrome ? "Add session" : undefined}
        {...(enableSlotCreateChrome
          ? {
              onClick: handleTimeSlotClick,
              onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  handleTimeSlotClick();
                }
              },
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
              className={`${statusStyles.card} rounded p-1 text-xs mb-1 group/session relative cursor-pointer transition-colors`}
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
  }: {
    day: Date;
    timeSlots: string[];
    sessionSlotIndex: Map<string, Session[]>;
    onCreateSession: ScheduleTimeSlotHandler;
    onEditSession: ScheduleEditSessionHandler;
    allowCreateInEmptySlot?: boolean;
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
          />
        ))}
      </div>
    );
  },
);

DayColumn.displayName = 'DayColumn';
