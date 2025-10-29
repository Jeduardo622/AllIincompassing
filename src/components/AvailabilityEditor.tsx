import React from 'react';
import { Clock } from 'lucide-react';

interface AvailabilityEditorProps {
  value: {
    [key: string]: {
      start: string | null;
      end: string | null;
    };
  };
  onChange: (value: {
    [key: string]: {
      start: string | null;
      end: string | null;
    };
  }) => void;
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
  monday: { start: null, end: null },
  tuesday: { start: null, end: null },
  wednesday: { start: null, end: null },
  thursday: { start: null, end: null },
  friday: { start: null, end: null },
  saturday: { start: null, end: null },
};

export default function AvailabilityEditor({ value = DEFAULT_AVAILABILITY, onChange }: AvailabilityEditorProps) {
  // Ensure value has all required days with proper structure
  const normalizedValue = React.useMemo(() => {
    const normalized = { ...DEFAULT_AVAILABILITY };
    DAYS.forEach(day => {
      normalized[day] = {
        start: value[day]?.start ?? null,
        end: value[day]?.end ?? null,
      };
    });
    return normalized;
  }, [value]);

  const handleDayChange = (day: string, field: 'start' | 'end', time: string | null) => {
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
      },
    });
  };

  return (
    <div className="space-y-4">
      {DAYS.map(day => {
        const dayValue = normalizedValue[day];
        const isEnabled = dayValue.start !== null && dayValue.end !== null;
        
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
          </div>
        );
      })}
    </div>
  );
}