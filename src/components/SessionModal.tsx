import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { format, addHours, addMinutes, parseISO } from 'date-fns';
import { 
  X, AlertCircle, Calendar, Clock, User, 
  FileText, CheckCircle2, AlertTriangle 
} from 'lucide-react';
import type { Session, Therapist, Client } from '../types';
import { checkSchedulingConflicts, suggestAlternativeTimes, type Conflict, type AlternativeTime } from '../lib/conflicts';
import AlternativeTimes from './AlternativeTimes';

interface SessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Partial<Session>) => Promise<void>;
  session?: Session;
  selectedDate?: Date;
  selectedTime?: string;
  therapists: Therapist[];
  clients: Client[];
  existingSessions: Session[];
}

export default function SessionModal({
  isOpen,
  onClose,
  onSubmit,
  session,
  selectedDate,
  selectedTime,
  therapists,
  clients,
  existingSessions,
}: SessionModalProps) {
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [alternativeTimes, setAlternativeTimes] = useState<AlternativeTime[]>([]);
  const [isLoadingAlternatives, setIsLoadingAlternatives] = useState(false);
  
  // Calculate default end time (15-minute intervals)
  const getDefaultEndTime = (startTimeStr: string) => {
    if (!startTimeStr) return '';
    
    const startTime = parseISO(startTimeStr);
    // Default to 1 hour session
    const endTime = addMinutes(startTime, 60);
    return format(endTime, "yyyy-MM-dd'T'HH:mm");
  };
  
  // Prepare default start time from selectedDate and selectedTime
  const getDefaultStartTime = () => {
    if (selectedDate && selectedTime) {
      return `${format(selectedDate, 'yyyy-MM-dd')}T${selectedTime}`;
    }
    return session?.start_time || '';
  };
  
  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm({
    defaultValues: {
      therapist_id: session?.therapist_id || '',
      client_id: session?.client_id || '',
      start_time: getDefaultStartTime(),
      end_time: session?.end_time || (selectedDate && selectedTime ? 
        getDefaultEndTime(`${format(selectedDate, 'yyyy-MM-dd')}T${selectedTime}`) : ''),
      notes: session?.notes || '',
      status: session?.status || 'scheduled',
    },
  });

  const startTime = watch('start_time');
  const endTime = watch('end_time');
  const therapistId = watch('therapist_id');
  const clientId = watch('client_id');

  const selectedTherapist = therapists.find(t => t.id === therapistId);
  const selectedClient = clients.find(c => c.id === clientId);

  useEffect(() => {
    if (startTime && therapistId && clientId) {
      // When start time changes, set end time to be 1 hour later by default
      // but ensure it's on a 15-minute interval
      const startDate = new Date(startTime);
      const endDate = addHours(startDate, 1);
      
      // Round to nearest 15 minutes
      const minutes = endDate.getMinutes();
      const roundedMinutes = Math.ceil(minutes / 15) * 15;
      const adjustedEndDate = new Date(endDate);
      adjustedEndDate.setMinutes(roundedMinutes % 60);
      if (roundedMinutes >= 60) {
        adjustedEndDate.setHours(endDate.getHours() + Math.floor(roundedMinutes / 60));
      }
      
      setValue('end_time', format(adjustedEndDate, "yyyy-MM-dd'T'HH:mm"));
    }
  }, [startTime, therapistId, clientId, setValue]);

  useEffect(() => {
    const checkConflicts = async () => {
      if (startTime && endTime && therapistId && clientId) {
        const therapist = therapists.find(t => t.id === therapistId);
        const client = clients.find(c => c.id === clientId);
        
        if (therapist && client) {
          const newConflicts = await checkSchedulingConflicts(
            startTime,
            endTime,
            therapistId,
            clientId,
            existingSessions,
            therapist,
            client,
            session?.id
          );
          
          setConflicts(newConflicts);
          
          // If conflicts exist, suggest alternative times
          if (newConflicts.length > 0) {
            setIsLoadingAlternatives(true);
            try {
              const alternatives = await suggestAlternativeTimes(
                startTime,
                endTime,
                therapistId,
                clientId,
                existingSessions,
                therapist,
                client,
                newConflicts,
                session?.id
              );
              setAlternativeTimes(alternatives);
            } catch (error) {
              console.error('Error suggesting alternative times:', error);
              setAlternativeTimes([]);
            } finally {
              setIsLoadingAlternatives(false);
            }
          } else {
            setAlternativeTimes([]);
          }
        }
      }
    };
    
    checkConflicts();
  }, [startTime, endTime, therapistId, clientId, therapists, clients, existingSessions, session?.id]);

  const handleFormSubmit = async (data: Partial<Session>) => {
    if (conflicts.length > 0) {
      if (!window.confirm('There are scheduling conflicts. Do you want to proceed anyway?')) {
        return;
      }
    }
    await onSubmit(data);
  };

  // Function to ensure time input is on 15-minute intervals
  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>, field: 'start_time' | 'end_time') => {
    const value = e.target.value;
    if (!value) {
      setValue(field, '');
      return;
    }
    
    const date = new Date(value);
    const minutes = date.getMinutes();
    const roundedMinutes = Math.round(minutes / 15) * 15;
    
    date.setMinutes(roundedMinutes % 60);
    if (roundedMinutes >= 60) {
      date.setHours(date.getHours() + Math.floor(roundedMinutes / 60));
    }
    
    setValue(field, format(date, "yyyy-MM-dd'T'HH:mm"));
    
    // If changing start time, also update end time
    if (field === 'start_time') {
      const endDate = addHours(date, 1);
      setValue('end_time', format(endDate, "yyyy-MM-dd'T'HH:mm"));
    }
  };

  const handleSelectAlternativeTime = (newStartTime: string, newEndTime: string) => {
    setValue('start_time', newStartTime);
    setValue('end_time', newEndTime);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-dark-lighter rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white flex items-center">
            <Calendar className="w-6 h-6 mr-2 text-blue-600" />
            {session ? 'Edit Session' : 'New Session'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-400 p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          <form id="session-form" onSubmit={handleSubmit(handleFormSubmit)} className="space-y-6">
            {conflicts.length > 0 && (
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/30 rounded-lg p-4">
                <div className="flex items-center mb-2">
                  <AlertTriangle className="w-5 h-5 text-amber-500 dark:text-amber-400 mr-2 flex-shrink-0" />
                  <h3 className="font-medium text-amber-800 dark:text-amber-200">
                    Scheduling Conflicts
                  </h3>
                </div>
                <ul className="space-y-2 text-sm text-amber-700 dark:text-amber-300">
                  {conflicts.map((conflict, index) => (
                    <li key={index} className="flex items-start">
                      <AlertCircle className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0" />
                      <span>{conflict.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Therapist
                </label>
                <select
                  {...register('therapist_id', { required: 'Therapist is required' })}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:text-gray-200"
                >
                  <option value="">Select a therapist</option>
                  {therapists.map(therapist => (
                    <option key={therapist.id} value={therapist.id}>
                      {therapist.full_name}
                    </option>
                  ))}
                </select>
                {errors.therapist_id && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.therapist_id.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Client
                </label>
                <select
                  {...register('client_id', { required: 'Client is required' })}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:text-gray-200"
                >
                  <option value="">Select a client</option>
                  {clients.map(client => (
                    <option key={client.id} value={client.id}>
                      {client.full_name}
                    </option>
                  ))}
                </select>
                {errors.client_id && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.client_id.message}</p>
                )}
              </div>
            </div>

            {selectedTherapist && selectedClient && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div>
                  <div className="flex items-center text-sm text-gray-600 dark:text-gray-300">
                    <User className="w-4 h-4 mr-2 text-blue-500" />
                    <span>{selectedTherapist.full_name}</span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {selectedTherapist.service_type.join(', ')}
                  </div>
                </div>
                <div>
                  <div className="flex items-center text-sm text-gray-600 dark:text-gray-300">
                    <User className="w-4 h-4 mr-2 text-green-500" />
                    <span>{selectedClient.full_name}</span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {selectedClient.service_preference.join(', ')}
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Start Time
                </label>
                <div className="relative">
                  <Clock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="datetime-local"
                    {...register('start_time', { required: 'Start time is required' })}
                    className="w-full pl-10 rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:text-gray-200"
                    onChange={(e) => handleTimeChange(e, 'start_time')}
                    step="900" // 15 minutes in seconds
                  />
                </div>
                {errors.start_time && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.start_time.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  End Time
                </label>
                <div className="relative">
                  <Clock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="datetime-local"
                    {...register('end_time', { required: 'End time is required' })}
                    className="w-full pl-10 rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:text-gray-200"
                    onChange={(e) => handleTimeChange(e, 'end_time')}
                    step="900" // 15 minutes in seconds
                  />
                </div>
                {errors.end_time && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.end_time.message}</p>
                )}
              </div>
            </div>

            {/* Alternative Times Section */}
            {conflicts.length > 0 && (
              <AlternativeTimes 
                alternatives={alternativeTimes}
                isLoading={isLoadingAlternatives}
                onSelectTime={handleSelectAlternativeTime}
              />
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Status
              </label>
              <select
                {...register('status')}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:text-gray-200"
              >
                <option value="scheduled">Scheduled</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
                <option value="no-show">No Show</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                <FileText className="w-4 h-4 inline mr-2" />
                Notes
              </label>
              <textarea
                {...register('notes')}
                rows={3}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:text-gray-200"
                placeholder="Add any session notes here..."
              />
            </div>
          </form>
        </div>

        {/* Footer */}
        <div className="border-t dark:border-gray-700 p-4">
          <div className="flex flex-col-reverse sm:flex-row justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="w-full sm:w-auto px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-dark border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="session-form"
              disabled={isSubmitting}
              className="w-full sm:w-auto px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
            >
              {isSubmitting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2" />
                  Saving...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  {session ? 'Update Session' : 'Create Session'}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}