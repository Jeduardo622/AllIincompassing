import React, { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO, startOfWeek, addDays, endOfWeek } from 'date-fns';
import { 
  Calendar as CalendarIcon, 
  ChevronLeft, 
  ChevronRight, 
  Clock, 
  Plus, 
  Edit2, 
  Trash2,
  Wand2 
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Session, Therapist, Client } from '../types';
import SessionModal from '../components/SessionModal';
import AutoScheduleModal from '../components/AutoScheduleModal';
import AvailabilityOverlay from '../components/AvailabilityOverlay';
import SessionFilters from '../components/SessionFilters';
import SchedulingMatrix from '../components/SchedulingMatrix';
import { useDebounce } from '../lib/performance';

// Memoized time slot component
const TimeSlot = React.memo(({ 
  time, 
  day, 
  sessions, 
  onCreateSession, 
  onEditSession 
}: {
  time: string;
  day: Date;
  sessions: Session[];
  onCreateSession: (timeSlot: { date: Date; time: string }) => void;
  onEditSession: (session: Session) => void;
}) => {
  const handleTimeSlotClick = useCallback(() => {
    onCreateSession({ date: day, time });
  }, [day, time, onCreateSession]);

  const handleSessionClick = useCallback((e: React.MouseEvent, session: Session) => {
    e.stopPropagation();
    onEditSession(session);
  }, [onEditSession]);

  // Filter sessions for this time slot
  const daySessions = useMemo(() => 
    sessions.filter(session => 
      format(parseISO(session.start_time), 'yyyy-MM-dd HH:mm') === 
      `${format(day, 'yyyy-MM-dd')} ${time}`
    ), [sessions, day, time]
  );

  return (
    <div
      className="h-10 border-b dark:border-gray-700 border-r dark:border-gray-700 p-2 relative group cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
      onClick={handleTimeSlotClick}
    >
      <button className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-opacity">
        <Plus className="w-4 h-4 text-gray-500 dark:text-gray-400" />
      </button>

      {daySessions.map(session => (
        <div
          key={session.id}
          className="bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 rounded p-1 text-xs mb-1 group/session relative cursor-pointer hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
          onClick={(e) => handleSessionClick(e, session)}
        >
          <div className="font-medium truncate">
            {session.client?.full_name}
          </div>
          <div className="text-blue-600 dark:text-blue-300 truncate">
            {session.therapist?.full_name}
          </div>
          <div className="flex items-center text-blue-500 dark:text-blue-400">
            <Clock className="w-3 h-3 mr-1" />
            {format(parseISO(session.start_time), 'h:mm a')}
          </div>
          
          <div className="absolute top-1 right-1 opacity-0 group-hover/session:opacity-100 flex space-x-1">
            <button 
              className="p-1 rounded hover:bg-blue-300 dark:hover:bg-blue-800"
              onClick={(e) => {
                e.stopPropagation();
                onEditSession(session);
              }}
            >
              <Edit2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
});

TimeSlot.displayName = 'TimeSlot';

// Memoized day column component
const DayColumn = React.memo(({ 
  day, 
  timeSlots, 
  sessions, 
  onCreateSession, 
  onEditSession,
  showAvailability,
  therapists,
  clients 
}: {
  day: Date;
  timeSlots: string[];
  sessions: Session[];
  onCreateSession: (timeSlot: { date: Date; time: string }) => void;
  onEditSession: (session: Session) => void;
  showAvailability: boolean;
  therapists: Therapist[];
  clients: Client[];
}) => {
  return (
    <div className="relative">
      {showAvailability && (
        <AvailabilityOverlay
          therapists={therapists}
          clients={clients}
          selectedDate={day}
          timeSlots={timeSlots}
        />
      )}
      
      {timeSlots.map(time => (
        <TimeSlot
          key={time}
          time={time}
          day={day}
          sessions={sessions}
          onCreateSession={onCreateSession}
          onEditSession={onEditSession}
        />
      ))}
    </div>
  );
});

DayColumn.displayName = 'DayColumn';

// Memoized week view component
const WeekView = React.memo(({ 
  weekDays, 
  timeSlots, 
  sessions, 
  onCreateSession, 
  onEditSession,
  showAvailability,
  therapists,
  clients 
}: {
  weekDays: Date[];
  timeSlots: string[];
  sessions: Session[];
  onCreateSession: (timeSlot: { date: Date; time: string }) => void;
  onEditSession: (session: Session) => void;
  showAvailability: boolean;
  therapists: Therapist[];
  clients: Client[];
}) => {
  return (
    <div className="bg-white dark:bg-dark-lighter rounded-lg shadow overflow-x-auto">
      <div className="grid grid-cols-7 border-b dark:border-gray-700 min-w-[800px]">
        <div className="py-4 px-2 text-center text-sm font-medium text-gray-500 dark:text-gray-400 border-r dark:border-gray-700">
          Time
        </div>
        {weekDays.map(day => (
          <div
            key={day.toISOString()}
            className="py-4 px-2 text-center text-sm font-medium text-gray-900 dark:text-white"
          >
            {format(day, 'EEE MMM d')}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 min-w-[800px]">
        <div className="border-r dark:border-gray-700">
          {timeSlots.map(time => (
            <div
              key={time}
              className="h-10 border-b dark:border-gray-700 p-2 text-sm text-gray-500 dark:text-gray-400 flex items-center"
            >
              {time}
            </div>
          ))}
        </div>

        {weekDays.map(day => (
          <DayColumn
            key={day.toISOString()}
            day={day}
            timeSlots={timeSlots}
            sessions={sessions}
            onCreateSession={onCreateSession}
            onEditSession={onEditSession}
            showAvailability={showAvailability}
            therapists={therapists}
            clients={clients}
          />
        ))}
      </div>
    </div>
  );
});

WeekView.displayName = 'WeekView';

// Memoized day view component
const DayView = React.memo(({ 
  selectedDate, 
  timeSlots, 
  sessions, 
  onCreateSession, 
  onEditSession,
  showAvailability,
  therapists,
  clients 
}: {
  selectedDate: Date;
  timeSlots: string[];
  sessions: Session[];
  onCreateSession: (timeSlot: { date: Date; time: string }) => void;
  onEditSession: (session: Session) => void;
  showAvailability: boolean;
  therapists: Therapist[];
  clients: Client[];
}) => {
  return (
    <div className="bg-white dark:bg-dark-lighter rounded-lg shadow overflow-x-auto" data-testid="day-view">
      <div className="grid grid-cols-2 border-b dark:border-gray-700">
        <div className="py-4 px-2 text-center text-sm font-medium text-gray-500 dark:text-gray-400 border-r dark:border-gray-700">
          Time
        </div>
        <div className="py-4 px-2 text-center text-sm font-medium text-gray-900 dark:text-white">
          {format(selectedDate, 'EEEE, MMMM d, yyyy')}
        </div>
      </div>

      <div className="grid grid-cols-2">
        <div className="border-r dark:border-gray-700">
          {timeSlots.map(time => (
            <div
              key={time}
              className="h-10 border-b dark:border-gray-700 p-2 text-sm text-gray-500 dark:text-gray-400 flex items-center"
            >
              {time}
            </div>
          ))}
        </div>

        <div className="relative">
          {showAvailability && (
            <AvailabilityOverlay
              therapists={therapists}
              clients={clients}
              selectedDate={selectedDate}
              timeSlots={timeSlots}
            />
          )}
          
          {timeSlots.map(time => (
            <TimeSlot
              key={time}
              time={time}
              day={selectedDate}
              sessions={sessions}
              onCreateSession={onCreateSession}
              onEditSession={onEditSession}
            />
          ))}
        </div>
      </div>
    </div>
  );
});

DayView.displayName = 'DayView';

const Schedule = React.memo(() => {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [view, setView] = useState<'day' | 'week' | 'matrix'>('week');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAutoScheduleModalOpen, setIsAutoScheduleModalOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState<Session | undefined>();
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<{ date: Date; time: string } | undefined>();
  const [showAvailability, setShowAvailability] = useState(true);
  const [selectedTherapist, setSelectedTherapist] = useState<string | null>(null);
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  
  const queryClient = useQueryClient();

  // Memoized date calculations
  const weekStart = useMemo(() => startOfWeek(selectedDate, { weekStartsOn: 1 }), [selectedDate]);
  const weekEnd = useMemo(() => endOfWeek(selectedDate, { weekStartsOn: 1 }), [selectedDate]);

  // Debounce filter changes
  const debouncedTherapist = useDebounce(selectedTherapist, 300);
  const debouncedClient = useDebounce(selectedClient, 300);

  // Fetch sessions with optimized caching
  const { data: sessions = [], isLoading: isLoadingSessions } = useQuery({
    queryKey: ['sessions', format(weekStart, 'yyyy-MM-dd'), format(weekEnd, 'yyyy-MM-dd'), debouncedTherapist, debouncedClient],
    queryFn: async () => {
      let query = supabase
        .from('sessions')
        .select(`
          *,
          therapist:therapists(id, full_name),
          client:clients(id, full_name)
        `)
        .gte('start_time', weekStart.toISOString())
        .lte('start_time', weekEnd.toISOString())
        .order('start_time');

      if (debouncedTherapist) {
        query = query.eq('therapist_id', debouncedTherapist);
      }

      if (debouncedClient) {
        query = query.eq('client_id', debouncedClient);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    staleTime: 2 * 60 * 1000, // 2 minutes for schedule data
  });

  // Fetch therapists and clients with longer cache time
  const { data: therapists = [], isLoading: isLoadingTherapists } = useQuery({
    queryKey: ['therapists'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('therapists')
        .select('*')
        .order('full_name');
      
      if (error) throw error;
      return data || [];
    },
    staleTime: 10 * 60 * 1000, // 10 minutes for therapist data
  });

  const { data: clients = [], isLoading: isLoadingClients } = useQuery({
    queryKey: ['clients'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .order('full_name');
      
      if (error) throw error;
      return data || [];
    },
    staleTime: 10 * 60 * 1000, // 10 minutes for client data
  });

  // Optimized mutations with proper error handling
  const createSessionMutation = useMutation({
    mutationFn: async (newSession: Partial<Session>) => {
      const { data, error } = await supabase
        .from('sessions')
        .insert([newSession])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      setIsModalOpen(false);
      setSelectedSession(undefined);
      setSelectedTimeSlot(undefined);
    },
  });

  const createMultipleSessionsMutation = useMutation({
    mutationFn: async (newSessions: Partial<Session>[]) => {
      const { data, error } = await supabase
        .from('sessions')
        .insert(newSessions)
        .select();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      setIsAutoScheduleModalOpen(false);
    },
  });

  const updateSessionMutation = useMutation({
    mutationFn: async (updatedSession: Partial<Session>) => {
      const { data, error } = await supabase
        .from('sessions')
        .update(updatedSession)
        .eq('id', selectedSession?.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      setIsModalOpen(false);
      setSelectedSession(undefined);
    },
  });

  const deleteSessionMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const { error } = await supabase
        .from('sessions')
        .delete()
        .eq('id', sessionId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  // Memoized callbacks
  const handleCreateSession = useCallback((timeSlot: { date: Date; time: string }) => {
    setSelectedTimeSlot(timeSlot);
    setSelectedSession(undefined);
    setIsModalOpen(true);
  }, []);

  const handleEditSession = useCallback((session: Session) => {
    setSelectedSession(session);
    setSelectedTimeSlot(undefined);
    setIsModalOpen(true);
  }, []);

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    if (window.confirm('Are you sure you want to delete this session?')) {
      await deleteSessionMutation.mutateAsync(sessionId);
    }
  }, [deleteSessionMutation]);

  const handleSubmit = useCallback(async (data: Partial<Session>) => {
    if (selectedSession) {
      await updateSessionMutation.mutateAsync(data);
    } else {
      await createSessionMutation.mutateAsync(data);
    }
  }, [selectedSession, updateSessionMutation, createSessionMutation]);

  const handleAutoSchedule = useCallback(async (sessions: Partial<Session>[]) => {
    await createMultipleSessionsMutation.mutateAsync(sessions);
  }, [createMultipleSessionsMutation]);

  const handleDateNavigation = useCallback((direction: 'prev' | 'next') => {
    setSelectedDate(d => {
      // If in day view, move by 1 day; otherwise, move by 7 days (week)
      const daysToAdd = view === 'day' ? 1 : 7;
      return addDays(d, direction === 'prev' ? -daysToAdd : daysToAdd);
    });
  }, [view]);

  const handleViewChange = useCallback((newView: 'day' | 'week' | 'matrix') => {
    setView(newView);
  }, []);

  const toggleAvailability = useCallback(() => {
    setShowAvailability(prev => !prev);
  }, []);

  // Memoized time slots generation
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

  // Memoized week days generation
  const weekDays = useMemo(() => {
    return Array.from({ length: 6 }, (_, i) => // Monday to Saturday
      addDays(weekStart, i)
    );
  }, [weekStart]);

  // Memoized date range display
  const dateRangeDisplay = useMemo(() => {
    if (view === 'day') {
      return format(selectedDate, 'MMMM d, yyyy');
    }
    return `${format(weekStart, 'MMM d')} - ${format(addDays(weekStart, 5), 'MMM d, yyyy')}`;
  }, [weekStart, selectedDate, view]);

  const isLoading = isLoadingSessions || isLoadingTherapists || isLoadingClients;

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="h-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Schedule</h1>
        
        <div className="flex items-center space-x-4">
          <button
            onClick={() => setIsAutoScheduleModalOpen(true)}
            className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-md shadow-sm hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 flex items-center transition-colors"
          >
            <Wand2 className="w-4 h-4 mr-2" />
            Auto Schedule
          </button>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => handleDateNavigation('prev')}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            
            <div className="flex items-center space-x-2">
              <CalendarIcon className="w-5 h-5 text-gray-500 dark:text-gray-400" />
              <span className="font-medium text-gray-900 dark:text-white min-w-[200px] text-center">
                {dateRangeDisplay}
              </span>
            </div>

            <button
              onClick={() => handleDateNavigation('next')}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          <div className="flex rounded-lg shadow-sm">
            <button
              onClick={() => handleViewChange('day')}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                view === 'day'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-dark-lighter text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
              } border border-gray-300 dark:border-gray-600 rounded-l-lg`}
            >
              Day
            </button>
            <button
              onClick={() => handleViewChange('week')}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                view === 'week'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-dark-lighter text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
              } border-t border-b border-gray-300 dark:border-gray-600`}
            >
              Week
            </button>
            <button
              onClick={() => handleViewChange('matrix')}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                view === 'matrix'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-dark-lighter text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
              } border border-gray-300 dark:border-gray-600 rounded-r-lg`}
            >
              Matrix
            </button>
          </div>

          <button
            onClick={toggleAvailability}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              showAvailability
                ? 'bg-green-600 text-white'
                : 'bg-white dark:bg-dark-lighter text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
            } border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm`}
          >
            Show Availability
          </button>
        </div>
      </div>

      <SessionFilters
        therapists={therapists}
        clients={clients}
        selectedTherapist={selectedTherapist}
        selectedClient={selectedClient}
        onTherapistChange={setSelectedTherapist}
        onClientChange={setSelectedClient}
      />

      {view === 'matrix' ? (
        <SchedulingMatrix
          therapists={therapists}
          clients={clients}
          selectedDate={selectedDate}
          onTimeSlotClick={(time) => handleCreateSession({ date: selectedDate, time })}
        />
      ) : view === 'day' ? (
        <DayView
          selectedDate={selectedDate}
          timeSlots={timeSlots}
          sessions={sessions.filter(session => 
            format(parseISO(session.start_time), 'yyyy-MM-dd') === format(selectedDate, 'yyyy-MM-dd')
          )}
          onCreateSession={handleCreateSession}
          onEditSession={handleEditSession}
          showAvailability={showAvailability}
          therapists={therapists}
          clients={clients}
        />
      ) : (
        <WeekView
          weekDays={weekDays}
          timeSlots={timeSlots}
          sessions={sessions}
          onCreateSession={handleCreateSession}
          onEditSession={handleEditSession}
          showAvailability={showAvailability}
          therapists={therapists}
          clients={clients}
        />
      )}

      {isModalOpen && (
        <SessionModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSubmit={handleSubmit}
          session={selectedSession}
          selectedDate={selectedTimeSlot?.date}
          selectedTime={selectedTimeSlot?.time}
          therapists={therapists}
          clients={clients}
          existingSessions={sessions}
        />
      )}

      {isAutoScheduleModalOpen && (
        <AutoScheduleModal
          isOpen={isAutoScheduleModalOpen}
          onClose={() => setIsAutoScheduleModalOpen(false)}
          onSchedule={handleAutoSchedule}
          therapists={therapists}
          clients={clients}
          existingSessions={sessions}
        />
      )}
    </div>
  );
});

Schedule.displayName = 'Schedule';

export default Schedule;