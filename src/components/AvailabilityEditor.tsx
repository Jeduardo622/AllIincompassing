import React from 'react';
import { Clock } from 'lucide-react';
import type { AvailabilityHours, AvailabilityWindow } from '../types';

interface AvailabilityEditorProps {
  value: AvailabilityHours;
  onChange: (value: AvailabilityHours) => void;
}

const DAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

// Generate time options from 6 AM to 9 PM in 15-minute intervals
const TIME_OPTIONS = Array.from({ length: 61 }, (_, i) => {
  const totalMinutes = i * 15 + 6 * 60; // Start at 6 AM (6 * 60 minutes)
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  
  const hourFormatted = hour.toString().padStart(2, '0');
  const minuteFormatted = minute.toString().padStart(2, '0');
  const timeValue = `${hourFormatted}:${minuteFormatted}`;
  
  const hour12 = hour % 12 || 12;
  const amPm = hour < 12 ? 'AM' : 'PM';
  const label = `${hour12}:${minuteFormatted} ${amPm}`;
  
  return {
    value: timeValue,
    label: label,
  };
});

const DEFAULT_AVAILABILITY = {
  monday: { start: null, end: null, start2: null, end2: null },
  tuesday: { start: null, end: null, start2: null, end2: null },
  wednesday: { start: null, end: null, start2: null, end2: null },
  thursday: { start: null, end: null, start2: null, end2: null },
  friday: { start: null, end: null, start2: null, end2: null },
  saturday: { start: null, end: null, start2: null, end2: null },
};

export default function AvailabilityEditor({ value = DEFAULT_AVAILABILITY, onChange }: AvailabilityEditorProps) {
  // Ensure value has all required days with proper structure
  const normalizedValue = React.useMemo(() => {
    const normalized = { ...DEFAULT_AVAILABILITY };
    DAYS.forEach(day => {
      normalized[day] = {
        start: value[day]?.start ?? null,
        end: value[day]?.end ?? null,
        start2: value[day]?.start2 ?? null,
        end2: value[day]?.end2 ?? null,
      };
    });
    return normalized;
  }, [value]);

  const handleDayChange = (
    day: string,
    field: keyof AvailabilityWindow,
    time: string | null,
  ) => {
    onChange({
      ...normalizedValue,
      [day]: {
        ...normalizedValue[day],
        [field]: time,
      },
    });
  };

  const handleDayToggle = (day: string, enabled: boolean) => {
    onChange({
      ...normalizedValue,
      [day]: {
        start: enabled ? '06:00' : null,
        end: enabled ? '21:00' : null,
        start2: null,
        end2: null,
      },
    });
  };

  const handleSecondBlockToggle = (day: string, enabled: boolean) => {
    onChange({
      ...normalizedValue,
      [day]: {
        ...normalizedValue[day],
        start2: enabled ? '15:00' : null,
        end2: enabled ? '20:00' : null,
      },
    });
  };

  return (
    <div className="space-y-4">
      {DAYS.map(day => {
        const dayValue = normalizedValue[day];
        const isEnabled = dayValue.start !== null && dayValue.end !== null;
        const hasSecondBlock = dayValue.start2 !== null && dayValue.end2 !== null;
        
        return (
          <div key={day} className="bg-white dark:bg-dark-lighter rounded-lg border dark:border-gray-700 p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center">
                <Clock className="w-5 h-5 text-gray-400 mr-2" />
                <h3 className="text-sm font-medium text-gray-900 dark:text-white capitalize">
                  {day}
                </h3>
              </div>
              <label
                className="relative inline-flex items-center cursor-pointer"
                aria-label={`Toggle ${day} availability`}
              >
                <input
                  type="checkbox"
                  checked={isEnabled}
                  onChange={(e) => handleDayToggle(day, e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor={`${`availability-${day}`.replace(/\s+/g, '-').toLowerCase()}-start`} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Start Time
                </label>
                <select
                  id={`${`availability-${day}`.replace(/\s+/g, '-').toLowerCase()}-start`}
                  value={dayValue.start || ''}
                  onChange={(e) => handleDayChange(day, 'start', e.target.value || null)}
                  disabled={!isEnabled}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:bg-gray-100 dark:disabled:bg-gray-700"
                >
                  <option value="">Select time</option>
                  {TIME_OPTIONS.map(({ value, label }) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor={`${`availability-${day}`.replace(/\s+/g, '-').toLowerCase()}-end`} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  End Time
                </label>
                <select
                  id={`${`availability-${day}`.replace(/\s+/g, '-').toLowerCase()}-end`}
                  value={dayValue.end || ''}
                  onChange={(e) => handleDayChange(day, 'end', e.target.value || null)}
                  disabled={!isEnabled}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:bg-gray-100 dark:disabled:bg-gray-700"
                >
                  <option value="">Select time</option>
                  {TIME_OPTIONS.map(({ value: timeValue, label }) => (
                    <option 
                      key={timeValue} 
                      value={timeValue}
                      disabled={dayValue.start && timeValue <= dayValue.start}
                    >
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {isEnabled && (
              <div className="mt-3">
                {!hasSecondBlock ? (
                  <button
                    type="button"
                    onClick={() => handleSecondBlockToggle(day, true)}
                    className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                  >
                    + Add second time block
                  </button>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-2 mt-1">
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Second Time Block
                      </p>
                      <button
                        type="button"
                        onClick={() => handleSecondBlockToggle(day, false)}
                        className="text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                      >
                        Remove second block
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label
                          htmlFor={`${`availability-${day}`.replace(/\s+/g, '-').toLowerCase()}-start2`}
                          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                        >
                          Second Start
                        </label>
                        <select
                          id={`${`availability-${day}`.replace(/\s+/g, '-').toLowerCase()}-start2`}
                          value={dayValue.start2 || ''}
                          onChange={(e) => handleDayChange(day, 'start2', e.target.value || null)}
                          className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        >
                          <option value="">Select time</option>
                          {TIME_OPTIONS.map(({ value: timeValue, label }) => (
                            <option
                              key={timeValue}
                              value={timeValue}
                              disabled={Boolean(dayValue.end && timeValue < dayValue.end)}
                            >
                              {label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label
                          htmlFor={`${`availability-${day}`.replace(/\s+/g, '-').toLowerCase()}-end2`}
                          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                        >
                          Second End
                        </label>
                        <select
                          id={`${`availability-${day}`.replace(/\s+/g, '-').toLowerCase()}-end2`}
                          value={dayValue.end2 || ''}
                          onChange={(e) => handleDayChange(day, 'end2', e.target.value || null)}
                          className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        >
                          <option value="">Select time</option>
                          {TIME_OPTIONS.map(({ value: timeValue, label }) => (
                            <option
                              key={timeValue}
                              value={timeValue}
                              disabled={Boolean(dayValue.start2 && timeValue <= dayValue.start2)}
                            >
                              {label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}