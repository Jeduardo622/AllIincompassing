import React, { useMemo } from 'react';
import { format } from 'date-fns';
import type { Therapist, Client } from '../types';

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

  const availabilityMap = useMemo(() => {
    const map = new Map<string, { therapists: Set<string>; clients: Set<string> }>();
    
    timeSlots.forEach(time => {
      const [hour, minute] = time.split(':').map(Number);
      const currentTotalMinutes = hour * 60 + minute;
      const entry = { therapists: new Set<string>(), clients: new Set<string>() };
      
      // Check therapist availability
      therapists.forEach(therapist => {
        const avail = therapist.availability_hours?.[dayName];
        if (avail?.start && avail?.end) {
          const [startHour, startMinute] = avail.start.split(':').map(Number);
          const [endHour, endMinute] = avail.end.split(':').map(Number);
          
          const startTotalMinutes = startHour * 60 + startMinute;
          const endTotalMinutes = endHour * 60 + endMinute;
          
          if (currentTotalMinutes >= startTotalMinutes && currentTotalMinutes < endTotalMinutes) {
            entry.therapists.add(therapist.id);
          }
        }
      });
      
      // Check client availability
      clients.forEach(client => {
        const avail = client.availability_hours?.[dayName];
        if (avail?.start && avail?.end) {
          const [startHour, startMinute] = avail.start.split(':').map(Number);
          const [endHour, endMinute] = avail.end.split(':').map(Number);
          
          const startTotalMinutes = startHour * 60 + startMinute;
          const endTotalMinutes = endHour * 60 + endMinute;
          
          if (currentTotalMinutes >= startTotalMinutes && currentTotalMinutes < endTotalMinutes) {
            entry.clients.add(client.id);
          }
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