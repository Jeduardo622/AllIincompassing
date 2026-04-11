import React, { useCallback, useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import { Clock, Edit2, Plus } from 'lucide-react';
import type { Session } from '../types';
import { createSessionSlotKey } from './schedule-utils';

export type ScheduleTimeSlotHandler = (timeSlot: { date: Date; time: string }) => void;
export type ScheduleEditSessionHandler = (session: Session) => void;

const SESSION_STATUS_STYLES: Record<
  Session['status'],
  { card: string; secondary: string; time: string }
> = {
  scheduled: {
    card: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 hover:bg-blue-200 dark:hover:bg-blue-900/50',
    secondary: 'text-blue-600 dark:text-blue-300',
    time: 'text-blue-500 dark:text-blue-400',
  },
  in_progress: {
    card: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-200 dark:hover:bg-emerald-900/50',
    secondary: 'text-emerald-600 dark:text-emerald-300',
    time: 'text-emerald-500 dark:text-emerald-400',
  },
  completed: {
    card: 'bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700',
    secondary: 'text-gray-400 dark:text-gray-500',
    time: 'text-gray-400 dark:text-gray-500',
  },
  cancelled: {
    card: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/30',
    secondary: 'text-red-500 dark:text-red-400',
    time: 'text-red-400 dark:text-red-500',
  },
  'no-show': {
    card: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30',
    secondary: 'text-amber-600 dark:text-amber-400',
    time: 'text-amber-500 dark:text-amber-500',
  },
};

export function getSessionStatusClasses(
  status: Session['status'],
): { card: string; secondary: string; time: string } {
  return SESSION_STATUS_STYLES[status] ?? SESSION_STATUS_STYLES.scheduled;
}

export const TimeSlot = React.memo(
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
    onCreateSession: ScheduleTimeSlotHandler;
    onEditSession: ScheduleEditSessionHandler;
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

    return (
      <div
        className="h-10 border-b border-r p-2 relative group cursor-pointer hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
        role="button"
        tabIndex={0}
        aria-label="Add session"
        title="Add session"
        onClick={handleTimeSlotClick}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleTimeSlotClick();
          }
        }}
      >
        <span
          aria-hidden="true"
          className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 p-1 rounded-full text-gray-500 transition-opacity dark:text-gray-400"
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
  }: {
    day: Date;
    timeSlots: string[];
    sessionSlotIndex: Map<string, Session[]>;
    onCreateSession: ScheduleTimeSlotHandler;
    onEditSession: ScheduleEditSessionHandler;
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
          />
        ))}
      </div>
    );
  },
);

DayColumn.displayName = 'DayColumn';
