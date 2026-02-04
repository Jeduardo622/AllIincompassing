import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { format, addHours, addMinutes, parseISO } from 'date-fns';
import {
  toZonedTime as utcToZonedTime,
  fromZonedTime as zonedTimeToUtc,
} from 'date-fns-tz';
import { 
  X, AlertCircle, Calendar, Clock, User, 
  FileText, CheckCircle2, AlertTriangle 
} from 'lucide-react';
import type { Session, Therapist, Client, Goal, Program } from '../types';
import { checkSchedulingConflicts, suggestAlternativeTimes, type Conflict, type AlternativeTime } from '../lib/conflicts';
import { logger } from '../lib/logger/logger';
import AlternativeTimes from './AlternativeTimes';
import { supabase } from '../lib/supabase';
import { useActiveOrganizationId } from '../lib/organization';
import { callApi } from '../lib/api';
import { showError, showSuccess } from '../lib/toast';

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
  timeZone?: string;
  defaultTherapistId?: string | null;
  defaultClientId?: string | null;
  retryHint?: string | null;
  onRetryHintDismiss?: () => void;
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
  timeZone,
  defaultTherapistId,
  defaultClientId,
  retryHint,
  onRetryHintDismiss,
}: SessionModalProps) {
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [alternativeTimes, setAlternativeTimes] = useState<AlternativeTime[]>([]);
  const [isLoadingAlternatives, setIsLoadingAlternatives] = useState(false);
  const activeOrganizationId = useActiveOrganizationId();

  const resolvedTimeZone = useMemo(() => {
    if (timeZone && timeZone.length > 0) {
      return timeZone;
    }
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
    } catch (error) {
      logger.warn('Unable to resolve user timezone', {
        error,
        context: { component: 'SessionModal', operation: 'resolveTimeZone' }
      });
      return 'UTC';
    }
  }, [timeZone]);

  const formatLocalInput = (isoString?: string | null) => {
    if (!isoString) return '';
    try {
      const date = typeof isoString === 'string' ? parseISO(isoString) : new Date(isoString);
      if (Number.isNaN(date.getTime())) return '';
      const zoned = utcToZonedTime(date, resolvedTimeZone);
      return format(zoned, "yyyy-MM-dd'T'HH:mm");
    } catch (error) {
      logger.error('Failed to format local input', {
        error,
        context: { component: 'SessionModal', operation: 'formatLocalInput' }
      });
      return '';
    }
  };

  const toUtcIsoString = (localValue?: string) => {
    if (!localValue) return '';
    try {
      return zonedTimeToUtc(localValue, resolvedTimeZone).toISOString();
    } catch (error) {
      logger.error('Failed to convert local time to UTC', {
        error,
        context: { component: 'SessionModal', operation: 'toUtcIsoString' }
      });
      return '';
    }
  };

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
    if (session?.start_time) {
      return formatLocalInput(session.start_time);
    }
    return '';
  };
  
  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm({
    defaultValues: {
      therapist_id: session?.therapist_id || defaultTherapistId || '',
      client_id: session?.client_id || defaultClientId || '',
      program_id: session?.program_id || '',
      goal_id: session?.goal_id || '',
      goal_ids: session?.goal_ids || [],
      start_time: getDefaultStartTime(),
      end_time: session?.end_time
        ? formatLocalInput(session.end_time)
        : (selectedDate && selectedTime
            ? getDefaultEndTime(`${format(selectedDate, 'yyyy-MM-dd')}T${selectedTime}`)
            : ''),
      notes: session?.notes || '',
      status: session?.status || 'scheduled',
    },
  });

  const startTime = watch('start_time');
  const endTime = watch('end_time');
  const therapistId = watch('therapist_id');
  const clientId = watch('client_id');
  const programId = watch('program_id');
  const goalId = watch('goal_id');
  const goalIds = watch('goal_ids') as string[] | undefined;

  const { data: sessionDetails } = useQuery({
    queryKey: ['session-details', session?.id, activeOrganizationId ?? 'MISSING_ORG'],
    queryFn: async () => {
      if (!session?.id || !activeOrganizationId) {
        return null;
      }
      const { data, error } = await supabase
        .from('sessions')
        .select('program_id, goal_id, started_at')
        .eq('id', session.id)
        .eq('organization_id', activeOrganizationId)
        .maybeSingle();
      if (error) {
        throw error;
      }
      return data ?? null;
    },
    enabled: Boolean(session?.id && activeOrganizationId),
  });

  const { data: sessionGoalRows = [] } = useQuery({
    queryKey: ['session-goals', session?.id, activeOrganizationId ?? 'MISSING_ORG'],
    queryFn: async () => {
      if (!session?.id || !activeOrganizationId) {
        return [];
      }
      const { data, error } = await supabase
        .from('session_goals')
        .select('goal_id')
        .eq('session_id', session.id)
        .eq('organization_id', activeOrganizationId);
      if (error) {
        throw error;
      }
      return data ?? [];
    },
    enabled: Boolean(session?.id && activeOrganizationId),
  });

  const { data: programs = [] } = useQuery({
    queryKey: ['client-programs', clientId, activeOrganizationId ?? 'MISSING_ORG'],
    queryFn: async () => {
      if (!clientId || !activeOrganizationId) {
        return [];
      }
      const { data, error } = await supabase
        .from('programs')
        .select('id, name, description, status, client_id')
        .eq('client_id', clientId)
        .eq('organization_id', activeOrganizationId)
        .order('created_at', { ascending: false });
      if (error) {
        throw error;
      }
      return (data ?? []) as Program[];
    },
    enabled: Boolean(clientId && activeOrganizationId),
  });

  const { data: goals = [] } = useQuery({
    queryKey: ['program-goals', programId, activeOrganizationId ?? 'MISSING_ORG'],
    queryFn: async () => {
      if (!programId || !activeOrganizationId) {
        return [];
      }
      const { data, error } = await supabase
        .from('goals')
        .select('id, title, status, program_id')
        .eq('program_id', programId)
        .eq('organization_id', activeOrganizationId)
        .order('created_at', { ascending: false });
      if (error) {
        throw error;
      }
      return (data ?? []) as Goal[];
    },
    enabled: Boolean(programId && activeOrganizationId),
  });

  const selectedTherapist = therapists.find(t => t.id === therapistId);
  const selectedClient = clients.find(c => c.id === clientId);

  useEffect(() => {
    if (session?.therapist_id) {
      setValue('therapist_id', session.therapist_id);
    } else if (defaultTherapistId) {
      setValue('therapist_id', defaultTherapistId);
    }
  }, [session?.therapist_id, defaultTherapistId, setValue]);

  useEffect(() => {
    if (session?.client_id) {
      setValue('client_id', session.client_id);
    } else if (defaultClientId) {
      setValue('client_id', defaultClientId);
    }
  }, [session?.client_id, defaultClientId, setValue]);

  useEffect(() => {
    if (!sessionDetails) {
      return;
    }
    if (sessionDetails.program_id) {
      setValue('program_id', sessionDetails.program_id);
    }
    if (sessionDetails.goal_id) {
      setValue('goal_id', sessionDetails.goal_id);
    }
  }, [sessionDetails, setValue]);

  useEffect(() => {
    if (!sessionGoalRows || sessionGoalRows.length === 0) {
      return;
    }
    const uniqueGoals = Array.from(
      new Set(sessionGoalRows.map((row) => row.goal_id).filter((id) => typeof id === 'string'))
    );
    if (uniqueGoals.length > 0) {
      setValue('goal_ids', uniqueGoals);
    }
  }, [sessionGoalRows, setValue]);

  useEffect(() => {
    if (!programs.length || programId) {
      return;
    }
    const nextProgram = programs.find((program) => program.status === 'active') ?? programs[0];
    if (nextProgram?.id) {
      setValue('program_id', nextProgram.id);
    }
  }, [programs, programId, setValue]);

  useEffect(() => {
    if (!goals.length) {
      return;
    }
    const goalIdsSet = new Set(goals.map((goal) => goal.id));
    if (!goalId || !goalIdsSet.has(goalId)) {
      const nextGoal = goals.find((goal) => goal.status === 'active') ?? goals[0];
      if (nextGoal?.id) {
        setValue('goal_id', nextGoal.id);
      }
    }
  }, [goals, goalId, setValue]);

  useEffect(() => {
    if (!programId) {
      if (Array.isArray(goalIds) && goalIds.length > 0) {
        setValue('goal_ids', []);
      }
      return;
    }
    if (!goals.length || !Array.isArray(goalIds)) {
      return;
    }
    const allowed = new Set(goals.map((goal) => goal.id));
    const filtered = goalIds.filter((id) => allowed.has(id));
    if (filtered.length !== goalIds.length) {
      setValue('goal_ids', filtered);
    }
  }, [programId, goals, goalIds, setValue]);

  useEffect(() => {
    if (!goalId) {
      return;
    }
    const nextGoalIds = Array.isArray(goalIds) ? goalIds : [];
    if (!nextGoalIds.includes(goalId)) {
      setValue('goal_ids', [...nextGoalIds, goalId]);
    }
  }, [goalId, goalIds, setValue]);

  const toggleGoalSelection = (targetId: string) => {
    const nextGoalIds = Array.isArray(goalIds) ? [...goalIds] : [];
    if (nextGoalIds.includes(targetId)) {
      if (targetId === goalId) {
        return;
      }
      setValue('goal_ids', nextGoalIds.filter((id) => id !== targetId));
      return;
    }
    setValue('goal_ids', [...nextGoalIds, targetId]);
  };

  const previousFormValues = useRef({
    startTime,
    therapistId,
    clientId,
  });

  useEffect(() => {
    if (!onRetryHintDismiss) {
      previousFormValues.current = { startTime, therapistId, clientId };
      return;
    }

    const previous = previousFormValues.current;
    if (
      previous.startTime !== startTime ||
      previous.therapistId !== therapistId ||
      previous.clientId !== clientId
    ) {
      onRetryHintDismiss();
    }
    previousFormValues.current = { startTime, therapistId, clientId };
  }, [startTime, therapistId, clientId, onRetryHintDismiss]);

  useEffect(() => {
    if (startTime && therapistId && clientId) {
      // When start time changes, set end time to be 1 hour later by default
      // but ensure it's on a 15-minute interval
      const startUtc = zonedTimeToUtc(startTime, resolvedTimeZone);
      const endUtc = addHours(startUtc, 1);
      const endZoned = utcToZonedTime(endUtc, resolvedTimeZone);
      setValue('end_time', format(endZoned, "yyyy-MM-dd'T'HH:mm"));
    }
  }, [startTime, therapistId, clientId, resolvedTimeZone, setValue]);

  useEffect(() => {
    const checkConflicts = async () => {
      if (startTime && endTime && therapistId && clientId) {
        const therapist = therapists.find(t => t.id === therapistId);
        const client = clients.find(c => c.id === clientId);

        if (therapist && client) {
          const startUtcIso = toUtcIsoString(startTime);
          const endUtcIso = toUtcIsoString(endTime);
          let newConflicts = await checkSchedulingConflicts(
            startUtcIso,
            endUtcIso,
            therapistId,
            clientId,
            existingSessions,
            therapist,
            client,
            {
              excludeSessionId: session?.id,
              timeZone: resolvedTimeZone,
            }
          );

          // Fallback: if no conflicts detected, perform a raw time match to catch equal-slot overlaps
          if (newConflicts.length === 0) {
            try {
              const localStart = startTime; // 'yyyy-MM-ddTHH:mm'
              const localDate = localStart?.slice(0, 10);
              const localHHmm = localStart?.slice(11, 16);
              const overlapping = existingSessions.find((s) => {
                if (s.therapist_id !== therapistId && s.client_id !== clientId) return false;
                const startIso = s.start_time ?? '';
                const rawDate = typeof startIso === 'string' && startIso.length >= 10 ? startIso.slice(0, 10) : '';
                const rawHHmm = typeof startIso === 'string' && startIso.length >= 16 ? startIso.slice(11, 16) : '';
                return rawDate === localDate && rawHHmm === localHHmm;
              });
              if (overlapping) {
                const overlapStart = parseISO(overlapping.start_time);
                const overlapEnd = parseISO(overlapping.end_time);
                newConflicts = [{
                  type: 'session_overlap',
                  message: `Overlaps with existing session from ${format(overlapStart, 'h:mm a')} to ${format(overlapEnd, 'h:mm a')}`,
                }];
              }
            } catch {
              // ignore fallback parsing errors
            }
          }

          setConflicts(newConflicts);

          // If conflicts exist, suggest alternative times
          if (newConflicts.length > 0) {
            setIsLoadingAlternatives(true);
            try {
              const alternatives = await suggestAlternativeTimes(
                startUtcIso,
                endUtcIso,
                therapistId,
                clientId,
                existingSessions,
                therapist,
                client,
                newConflicts,
                {
                  excludeSessionId: session?.id,
                  timeZone: resolvedTimeZone,
                }
              );
              setAlternativeTimes(alternatives);
            } catch (error) {
              logger.error('Failed to suggest alternative times', {
                error,
                context: { component: 'SessionModal', operation: 'suggestAlternativeTimes' }
              });
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
  }, [
    startTime,
    endTime,
    therapistId,
    clientId,
    therapists,
    clients,
    existingSessions,
    session?.id,
    resolvedTimeZone,
  ]);

  const handleFormSubmit = async (data: Partial<Session>) => {
    if (conflicts.length > 0) {
      if (!window.confirm('There are scheduling conflicts. Do you want to proceed anyway?')) {
        return;
      }
    }
    try {
      const normalizedGoalIds = Array.isArray(data.goal_ids) ? data.goal_ids : [];
      const mergedGoalIds = data.goal_id && !normalizedGoalIds.includes(data.goal_id)
        ? [...normalizedGoalIds, data.goal_id]
        : normalizedGoalIds;
      const transformed: Partial<Session> = {
        ...data,
        goal_ids: mergedGoalIds,
        // If a timezone prop is provided, normalize to UTC for consumers expecting Z times
        start_time: timeZone ? toUtcIsoString(data.start_time) : data.start_time,
        end_time: timeZone ? toUtcIsoString(data.end_time) : data.end_time,
      };
      await onSubmit(transformed);
    } catch (error) {
      logger.error('Failed to submit session', {
        error,
        context: { component: 'SessionModal', operation: 'handleFormSubmit' }
      });
      return;
    }
  };

  const handleStartSession = async () => {
    if (!session?.id) {
      return;
    }
    if (!programId || !goalId) {
      showError("Select a program and primary goal before starting.");
      return;
    }
    try {
      const response = await callApi("/api/sessions-start", {
        method: "POST",
        body: JSON.stringify({
          session_id: session.id,
          program_id: programId,
          goal_id: goalId,
          goal_ids: goalIds ?? [],
        }),
      });
      if (!response.ok) {
        showError("Failed to start session");
        return;
      }
      showSuccess("Session started");
      onClose();
    } catch (error) {
      logger.error("Failed to start session", {
        error,
        context: { component: "SessionModal", operation: "handleStartSession" },
      });
      showError(error instanceof Error ? error.message : "Failed to start session");
    }
  };

  // Function to ensure time input is on 15-minute intervals
  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>, field: 'start_time' | 'end_time') => {
    const value = e.target.value;
    if (!value) {
      setValue(field, '');
      return;
    }

    const utcDate = zonedTimeToUtc(value, resolvedTimeZone);
    const minutes = utcDate.getUTCMinutes();
    const roundedMinutes = Math.round(minutes / 15) * 15;

    const adjustedUtc = new Date(utcDate);
    adjustedUtc.setUTCMinutes(roundedMinutes % 60, 0, 0);
    if (roundedMinutes >= 60) {
      adjustedUtc.setUTCHours(utcDate.getUTCHours() + Math.floor(roundedMinutes / 60));
    }

    const adjustedLocal = utcToZonedTime(adjustedUtc, resolvedTimeZone);
    setValue(field, format(adjustedLocal, "yyyy-MM-dd'T'HH:mm"));

    // If changing start time, also update end time
    if (field === 'start_time') {
      const endUtc = addHours(adjustedUtc, 1);
      const endLocal = utcToZonedTime(endUtc, resolvedTimeZone);
      setValue('end_time', format(endLocal, "yyyy-MM-dd'T'HH:mm"));
    }
  };

  const handleSelectAlternativeTime = (newStartTime: string, newEndTime: string) => {
    const toLocalInput = (iso: string) => formatLocalInput(iso);
    setValue('start_time', toLocalInput(newStartTime));
    setValue('end_time', toLocalInput(newEndTime));
  };

  const canStartSession = Boolean(session?.id && !session?.started_at && programId && goalId);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true">
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
            {retryHint && (
              <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/40 dark:bg-blue-900/20">
                <AlertCircle className="w-5 h-5 text-blue-500 dark:text-blue-300 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-blue-800 dark:text-blue-100 space-y-2">
                  <div>
                    <p className="font-medium">Session not saved</p>
                    <p className="mt-1">{retryHint}</p>
                  </div>
                  {onRetryHintDismiss && (
                    <button
                      type="button"
                      onClick={onRetryHintDismiss}
                      className="text-xs font-semibold text-blue-600 hover:text-blue-500 dark:text-blue-300 dark:hover:text-blue-200"
                    >
                      Dismiss
                    </button>
                  )}
                </div>
              </div>
            )}
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
                <label
                  htmlFor="therapist-select"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Therapist
                </label>
                <select
                  id="therapist-select"
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
                <label
                  htmlFor="client-select"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Client
                </label>
                <select
                  id="client-select"
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
                <label
                  htmlFor="program-select"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Program
                </label>
                <select
                  id="program-select"
                  {...register('program_id', { required: 'Program is required' })}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:text-gray-200"
                >
                  <option value="">Select a program</option>
                  {programs.map((program) => (
                    <option key={program.id} value={program.id}>
                      {program.name}
                    </option>
                  ))}
                </select>
                {errors.program_id && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.program_id.message}</p>
                )}
              </div>

              <div>
                <label
                  htmlFor="goal-select"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Primary Goal
                </label>
                <select
                  id="goal-select"
                  {...register('goal_id', { required: 'Primary goal is required' })}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:text-gray-200"
                >
                  <option value="">Select a goal</option>
                  {goals.map((goal) => (
                    <option key={goal.id} value={goal.id}>
                      {goal.title}
                    </option>
                  ))}
                </select>
                {errors.goal_id && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.goal_id.message}</p>
                )}
              </div>
            </div>

            {goals.length > 0 && (
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Additional Goals</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {goals.map((goal) => (
                    <label key={goal.id} className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                      <input
                        type="checkbox"
                        checked={Array.isArray(goalIds) && goalIds.includes(goal.id)}
                        onChange={() => toggleGoalSelection(goal.id)}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                      <span>{goal.title}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="start-time-input"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Start Time
                </label>
                <div className="relative">
                  <Clock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="datetime-local"
                    id="start-time-input"
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
                <label
                  htmlFor="end-time-input"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  End Time
                </label>
                <div className="relative">
                  <Clock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="datetime-local"
                    id="end-time-input"
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
              <label
                htmlFor="status-select"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                Status
              </label>
              <select
                id="status-select"
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
              <label
                htmlFor="notes-input"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                <FileText className="w-4 h-4 inline mr-2" />
                Notes
              </label>
              <textarea
                id="notes-input"
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
            {session?.id && (
              <button
                type="button"
                onClick={handleStartSession}
                disabled={!canStartSession}
                className="w-full sm:w-auto px-4 py-2 text-sm font-medium text-white bg-emerald-600 border border-transparent rounded-md shadow-sm hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Start Session
              </button>
            )}
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