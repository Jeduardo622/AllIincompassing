import React from 'react';
import { format } from 'date-fns';
import type { Session } from '../types';
import { TimeSlot, type ScheduleEditSessionHandler, type ScheduleTimeSlotHandler } from './ScheduleCalendarViewShared';
import { createSessionSlotKey } from './schedule-utils';

interface ScheduleDayViewProps {
  selectedDate: Date;
  timeSlots: string[];
  sessionSlotIndex: Map<string, Session[]>;
  onCreateSession: ScheduleTimeSlotHandler;
  onEditSession: ScheduleEditSessionHandler;
}

export const ScheduleDayView: React.FC<ScheduleDayViewProps> = ({
  selectedDate,
  timeSlots,
  sessionSlotIndex,
  onCreateSession,
  onEditSession,
}) => {
  const selectedDateKey = format(selectedDate, 'yyyy-MM-dd');

  return (
    <div
      className="bg-white dark:bg-dark-lighter rounded-lg shadow overflow-x-auto"
      data-testid="day-view"
    >
      <div className="grid grid-cols-2 border-b dark:border-gray-700">
        <div className="py-4 px-2 text-center text-sm font-medium text-gray-500 border-r dark:border-gray-700 dark:text-gray-400">
          Time
        </div>
        <div className="py-4 px-2 text-center text-sm font-medium text-gray-900 dark:text-white">
          {format(selectedDate, 'EEEE, MMMM d, yyyy')}
        </div>
      </div>

      <div className="grid grid-cols-2">
        <div className="border-r dark:border-gray-700">
          {timeSlots.map((time) => (
            <div
              key={time}
              className="h-10 border-b p-2 text-sm text-gray-500 flex items-center dark:border-gray-700 dark:text-gray-400"
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
};
