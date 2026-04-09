import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
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
  addMinutesToLocalInput,
  diffMinutesBetweenLocalInputs,
  formatSessionLocalInput,
  getDefaultSessionEndTime,
  normalizeQuarterHourLocalInput,
  resolveSchedulingTimeZone,
  toUtcSessionIsoString,
} from "../features/scheduling/domain/time";
import { startSessionFromModal } from "../features/scheduling/domain/sessionStart";

const ENABLE_ALTERNATIVE_TIME_SUGGESTIONS = false;

export interface SessionModalClinicalNotesPayload {
  session_note_narrative?: string;
  session_note_goal_notes?: Record<string, string>;
  session_note_goal_ids?: string[];
  session_note_goals_addressed?: string[];
  session_note_authorization_id?: string;
  session_note_service_code?: string;
}

export type SessionModalSubmitData = Partial<Session> & SessionModalClinicalNotesPayload;

interface SessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: SessionModalSubmitData) => Promise<void>;
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
  retryActionLabel?: string | null;
  onRetryAction?: (() => void) | undefined;
  onSessionStarted?: () => void | Promise<void>;
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
  retryActionLabel,
  onRetryAction,
  onSessionStarted,
}: SessionModalProps) {
  const [isPlanSummaryExpanded, setIsPlanSummaryExpanded] = useState(false);
  const [isClinicalSummaryExpanded, setIsClinicalSummaryExpanded] = useState(false);
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
  const retryHintDescriptionId = 'session-modal-retry-description';
  const retryHintHeadingId = 'session-modal-retry-heading';
  const conflictDescriptionId = 'session-modal-conflicts-description';
  const conflictHeadingId = 'session-modal-conflicts-heading';

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

  type SessionModalFormValues = Partial<Session> & SessionModalClinicalNotesPayload;
  
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    getValues,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<SessionModalFormValues>({
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
      session_note_narrative: '',
      session_note_goal_notes: {},
      session_note_goal_ids: [],
      session_note_goals_addressed: [],
      session_note_authorization_id: '',
      session_note_service_code: '',
    },
  });

  const startTime = watch('start_time');
  const endTime = watch('end_time');
  const therapistId = watch('therapist_id');
  const clientId = watch('client_id');
  const programId = watch('program_id');
  const goalId = watch('goal_id');
  const goalIds = watch('goal_ids') as string[] | undefined;
  const sessionNoteNarrative = watch('session_note_narrative') ?? '';
  const sessionNoteAuthorizationId = watch('session_note_authorization_id') ?? '';
  const sessionNoteGoalNotes = watch('session_note_goal_notes') as Record<string, string> | undefined;

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

  const {
    data: programs = [],
    isFetched: isProgramsFetched,
    isFetching: isProgramsFetching,
    isError: isProgramsError,
    refetch: refetchPrograms,
  } = useQuery({
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

  const {
    data: goals = [],
    isFetched: isGoalsFetched,
    isFetching: isGoalsFetching,
    isError: isGoalsError,
    refetch: refetchGoals,
  } = useQuery({
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

  const { data: approvedAuthorizations = [] } = useQuery({
    queryKey: ['session-note-authorizations', clientId, activeOrganizationId ?? 'MISSING_ORG'],
    queryFn: async () => {
      if (!clientId || !activeOrganizationId) {
        return [];
      }
      const { data, error } = await supabase
        .from('authorizations')
        .select('id, authorization_number, services:authorization_services(service_code)')
        .eq('client_id', clientId)
        .eq('organization_id', activeOrganizationId)
        .eq('status', 'approved')
        .order('start_date', { ascending: false });
      if (error) {
        throw error;
      }
      return (
        data as Array<{
          id: string;
          authorization_number: string;
          services?: Array<{ service_code: string | null }> | null;
        }>
      ) ?? [];
    },
    enabled: Boolean(clientId && activeOrganizationId),
  });

  const { data: linkedSessionNote } = useQuery({
    queryKey: ['session-note-linked', session?.id, activeOrganizationId ?? 'MISSING_ORG'],
    queryFn: async () => {
      if (!session?.id || !activeOrganizationId) {
        return null;
      }
      const { data, error } = await supabase
        .from('client_session_notes')
        .select('id, authorization_id, service_code, narrative, goal_notes, goal_ids, goals_addressed')
        .eq('session_id', session.id)
        .eq('organization_id', activeOrganizationId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        throw error;
      }
      return data ?? null;
    },
    enabled: Boolean(session?.id && activeOrganizationId),
  });

  const selectedTherapist = therapists.find(t => t.id === therapistId);
  const selectedClient = clients.find(c => c.id === clientId);
  const selectedTherapistServices = selectedTherapist?.service_type ?? [];
  const selectedClientServices = selectedClient?.service_preference ?? [];
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle');
  const activePrograms = programs.filter((program) => program.status === 'active');
  const activeGoals = goals.filter((goal) => goal.status === 'active');
  const selectedPrimaryGoal = goals.find((goal) => goal.id === goalId);
  const hasProgramOptionForValue = typeof programId === 'string' && programId.length > 0
    ? programs.some((program) => program.id === programId)
    : false;
  const hasGoalOptionForValue = typeof goalId === 'string' && goalId.length > 0
    ? goals.some((goal) => goal.id === goalId)
    : false;

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
      if (session?.id) {
        return;
      }
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
    if (session?.id && programId && !programIds.has(programId)) {
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
    if (session?.id && goalId && !goalIdsSet.has(goalId)) {
      return;
    }
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
    if (session?.id && goalId) {
      allowed.add(goalId);
    }
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

      if (!ENABLE_ALTERNATIVE_TIME_SUGGESTIONS) {
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

  const handleFormSubmit = async (data: SessionModalFormValues) => {
    if (conflicts.length > 0) {
      if (!window.confirm('There are scheduling conflicts. Do you want to proceed anyway?')) {
        return;
      }
    }
    try {
      const normalizedGoalNoteMap = Object.fromEntries(
        Object.entries(data.session_note_goal_notes ?? {})
          .map(([goalKey, noteValue]) => [goalKey, noteValue?.trim() ?? ''])
          .filter(([, noteValue]) => noteValue.length > 0),
      );
      const normalizedGoalIds = Array.isArray(data.goal_ids) ? data.goal_ids : [];
      const mergedGoalIds = data.goal_id && !normalizedGoalIds.includes(data.goal_id)
        ? [...normalizedGoalIds, data.goal_id]
        : normalizedGoalIds;
      if (hasAnyClinicalNoteInput) {
        if (!session?.id) {
          showError('Clinical session notes can only be saved for existing sessions.');
          return;
        }
        if (!data.session_note_authorization_id) {
          showError('Select an authorization to save clinical session notes.');
          return;
        }
        if (!data.session_note_service_code) {
          showError('Select a service code to save clinical session notes.');
          return;
        }
        for (const trackedGoalId of mergedGoalIds) {
          const goalNoteText = normalizedGoalNoteMap[trackedGoalId]?.trim() ?? '';
          if (!goalNoteText) {
            const goalLabel = goals.find((goal) => goal.id === trackedGoalId)?.title ?? trackedGoalId;
            showError(`Add a note for goal "${goalLabel}" before saving clinical notes.`);
            return;
          }
        }
      }
      const transformed: SessionModalSubmitData = {
        ...data,
        session_note_narrative: data.session_note_narrative?.trim() ?? '',
        session_note_goal_notes: normalizedGoalNoteMap,
        session_note_goal_ids: mergedGoalIds,
        session_note_goals_addressed: mergedGoalIds
          .map((goalEntryId) => goals.find((goal) => goal.id === goalEntryId)?.title?.trim())
          .filter((goalLabel): goalLabel is string => Boolean(goalLabel)),
        session_note_authorization_id: data.session_note_authorization_id ?? '',
        session_note_service_code: data.session_note_service_code ?? '',
        goal_ids: mergedGoalIds,
        // If a timezone prop is provided, normalize to UTC for consumers expecting Z times
        start_time: timeZone ? toUtcSessionIsoString(data.start_time, resolvedTimeZone) : data.start_time,
        end_time: timeZone ? toUtcSessionIsoString(data.end_time, resolvedTimeZone) : data.end_time,
      };
      await onSubmit(transformed);
      reset(getValues());
      setSaveState('saved');
    } catch (error) {
      logger.error('Failed to submit session', {
        error,
        context: { component: 'SessionModal', operation: 'handleFormSubmit' }
      });
      setSaveState('error');
      return;
    }
  };

  const handleAttemptClose = useCallback(() => {
    if (isSubmitting) {
      return;
    }
    if (!isDirty) {
      onClose();
      return;
    }
    const shouldDiscard = window.confirm(
      'You have unsaved changes in this session. Close without saving?'
    );
    if (shouldDiscard) {
      onClose();
    }
  }, [isDirty, isSubmitting, onClose]);

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
      await onSessionStarted?.();
      onClose();
    } catch (error) {
      logger.error("Failed to start session", {
        error,
        context: { component: "SessionModal", operation: "handleStartSession" },
      });
      showError(error instanceof Error ? error.message : "Failed to start session");
    }
  };

  const handleCloseSession = () => {
    setValue('status', 'completed', { shouldDirty: true });
    void handleSubmit(async (formData) => {
      await handleFormSubmit({
        ...formData,
        status: 'completed',
      });
    })();
  };

  // Function to ensure time input is on 15-minute intervals
  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>, field: 'start_time' | 'end_time') => {
    const value = e.target.value;
    if (!value) {
      setValue(field, '');
      return;
    }

    const normalized = normalizeQuarterHourLocalInput(value, resolvedTimeZone);

    if (field === 'start_time') {
      const previousStart = getValues('start_time');
      const previousEnd = getValues('end_time');
      setValue('start_time', normalized);
      let durationMinutes = 60;
      if (previousStart && previousEnd) {
        const d = diffMinutesBetweenLocalInputs(previousStart, previousEnd, resolvedTimeZone);
        if (d != null && d > 0) {
          durationMinutes = d;
        }
      }
      setValue('end_time', addMinutesToLocalInput(normalized, durationMinutes, resolvedTimeZone));
      return;
    }

    setValue('end_time', normalized);
  };

  const handleSelectAlternativeTime = (newStartTime: string, newEndTime: string) => {
    const toLocalInput = (iso: string) => formatSessionLocalInput(iso, resolvedTimeZone);
    setValue('start_time', toLocalInput(newStartTime));
    setValue('end_time', toLocalInput(newEndTime));
  };

  const hasStartedSession = Boolean(sessionDetails?.started_at ?? session?.started_at);
  const hasTerminalSessionStatus =
    session?.status === 'completed' ||
    session?.status === 'cancelled' ||
    session?.status === 'no-show';
  const isInProgressSession =
    !hasTerminalSessionStatus &&
    (session?.status === 'in_progress' || hasStartedSession);
  const isDependentDataLoading = (Boolean(clientId) && isProgramsFetching) || (Boolean(programId) && isGoalsFetching);
  const canStartSession = Boolean(session?.id && !hasStartedSession && programId && goalId);
  const sessionNoteGoalIds = useMemo(
    () => (Array.isArray(goalIds) ? goalIds : []),
    [goalIds],
  );
  const selectedAuthorization = approvedAuthorizations.find(
    (authorization) => authorization.id === sessionNoteAuthorizationId,
  );
  const sessionNoteServiceCodes = useMemo(() => {
    const services = selectedAuthorization?.services ?? [];
    return Array.from(
      new Set(
        services
          .map((service) => service.service_code?.trim())
          .filter((serviceCode): serviceCode is string => Boolean(serviceCode)),
      ),
    );
  }, [selectedAuthorization]);
  const hasAnyClinicalNoteInput = useMemo(() => {
    if (sessionNoteNarrative.trim().length > 0) {
      return true;
    }
    const values = Object.values(sessionNoteGoalNotes ?? {});
    return values.some((value) => value?.trim().length > 0);
  }, [sessionNoteNarrative, sessionNoteGoalNotes]);
  const saveStateMessage = useMemo(() => {
    if (isSubmitting) {
      return { tone: 'info' as const, text: 'Saving session details...' };
    }
    if (saveState === 'saved') {
      return { tone: 'success' as const, text: 'Session details saved.' };
    }
    if (saveState === 'error') {
      return { tone: 'error' as const, text: 'Unable to save session details. Try again.' };
    }
    if (isDirty) {
      return { tone: 'warning' as const, text: 'Unsaved changes.' };
    }
    return null;
  }, [isDirty, isSubmitting, saveState]);
  const dialogDescriptionIds = [
    dialogDescriptionId,
    ...(retryHint ? [retryHintDescriptionId] : []),
    ...(conflicts.length > 0 ? [conflictDescriptionId] : []),
  ].join(' ');

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
        handleAttemptClose();
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
  }, [isOpen, handleAttemptClose]);

  useEffect(() => {
    if (!isOpen || !isDirty || isSubmitting) {
      return;
    }
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isOpen, isDirty, isSubmitting]);

  useEffect(() => {
    if (!isDirty && saveState === 'error') {
      setSaveState('idle');
    }
  }, [isDirty, saveState]);

  useEffect(() => {
    if (!isOpen) {
      setSaveState('idle');
    }
  }, [isOpen, session?.id]);

  useEffect(() => {
    if (!linkedSessionNote || !session?.id || isDirty) {
      return;
    }
    setValue('session_note_narrative', linkedSessionNote.narrative ?? '');
    setValue(
      'session_note_goal_notes',
      (linkedSessionNote.goal_notes as Record<string, string> | null) ?? {},
    );
    setValue('session_note_goal_ids', linkedSessionNote.goal_ids ?? []);
    setValue('session_note_goals_addressed', linkedSessionNote.goals_addressed ?? []);
    setValue('session_note_authorization_id', linkedSessionNote.authorization_id ?? '');
    setValue('session_note_service_code', linkedSessionNote.service_code ?? '');
  }, [linkedSessionNote, session?.id, setValue, isDirty]);

  useEffect(() => {
    if (!isOpen) {
      setIsPlanSummaryExpanded(false);
      setIsClinicalSummaryExpanded(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black bg-opacity-50 sm:items-center p-0 sm:p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === overlayRef.current) {
          handleAttemptClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        className="flex h-[100dvh] w-full max-w-2xl flex-col overflow-hidden bg-white shadow-xl dark:bg-dark-lighter sm:h-auto sm:max-h-[90vh] sm:rounded-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby={dialogTitleId}
        aria-describedby={dialogDescriptionIds}
        data-session-status={session?.status ?? ""}
        tabIndex={-1}
      >
        {/* Header */}
        <div className="border-b bg-white px-4 py-3 dark:border-gray-700 dark:bg-dark-lighter sm:px-5 sm:py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                Schedule
              </p>
              <h2
                id={dialogTitleId}
                className="mt-1 flex items-center text-lg font-semibold text-gray-900 dark:text-white sm:text-xl"
              >
                <Calendar className="mr-2 h-5 w-5 text-blue-600 sm:h-6 sm:w-6" />
                {session ? 'Edit Session' : 'New Session'}
              </h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Review core details first, then add notes before saving.
              </p>
            </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={handleAttemptClose}
            disabled={isSubmitting}
            aria-label="Close session modal"
            title="Close session modal"
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-500 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-4 pb-28 sm:p-5 sm:pb-6">
          <p id={dialogDescriptionId} className="sr-only">
            Use this form to create or update a therapy session.
          </p>
          <form id="session-form" onSubmit={handleSubmit(handleFormSubmit)} className="space-y-5 sm:space-y-6">
            {retryHint && (
              <div
                data-testid="session-modal-blocked-close-panel"
                id={retryHintDescriptionId}
                role="region"
                aria-labelledby={retryHintHeadingId}
                className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/40 dark:bg-blue-900/20"
              >
                <AlertCircle className="w-5 h-5 text-blue-500 dark:text-blue-300 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-blue-800 dark:text-blue-100 space-y-2">
                  <div>
                    <h3 id={retryHintHeadingId} className="font-medium">Session not saved</h3>
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
                  {onRetryAction && retryActionLabel && (
                    <button
                      type="button"
                      onClick={onRetryAction}
                      className="text-xs font-semibold text-blue-700 hover:text-blue-600 dark:text-blue-200 dark:hover:text-blue-100"
                    >
                      {retryActionLabel}
                    </button>
                  )}
                </div>
              </div>
            )}
            {conflicts.length > 0 && (
              <div
                id={conflictDescriptionId}
                role="region"
                aria-labelledby={conflictHeadingId}
                className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/30 rounded-lg p-3 sm:p-4"
              >
                <div className="flex items-center mb-2">
                  <AlertTriangle className="w-5 h-5 text-amber-500 dark:text-amber-400 mr-2 flex-shrink-0" />
                  <h3 id={conflictHeadingId} className="font-medium text-amber-800 dark:text-amber-200">
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
            {isInProgressSession && (
              <div
                data-testid="session-modal-in-progress-guidance"
                className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 sm:p-4 text-sm text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-200"
              >
                <p className="font-medium">Session in progress</p>
                <p className="mt-1">
                  You can update program, primary goal, and additional goals while this session is active.
                  Save session details to keep this plan in sync.
                </p>
              </div>
            )}
            {saveStateMessage && (
              <div
                data-testid="session-modal-save-state"
                role="status"
                aria-live="polite"
                className={`rounded-md border px-3 py-2 text-xs ${
                  saveStateMessage.tone === 'success'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-200'
                    : saveStateMessage.tone === 'error'
                      ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200'
                      : saveStateMessage.tone === 'warning'
                        ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200'
                        : 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-200'
                }`}
              >
                {saveStateMessage.text}
              </div>
            )}

            <section className="space-y-4 rounded-xl border border-gray-200 bg-gray-50/70 p-4 dark:border-gray-700 dark:bg-gray-900/30">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">People &amp; Plan</h3>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Pick the therapist, client, and care-plan details for this session.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsPlanSummaryExpanded((current) => !current)}
                  aria-expanded={isPlanSummaryExpanded}
                  className="rounded-full border border-gray-200 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-white dark:border-gray-700 dark:text-gray-300 dark:hover:bg-dark"
                >
                  {isPlanSummaryExpanded ? 'Hide summary' : 'Show summary'}
                </button>
              </div>

              {isPlanSummaryExpanded && (selectedTherapist || selectedClient || selectedPrimaryGoal) && (
                <div className="grid gap-2 rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-600 dark:border-gray-700 dark:bg-dark-lighter dark:text-gray-300 sm:grid-cols-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 dark:text-white">Therapist</p>
                    <p className="mt-1 truncate">{selectedTherapist?.full_name ?? 'Not selected'}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 dark:text-white">Client</p>
                    <p className="mt-1 truncate">{selectedClient?.full_name ?? 'Not selected'}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 dark:text-white">Primary goal</p>
                    <p className="mt-1 truncate">{selectedPrimaryGoal?.title ?? 'Not selected'}</p>
                  </div>
                </div>
              )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
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
                  className="min-h-11 w-full rounded-md border-gray-300 bg-white shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-dark dark:text-gray-200"
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
                  className="min-h-11 w-full rounded-md border-gray-300 bg-white shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-dark dark:text-gray-200"
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
              <>
                <details className="rounded-lg border border-blue-200 bg-blue-50 text-xs text-blue-800 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-100 sm:hidden">
                  <summary className="cursor-pointer list-none px-3 py-2.5 [&::-webkit-details-marker]:hidden">
                    <div className="flex min-h-11 items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-blue-900 dark:text-blue-100">
                        {selectedPrimaryGoal.title}
                      </span>
                      <span className="shrink-0 text-[11px] font-medium text-blue-700/90 dark:text-blue-200/90">
                        Goal criteria
                      </span>
                    </div>
                  </summary>
                  <div className="space-y-1 border-t border-blue-200/70 px-3 pb-3 pt-2 dark:border-blue-800/40">
                    {selectedPrimaryGoal.measurement_type && (
                      <p className="truncate">Measurement: {selectedPrimaryGoal.measurement_type}</p>
                    )}
                    {selectedPrimaryGoal.baseline_data && (
                      <p className="break-words">Baseline: {selectedPrimaryGoal.baseline_data}</p>
                    )}
                    {selectedPrimaryGoal.target_criteria && (
                      <p className="break-words">Target: {selectedPrimaryGoal.target_criteria}</p>
                    )}
                    {selectedPrimaryGoal.mastery_criteria && (
                      <p className="break-words">Mastery: {selectedPrimaryGoal.mastery_criteria}</p>
                    )}
                    {selectedPrimaryGoal.maintenance_criteria && (
                      <p className="break-words">Maintenance: {selectedPrimaryGoal.maintenance_criteria}</p>
                    )}
                    {selectedPrimaryGoal.generalization_criteria && (
                      <p className="break-words">Generalization: {selectedPrimaryGoal.generalization_criteria}</p>
                    )}
                    <p>
                      Objective data points:{" "}
                      {Array.isArray(selectedPrimaryGoal.objective_data_points)
                        ? selectedPrimaryGoal.objective_data_points.length
                        : 0}
                    </p>
                  </div>
                </details>
                <div className="hidden rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-100 sm:block">
                  <p className="font-semibold">{selectedPrimaryGoal.title}</p>
                  {selectedPrimaryGoal.measurement_type && <p>Measurement: {selectedPrimaryGoal.measurement_type}</p>}
                  {selectedPrimaryGoal.baseline_data && <p>Baseline: {selectedPrimaryGoal.baseline_data}</p>}
                  {selectedPrimaryGoal.target_criteria && <p>Target: {selectedPrimaryGoal.target_criteria}</p>}
                  {selectedPrimaryGoal.mastery_criteria && <p>Mastery: {selectedPrimaryGoal.mastery_criteria}</p>}
                  {selectedPrimaryGoal.maintenance_criteria && <p>Maintenance: {selectedPrimaryGoal.maintenance_criteria}</p>}
                  {selectedPrimaryGoal.generalization_criteria && (
                    <p>Generalization: {selectedPrimaryGoal.generalization_criteria}</p>
                  )}
                  <p>
                    Objective data points:{" "}
                    {Array.isArray(selectedPrimaryGoal.objective_data_points)
                      ? selectedPrimaryGoal.objective_data_points.length
                      : 0}
                  </p>
                </div>
              </>
            )}

            {selectedTherapist && selectedClient && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 p-3 sm:p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div>
                  <div className="flex items-center text-sm text-gray-600 dark:text-gray-300">
                    <User className="w-4 h-4 mr-2 text-blue-500" />
                    <span className="truncate">{selectedTherapist.full_name}</span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {selectedTherapistServices.join(', ') || 'No service types'}
                  </div>
                </div>
                <div>
                  <div className="flex items-center text-sm text-gray-600 dark:text-gray-300">
                    <User className="w-4 h-4 mr-2 text-green-500" />
                    <span className="truncate">{selectedClient.full_name}</span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {selectedClientServices.join(', ') || 'No service preferences'}
                  </div>
                </div>
              </div>
            )}

            {(programs.length === 0 || activePrograms.length === 0 || activeGoals.length === 0) && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200 sm:p-4">
                {programs.length === 0 || activePrograms.length === 0
                  ? 'No active programs found for this client. Create or activate a program before starting a session.'
                  : 'No active goals found for the selected program. Add or activate a goal before starting a session.'}
              </div>
            )}

            <div className="space-y-2 sm:space-y-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 sm:sr-only">
                Program &amp; goals
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-4">
              <div>
                <label
                  htmlFor="program-select"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Program
                </label>
                <select
                  id="program-select"
                  {...register('program_id', { required: session ? false : 'Program is required' })}
                  disabled={isProgramsFetching || !clientId}
                  className="min-h-11 w-full rounded-md border-gray-300 bg-white shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-dark dark:text-gray-200"
                >
                  <option value="">Select a program</option>
                  {programId && !hasProgramOptionForValue && (
                    <option value={programId}>
                      Current program (unavailable in active list)
                    </option>
                  )}
                  {programs.map((program) => (
                    <option key={program.id} value={program.id}>
                      {program.name}
                    </option>
                  ))}
                </select>
                {errors.program_id && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.program_id.message}</p>
                )}
                {isProgramsFetching && (
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Loading programs...</p>
                )}
                {isProgramsError && (
                  <div className="mt-1 flex items-center gap-2 text-xs text-red-600 dark:text-red-300">
                    <span>Could not load programs.</span>
                    <button
                      type="button"
                      onClick={() => {
                        void refetchPrograms();
                      }}
                      className="font-semibold underline underline-offset-2"
                    >
                      Retry
                    </button>
                  </div>
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
                  {...register('goal_id', { required: session ? false : 'Primary goal is required' })}
                  disabled={isGoalsFetching || !programId}
                  className="min-h-11 w-full rounded-md border-gray-300 bg-white shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-dark dark:text-gray-200"
                >
                  <option value="">Select a goal</option>
                  {goalId && !hasGoalOptionForValue && (
                    <option value={goalId}>
                      Current goal (unavailable in active list)
                    </option>
                  )}
                  {goals.map((goal) => (
                    <option key={goal.id} value={goal.id}>
                      {goal.title}
                    </option>
                  ))}
                </select>
                {errors.goal_id && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.goal_id.message}</p>
                )}
                {isGoalsFetching && (
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Loading goals...</p>
                )}
                {isGoalsError && (
                  <div className="mt-1 flex items-center gap-2 text-xs text-red-600 dark:text-red-300">
                    <span>Could not load goals.</span>
                    <button
                      type="button"
                      onClick={() => {
                        void refetchGoals();
                      }}
                      className="font-semibold underline underline-offset-2"
                    >
                      Retry
                    </button>
                  </div>
                )}
              </div>
            </div>
            </div>

            {goals.length > 0 && (
              <>
                <details className="rounded-lg border border-gray-200 dark:border-gray-700 sm:hidden">
                  <summary className="cursor-pointer list-none px-3 py-2.5 [&::-webkit-details-marker]:hidden">
                    <div className="flex min-h-11 items-center justify-between gap-2 text-sm font-medium text-gray-800 dark:text-gray-100">
                      <span>Additional goals</span>
                      <span className="shrink-0 text-xs font-normal text-gray-500 dark:text-gray-400">
                        {(Array.isArray(goalIds) ? goalIds.length : 0)} selected
                      </span>
                    </div>
                  </summary>
                  <div className="border-t border-gray-200 px-3 pb-3 pt-2 dark:border-gray-700">
                    <div className="grid grid-cols-1 gap-2">
                      {goals.map((goal) => (
                        <label
                          key={`m-${goal.id}`}
                          className="flex min-w-0 items-center gap-2 text-sm text-gray-600 dark:text-gray-300"
                        >
                          <input
                            type="checkbox"
                            checked={Array.isArray(goalIds) && goalIds.includes(goal.id)}
                            onChange={() => toggleGoalSelection(goal.id)}
                            className="h-5 w-5 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="min-w-0 flex-1 truncate">{goal.title}</span>
                          <span className="shrink-0 text-[11px] text-gray-500 dark:text-gray-400">
                            (
                            {Array.isArray(goal.objective_data_points) ? goal.objective_data_points.length : 0} pts)
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                </details>
                <div className="hidden rounded-lg border border-gray-200 dark:border-gray-700 p-3 sm:block">
                  <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">Additional Goals</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {goals.map((goal) => (
                      <label key={goal.id} className="flex min-w-0 items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                        <input
                          type="checkbox"
                          checked={Array.isArray(goalIds) && goalIds.includes(goal.id)}
                          onChange={() => toggleGoalSelection(goal.id)}
                          className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="truncate">{goal.title}</span>
                        <span className="text-[11px] text-gray-500 dark:text-gray-400">
                          ({Array.isArray(goal.objective_data_points) ? goal.objective_data_points.length : 0} data points)
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </>
            )}
            </section>

            <section className="space-y-4 rounded-xl border border-gray-200 p-4 dark:border-gray-700">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Timing &amp; Status</h3>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Keep the timeline and status fields easy to review before saving.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
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
                    className="min-h-11 w-full rounded-md border-gray-300 bg-white pl-10 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-dark dark:text-gray-200"
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
                    className="min-h-11 w-full rounded-md border-gray-300 bg-white pl-10 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-dark dark:text-gray-200"
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
            {ENABLE_ALTERNATIVE_TIME_SUGGESTIONS && conflicts.length > 0 && (
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
                className="min-h-11 w-full rounded-md border-gray-300 bg-white shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-dark dark:text-gray-200"
              >
                <option value="scheduled">Scheduled</option>
                <option value="in_progress" disabled>In Progress</option>
                <option value="completed" disabled={!session}>Completed</option>
                <option value="cancelled">Cancelled</option>
                <option value="no-show" disabled={!session}>No Show</option>
              </select>
            </div>
            </section>

            <section className="space-y-4 rounded-xl border border-gray-200 p-4 dark:border-gray-700">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Session Notes</h3>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Add schedule-only notes here. Clinical note fields stay separate below.
              </p>
            </div>
            <div>
              <label
                htmlFor="notes-input"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                <FileText className="w-4 h-4 inline mr-2" />
                Schedule Notes
              </label>
              <textarea
                id="notes-input"
                {...register('notes')}
                rows={3}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:text-gray-200"
                placeholder="Add any session notes here..."
              />
              {isInProgressSession && (
                <p
                  data-testid="session-modal-notes-guidance"
                  className="mt-2 text-xs text-gray-500 dark:text-gray-400"
                >
                  These schedule notes are saved with the session. For per-goal documentation needed to close
                  in-progress sessions, use Client Details &gt; Session Notes.
                </p>
              )}
            </div>
            </section>

            {session?.id && (
              <section className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-4 space-y-4 dark:border-indigo-900/40 dark:bg-indigo-900/10">
                <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">Clinical Session Notes</p>
                  <p className="mt-1 text-xs text-indigo-700 dark:text-indigo-300">
                    Write both narrative and per-goal notes from this schedule session modal.
                  </p>
                </div>
                  <button
                    type="button"
                    onClick={() => setIsClinicalSummaryExpanded((current) => !current)}
                    aria-expanded={isClinicalSummaryExpanded}
                    className="rounded-full border border-indigo-200 bg-white px-3 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:bg-dark-lighter dark:text-indigo-200 dark:hover:bg-indigo-900/30"
                  >
                    {isClinicalSummaryExpanded ? 'Hide details' : 'Show details'}
                  </button>
                </div>
                {isClinicalSummaryExpanded && (
                  <div className="rounded-lg border border-indigo-200 bg-white/90 p-3 text-xs text-indigo-800 dark:border-indigo-800 dark:bg-dark-lighter dark:text-indigo-200">
                    <p className="font-medium">Linked note requirements</p>
                    <p className="mt-1">
                      Authorization, service code, narrative, and per-goal notes stay unchanged. This toggle only reduces mobile scrolling.
                    </p>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <div>
                    <label
                      htmlFor="session-note-auth-select"
                      className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                    >
                      Authorization
                    </label>
                    <select
                      id="session-note-auth-select"
                      {...register('session_note_authorization_id')}
                      className="min-h-11 w-full rounded-md border-gray-300 bg-white shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-dark dark:text-gray-200"
                    >
                      <option value="">Select authorization</option>
                      {approvedAuthorizations.map((authorization) => (
                        <option key={authorization.id} value={authorization.id}>
                          {authorization.authorization_number}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label
                      htmlFor="session-note-service-code-select"
                      className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                    >
                      Service Code
                    </label>
                    <select
                      id="session-note-service-code-select"
                      {...register('session_note_service_code')}
                      className="min-h-11 w-full rounded-md border-gray-300 bg-white shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-dark dark:text-gray-200"
                      disabled={!sessionNoteAuthorizationId}
                    >
                      <option value="">Select service code</option>
                      {sessionNoteServiceCodes.map((serviceCode) => (
                        <option key={serviceCode} value={serviceCode}>
                          {serviceCode}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label
                    htmlFor="session-note-narrative-input"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                  >
                    Clinical Narrative
                  </label>
                  <textarea
                    id="session-note-narrative-input"
                    {...register('session_note_narrative')}
                    rows={4}
                    className="w-full rounded-md border-gray-300 bg-white shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-dark dark:text-gray-200"
                    placeholder="Write a clinical summary for this session..."
                  />
                </div>
                {sessionNoteGoalIds.length > 0 && (
                  <div className="space-y-3">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Per-goal Notes</p>
                    {sessionNoteGoalIds.map((selectedGoalId) => {
                      const selectedGoal = goals.find((goal) => goal.id === selectedGoalId);
                      const fieldKey = `session_note_goal_notes.${selectedGoalId}` as const;
                      return (
                        <div key={selectedGoalId}>
                          <label
                            htmlFor={`goal-note-${selectedGoalId}`}
                            className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1"
                          >
                            {selectedGoal?.title ?? selectedGoalId}
                          </label>
                          <textarea
                            id={`goal-note-${selectedGoalId}`}
                            {...register(fieldKey)}
                            rows={2}
                            className="w-full rounded-md border-gray-300 bg-white shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-dark dark:text-gray-200"
                            placeholder="Add progress notes for this goal..."
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            )}
          </form>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 z-10 border-t bg-white/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] backdrop-blur dark:border-gray-700 dark:bg-dark-lighter/95 sm:px-5 sm:py-4 sm:pb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
            <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:justify-end">
            <button
              type="button"
              onClick={handleAttemptClose}
              disabled={isSubmitting}
              className="min-h-11 w-full rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-gray-600 dark:bg-dark dark:text-gray-300 dark:hover:bg-gray-800 sm:w-auto"
            >
              Cancel
            </button>
            {session?.id && (
              <button
                type="button"
                onClick={handleStartSession}
                disabled={!canStartSession || isDependentDataLoading}
                className="min-h-11 w-full rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 shadow-sm hover:bg-emerald-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-200 dark:hover:bg-emerald-900/30 sm:w-auto"
              >
                Start Session
              </button>
            )}
            {session?.id && isInProgressSession && (
              <button
                type="button"
                onClick={handleCloseSession}
                disabled={isSubmitting || isDependentDataLoading || isLoadingAlternatives}
                className="min-h-11 w-full rounded-md border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-medium text-violet-700 shadow-sm hover:bg-violet-100 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-violet-900/40 dark:bg-violet-900/20 dark:text-violet-200 dark:hover:bg-violet-900/30 sm:w-auto"
              >
                Close Session
              </button>
            )}
            </div>
            <button
              type="submit"
              form="session-form"
              disabled={isSubmitting || isDependentDataLoading || isLoadingAlternatives}
              className="flex min-h-11 w-full items-center justify-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:min-w-[12rem]"
            >
              {isSubmitting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2" />
                  Saving...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  {session
                    ? (isInProgressSession ? 'Save Session Details' : 'Update Session')
                    : 'Create Session'}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
