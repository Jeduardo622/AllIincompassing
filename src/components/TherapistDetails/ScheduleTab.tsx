import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { 
  Calendar, Clock, User, MapPin, 
  ChevronLeft, ChevronRight, Calendar as CalendarIcon,
  Plus, Edit2, Trash2
} from 'lucide-react';
import { format, addDays, startOfWeek, endOfWeek, isSameDay, parseISO } from 'date-fns';
import { supabase } from '../../lib/supabase';

interface ScheduleTabProps {
  therapist: any;
}

export default function ScheduleTab({ therapist }: ScheduleTabProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<'day' | 'week'>('week');
  
  // Calculate week start and end dates
  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 });
  
  // Today's date for highlighting
  const today = new Date();
  const isToday = (date: Date) => format(date, 'yyyy-MM-dd') === format(today, 'yyyy-MM-dd');
  
  // Fetch sessions for this therapist
  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ['therapist-sessions', therapist.id, format(weekStart, 'yyyy-MM-dd'), format(weekEnd, 'yyyy-MM-dd')],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sessions')
        .select(`
          *,
          client:clients(id, full_name)
        `)
        .eq('therapist_id', therapist.id)
        .gte('start_time', weekStart.toISOString())
        .lte('start_time', weekEnd.toISOString())
        .order('start_time');
        
      if (error) throw error;
      return data || [];
    },
  });
  
  // Generate time slots (8 AM to 6 PM in 30-minute intervals)
  const timeSlots = Array.from({ length: 20 }, (_, i) => {
    const hour = Math.floor(i / 2) + 8;
    const minute = (i % 2) * 30;
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  });
  
  // Generate days of the week
  const weekDays = Array.from({ length: 6 }, (_, i) => // Monday to Saturday
    addDays(weekStart, i)
  );
  
  // Navigate to previous/next week
  const goToPreviousWeek = () => {
    setCurrentDate(prev => addDays(prev, -7));
  };
  
  const goToNextWeek = () => {
    setCurrentDate(prev => addDays(prev, 7));
  };
  
  // Set date to today
  const goToToday = () => {
    setCurrentDate(new Date());
  };
  
  // Get sessions for a specific day and time
  const getSessionsForTimeSlot = (day: Date, timeSlot: string) => {
    const [hour, minute] = timeSlot.split(':').map(Number);
    
    return sessions.filter(session => {
      const sessionDate = parseISO(session.start_time);
      const sessionHour = sessionDate.getHours();
      const sessionMinute = sessionDate.getMinutes();
      
      return (
        isSameDay(sessionDate, day) &&
        sessionHour === hour &&
        sessionMinute === minute
      );
    });
  };
  
  // Get status color
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-200';
      case 'cancelled':
        return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-200';
      case 'no-show':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200';
      default:
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-200';
    }
  };
  
  if (isLoading) {
    return (  
      <div className="flex justify-center items-center py-20">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
        <span className="ml-3 text-gray-600 dark:text-gray-300">Loading schedule...</span>
      </div>
    );
  }
  
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <button
            onClick={goToPreviousWeek}
            className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="Previous week"
          >
            <ChevronLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </button>
          
          <h2 className="text-lg font-medium text-gray-900 dark:text-white px-2">
            {format(weekStart, 'MMM d')} - {format(weekEnd, 'MMM d, yyyy')}
          </h2>
          
          <button
            onClick={goToNextWeek}
            className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="Next week"
          >
            <ChevronRight className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </button>
          
          <button
            onClick={goToToday}
            className="ml-2 px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-md flex items-center hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <CalendarIcon className="w-4 h-4 mr-1 text-blue-600 dark:text-blue-400" />
            Today
          </button>
        </div>
        
        <div className="flex space-x-2">
          <button
            onClick={() => setView('day')}
            className={`px-3 py-1 text-sm rounded-md ${
              view === 'day'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
            }`}
          >
            Day
          </button>
          <button
            onClick={() => setView('week')}
            className={`px-3 py-1 text-sm rounded-md ${
              view === 'week'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
            }`}
          >
            Week
          </button>
        </div>
      </div>
      
      <div className="bg-white dark:bg-dark-lighter rounded-lg shadow overflow-x-auto">
        <div className="grid grid-cols-7 border-b dark:border-gray-700 min-w-[800px]">
          <div className="py-3 px-2 text-center text-sm font-medium text-gray-500 dark:text-gray-400 border-r dark:border-gray-700">
            Time
          </div>
          {weekDays.map((day) => (
            <div
              key={day.toISOString()}
              className={`py-3 px-2 text-center text-sm font-medium ${
                isToday(day) 
                  ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300' 
                  : 'text-gray-900 dark:text-white'
              }`}
            >
              {format(day, "EEE MMM d")}
            </div>
          ))}
        </div>
        
        <div className="grid grid-cols-7">
          <div className="border-r dark:border-gray-700">
            {timeSlots.map(time => (
              <div
                key={time}
                className="h-16 border-b dark:border-gray-700 p-2 text-sm text-gray-500 dark:text-gray-400"
              >
                {time}
              </div>
            ))}
          </div>
          
          {weekDays.map(day => (
            <div key={day.toISOString()} className="relative">
              {timeSlots.map(time => {
                const sessionsInSlot = getSessionsForTimeSlot(day, time);
                
                return (
                  <div
                    key={time}
                    className="h-16 border-b dark:border-gray-700 border-r dark:border-gray-700 p-2 relative"
                  >
                    {sessionsInSlot.map(session => (
                      <div
                        key={session.id}
                        className={`absolute inset-1 rounded p-1 text-xs ${getStatusColor(session.status)}`}
                      >
                        <div className="font-medium">
                          {session.client?.full_name}
                        </div>
                        <div className="flex items-center mt-1">
                          <Clock className="w-3 h-3 mr-1" />
                          {format(parseISO(session.start_time), 'h:mm a')} - 
                          {format(parseISO(session.end_time), 'h:mm a')}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      
      <div className="bg-white dark:bg-dark-lighter rounded-lg shadow p-4">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
          Weekly Availability
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Your availability for scheduling client sessions
        </p>
        
        <div className="space-y-4">
          {Object.entries(therapist.availability_hours || {}).map(([day, hours]: [string, any]) => (
            <div key={day} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <div className="font-medium text-gray-900 dark:text-white capitalize">
                {day}
              </div>
              <div className="text-gray-600 dark:text-gray-300">
                {hours.start && hours.end ? (
                  <span>
                    {hours.start} - {hours.end}
                  </span>
                ) : (
                  <span className="text-gray-400 dark:text-gray-500">Not available</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      
      <div className="bg-white dark:bg-dark-lighter rounded-lg shadow p-4">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
          Upcoming Sessions
        </h3>
        
        {sessions.length === 0 ? (
          <p className="text-center text-gray-500 dark:text-gray-400 py-4">
            No upcoming sessions scheduled
          </p>
        ) : (
          <div className="space-y-3">
            {sessions.slice(0, 5).map(session => (
              <div 
                key={session.id}
                className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
              >
                <div className="flex items-center">
                  <User className="w-5 h-5 text-blue-600 dark:text-blue-400 mr-2" />
                  <div>
                    <div className="font-medium text-gray-900 dark:text-white flex items-center">
                      {session.client?.full_name} 
                      {session.status === 'scheduled' && 
                        <span className="ml-2 px-2 py-0.5 text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300 rounded-full">
                          Upcoming
                        </span>
                      }
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      {format(parseISO(session.start_time), 'EEEE, MMMM d')}
                    </div>
                  </div>
                </div>
                <div className="flex items-center">
                  <div className="text-right mr-4">
                    <div className="font-medium text-gray-900 dark:text-white">
                      {format(parseISO(session.start_time), 'h:mm a')}
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      {format(parseISO(session.end_time), 'h:mm a')}
                    </div>
                  </div>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(session.status)}`}>
                    {session.status.charAt(0).toUpperCase() + session.status.slice(1)}
                  </span>
                </div>
                {/* Add session note preview if available */}
                {session.notes && (
                  <div className="mt-2 text-xs text-gray-600 dark:text-gray-400 border-t border-gray-100 dark:border-gray-700 pt-2">
                    {session.notes.length > 100 ? `${session.notes.substring(0, 100)}...` : session.notes}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}