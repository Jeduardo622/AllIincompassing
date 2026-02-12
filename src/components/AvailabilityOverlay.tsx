import React, { useMemo } from 'react';
import { format } from 'date-fns';
import type { Therapist, Client } from '../types';
import type { AvailabilityWindow } from '../types';

interface AvailabilityOverlayProps {
  therapists: Therapist[];
  clients: Client[];
  selectedDate: Date;
  timeSlots: string[];
}

export default function AvailabilityOverlay({ 
  therapists, 
  clients, 
  selectedDate,
  timeSlots 
}: AvailabilityOverlayProps) {
  const dayName = format(selectedDate, 'EEEE').toLowerCase();

  const isMinuteInAvailability = (minutes: number, availability: AvailabilityWindow | undefined): boolean => {
    if (!availability) {
      return false;
    }

    const toMinutes = (value: string | null | undefined): number | null => {
      if (!value) {
        return null;
      }
      const [hoursPart, minutesPart = '0'] = value.split(':');
      const hours = Number.parseInt(hoursPart, 10);
      const mins = Number.parseInt(minutesPart, 10);
      if (Number.isNaN(hours) || Number.isNaN(mins)) {
        return null;
      }
      return hours * 60 + mins;
    };

    const ranges: Array<{ start: number; end: number }> = [];
    const firstStart = toMinutes(availability.start);
    const firstEnd = toMinutes(availability.end);
    if (firstStart !== null && firstEnd !== null && firstStart < firstEnd) {
      ranges.push({ start: firstStart, end: firstEnd });
    }

    const secondStart = toMinutes(availability.start2);
    const secondEnd = toMinutes(availability.end2);
    if (secondStart !== null && secondEnd !== null && secondStart < secondEnd) {
      ranges.push({ start: secondStart, end: secondEnd });
    }

    return ranges.some(range => minutes >= range.start && minutes < range.end);
  };

  const availabilityMap = useMemo(() => {
    const map = new Map<string, { therapists: Set<string>; clients: Set<string> }>();
    
    timeSlots.forEach(time => {
      const [hour, minute] = time.split(':').map(Number);
      const currentTotalMinutes = hour * 60 + minute;
      const entry = { therapists: new Set<string>(), clients: new Set<string>() };
      
      // Check therapist availability
      therapists.forEach(therapist => {
        const avail = therapist.availability_hours?.[dayName];
        if (isMinuteInAvailability(currentTotalMinutes, avail)) {
          entry.therapists.add(therapist.id);
        }
      });
      
      // Check client availability
      clients.forEach(client => {
        const avail = client.availability_hours?.[dayName];
        if (isMinuteInAvailability(currentTotalMinutes, avail)) {
          entry.clients.add(client.id);
        }
      });
      
      map.set(time, entry);
    });
    
    return map;
  }, [therapists, clients, dayName, timeSlots]);

  return (
    <div className="absolute inset-0 pointer-events-none">
      {timeSlots.map(time => (
        <div key={time} className="h-20 border-b border-r relative">
          <div className="absolute inset-0 flex">
            {/* Therapist availability indicators */}
            <div className="flex-1 flex">
              {therapists.map(therapist => {
                const isAvailable = availabilityMap.get(time)?.therapists.has(therapist.id);
                return (
                  <div
                    key={therapist.id}
                    className={`flex-1 ${
                      isAvailable
                        ? 'bg-green-50'
                        : 'bg-red-50'
                    } opacity-20`}
                    title={`${therapist.full_name} ${
                      isAvailable ? 'Available' : 'Unavailable'
                    } at ${time}`}
                  />
                );
              })}
            </div>
            
            {/* Client availability indicators */}
            <div className="flex-1 flex">
              {clients.map(client => {
                const isAvailable = availabilityMap.get(time)?.clients.has(client.id);
                return (
                  <div
                    key={client.id}
                    className={`flex-1 ${
                      isAvailable
                        ? 'bg-blue-50'
                        : 'bg-gray-50'
                    } opacity-20`}
                    title={`${client.full_name} ${
                      isAvailable ? 'Available' : 'Unavailable'
                    } at ${time}`}
                  />
                );
              })}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}