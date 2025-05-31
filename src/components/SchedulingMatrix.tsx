import React, { useMemo } from 'react';
import { format } from 'date-fns';
import { MapPin, Clock, AlertTriangle } from 'lucide-react';
import type { Therapist, Client } from '../types';
import { getDistance } from 'geolib';

interface SchedulingMatrixProps {
  therapists: Therapist[];
  clients: Client[];
  selectedDate: Date;
  onTimeSlotClick: (time: string) => void;
}

export default function SchedulingMatrix({
  therapists,
  clients,
  selectedDate,
  onTimeSlotClick,
}: SchedulingMatrixProps) {
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

  const dayName = format(selectedDate, 'EEEE').toLowerCase();

  // Calculate travel times and distances
  const travelInfo = useMemo(() => {
    const info = new Map<string, {
      distance: number;
      travelTime: number;
      isRushHour: boolean;
    }>();

    therapists.forEach(therapist => {
      if (therapist.latitude && therapist.longitude) {
        clients.forEach(client => {
          if (client.latitude && client.longitude) {
            const key = `${therapist.id}-${client.id}`;
            const distance = getDistance(
              { latitude: therapist.latitude, longitude: therapist.longitude },
              { latitude: client.latitude, longitude: client.longitude }
            ) / 1000; // Convert to km

            // Estimate travel time (assuming average speed of 30 km/h)
            let travelTime = (distance / 30) * 60; // minutes

            // Check for rush hour (8-9 AM and 4-6 PM)
            const isRushHour = timeSlots.some(time => {
              const hour = parseInt(time.split(':')[0]);
              return (hour >= 8 && hour <= 9) || (hour >= 16 && hour <= 18);
            });

            if (isRushHour) {
              travelTime *= 1.5; // 50% longer during rush hour
            }

            info.set(key, {
              distance,
              travelTime,
              isRushHour
            });
          }
        });
      }
    });

    return info;
  }, [therapists, clients, timeSlots]);

  const availabilityMap = useMemo(() => {
    const map = new Map<string, { therapists: Set<string>; clients: Set<string> }>();
    
    timeSlots.forEach(time => {
      const [hour, minute] = time.split(':').map(Number);
      const entry = { therapists: new Set<string>(), clients: Set<string>() };
      
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

  if (!therapists.length || !clients.length) {
    return (
      <div className="bg-white dark:bg-dark-lighter rounded-lg shadow p-8 text-center text-gray-500">
        No therapists or clients available to display in the matrix.
      </div>
    );
  }

  // Group time slots by hour for better display
  const groupedTimeSlots = useMemo(() => {
    const grouped: Record<string, string[]> = {};
    
    timeSlots.forEach(time => {
      const hour = time.split(':')[0];
      if (!grouped[hour]) {
        grouped[hour] = [];
      }
      grouped[hour].push(time);
    });
    
    return grouped;
  }, [timeSlots]);

  return (
    <div className="bg-white dark:bg-dark-lighter rounded-lg shadow overflow-hidden">
      <div className="grid grid-cols-[150px_1fr] divide-x divide-gray-200 dark:divide-gray-700">
        {/* Time slots column */}
        <div className="bg-gray-50 dark:bg-gray-800">
          <div className="h-12 flex items-center justify-center font-medium text-gray-700 dark:text-gray-300 border-b dark:border-gray-700">
            Time
          </div>
          {Object.entries(groupedTimeSlots).map(([hour, slots]) => (
            <React.Fragment key={hour}>
              {slots.map((time, index) => (
                <div
                  key={time}
                  className={`h-10 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400 ${
                    index === slots.length - 1 ? 'border-b dark:border-gray-700' : ''
                  }`}
                >
                  {time}
                </div>
              ))}
            </React.Fragment>
          ))}
        </div>

        {/* Availability grid */}
        <div className="overflow-x-auto">
          <div className="inline-grid" style={{ 
            gridTemplateColumns: `repeat(${therapists.length + clients.length}, minmax(120px, 1fr))`
          }}>
            {/* Headers */}
            {therapists.map(therapist => (
              <div
                key={therapist.id}
                className="h-12 flex items-center justify-center font-medium text-gray-700 dark:text-gray-300 border-b dark:border-gray-700 border-r dark:border-gray-700 px-2 text-center"
              >
                <div>
                  <div className="truncate">{therapist.full_name}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {(therapist.service_type ?? []).join(', ')}
                  </div>
                  {therapist.latitude && therapist.longitude && (
                    <div className="text-xs text-gray-400 dark:text-gray-500 flex items-center justify-center mt-1">
                      <MapPin className="w-3 h-3 mr-1" />
                      Service radius: {therapist.service_radius_km}km
                    </div>
                  )}
                </div>
              </div>
            ))}
            {clients.map(client => (
              <div
                key={client.id}
                className="h-12 flex items-center justify-center font-medium text-gray-700 dark:text-gray-300 border-b dark:border-gray-700 border-r dark:border-gray-700 px-2 text-center"
              >
                <div>
                  <div className="truncate">{client.full_name}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {(client.service_preference ?? []).join(', ')}
                  </div>
                  {client.latitude && client.longitude && (
                    <div className="text-xs text-gray-400 dark:text-gray-500 flex items-center justify-center mt-1">
                      <MapPin className="w-3 h-3 mr-1" />
                      Max travel: {client.max_travel_minutes}min
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Availability cells */}
            {Object.entries(groupedTimeSlots).map(([hour, slots]) => (
              <React.Fragment key={hour}>
                {slots.map(time => (
                  <React.Fragment key={time}>
                    {therapists.map(therapist => {
                      const isAvailable = availabilityMap.get(time)?.therapists.has(therapist.id);
                      const isRushHour = (parseInt(time.split(':')[0]) >= 8 && parseInt(time.split(':')[0]) <= 9) || 
                                        (parseInt(time.split(':')[0]) >= 16 && parseInt(time.split(':')[0]) <= 18);
                      
                      return (
                        <div
                          key={`${time}-${therapist.id}`}
                          className={`h-10 border-b dark:border-gray-700 border-r dark:border-gray-700 transition-colors relative ${
                            isAvailable
                              ? 'bg-green-50 dark:bg-green-900/20 hover:bg-green-100 dark:hover:bg-green-900/30 cursor-pointer'
                              : 'bg-red-50 dark:bg-red-900/20'
                          }`}
                          onClick={() => {
                            if (isAvailable) {
                              onTimeSlotClick(time);
                            }
                          }}
                        >
                          {isRushHour && therapist.avoid_rush_hour && (
                            <div className="absolute top-1 right-1">
                              <AlertTriangle className="w-4 h-4 text-amber-500" />
                            </div>
                          )}
                          {isAvailable && (
                            <div className="absolute bottom-1 right-1 text-xs text-gray-500 dark:text-gray-400">
                              <Clock className="w-3 h-3 inline-block mr-1" />
                              {time}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {clients.map(client => {
                      const isAvailable = availabilityMap.get(time)?.clients.has(client.id);
                      const isRushHour = (parseInt(time.split(':')[0]) >= 8 && parseInt(time.split(':')[0]) <= 9) || 
                                        (parseInt(time.split(':')[0]) >= 16 && parseInt(time.split(':')[0]) <= 18);
                      
                      return (
                        <div
                          key={`${time}-${client.id}`}
                          className={`h-10 border-b dark:border-gray-700 border-r dark:border-gray-700 transition-colors relative ${
                            isAvailable
                              ? 'bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30 cursor-pointer'
                              : 'bg-gray-50 dark:bg-gray-800'
                          }`}
                          onClick={() => {
                            if (isAvailable) {
                              onTimeSlotClick(time);
                            }
                          }}
                        >
                          {isRushHour && client.avoid_rush_hour && (
                            <div className="absolute top-1 right-1">
                              <AlertTriangle className="w-4 h-4 text-amber-500" />
                            </div>
                          )}
                          {isAvailable && (
                            <div className="absolute bottom-1 right-1 text-xs text-gray-500 dark:text-gray-400">
                              <Clock className="w-3 h-3 inline-block mr-1" />
                              {time}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </React.Fragment>
                ))}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

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
        </div>
      </div>
    </div>
  );
}