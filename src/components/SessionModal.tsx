import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { 
  X, AlertCircle, Calendar, Clock, User, 
  FileText, CheckCircle2, AlertTriangle 
} from 'lucide-react';
import type { Session, Therapist, Client, Goal, Program } from '../types';
import { checkSchedulingConflicts, suggestAlternativeTimes, type Conflict, type AlternativeTime } from '../lib/conflicts';
import { logger } from '../lib/logger/logger';
import { AlternativeTimes } from './AlternativeTimes';
import { supabase } from '../lib/supabase';
import { useActiveOrganizationId } from '../lib/organization';
import { showError, showSuccess } from '../lib/toast';
import {
  formatSessionLocalInput,
  getDefaultSessionEndTime,
  normalizeQuarterHourLocalInput,
  resolveSchedulingTimeZone,
  toUtcSessionIsoString,
} from "../features/scheduling/domain/time";
import { startSessionFromModal } from "../features/scheduling/domain/sessionStart";

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

export function SessionModal({
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
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const previousClientIdRef = useRef<string | null>(null);
  const conflictCheckRequestIdRef = useRef(0);
  const activeOrganizationId = useActiveOrganizationId();
  const dialogTitleId = 'session-modal-title';
  const dialogDescriptionId = 'session-modal-description';

  const resolvedTimeZone = useMemo(() => resolveSchedulingTimeZone(timeZone), [timeZone]);

  // Prepare default start time from selectedDate and selectedTime
  const getDefaultStartTime = () => {
    if (selectedDate && selectedTime) {
      return `${format(selectedDate, 'yyyy-MM-dd')}T${selectedTime}`;
    }
    if (session?.start_time) {
      return formatSessionLocalInput(session.start_time, resolvedTimeZone);
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
        ? formatSessionLocalInput(session.end_time, resolvedTimeZone)
        : (selectedDate && selectedTime
            ? getDefaultSessionEndTime(`${format(selectedDate, 'yyyy-MM-dd')}T${selectedTime}`)
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

  const { data: programs = [], isFetched: isProgramsFetched, isFetching: isProgramsFetching } = useQuery({
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

  const { data: goals = [], isFetched: isGoalsFetched, isFetching: isGoalsFetching } = useQuery({
    queryKey: ['program-goals', programId, activeOrganizationId ?? 'MISSING_ORG'],
    queryFn: async () => {
      if (!programId || !activeOrganizationId) {
        return [];
      }
      const { data, error } = await supabase
        .from('goals')
        .select(
          'id, title, status, program_id, measurement_type, baseline_data, target_criteria, mastery_criteria, maintenance_criteria, generalization_criteria, objective_data_points',
        )
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
  const selectedTherapistServices = selectedTherapist?.service_type ?? [];
  const selectedClientServices = selectedClient?.service_preference ?? [];
  const activePrograms = programs.filter((program) => program.status === 'active');
  const activeGoals = goals.filter((goal) => goal.status === 'active');
  const selectedPrimaryGoal = goals.find((goal) => goal.id === goalId);

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
    const previousClientId = previousClientIdRef.current;
    previousClientIdRef.current = clientId;

    if (!previousClientId || previousClientId === clientId) {
      return;
    }

    setValue('program_id', '');
    setValue('goal_id', '');
    setValue('goal_ids', []);
  }, [clientId, setValue]);

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
    if (!isProgramsFetched) {
      return;
    }

    if (!programs.length) {
      if (programId) {
        setValue('program_id', '');
      }
      if (goalId) {
        setValue('goal_id', '');
      }
      if (Array.isArray(goalIds) && goalIds.length > 0) {
        setValue('goal_ids', []);
      }
      return;
    }
    const programIds = new Set(programs.map((program) => program.id));
    if (programId && programIds.has(programId)) {
      return;
    }

    const nextProgram = programs.find((program) => program.status === 'active') ?? programs[0];
    if (nextProgram?.id) {
      setValue('program_id', nextProgram.id);
      if (goalId) {
        setValue('goal_id', '');
      }
      if (Array.isArray(goalIds) && goalIds.length > 0) {
        setValue('goal_ids', []);
      }
    }
  }, [isProgramsFetched, programs, programId, goalId, goalIds, setValue]);

  useEffect(() => {
    if (!isGoalsFetched) {
      return;
    }

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
  }, [isGoalsFetched, goals, goalId, setValue]);

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
      setValue('end_time', getDefaultSessionEndTime(startTime));
    }
  }, [startTime, therapistId, clientId, setValue]);

  useEffect(() => {
    const requestId = conflictCheckRequestIdRef.current + 1;
    conflictCheckRequestIdRef.current = requestId;
    let cancelled = false;

    const shouldAbort = (): boolean =>
      cancelled || conflictCheckRequestIdRef.current !== requestId;

    const checkConflicts = async () => {
      if (!startTime || !endTime || !therapistId || !clientId) {
        if (!shouldAbort()) {
          setConflicts([]);
          setAlternativeTimes([]);
          setIsLoadingAlternatives(false);
        }
        return;
      }

      const therapist = therapists.find((t) => t.id === therapistId);
      const client = clients.find((c) => c.id === clientId);
      if (!therapist || !client) {
        if (!shouldAbort()) {
          setConflicts([]);
          setAlternativeTimes([]);
          setIsLoadingAlternatives(false);
        }
        return;
      }

      const startUtcIso = toUtcSessionIsoString(startTime, resolvedTimeZone);
      const endUtcIso = toUtcSessionIsoString(endTime, resolvedTimeZone);
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
      if (shouldAbort()) {
        return;
      }

      // Fallback: if no conflicts detected, perform a raw time match to catch equal-slot overlaps
      if (newConflicts.length === 0) {
        try {
          const localStart = startTime; // 'yyyy-MM-ddTHH:mm'
          const localDate = localStart?.slice(0, 10);
          const localHHmm = localStart?.slice(11, 16);
          const overlapping = existingSessions.find((s) => {
            if (s.therapist_id !== therapistId && s.client_id !== clientId) return false;
            const localIso = formatSessionLocalInput(s.start_time, resolvedTimeZone);
            const localSessionDate = localIso.slice(0, 10);
            const localSessionHHmm = localIso.slice(11, 16);
            return localSessionDate === localDate && localSessionHHmm === localHHmm;
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

      if (shouldAbort()) {
        return;
      }
      setConflicts(newConflicts);

      if (newConflicts.length === 0) {
        setAlternativeTimes([]);
        setIsLoadingAlternatives(false);
        return;
      }

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
        if (!shouldAbort()) {
          setAlternativeTimes(alternatives);
        }
      } catch (error) {
        logger.error('Failed to suggest alternative times', {
          error,
          context: { component: 'SessionModal', operation: 'suggestAlternativeTimes' }
        });
        if (!shouldAbort()) {
          setAlternativeTimes([]);
        }
      } finally {
        if (!shouldAbort()) {
          setIsLoadingAlternatives(false);
        }
      }
    };

    checkConflicts();

    return () => {
      cancelled = true;
    };
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
        start_time: timeZone ? toUtcSessionIsoString(data.start_time, resolvedTimeZone) : data.start_time,
        end_time: timeZone ? toUtcSessionIsoString(data.end_time, resolvedTimeZone) : data.end_time,
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
      await startSessionFromModal({
        sessionId: session.id,
        programId,
        goalId,
        goalIds: goalIds ?? [],
      });
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

    const normalized = normalizeQuarterHourLocalInput(value, resolvedTimeZone);
    setValue(field, normalized.normalizedStart);

    // If changing start time, also update end time
    if (field === 'start_time') {
      setValue('end_time', normalized.normalizedEnd);
    }
  };

  const handleSelectAlternativeTime = (newStartTime: string, newEndTime: string) => {
    const toLocalInput = (iso: string) => formatSessionLocalInput(iso, resolvedTimeZone);
    setValue('start_time', toLocalInput(newStartTime));
    setValue('end_time', toLocalInput(newEndTime));
  };

  const hasStartedSession = Boolean(sessionDetails?.started_at ?? session?.started_at);
  const isDependentDataLoading = (Boolean(clientId) && isProgramsFetching) || (Boolean(programId) && isGoalsFetching);
  const canStartSession = Boolean(session?.id && !hasStartedSession && programId && goalId);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    previousActiveElementRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const focusDialog = () => {
      const fallbackTarget = closeButtonRef.current ?? dialogRef.current;
      fallbackTarget?.focus();
    };

    const getFocusableElements = () => {
      if (!dialogRef.current) {
        return [] as HTMLElement[];
      }

      return Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => !element.hasAttribute('aria-hidden'));
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) {
        event.preventDefault();
        focusDialog();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement as HTMLElement | null;
      const dialogElement = dialogRef.current;

      if (!dialogElement?.contains(activeElement)) {
        event.preventDefault();
        if (event.shiftKey) {
          lastElement.focus();
        } else {
          firstElement.focus();
        }
        return;
      }

      if (event.shiftKey && activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    focusDialog();

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousActiveElementRef.current?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === overlayRef.current) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        className="bg-white dark:bg-dark-lighter rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby={dialogTitleId}
        aria-describedby={dialogDescriptionId}
        tabIndex={-1}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
          <h2 id={dialogTitleId} className="text-xl font-semibold text-gray-900 dark:text-white flex items-center">
            <Calendar className="w-6 h-6 mr-2 text-blue-600" />
            {session ? 'Edit Session' : 'New Session'}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close session modal"
            title="Close session modal"
            className="text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-400 p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          <p id={dialogDescriptionId} className="sr-only">
            Use this form to create or update a therapy session.
          </p>
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

            {selectedPrimaryGoal && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-100">
                <p className="font-semibold">{selectedPrimaryGoal.title}</p>
                {selectedPrimaryGoal.measurement_type && <p>Measurement: {selectedPrimaryGoal.measurement_type}</p>}
                {selectedPrimaryGoal.baseline_data && <p>Baseline: {selectedPrimaryGoal.baseline_data}</p>}
                {selectedPrimaryGoal.target_criteria && <p>Target: {selectedPrimaryGoal.target_criteria}</p>}
                {selectedPrimaryGoal.mastery_criteria && <p>Mastery: {selectedPrimaryGoal.mastery_criteria}</p>}
                {selectedPrimaryGoal.maintenance_criteria && <p>Maintenance: {selectedPrimaryGoal.maintenance_criteria}</p>}
                {selectedPrimaryGoal.generalization_criteria && <p>Generalization: {selectedPrimaryGoal.generalization_criteria}</p>}
                <p>
                  Objective data points:{" "}
                  {Array.isArray(selectedPrimaryGoal.objective_data_points)
                    ? selectedPrimaryGoal.objective_data_points.length
                    : 0}
                </p>
              </div>
            )}

            {selectedTherapist && selectedClient && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div>
                  <div className="flex items-center text-sm text-gray-600 dark:text-gray-300">
                    <User className="w-4 h-4 mr-2 text-blue-500" />
                    <span>{selectedTherapist.full_name}</span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {selectedTherapistServices.join(', ') || 'No service types'}
                  </div>
                </div>
                <div>
                  <div className="flex items-center text-sm text-gray-600 dark:text-gray-300">
                    <User className="w-4 h-4 mr-2 text-green-500" />
                    <span>{selectedClient.full_name}</span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {selectedClientServices.join(', ') || 'No service preferences'}
                  </div>
                </div>
              </div>
            )}

            {(programs.length === 0 || activePrograms.length === 0 || activeGoals.length === 0) && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
                {programs.length === 0 || activePrograms.length === 0
                  ? 'No active programs found for this client. Create or activate a program before starting a session.'
                  : 'No active goals found for the selected program. Add or activate a goal before starting a session.'}
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
                      <span className="text-[11px] text-gray-500 dark:text-gray-400">
                        ({Array.isArray(goal.objective_data_points) ? goal.objective_data_points.length : 0} data points)
                      </span>
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
                disabled={!canStartSession || isDependentDataLoading}
                className="w-full sm:w-auto px-4 py-2 text-sm font-medium text-white bg-emerald-600 border border-transparent rounded-md shadow-sm hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Start Session
              </button>
            )}
            <button
              type="submit"
              form="session-form"
              disabled={isSubmitting || isDependentDataLoading || isLoadingAlternatives}
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
