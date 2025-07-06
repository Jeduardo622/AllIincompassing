import React, { useMemo, useRef, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Clock, AlertTriangle } from 'lucide-react';
import type { Therapist, Client } from '../types';
import { useVirtualizedList } from '../lib/performance';

interface SchedulingMatrixProps {
  therapists: Therapist[];
  clients: Client[];
  selectedDate: Date;
  onTimeSlotClick: (time: string) => void;
}

const CELL_HEIGHT = 40; // Height of each time slot cell
const CONTAINER_HEIGHT = 600; // Max height of the scrollable area

export default function SchedulingMatrix({
  therapists,
  clients,
  selectedDate,
  onTimeSlotClick,
}: SchedulingMatrixProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  // Generate time slots in 15-minute intervals from 8 AM to 6 PM
  const timeSlots = useMemo(() => {
    const slots = [];
    for (let hour = 8; hour < 18; hour++) {
      for (let minute = 0; minute < 60; minute += 15) {
        const hourStr = hour.toString().padStart(2, '0');
        const minuteStr = minute.toString().padStart(2, '0');
        slots.push(`${hourStr}:${minuteStr}`);
      }
    }
    return slots;
  }, []);

  // Use virtual scrolling for time slots
  const virtualizedTimeSlots = useVirtualizedList(
    timeSlots,
    CELL_HEIGHT,
    CONTAINER_HEIGHT
  );

  const dayName = format(selectedDate, 'EEEE').toLowerCase();

  const availabilityMap = useMemo(() => {
    const map = new Map<string, { therapists: Set<string>; clients: Set<string> }>();
    
    timeSlots.forEach(time => {
      const [hour, minute] = time.split(':').map(Number);
      const entry = { therapists: new Set<string>(), clients: new Set<string>() };
      
      therapists.forEach(therapist => {
        const avail = therapist.availability_hours[dayName];
        if (avail?.start && avail?.end) {
          const [startHour, startMinute] = avail.start.split(':').map(Number);
          const [endHour, endMinute] = avail.end.split(':').map(Number);
          
          const startTotalMinutes = startHour * 60 + startMinute;
          const endTotalMinutes = endHour * 60 + endMinute;
          const currentTotalMinutes = hour * 60 + minute;
          
          if (currentTotalMinutes >= startTotalMinutes && currentTotalMinutes < endTotalMinutes) {
            entry.therapists.add(therapist.id);
          }
        }
      });
      
      clients.forEach(client => {
        const avail = client.availability_hours[dayName];
        if (avail?.start && avail?.end) {
          const [startHour, startMinute] = avail.start.split(':').map(Number);
          const [endHour, endMinute] = avail.end.split(':').map(Number);
          
          const startTotalMinutes = startHour * 60 + startMinute;
          const endTotalMinutes = endHour * 60 + endMinute;
          const currentTotalMinutes = hour * 60 + minute;
          
          if (currentTotalMinutes >= startTotalMinutes && currentTotalMinutes < endTotalMinutes) {
            entry.clients.add(client.id);
          }
        }
      });
      
      map.set(time, entry);
    });
    
    return map;
  }, [therapists, clients, dayName, timeSlots]);

  // Handle scroll events for virtual scrolling
  useEffect(() => {
    const handleScroll = () => {
      if (containerRef.current) {
        setScrollTop(containerRef.current.scrollTop);
      }
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll);
      return () => container.removeEventListener('scroll', handleScroll);
    }
  }, []);

  // Get visible time slots based on scroll position
  const visibleTimeSlots = useMemo(() => {
    return virtualizedTimeSlots.getVisibleItems(scrollTop);
  }, [virtualizedTimeSlots, scrollTop]);

  if (!therapists.length || !clients.length) {
    return (
      <div className="bg-white dark:bg-dark-lighter rounded-lg shadow p-8 text-center text-gray-500">
        No therapists or clients available to display in the matrix.
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-dark-lighter rounded-lg shadow overflow-hidden">
      <div className="grid grid-cols-[150px_1fr] divide-x divide-gray-200 dark:divide-gray-700">
        {/* Fixed header */}
        <div className="sticky top-0 z-10 bg-white dark:bg-dark-lighter">
          <div className="h-12 flex items-center justify-center font-medium text-gray-700 dark:text-gray-300 border-b dark:border-gray-700">
            Time
          </div>
        </div>

        {/* Therapist and client headers */}
        <div className="sticky top-0 z-10 bg-white dark:bg-dark-lighter">
          <div className="grid grid-cols-2 h-12 border-b dark:border-gray-700">
            <div className="flex items-center justify-center font-medium text-gray-700 dark:text-gray-300 border-r dark:border-gray-700">
              Therapists ({therapists.length})
            </div>
            <div className="flex items-center justify-center font-medium text-gray-700 dark:text-gray-300">
              Clients ({clients.length})
            </div>
          </div>
        </div>

        {/* Time column */}
        <div className="bg-gray-50 dark:bg-gray-800">
          <div
            ref={containerRef}
            className="overflow-y-auto"
            style={{ height: CONTAINER_HEIGHT }}
          >
            {/* Virtual scrolling spacer */}
            <div style={{ height: visibleTimeSlots.offsetY }} />
            
            {/* Visible time slots */}
            {visibleTimeSlots.items.map((time) => (
              <div
                key={time}
                className="flex items-center justify-center text-sm text-gray-500 dark:text-gray-400 border-b dark:border-gray-700"
                style={{ height: CELL_HEIGHT }}
              >
                {time}
              </div>
            ))}
            
            {/* Bottom spacer */}
            <div style={{ 
              height: (timeSlots.length - visibleTimeSlots.endIndex) * CELL_HEIGHT 
            }} />
          </div>
        </div>

        {/* Availability grid */}
        <div className="relative">
          <div className="overflow-y-auto" style={{ height: CONTAINER_HEIGHT }}>
            {/* Virtual scrolling spacer */}
            <div style={{ height: visibleTimeSlots.offsetY }} />
            
            {/* Visible availability cells */}
            {visibleTimeSlots.items.map((time) => (
              <div key={time} className="grid grid-cols-2 border-b dark:border-gray-700" style={{ height: CELL_HEIGHT }}>
                {/* Therapist availability */}
                <div className="grid" style={{ gridTemplateColumns: `repeat(${therapists.length}, 1fr)` }}>
                  {therapists.map(therapist => {
                    const isAvailable = availabilityMap.get(time)?.therapists.has(therapist.id);
                    const isRushHour = (parseInt(time.split(':')[0]) >= 8 && parseInt(time.split(':')[0]) <= 9) || 
                                      (parseInt(time.split(':')[0]) >= 16 && parseInt(time.split(':')[0]) <= 18);
                    
                    return (
                      <div
                        key={`${time}-${therapist.id}`}
                        className={`h-full border-r dark:border-gray-700 transition-colors relative ${
                          isAvailable
                            ? 'bg-green-50 dark:bg-green-900/20 hover:bg-green-100 dark:hover:bg-green-900/30 cursor-pointer'
                            : 'bg-red-50 dark:bg-red-900/20'
                        }`}
                        onClick={() => {
                          if (isAvailable) {
                            onTimeSlotClick(time);
                          }
                        }}
                        title={`${therapist.full_name} - ${time}`}
                      >
                        {isRushHour && therapist.avoid_rush_hour && (
                          <div className="absolute top-1 right-1">
                            <AlertTriangle className="w-3 h-3 text-amber-500" />
                          </div>
                        )}
                        {isAvailable && (
                          <div className="absolute bottom-1 right-1 text-xs opacity-0 group-hover:opacity-100">
                            <Clock className="w-3 h-3 text-gray-500" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Client availability */}
                <div className="grid" style={{ gridTemplateColumns: `repeat(${clients.length}, 1fr)` }}>
                  {clients.map(client => {
                    const isAvailable = availabilityMap.get(time)?.clients.has(client.id);
                    const isRushHour = (parseInt(time.split(':')[0]) >= 8 && parseInt(time.split(':')[0]) <= 9) || 
                                      (parseInt(time.split(':')[0]) >= 16 && parseInt(time.split(':')[0]) <= 18);
                    
                    return (
                      <div
                        key={`${time}-${client.id}`}
                        className={`h-full border-r dark:border-gray-700 transition-colors relative ${
                          isAvailable
                            ? 'bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30 cursor-pointer'
                            : 'bg-gray-50 dark:bg-gray-800'
                        }`}
                        onClick={() => {
                          if (isAvailable) {
                            onTimeSlotClick(time);
                          }
                        }}
                        title={`${client.full_name} - ${time}`}
                      >
                        {isRushHour && client.avoid_rush_hour && (
                          <div className="absolute top-1 right-1">
                            <AlertTriangle className="w-3 h-3 text-amber-500" />
                          </div>
                        )}
                        {isAvailable && (
                          <div className="absolute bottom-1 right-1 text-xs opacity-0 group-hover:opacity-100">
                            <Clock className="w-3 h-3 text-gray-500" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            
            {/* Bottom spacer */}
            <div style={{ 
              height: (timeSlots.length - visibleTimeSlots.endIndex) * CELL_HEIGHT 
            }} />
          </div>
        </div>
      </div>

      {/* Legend and performance info */}
      <div className="p-4 bg-gray-50 dark:bg-gray-800 border-t dark:border-gray-700">
        <div className="flex flex-wrap items-center gap-6 text-sm">
          <div className="flex items-center">
            <div className="w-4 h-4 bg-green-50 dark:bg-green-900/20 border border-gray-200 dark:border-gray-700 rounded mr-2" />
            <span className="text-gray-600 dark:text-gray-300">Therapist Available</span>
          </div>
          <div className="flex items-center">
            <div className="w-4 h-4 bg-blue-50 dark:bg-blue-900/20 border border-gray-200 dark:border-gray-700 rounded mr-2" />
            <span className="text-gray-600 dark:text-gray-300">Client Available</span>
          </div>
          <div className="flex items-center">
            <div className="w-4 h-4 bg-red-50 dark:bg-red-900/20 border border-gray-200 dark:border-gray-700 rounded mr-2" />
            <span className="text-gray-600 dark:text-gray-300">Therapist Unavailable</span>
          </div>
          <div className="flex items-center">
            <div className="w-4 h-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded mr-2" />
            <span className="text-gray-600 dark:text-gray-300">Client Unavailable</span>
          </div>
          <div className="flex items-center">
            <AlertTriangle className="w-4 h-4 text-amber-500 mr-2" />
            <span className="text-gray-600 dark:text-gray-300">Rush Hour Warning</span>
          </div>
          <div className="flex items-center text-xs text-gray-500">
            <span>Virtual scrolling active - rendering {visibleTimeSlots.items.length} of {timeSlots.length} time slots</span>
          </div>
        </div>
      </div>
    </div>
  );
}