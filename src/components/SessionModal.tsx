import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { format, addHours, addMinutes, parseISO } from 'date-fns';
import { 
  X, AlertCircle, Calendar, Clock, User, 
  FileText, CheckCircle2, AlertTriangle, Info
} from 'lucide-react';
import type { Session, Therapist, Client } from '../types';
import { checkSchedulingConflicts, suggestAlternativeTimes, type Conflict, type AlternativeTime } from '../lib/conflicts';
import { cn, typography, patterns } from '../lib/design-system';
import AlternativeTimes from './AlternativeTimes';
import Modal, { ModalBody, ModalFooter } from './ui/Modal';
import Button from './ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';

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
  const [showDetails, setShowDetails] = useState(false);
  
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

  const resetForm = () => {
    const defaultValues = {
      therapist_id: session?.therapist_id || '',
      client_id: session?.client_id || '',
      start_time: getDefaultStartTime(),
      end_time: session?.end_time || (selectedDate && selectedTime ? 
        getDefaultEndTime(`${format(selectedDate, 'yyyy-MM-dd')}T${selectedTime}`) : ''),
      notes: session?.notes || '',
      status: session?.status || 'scheduled',
    };
    
    Object.entries(defaultValues).forEach(([key, value]) => {
      setValue(key as keyof typeof defaultValues, value);
    });
  };

  const statusOptions = [
    { value: 'scheduled', label: 'Scheduled', color: 'text-primary-600' },
    { value: 'completed', label: 'Completed', color: 'text-success-600' },
    { value: 'cancelled', label: 'Cancelled', color: 'text-error-600' },
    { value: 'no-show', label: 'No Show', color: 'text-warning-600' },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={session ? 'Edit Session' : 'New Session'}
      size="xl"
      className="max-w-2xl"
    >
      <ModalBody className="space-y-6">
        {/* Quick Info Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="flex items-center text-sm text-gray-500 dark:text-gray-400">
              <Calendar className="h-4 w-4 mr-2" />
              {selectedDate ? format(selectedDate, 'EEEE, MMMM d, yyyy') : 'Select date'}
            </div>
            {selectedTime && (
              <div className="flex items-center text-sm text-gray-500 dark:text-gray-400">
                <Clock className="h-4 w-4 mr-2" />
                {selectedTime}
              </div>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowDetails(!showDetails)}
          >
            {showDetails ? 'Hide' : 'Show'} Details
          </Button>
        </div>

        {/* Conflicts Alert */}
        {conflicts.length > 0 && (
          <Card variant="bordered" className="border-warning-200 bg-warning-50 dark:bg-warning-900/20">
            <CardContent className="p-4">
              <div className="flex items-start">
                <AlertTriangle className="h-5 w-5 text-warning-600 mr-3 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <h4 className="font-medium text-warning-800 dark:text-warning-200 mb-2">
                    Scheduling Conflicts
                  </h4>
                  <ul className="space-y-1 text-sm text-warning-700 dark:text-warning-300">
                    {conflicts.map((conflict, index) => (
                      <li key={index} className="flex items-start">
                        <span className="w-2 h-2 bg-warning-400 rounded-full mr-2 mt-1.5 flex-shrink-0" />
                        {conflict.message}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <form id="session-form" onSubmit={handleSubmit(handleFormSubmit)} className="space-y-6">
          {/* Participant Selection */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className={patterns['form-group']}>
              <label htmlFor="therapist-select" className={patterns['form-label']}>
                Therapist *
              </label>
              <select
                id="therapist-select"
                {...register('therapist_id', { required: 'Please select a therapist' })}
                className={cn(
                  patterns['form-input'],
                  'dark:bg-dark dark:border-gray-600 dark:text-gray-200',
                  errors.therapist_id && 'border-error-300 focus:border-error-500 focus:ring-error-500'
                )}
              >
                <option value="">Select a therapist</option>
                {therapists.map(therapist => (
                  <option key={therapist.id} value={therapist.id}>
                    {therapist.full_name}
                  </option>
                ))}
              </select>
              {errors.therapist_id && (
                <p className={patterns['form-error']}>{errors.therapist_id.message}</p>
              )}
            </div>

            <div className={patterns['form-group']}>
              <label htmlFor="client-select" className={patterns['form-label']}>
                Client *
              </label>
              <select
                id="client-select"
                {...register('client_id', { required: 'Please select a client' })}
                className={cn(
                  patterns['form-input'],
                  'dark:bg-dark dark:border-gray-600 dark:text-gray-200',
                  errors.client_id && 'border-error-300 focus:border-error-500 focus:ring-error-500'
                )}
              >
                <option value="">Select a client</option>
                {clients.map(client => (
                  <option key={client.id} value={client.id}>
                    {client.full_name}
                  </option>
                ))}
              </select>
              {errors.client_id && (
                <p className={patterns['form-error']}>{errors.client_id.message}</p>
              )}
            </div>
          </div>

          {/* Selected Participants Info */}
          {selectedTherapist && selectedClient && (
            <Card variant="soft" className="bg-gray-50 dark:bg-gray-800/50">
              <CardContent className="p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-primary-100 dark:bg-primary-900 rounded-full flex items-center justify-center">
                      <User className="h-5 w-5 text-primary-600 dark:text-primary-400" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white">
                        {selectedTherapist.full_name}
                      </p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {selectedTherapist.service_type.join(', ')}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-success-100 dark:bg-success-900 rounded-full flex items-center justify-center">
                      <User className="h-5 w-5 text-success-600 dark:text-success-400" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white">
                        {selectedClient.full_name}
                      </p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {selectedClient.service_preference.join(', ')}
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Time Selection */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className={patterns['form-group']}>
              <label htmlFor="start-time-input" className={patterns['form-label']}>
                Start Time *
              </label>
              <div className="relative">
                <Clock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="datetime-local"
                  id="start-time-input"
                  {...register('start_time', { required: 'Please select a start time' })}
                  className={cn(
                    patterns['form-input'],
                    'pl-10 dark:bg-dark dark:border-gray-600 dark:text-gray-200',
                    errors.start_time && 'border-error-300 focus:border-error-500 focus:ring-error-500'
                  )}
                  onChange={(e) => handleTimeChange(e, 'start_time')}
                  step="900" // 15 minutes in seconds
                />
              </div>
              {errors.start_time && (
                <p className={patterns['form-error']}>{errors.start_time.message}</p>
              )}
            </div>

            <div className={patterns['form-group']}>
              <label htmlFor="end-time-input" className={patterns['form-label']}>
                End Time *
              </label>
              <div className="relative">
                <Clock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="datetime-local"
                  id="end-time-input"
                  {...register('end_time', { required: 'Please select an end time' })}
                  className={cn(
                    patterns['form-input'],
                    'pl-10 dark:bg-dark dark:border-gray-600 dark:text-gray-200',
                    errors.end_time && 'border-error-300 focus:border-error-500 focus:ring-error-500'
                  )}
                  onChange={(e) => handleTimeChange(e, 'end_time')}
                  step="900" // 15 minutes in seconds
                />
              </div>
              {errors.end_time && (
                <p className={patterns['form-error']}>{errors.end_time.message}</p>
              )}
            </div>
          </div>

          {/* Alternative Times */}
          {conflicts.length > 0 && (
            <AlternativeTimes 
              alternatives={alternativeTimes}
              isLoading={isLoadingAlternatives}
              onSelectTime={handleSelectAlternativeTime}
            />
          )}

          {/* Status and Notes */}
          <div className="space-y-4">
            <div className={patterns['form-group']}>
              <label htmlFor="status-select" className={patterns['form-label']}>
                Status
              </label>
              <select
                id="status-select"
                {...register('status')}
                className={cn(
                  patterns['form-input'],
                  'dark:bg-dark dark:border-gray-600 dark:text-gray-200'
                )}
              >
                {statusOptions.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className={patterns['form-group']}>
              <label htmlFor="notes-input" className={patterns['form-label']}>
                Session Notes
              </label>
              <textarea
                id="notes-input"
                {...register('notes')}
                rows={3}
                className={cn(
                  patterns['form-input'],
                  'dark:bg-dark dark:border-gray-600 dark:text-gray-200',
                  'resize-vertical'
                )}
                placeholder="Add any session notes here..."
              />
              <p className={patterns['form-help']}>
                Optional notes about the session, preparation, or follow-up
              </p>
            </div>
          </div>

          {/* Additional Details */}
          {showDetails && (
            <Card variant="bordered">
              <CardHeader>
                <CardTitle as="h4">Additional Details</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 text-sm">
                  <div className="flex items-center text-gray-600 dark:text-gray-400">
                    <Info className="h-4 w-4 mr-2" />
                    Sessions are scheduled in 15-minute intervals
                  </div>
                  <div className="flex items-center text-gray-600 dark:text-gray-400">
                    <Info className="h-4 w-4 mr-2" />
                    Conflicts are automatically checked against therapist and client availability
                  </div>
                  <div className="flex items-center text-gray-600 dark:text-gray-400">
                    <Info className="h-4 w-4 mr-2" />
                    All times are displayed in your local timezone
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </form>
      </ModalBody>

      <ModalFooter>
        <Button
          variant="outline"
          onClick={onClose}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button
          variant="outline"
          onClick={resetForm}
          disabled={isSubmitting}
        >
          Reset
        </Button>
        <Button
          type="submit"
          form="session-form"
          isLoading={isSubmitting}
          loadingText="Saving..."
          leftIcon={<CheckCircle2 className="h-4 w-4" />}
        >
          {session ? 'Update Session' : 'Create Session'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}