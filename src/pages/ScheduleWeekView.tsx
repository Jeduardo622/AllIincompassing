import React from 'react';
import { format } from 'date-fns';
import type { Session } from '../types';
import { DayColumn, type ScheduleEditSessionHandler, type ScheduleTimeSlotHandler } from './ScheduleCalendarViewShared';

interface ScheduleWeekViewProps {
  weekDays: Date[];
  timeSlots: string[];
  sessionSlotIndex: Map<string, Session[]>;
  onCreateSession: ScheduleTimeSlotHandler;
  onEditSession: ScheduleEditSessionHandler;
}

const ScheduleWeekViewComponent: React.FC<ScheduleWeekViewProps> = ({
  weekDays,
  timeSlots,
  sessionSlotIndex,
  onCreateSession,
  onEditSession,
}) => {
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
          />
        ))}
      </div>
    </div>
  );
};

export const ScheduleWeekView = React.memo(ScheduleWeekViewComponent);
ScheduleWeekView.displayName = 'ScheduleWeekView';
