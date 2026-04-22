import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import {
  X,
  AlertCircle,
  Calendar,
  Clock,
  User,
  FileText,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  Plus,
  Trash2,
} from 'lucide-react';
import type {
  Session,
  SessionGoalMeasurementEntry,
  Therapist,
  Client,
  Goal,
  Program,
} from '../types';
import { checkSchedulingConflicts, suggestAlternativeTimes, type Conflict, type AlternativeTime } from '../lib/conflicts';
import { logger } from '../lib/logger/logger';
import { AlternativeTimes } from './AlternativeTimes';
import { supabase } from '../lib/supabase';
import { fetchLinkedClientSessionNoteForSession } from '../lib/session-note-linked-fetch';
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
import {
  getGoalMeasurementFieldMeta,
  hasMeaningfulGoalMeasurementEntry,
  mergeUniqueGoalIds,
  normalizeGoalMeasurementEntry,
} from '../lib/goal-measurements';
import {
  getTherapistMinTrialsTarget,
} from '../lib/session-goal-tracks';
import {
  createAdhocSessionTargetId,
  isAdhocSessionTargetId,
  pruneEmptyAdhocSessionTargets,
  showGoalOnBxCaptureTab,
  showGoalOnSkillCaptureTab,
} from '../lib/session-adhoc-targets';

const ENABLE_ALTERNATIVE_TIME_SUGGESTIONS = false;

export interface SessionModalClinicalNotesPayload {
  session_note_narrative?: string;
  session_note_goal_notes?: Record<string, string>;
  session_note_goal_measurements?: Record<string, SessionGoalMeasurementEntry>;
  session_note_goal_ids?: string[];
  session_note_goals_addressed?: string[];
  session_note_authorization_id?: string;
  session_note_service_code?: string;
  /** When set, POST /api/session-notes/upsert merges only these goal keys from this payload (server-authoritative). */
  session_note_capture_merge_goal_ids?: string[];
}

export type SessionModalSubmitData = Partial<Session> & SessionModalClinicalNotesPayload;

const toOptionalNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toFormNumber = (value: unknown): number | undefined => {
  const normalized = toOptionalNumber(value);
  return normalized ?? undefined;
};

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
  const [selectedProgramIds, setSelectedProgramIds] = useState<string[]>(() =>
    session?.program_id ? [session.program_id] : [],
  );
  const [mobileProgramsExpanded, setMobileProgramsExpanded] = useState(false);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [alternativeTimes, setAlternativeTimes] = useState<AlternativeTime[]>([]);
  const [isLoadingAlternatives, setIsLoadingAlternatives] = useState(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const sessionCaptureSectionRef = useRef<HTMLElement | null>(null);
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
      session_note_goal_measurements: {},
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
  const sessionNoteGoalNotes = watch('session_note_goal_notes') as Record<string, string> | undefined;
  const sessionNoteStoredGoalIds = watch('session_note_goal_ids') as string[] | undefined;
  const sessionNoteGoalsAddressed = watch('session_note_goals_addressed') as string[] | undefined;
  const sessionNoteGoalMeasurements = watch('session_note_goal_measurements') as
    | Record<string, SessionGoalMeasurementEntry | Record<string, unknown>>
    | undefined;

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
    queryKey: ['client-goals', clientId, activeOrganizationId ?? 'MISSING_ORG'],
    queryFn: async () => {
      if (!clientId || !activeOrganizationId) {
        return [];
      }
      const { data, error } = await supabase
        .from('goals')
        .select(
          'id, title, status, program_id, measurement_type, baseline_data, target_criteria, mastery_criteria, maintenance_criteria, generalization_criteria, objective_data_points',
        )
        .eq('client_id', clientId)
        .eq('organization_id', activeOrganizationId)
        .order('created_at', { ascending: false });
      if (error) {
        throw error;
      }
      return (data ?? []) as Goal[];
    },
    enabled: Boolean(clientId && activeOrganizationId),
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
      return fetchLinkedClientSessionNoteForSession({
        sessionId: session.id,
        organizationId: activeOrganizationId,
      });
    },
    enabled: Boolean(session?.id && activeOrganizationId),
  });

  const selectedTherapist = therapists.find(t => t.id === therapistId);
  const selectedClient = clients.find(c => c.id === clientId);
  const selectedTherapistServices = selectedTherapist?.service_type ?? [];
  const selectedClientServices = selectedClient?.service_preference ?? [];
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle');
  const activePrograms = programs.filter((program) => program.status === 'active');
  const availableGoals = useMemo(
    () => goals.filter((goal) => goal.status !== 'archived'),
    [goals],
  );
  const activeGoals = useMemo(
    () => availableGoals.filter((goal) => goal.status === 'active'),
    [availableGoals],
  );
  const programsById = useMemo(
    () => new Map(programs.map((program) => [program.id, program])),
    [programs],
  );
  const goalsById = useMemo(
    () => new Map(availableGoals.map((goal) => [goal.id, goal])),
    [availableGoals],
  );
  const activeGoalsByProgram = useMemo(() => {
    const byProgram = new Map<string, Goal[]>();
    for (const goal of activeGoals) {
      const programKey = goal.program_id ?? '__unknown__';
      const existing = byProgram.get(programKey);
      if (existing) {
        existing.push(goal);
      } else {
        byProgram.set(programKey, [goal]);
      }
    }
    return byProgram;
  }, [activeGoals]);
  const selectedPrimaryGoal = goalId ? goalsById.get(goalId) : undefined;
  const selectedProgramSet = useMemo(
    () => new Set(selectedProgramIds),
    [selectedProgramIds],
  );
  const selectedPrograms = useMemo(
    () => selectedProgramIds.map((id) => programsById.get(id)).filter((program): program is Program => Boolean(program)),
    [programsById, selectedProgramIds],
  );
  const selectedProgramGoals = useMemo(
    () =>
      selectedProgramIds.flatMap((id) => activeGoalsByProgram.get(id) ?? []),
    [activeGoalsByProgram, selectedProgramIds],
  );
  const availableProgramGroups = useMemo(
    () =>
      activePrograms
        .map((program) => ({
          program,
          goals: activeGoalsByProgram.get(program.id) ?? [],
        }))
        .filter(({ goals }) => goals.length > 0),
    [activeGoalsByProgram, activePrograms],
  );
  const selectedGoalsForSession = useMemo(
    () =>
      mergeUniqueGoalIds(Array.isArray(goalIds) ? goalIds : [], goalId ? [goalId] : [])
        .map((id) => goalsById.get(id))
        .filter((goal): goal is Goal => Boolean(goal)),
    [goalId, goalIds, goalsById],
  );
  const selectedGoalsSummary = useMemo(
    () => selectedGoalsForSession.map((goal) => goal.title).join(', '),
    [selectedGoalsForSession],
  );
  const hasProgramOptionForValue = typeof programId === 'string' && programId.length > 0
    ? activePrograms.some((program) => program.id === programId)
    : false;
  const hasGoalOptionForValue = typeof goalId === 'string' && goalId.length > 0
    ? selectedProgramGoals.some((goal) => goal.id === goalId)
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
    setSelectedProgramIds([]);
    setMobileProgramsExpanded(false);
  }, [clientId, setValue]);

  useEffect(() => {
    if (!sessionDetails) {
      return;
    }
    if (sessionDetails.program_id) {
      setValue('program_id', sessionDetails.program_id);
      setSelectedProgramIds((current) =>
        current.includes(sessionDetails.program_id as string)
          ? current
          : [sessionDetails.program_id as string, ...current],
      );
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
      setSelectedProgramIds([]);
      return;
    }
    const programIdsSet = new Set(programs.map((program) => program.id));
    const nextProgram = programs.find((program) => program.status === 'active') ?? programs[0];
    if (!programId || !programIdsSet.has(programId)) {
      if (session?.id && programId && !programIdsSet.has(programId)) {
        return;
      }
      if (nextProgram?.id) {
        setValue('program_id', nextProgram.id);
      }
    }

    setSelectedProgramIds((current) => {
      const filtered = current.filter((id) => programIdsSet.has(id));
      const preferredPrimaryProgram = programIdsSet.has(programId ?? '') ? programId : nextProgram?.id ?? '';
      const withPrimary =
        preferredPrimaryProgram && !filtered.includes(preferredPrimaryProgram)
          ? [preferredPrimaryProgram, ...filtered]
          : filtered;
      if (withPrimary.length > 0) {
        return withPrimary;
      }
      return nextProgram?.id ? [nextProgram.id] : [];
    });
  }, [isProgramsFetched, programs, programId, goalId, goalIds, session?.id, setValue]);

  useEffect(() => {
    if (!isGoalsFetched) {
      return;
    }

    if (!availableGoals.length) {
      return;
    }
    const primaryProgramId = selectedProgramIds[0] ?? programId ?? '';
    const primaryProgramGoals =
      activeGoalsByProgram.get(primaryProgramId) ??
      activeGoalsByProgram.get(programId ?? '') ??
      activeGoals;
    const goalIdsSet = new Set(availableGoals.map((goal) => goal.id));
    if (session?.id && goalId && !goalIdsSet.has(goalId)) {
      return;
    }
    if (!goalId || !goalIdsSet.has(goalId)) {
      const nextGoal = primaryProgramGoals[0] ?? activeGoals[0] ?? availableGoals[0];
      if (nextGoal?.id) {
        setValue('goal_id', nextGoal.id);
        if (nextGoal.program_id) {
          setValue('program_id', nextGoal.program_id);
        }
      }
    }
  }, [
    activeGoals,
    activeGoalsByProgram,
    availableGoals,
    goalId,
    isGoalsFetched,
    programId,
    selectedProgramIds,
    session?.id,
    setValue,
  ]);

  useEffect(() => {
    if (!goalId) {
      return;
    }
    const nextGoalIds = Array.isArray(goalIds) ? goalIds : [];
    if (!nextGoalIds.includes(goalId)) {
      setValue('goal_ids', [...nextGoalIds, goalId]);
    }
    const primaryGoalProgramId = goalsById.get(goalId)?.program_id;
    if (primaryGoalProgramId) {
      setSelectedProgramIds((current) =>
        current.includes(primaryGoalProgramId) ? current : [primaryGoalProgramId, ...current],
      );
      if (programId !== primaryGoalProgramId) {
        setValue('program_id', primaryGoalProgramId);
      }
    }
  }, [goalId, goalIds, goalsById, programId, setValue]);

  useEffect(() => {
    const programsFromGoals = mergeUniqueGoalIds(Array.isArray(goalIds) ? goalIds : [], goalId ? [goalId] : [])
      .map((selectedGoalId) => goalsById.get(selectedGoalId)?.program_id)
      .filter((id): id is string => Boolean(id));
    if (programId) {
      programsFromGoals.unshift(programId);
    }
    if (programsFromGoals.length === 0) {
      return;
    }
    setSelectedProgramIds((current) => {
      const next = Array.from(new Set([...programsFromGoals, ...current]));
      return next.length === current.length && next.every((id, index) => id === current[index])
        ? current
        : next;
    });
  }, [goalId, goalIds, setValue]);

  const updateProgramSelection = useCallback(
    (nextProgramIds: string[]) => {
      const uniqueProgramIds = Array.from(new Set(nextProgramIds)).filter((id) => programsById.has(id));
      setSelectedProgramIds(uniqueProgramIds);

      if (uniqueProgramIds.length === 0) {
        if (Array.isArray(goalIds) && goalIds.length > 0) {
          setValue('goal_ids', []);
        }
        if (goalId) {
          setValue('goal_id', '');
        }
        if (programId) {
          setValue('program_id', '');
        }
        return;
      }

      const selectedGoalIdSet = new Set(
        uniqueProgramIds.flatMap((id) => (activeGoalsByProgram.get(id) ?? []).map((goal) => goal.id)),
      );
      const currentGoalIds = Array.isArray(goalIds) ? goalIds : [];
      const nextGoalIds = currentGoalIds.filter((id) => selectedGoalIdSet.has(id));
      if (nextGoalIds.length !== currentGoalIds.length) {
        setValue('goal_ids', nextGoalIds);
      }

      const currentPrimaryGoal = goalId ? goalsById.get(goalId) : undefined;
      const fallbackGoal =
        uniqueProgramIds.flatMap((id) => activeGoalsByProgram.get(id) ?? [])[0] ??
        activeGoals[0] ??
        availableGoals[0];
      const nextPrimaryGoal =
        currentPrimaryGoal && uniqueProgramIds.includes(currentPrimaryGoal.program_id)
          ? currentPrimaryGoal
          : fallbackGoal;
      if (nextPrimaryGoal?.id && nextPrimaryGoal.id !== goalId) {
        setValue('goal_id', nextPrimaryGoal.id);
      }

      const nextPrimaryProgramId =
        nextPrimaryGoal?.program_id ??
        uniqueProgramIds[0] ??
        '';
      if (nextPrimaryProgramId !== programId) {
        setValue('program_id', nextPrimaryProgramId);
      }
    },
    [activeGoals, activeGoalsByProgram, availableGoals, goalId, goalIds, goalsById, programId, programsById, setValue],
  );

  const toggleProgramSelection = useCallback(
    (targetProgramId: string) => {
      const nextProgramIds = selectedProgramSet.has(targetProgramId)
        ? selectedProgramIds.filter((id) => id !== targetProgramId)
        : [...selectedProgramIds, targetProgramId];
      updateProgramSelection(nextProgramIds);
    },
    [selectedProgramIds, selectedProgramSet, updateProgramSelection],
  );

  const toggleGoalSelection = (targetId: string) => {
    const nextGoalIds = Array.isArray(goalIds) ? [...goalIds] : [];
    if (nextGoalIds.includes(targetId)) {
      if (targetId === goalId) {
        return;
      }
      setValue('goal_ids', nextGoalIds.filter((id) => id !== targetId));
      return;
    }
    const programForGoal = goalsById.get(targetId)?.program_id;
    if (programForGoal && !selectedProgramSet.has(programForGoal)) {
      setSelectedProgramIds((current) => [...current, programForGoal]);
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

  const handleFormSubmit = async (
    data: SessionModalFormValues,
    options?: { captureMergeGoalIds?: string[] },
  ) => {
    if (conflicts.length > 0) {
      if (!window.confirm('There are scheduling conflicts. Do you want to proceed anyway?')) {
        return;
      }
    }
    try {
      const pruned = pruneEmptyAdhocSessionTargets(
        {
          session_note_goal_ids: Array.isArray(data.session_note_goal_ids) ? data.session_note_goal_ids : [],
          session_note_goals_addressed: Array.isArray(data.session_note_goals_addressed)
            ? data.session_note_goals_addressed
            : [],
          session_note_goal_notes: data.session_note_goal_notes ?? {},
          session_note_goal_measurements: data.session_note_goal_measurements ?? {},
        },
        goals,
      );
      const working: SessionModalFormValues = {
        ...data,
        session_note_goal_ids: pruned.session_note_goal_ids,
        session_note_goals_addressed: pruned.session_note_goals_addressed,
        session_note_goal_notes: pruned.session_note_goal_notes,
        session_note_goal_measurements: pruned.session_note_goal_measurements,
      };
      setValue('session_note_goal_ids', pruned.session_note_goal_ids, { shouldDirty: true });
      setValue('session_note_goals_addressed', pruned.session_note_goals_addressed, { shouldDirty: true });
      setValue('session_note_goal_notes', pruned.session_note_goal_notes, { shouldDirty: true });
      setValue('session_note_goal_measurements', pruned.session_note_goal_measurements, { shouldDirty: true });

      const normalizedGoalNoteMap = Object.fromEntries(
        Object.entries(working.session_note_goal_notes ?? {})
          .map(([goalKey, noteValue]) => [goalKey, noteValue?.trim() ?? ''])
          .filter(([, noteValue]) => noteValue.length > 0),
      );
      const normalizedGoalIds = Array.isArray(working.goal_ids) ? working.goal_ids : [];
      const sessionGoalIds = mergeUniqueGoalIds(
        normalizedGoalIds,
        working.goal_id ? [working.goal_id] : [],
      );
      const storedGoalIds = Array.isArray(working.session_note_goal_ids) ? working.session_note_goal_ids : [];
      const noteGoalIds = Object.keys(working.session_note_goal_notes ?? {});
      const measurementGoalIds = Object.keys(working.session_note_goal_measurements ?? {});
      const mergedGoalIds = mergeUniqueGoalIds(
        sessionGoalIds,
        storedGoalIds,
        noteGoalIds,
        measurementGoalIds,
      );
      const storedGoalLabelsById = new Map(
        storedGoalIds.map((goalEntryId, index) => [
          goalEntryId,
          working.session_note_goals_addressed?.[index]?.trim() ?? null,
        ]),
      );
      const normalizedGoalMeasurementMap = Object.fromEntries(
        mergedGoalIds
          .map((goalEntryId) => {
            const entry = normalizeGoalMeasurementEntry(
              working.session_note_goal_measurements?.[goalEntryId],
              goalsById.get(goalEntryId),
            );
            return entry ? [goalEntryId, entry] : null;
          })
          .filter((entry): entry is [string, SessionGoalMeasurementEntry] => Boolean(entry)),
      );
      const firstApprovedAuth = approvedAuthorizations[0];
      const firstDefaultServiceCode =
        (firstApprovedAuth?.services ?? [])
          .map((s) => s.service_code?.trim())
          .find((c): c is string => Boolean(c)) ?? '';
      const resolvedAuthorizationId =
        working.session_note_authorization_id?.trim() || firstApprovedAuth?.id || '';
      const resolvedServiceCode =
        working.session_note_service_code?.trim() || firstDefaultServiceCode;
      const mergeGoalIds = options?.captureMergeGoalIds?.filter((id) => id.trim().length > 0) ?? [];
      const isPartialCaptureSave = mergeGoalIds.length > 0;
      const hasCaptureInputFromSubmit = isPartialCaptureSave
        ? mergeGoalIds.some((goalKey) => {
            const noteText = (working.session_note_goal_notes?.[goalKey] ?? '').trim();
            if (noteText.length > 0) {
              return true;
            }
            const rawValue = working.session_note_goal_measurements?.[goalKey];
            return hasMeaningfulGoalMeasurementEntry(
              normalizeGoalMeasurementEntry(rawValue, goalsById.get(goalKey)),
            );
          })
        : Object.values(working.session_note_goal_notes ?? {}).some(
            (value) => typeof value === 'string' && value.trim().length > 0,
          ) ||
          Object.entries(working.session_note_goal_measurements ?? {}).some(([goalKey, rawValue]) =>
            hasMeaningfulGoalMeasurementEntry(
              normalizeGoalMeasurementEntry(rawValue, goalsById.get(goalKey)),
            ),
          );
      const goalIdsRequiringNotes = isPartialCaptureSave
        ? mergedGoalIds.filter((id) => mergeGoalIds.includes(id))
        : mergedGoalIds;
      if (hasCaptureInputFromSubmit || isPartialCaptureSave) {
        if (!session?.id) {
          showError('Session capture can only be saved for existing sessions.');
          return;
        }
        if (!resolvedAuthorizationId || !resolvedServiceCode) {
          showError(
            'No approved authorization or service is available for this client. Ask an admin to configure billing defaults.',
          );
          return;
        }
        for (const trackedGoalId of goalIdsRequiringNotes) {
          const goalNoteText = normalizedGoalNoteMap[trackedGoalId]?.trim() ?? '';
          if (!goalNoteText) {
            const goalLabel =
              goalsById.get(trackedGoalId)?.title?.trim() ??
              storedGoalLabelsById.get(trackedGoalId) ??
              (isAdhocSessionTargetId(trackedGoalId) ? 'Session target' : `Goal ${trackedGoalId.slice(0, 8)}…`);
            showError(`Add a per-goal note for "${goalLabel}" before saving.`);
            return;
          }
        }
      }
      const transformed: SessionModalSubmitData = {
        ...working,
        session_note_narrative: working.session_note_narrative?.trim() ?? '',
        session_note_goal_notes: normalizedGoalNoteMap,
        session_note_goal_measurements: normalizedGoalMeasurementMap,
        session_note_goal_ids: mergedGoalIds,
        session_note_goals_addressed: mergedGoalIds
          .map((goalEntryId) => (
            goalsById.get(goalEntryId)?.title?.trim() ??
            storedGoalLabelsById.get(goalEntryId) ??
            `Goal ${goalEntryId.slice(0, 8)}…`
          )),
        session_note_authorization_id: resolvedAuthorizationId,
        session_note_service_code: resolvedServiceCode,
        ...(isPartialCaptureSave ? { session_note_capture_merge_goal_ids: mergeGoalIds } : {}),
        goal_ids: sessionGoalIds,
        // If a timezone prop is provided, normalize to UTC for consumers expecting Z times
        start_time: timeZone ? toUtcSessionIsoString(working.start_time, resolvedTimeZone) : working.start_time,
        end_time: timeZone ? toUtcSessionIsoString(working.end_time, resolvedTimeZone) : working.end_time,
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
  const isDependentDataLoading = (Boolean(clientId) && isProgramsFetching) || (Boolean(clientId) && isGoalsFetching);
  const canStartSession = Boolean(
    session?.id &&
      !hasStartedSession &&
      session?.status !== 'in_progress' &&
      programId &&
      goalId,
  );
  const sessionModalMode = useMemo(() => {
    if (!session) {
      return 'create';
    }
    return isInProgressSession ? 'live' : 'edit';
  }, [session, isInProgressSession]);
  const modalTitle = useMemo(() => {
    if (!session) {
      return 'New Session';
    }
    return isInProgressSession ? 'Live session' : 'Edit Session';
  }, [session, isInProgressSession]);
  const modalSubtitle = useMemo(() => {
    if (!session) {
      return 'Choose therapist, client, time, and plan details before creating this appointment.';
    }
    if (isInProgressSession) {
      return 'Log trials and per-goal notes, then save to sync. Use Close session when the visit ends.';
    }
    return 'Review core details first, then add notes before saving.';
  }, [session, isInProgressSession]);
  const sessionNoteGoalIds = useMemo(
    () => mergeUniqueGoalIds(
      Array.isArray(goalIds) ? goalIds : [],
      sessionNoteStoredGoalIds,
      Object.keys(sessionNoteGoalNotes ?? {}),
      Object.keys(sessionNoteGoalMeasurements ?? {}),
    ),
    [goalIds, sessionNoteGoalMeasurements, sessionNoteGoalNotes, sessionNoteStoredGoalIds],
  );
  const [sessionCaptureTab, setSessionCaptureTab] = useState<'skill' | 'bx'>('skill');
  const [isSessionCaptureNarrow, setIsSessionCaptureNarrow] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.matchMedia?.('(max-width: 639px)')?.matches ?? false;
  });
  const [mobileCaptureOpenGoalId, setMobileCaptureOpenGoalId] = useState<string | null>(null);

  const sessionCaptureSkillGoalIds = useMemo(
    () =>
      sessionNoteGoalIds.filter((id) => showGoalOnSkillCaptureTab(goalsById.get(id), id)),
    [goalsById, sessionNoteGoalIds],
  );
  const sessionCaptureBxGoalIds = useMemo(
    () => sessionNoteGoalIds.filter((id) => showGoalOnBxCaptureTab(goalsById.get(id), id)),
    [goalsById, sessionNoteGoalIds],
  );
  const sessionCaptureGoalIdsForTab = useMemo(() => {
    if (sessionCaptureTab === 'skill') {
      return sessionCaptureSkillGoalIds;
    }
    return sessionCaptureBxGoalIds;
  }, [sessionCaptureBxGoalIds, sessionCaptureSkillGoalIds, sessionCaptureTab]);

  const bumpTrialCount = useCallback(
    (goalId: string, field: 'metric_value' | 'incorrect_trials', delta: number) => {
      const path = `session_note_goal_measurements.${goalId}.data.${field}` as const;
      const raw = getValues(path);
      const cur =
        typeof raw === 'number' && Number.isFinite(raw)
          ? raw
          : typeof raw === 'string' && raw.trim().length > 0
            ? Number(raw)
            : 0;
      const safe = Number.isFinite(cur) ? cur : 0;
      setValue(path, Math.max(0, safe + delta), { shouldDirty: true, shouldTouch: true });
    },
    [getValues, setValue],
  );

  const addAdhocSessionTarget = useCallback(
    (kind: 'skill' | 'bx') => {
      const id = createAdhocSessionTargetId(kind);
      const label = kind === 'skill' ? 'New skill target' : 'New behavior target';
      const ids = [...(getValues('session_note_goal_ids') ?? [])];
      const labels = [...(getValues('session_note_goals_addressed') ?? [])];
      setValue('session_note_goal_ids', [...ids, id], { shouldDirty: true, shouldTouch: true });
      setValue('session_note_goals_addressed', [...labels, label], { shouldDirty: true, shouldTouch: true });
      if (kind === 'bx') {
        setSessionCaptureTab('bx');
      } else {
        setSessionCaptureTab('skill');
      }
    },
    [getValues, setValue],
  );

  const removeAdhocSessionTarget = useCallback(
    (targetId: string) => {
      if (!isAdhocSessionTargetId(targetId)) {
        return;
      }
      const ids = [...(getValues('session_note_goal_ids') ?? [])];
      const idx = ids.indexOf(targetId);
      if (idx === -1) {
        return;
      }
      const labels = [...(getValues('session_note_goals_addressed') ?? [])];
      ids.splice(idx, 1);
      labels.splice(idx, 1);
      setValue('session_note_goal_ids', ids, { shouldDirty: true, shouldTouch: true });
      setValue('session_note_goals_addressed', labels, { shouldDirty: true, shouldTouch: true });
      const notes = { ...(getValues('session_note_goal_notes') ?? {}) };
      delete notes[targetId];
      setValue('session_note_goal_notes', notes, { shouldDirty: true, shouldTouch: true });
      const measurements = { ...(getValues('session_note_goal_measurements') ?? {}) };
      delete measurements[targetId];
      setValue('session_note_goal_measurements', measurements, { shouldDirty: true, shouldTouch: true });
    },
    [getValues, setValue],
  );

  const updateStoredGoalLabelAtId = useCallback(
    (goalId: string, nextLabel: string) => {
      const ids = [...(getValues('session_note_goal_ids') ?? [])];
      const idx = ids.indexOf(goalId);
      if (idx === -1) {
        return;
      }
      const labels = [...(getValues('session_note_goals_addressed') ?? [])];
      labels[idx] = nextLabel;
      setValue('session_note_goals_addressed', labels, { shouldDirty: true, shouldTouch: true });
    },
    [getValues, setValue],
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return;
    }
    const media = window.matchMedia('(max-width: 639px)');
    const syncNarrow = () => {
      setIsSessionCaptureNarrow(media.matches);
    };
    syncNarrow();
    media.addEventListener('change', syncNarrow);
    return () => media.removeEventListener('change', syncNarrow);
  }, []);

  useEffect(() => {
    if (!isSessionCaptureNarrow) {
      return;
    }
    const ids = sessionCaptureGoalIdsForTab;
    if (ids.length === 0) {
      setMobileCaptureOpenGoalId(null);
      return;
    }
    setMobileCaptureOpenGoalId((current) =>
      current != null && ids.includes(current) ? current : ids[0] ?? null,
    );
  }, [isSessionCaptureNarrow, sessionCaptureGoalIdsForTab]);

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
    setValue(
      'session_note_goal_notes',
      (linkedSessionNote.goal_notes as Record<string, string> | null) ?? {},
    );
    setValue(
      'session_note_goal_measurements',
      (linkedSessionNote.goal_measurements as Record<string, unknown> | null) ?? {},
    );
    setValue('session_note_goal_ids', linkedSessionNote.goal_ids ?? []);
    setValue('session_note_goals_addressed', linkedSessionNote.goals_addressed ?? []);
    setValue('session_note_authorization_id', linkedSessionNote.authorization_id ?? '');
    setValue('session_note_service_code', linkedSessionNote.service_code ?? '');
  }, [linkedSessionNote, session?.id, setValue, isDirty]);

  useEffect(() => {
    if (!isOpen) {
      setIsPlanSummaryExpanded(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !isInProgressSession) {
      return;
    }
    setIsPlanSummaryExpanded(false);
  }, [isOpen, isInProgressSession, session?.id]);

  useEffect(() => {
    if (!isOpen || !isInProgressSession) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      sessionCaptureSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen, isInProgressSession, session?.id]);

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
        data-session-modal-mode={sessionModalMode}
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
                {modalTitle}
              </h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {modalSubtitle}
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
        <div className="flex-1 overflow-y-auto px-4 py-4 pb-24 sm:p-5 sm:pb-6 max-sm:pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))]">
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
                className="max-sm:mb-2 max-sm:bg-transparent max-sm:p-0 sm:rounded-lg sm:border sm:border-amber-200 sm:bg-amber-50 sm:p-4 dark:sm:border-amber-900/30 dark:sm:bg-amber-900/20"
              >
                <h3
                  id={conflictHeadingId}
                  className="sr-only sm:mb-2 sm:flex sm:items-center sm:gap-2 sm:not-sr-only sm:text-base sm:font-medium sm:text-amber-800 dark:sm:text-amber-200"
                >
                  <AlertTriangle className="hidden h-5 w-5 sm:block" aria-hidden />
                  Scheduling Conflicts
                </h3>
                {/* Mobile: single compact row + expand; demoted vs large alert card */}
                <details className="group sm:hidden">
                  <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg border border-amber-200/35 bg-amber-50/35 px-2.5 py-2 text-left shadow-none dark:border-amber-800/25 dark:bg-amber-950/20 [&::-webkit-details-marker]:hidden">
                    <AlertTriangle
                      className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 text-[13px] font-medium leading-tight text-amber-950/90 dark:text-amber-100">
                      {conflicts.length} scheduling issue{conflicts.length === 1 ? '' : 's'} — details
                    </span>
                    <ChevronDown
                      className="h-4 w-4 shrink-0 text-amber-700/80 transition-transform group-open:rotate-180 dark:text-amber-300/90"
                      aria-hidden
                    />
                  </summary>
                  <ul className="mt-1.5 max-h-36 space-y-2 overflow-y-auto rounded-md border border-amber-200/30 bg-white/70 px-2.5 py-2 text-[13px] leading-snug text-amber-900 dark:border-amber-800/30 dark:bg-amber-950/35 dark:text-amber-100/95">
                    {conflicts.map((conflict, index) => (
                      <li key={index} className="flex items-start gap-2">
                        <AlertCircle
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400"
                          aria-hidden
                        />
                        <span>{conflict.message}</span>
                      </li>
                    ))}
                  </ul>
                </details>
                <ul className="hidden space-y-2 text-sm text-amber-700 dark:text-amber-300 sm:block">
                  {conflicts.map((conflict, index) => (
                    <li key={index} className="flex items-start">
                      <AlertCircle className="mt-0.5 mr-2 h-4 w-4 flex-shrink-0" />
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
                  You can adjust program and goals while active; save to keep the plan in sync with the schedule.
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

            {(programs.length === 0 || activePrograms.length === 0 || availableProgramGroups.length === 0) && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200 sm:p-4">
                {programs.length === 0 || activePrograms.length === 0
                  ? 'No active programs found for this client. Create or activate a program before starting a session.'
                  : 'No active goals found for this client. Add or activate a goal before starting a session.'}
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
                  onChange={(event) => {
                    const nextProgramId = event.target.value;
                    setValue('program_id', nextProgramId, { shouldDirty: true, shouldTouch: true });
                    if (!nextProgramId) {
                      updateProgramSelection([]);
                      return;
                    }
                    updateProgramSelection([nextProgramId, ...selectedProgramIds.filter((id) => id !== nextProgramId)]);
                  }}
                  className="min-h-11 w-full rounded-md border-gray-300 bg-white shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-dark dark:text-gray-200"
                >
                  <option value="">Select a program</option>
                  {programId && !hasProgramOptionForValue && (
                    <option value={programId}>
                      Current program (unavailable in active list)
                    </option>
                  )}
                  {activePrograms.map((program) => (
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
                  disabled={isGoalsFetching || selectedProgramGoals.length === 0}
                  className="min-h-11 w-full rounded-md border-gray-300 bg-white shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-dark dark:text-gray-200"
                >
                  <option value="">Select a goal</option>
                  {goalId && !hasGoalOptionForValue && (
                    <option value={goalId}>
                      Current goal (unavailable in active list)
                    </option>
                  )}
                  {selectedProgramGoals.map((goal) => (
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

            {availableProgramGroups.length > 0 && (
              <div className="space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Programs in this session</p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Choose one or more programs, then select the goals you want to track without waiting on another fetch.
                    </p>
                  </div>
                  <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 dark:bg-blue-900/20 dark:text-blue-200">
                    {selectedProgramIds.length} selected
                  </span>
                </div>
                <div className="hidden flex-wrap gap-2 sm:flex">
                  {availableProgramGroups.map(({ program, goals: groupedGoals }) => {
                    const isSelected = selectedProgramSet.has(program.id);
                    return (
                      <button
                        key={program.id}
                        type="button"
                        onClick={() => toggleProgramSelection(program.id)}
                        className={`rounded-full border px-3 py-2 text-sm font-medium transition ${
                          isSelected
                            ? 'border-blue-500 bg-blue-600 text-white shadow-sm'
                            : 'border-gray-300 bg-white text-gray-700 hover:border-blue-300 hover:text-blue-700 dark:border-gray-600 dark:bg-dark dark:text-gray-200'
                        }`}
                      >
                        {program.name}
                        <span className={`ml-2 text-[11px] ${isSelected ? 'text-blue-100' : 'text-gray-500 dark:text-gray-400'}`}>
                          {groupedGoals.length} goals
                        </span>
                      </button>
                    );
                  })}
                </div>
                <details
                  className="rounded-lg border border-gray-200 dark:border-gray-700 sm:hidden"
                  open={mobileProgramsExpanded}
                  onToggle={(event) => setMobileProgramsExpanded(event.currentTarget.open)}
                >
                  <summary className="cursor-pointer list-none px-3 py-2.5 [&::-webkit-details-marker]:hidden">
                    <div className="flex min-h-11 items-center justify-between gap-2 text-sm font-medium text-gray-800 dark:text-gray-100">
                      <span>Selected programs</span>
                      <span className="shrink-0 text-xs font-normal text-gray-500 dark:text-gray-400">
                        {selectedProgramIds.length} chosen
                      </span>
                    </div>
                  </summary>
                  <div className="border-t border-gray-200 px-3 pb-3 pt-2 dark:border-gray-700">
                    <div className="grid grid-cols-1 gap-2">
                      {availableProgramGroups.map(({ program, goals: groupedGoals }) => (
                        <label
                          key={`mobile-program-${program.id}`}
                          className="flex min-w-0 items-center gap-2 text-sm text-gray-600 dark:text-gray-300"
                        >
                          <input
                            type="checkbox"
                            checked={selectedProgramSet.has(program.id)}
                            onChange={() => toggleProgramSelection(program.id)}
                            className="h-5 w-5 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="min-w-0 flex-1 truncate">{program.name}</span>
                          <span className="shrink-0 text-[11px] text-gray-500 dark:text-gray-400">
                            {groupedGoals.length} goals
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                </details>
                {selectedPrograms.length > 0 && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Tracking: {selectedPrograms.map((program) => program.name).join(', ')}
                  </p>
                )}
              </div>
            )}
            </div>

            {selectedProgramGoals.length > 0 && (
              <>
                <details className="rounded-lg border border-gray-200 dark:border-gray-700 sm:hidden">
                  <summary className="cursor-pointer list-none px-3 py-2.5 [&::-webkit-details-marker]:hidden">
                    <div className="flex min-h-11 items-center justify-between gap-2 text-sm font-medium text-gray-800 dark:text-gray-100">
                      <span>Additional goals</span>
                      <span className="shrink-0 text-xs font-normal text-gray-500 dark:text-gray-400">
                        {selectedGoalsForSession.length} selected
                      </span>
                    </div>
                  </summary>
                  <div className="space-y-3 border-t border-gray-200 px-3 pb-3 pt-2 dark:border-gray-700">
                    {selectedPrograms.map((program) => {
                      const groupedGoals = activeGoalsByProgram.get(program.id) ?? [];
                      if (groupedGoals.length === 0) {
                        return null;
                      }
                      return (
                        <div key={`mobile-goals-${program.id}`} className="space-y-2">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                            {program.name}
                          </p>
                          <div className="grid grid-cols-1 gap-2">
                            {groupedGoals.map((goal) => (
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
                                  {Array.isArray(goal.objective_data_points) ? goal.objective_data_points.length : 0} pts
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    {selectedPrograms.length === 0 && (
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Select at least one program to choose goals.
                      </p>
                    )}
                    {selectedGoalsSummary && (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Selected goals: {selectedGoalsSummary}
                      </p>
                    )}
                  </div>
                </details>
                <div className="hidden rounded-lg border border-gray-200 p-3 dark:border-gray-700 sm:block">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Goals in this session</p>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {selectedGoalsForSession.length} selected
                    </span>
                  </div>
                  <div className="space-y-3">
                    {selectedPrograms.map((program) => {
                      const groupedGoals = activeGoalsByProgram.get(program.id) ?? [];
                      if (groupedGoals.length === 0) {
                        return null;
                      }
                      return (
                        <div key={`desktop-goals-${program.id}`} className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                            {program.name}
                          </p>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {groupedGoals.map((goal) => (
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
                      );
                    })}
                    {selectedGoalsSummary && (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Selected goals: {selectedGoalsSummary}
                      </p>
                    )}
                    {selectedPrograms.length === 0 && (
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Select at least one program to choose goals.
                      </p>
                    )}
                  </div>
                </div>
              </>
            )}
            {availableProgramGroups.length > 0 && selectedProgramGoals.length === 0 && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-200">
                Select one or more programs above to load goals instantly on mobile and desktop.
              </div>
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
              <section
                ref={sessionCaptureSectionRef}
                className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-4 space-y-4 dark:border-indigo-900/40 dark:bg-indigo-900/10"
                data-testid="session-modal-capture-section"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">Session capture</p>
                    <p className="mt-1 text-xs text-indigo-700 dark:text-indigo-300">
                      Per-goal notes and trial counts save with this session. Ad-hoc skill and behavior rows live on the
                      session note.
                    </p>
                    <details className="mt-2 text-xs text-indigo-700 dark:text-indigo-300">
                      <summary className="cursor-pointer font-semibold text-indigo-800 hover:underline dark:text-indigo-200">
                        Billing, authorization, and full narratives
                      </summary>
                      <p className="mt-2 leading-snug">
                        Billing uses the first approved authorization on file when defaults exist. Full narrative,
                        signatures, and additional measurement fields are completed in Client Details.
                      </p>
                    </details>
                  </div>
                  <div className="flex flex-shrink-0 flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => addAdhocSessionTarget('skill')}
                      className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-800 shadow-sm hover:bg-indigo-50 dark:border-indigo-800 dark:bg-dark-lighter dark:text-indigo-100 dark:hover:bg-indigo-900/30"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden />
                      Add skill
                    </button>
                    <button
                      type="button"
                      onClick={() => addAdhocSessionTarget('bx')}
                      className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-800 shadow-sm hover:bg-indigo-50 dark:border-indigo-800 dark:bg-dark-lighter dark:text-indigo-100 dark:hover:bg-indigo-900/30"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden />
                      Add behavior
                    </button>
                  </div>
                </div>
                {sessionNoteGoalIds.length === 0 ? (
                  <p className="text-sm text-indigo-900/90 dark:text-indigo-200/90">
                    Select program and goals under People &amp; Plan, or tap Add skill / Add behavior to record ad-hoc
                    targets for this session.
                  </p>
                ) : (
                  <>
                    <div
                      className="flex gap-2 border-b border-indigo-200/60 pb-2 dark:border-indigo-800/50"
                      role="tablist"
                      aria-label="Session capture category"
                    >
                      <button
                        type="button"
                        role="tab"
                        aria-selected={sessionCaptureTab === 'skill'}
                        className={`rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition ${
                          sessionCaptureTab === 'skill'
                            ? 'bg-indigo-600 text-white shadow-sm'
                            : 'bg-white/80 text-indigo-800 hover:bg-white dark:bg-dark-lighter dark:text-indigo-100'
                        }`}
                        onClick={() => setSessionCaptureTab('skill')}
                      >
                        Skill
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={sessionCaptureTab === 'bx'}
                        className={`rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition ${
                          sessionCaptureTab === 'bx'
                            ? 'bg-indigo-600 text-white shadow-sm'
                            : 'bg-white/80 text-indigo-800 hover:bg-white dark:bg-dark-lighter dark:text-indigo-100'
                        }`}
                        onClick={() => setSessionCaptureTab('bx')}
                      >
                        BX
                      </button>
                    </div>
                    {isInProgressSession ? (
                      <div
                        className="flex flex-col gap-2 rounded-lg border border-indigo-200/80 bg-white/95 p-3 shadow-sm dark:border-indigo-800/60 dark:bg-dark-lighter/90"
                        data-testid="session-modal-capture-save-row"
                      >
                        <p className="text-[11px] leading-snug text-indigo-800 dark:text-indigo-200">
                          Each button writes only that tab&apos;s goal rows to the session note; the other tab keeps its
                          last saved values until you save it or use Save progress for everything.
                        </p>
                        <div className="flex flex-wrap gap-2" role="group" aria-label="Save session capture">
                          <button
                            type="button"
                            data-testid="session-modal-save-capture-skills"
                            disabled={
                              isSubmitting ||
                              isDependentDataLoading ||
                              isLoadingAlternatives ||
                              sessionCaptureSkillGoalIds.length === 0
                            }
                            onClick={() =>
                              void handleSubmit((fd) =>
                                handleFormSubmit(fd, { captureMergeGoalIds: sessionCaptureSkillGoalIds }),
                              )()
                            }
                            className="inline-flex min-h-10 flex-1 items-center justify-center rounded-lg border border-indigo-300 bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-500 dark:focus:ring-offset-dark sm:text-sm"
                          >
                            Save skills
                          </button>
                          <button
                            type="button"
                            data-testid="session-modal-save-capture-behaviors"
                            disabled={
                              isSubmitting ||
                              isDependentDataLoading ||
                              isLoadingAlternatives ||
                              sessionCaptureBxGoalIds.length === 0
                            }
                            onClick={() =>
                              void handleSubmit((fd) =>
                                handleFormSubmit(fd, { captureMergeGoalIds: sessionCaptureBxGoalIds }),
                              )()
                            }
                            className="inline-flex min-h-10 flex-1 items-center justify-center rounded-lg border border-violet-300 bg-violet-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-violet-500 dark:focus:ring-offset-dark sm:text-sm"
                          >
                            Save behaviors
                          </button>
                        </div>
                      </div>
                    ) : null}
                    {sessionCaptureGoalIdsForTab.length === 0 ? (
                      <p className="text-sm text-indigo-900/90 dark:text-indigo-200/90">
                        No targets on this tab. Switch tabs, add an ad-hoc target above, or adjust goals under People
                        &amp; Plan.
                      </p>
                    ) : (
                      <div className="space-y-4">
                        {sessionCaptureGoalIdsForTab.map((selectedGoalId) => {
                          const selectedGoal = goalsById.get(selectedGoalId);
                          const storedTitleIndex = sessionNoteStoredGoalIds?.indexOf(selectedGoalId) ?? -1;
                          const storedTitle =
                            storedTitleIndex >= 0 ? sessionNoteGoalsAddressed?.[storedTitleIndex] ?? '' : '';
                          const measurementFieldMeta = getGoalMeasurementFieldMeta(selectedGoal);
                          const existingMeasurementEntry = normalizeGoalMeasurementEntry(
                            sessionNoteGoalMeasurements?.[selectedGoalId],
                            selectedGoal,
                          );
                          const minTrials = getTherapistMinTrialsTarget(selectedGoal);
                          const fieldKey = `session_note_goal_notes.${selectedGoalId}` as const;
                          const metricValueFieldKey =
                            `session_note_goal_measurements.${selectedGoalId}.data.metric_value` as const;
                          const incorrectTrialsFieldKey =
                            `session_note_goal_measurements.${selectedGoalId}.data.incorrect_trials` as const;
                          const trialPromptNoteFieldKey =
                            `session_note_goal_measurements.${selectedGoalId}.data.trial_prompt_note` as const;
                          const metricLabelFieldKey =
                            `session_note_goal_measurements.${selectedGoalId}.data.metric_label` as const;
                          const metricUnitFieldKey =
                            `session_note_goal_measurements.${selectedGoalId}.data.metric_unit` as const;
                          const measurementTypeFieldKey =
                            `session_note_goal_measurements.${selectedGoalId}.data.measurement_type` as const;
                          const opportunitiesFieldKey =
                            `session_note_goal_measurements.${selectedGoalId}.data.opportunities` as const;
                          const promptLevelFieldKey =
                            `session_note_goal_measurements.${selectedGoalId}.data.prompt_level` as const;
                          const noteFieldKey =
                            `session_note_goal_measurements.${selectedGoalId}.data.note` as const;
                          const correctWatch = watch(metricValueFieldKey);
                          const incorrectWatch = watch(incorrectTrialsFieldKey);
                          const correctDisplay =
                            typeof correctWatch === 'number' && Number.isFinite(correctWatch)
                              ? correctWatch
                              : Number(correctWatch) || 0;
                          const incorrectDisplay =
                            typeof incorrectWatch === 'number' && Number.isFinite(incorrectWatch)
                              ? incorrectWatch
                              : Number(incorrectWatch) || 0;
                          const mobileGoalSummaryLabel = isAdhocSessionTargetId(selectedGoalId)
                            ? (storedTitle.trim() ? storedTitle : 'Ad-hoc target')
                            : (selectedGoal?.title ?? selectedGoalId);
                          const captureDetailsOpen =
                            !isSessionCaptureNarrow || mobileCaptureOpenGoalId === selectedGoalId;
                          return (
                            <details
                              key={selectedGoalId}
                              open={captureDetailsOpen}
                              onToggle={(event) => {
                                if (!isSessionCaptureNarrow) {
                                  return;
                                }
                                setMobileCaptureOpenGoalId(
                                  event.currentTarget.open ? selectedGoalId : null,
                                );
                              }}
                              className="group rounded-lg border border-indigo-100 bg-white/80 p-3 dark:border-indigo-900/40 dark:bg-dark-lighter/40"
                              data-testid={`session-modal-goal-capture-${selectedGoalId}`}
                            >
                              <summary className="mb-0 flex cursor-pointer list-none items-center gap-2 rounded-md px-0.5 py-1 sm:hidden [&::-webkit-details-marker]:hidden">
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-left text-xs font-semibold uppercase tracking-wide text-indigo-800 dark:text-indigo-200">
                                    {mobileGoalSummaryLabel}
                                  </p>
                                  <p className="mt-0.5 text-left text-[11px] tabular-nums text-gray-600 dark:text-gray-400">
                                    Trials +{correctDisplay} · −{incorrectDisplay}
                                  </p>
                                </div>
                                {isAdhocSessionTargetId(selectedGoalId) ? (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      removeAdhocSessionTarget(selectedGoalId);
                                    }}
                                    className="shrink-0 rounded-full p-2 text-indigo-700 hover:bg-indigo-100 dark:text-indigo-200 dark:hover:bg-indigo-900/40"
                                    aria-label="Remove ad-hoc target"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                ) : null}
                                <ChevronDown
                                  className="h-4 w-4 shrink-0 text-indigo-700 transition-transform group-open:rotate-180 dark:text-indigo-200"
                                  aria-hidden
                                />
                              </summary>
                              <div className="hidden sm:flex sm:items-start sm:justify-between sm:gap-2">
                                {isAdhocSessionTargetId(selectedGoalId) ? (
                                  <div className="min-w-0 flex-1">
                                    <label
                                      htmlFor={`adhoc-title-${selectedGoalId}`}
                                      className="block text-[11px] font-medium uppercase tracking-wide text-indigo-800 dark:text-indigo-200"
                                    >
                                      Target title
                                    </label>
                                    <input
                                      id={`adhoc-title-${selectedGoalId}`}
                                      value={storedTitle}
                                      onChange={(event) =>
                                        updateStoredGoalLabelAtId(selectedGoalId, event.target.value)
                                      }
                                      className="mt-1 w-full rounded-md border border-indigo-200 bg-white px-2 py-1.5 text-sm font-semibold text-indigo-900 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-indigo-800 dark:bg-dark dark:text-indigo-100"
                                      placeholder="Name this target"
                                      autoComplete="off"
                                    />
                                  </div>
                                ) : (
                                  <p className="text-xs font-semibold uppercase tracking-wide text-indigo-800 dark:text-indigo-200">
                                    {selectedGoal?.title ?? selectedGoalId}
                                  </p>
                                )}
                                {isAdhocSessionTargetId(selectedGoalId) && (
                                  <button
                                    type="button"
                                    onClick={() => removeAdhocSessionTarget(selectedGoalId)}
                                    className="shrink-0 rounded-full p-2 text-indigo-700 hover:bg-indigo-100 dark:text-indigo-200 dark:hover:bg-indigo-900/40"
                                    aria-label="Remove ad-hoc target"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                )}
                              </div>
                              {isAdhocSessionTargetId(selectedGoalId) ? (
                                <div className="mt-3 sm:hidden">
                                  <label
                                    htmlFor={`adhoc-title-mobile-${selectedGoalId}`}
                                    className="block text-[11px] font-medium uppercase tracking-wide text-indigo-800 dark:text-indigo-200"
                                  >
                                    Target title
                                  </label>
                                  <input
                                    id={`adhoc-title-mobile-${selectedGoalId}`}
                                    value={storedTitle}
                                    onChange={(event) =>
                                      updateStoredGoalLabelAtId(selectedGoalId, event.target.value)
                                    }
                                    className="mt-1 w-full rounded-md border border-indigo-200 bg-white px-2 py-1.5 text-sm font-semibold text-indigo-900 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-indigo-800 dark:bg-dark dark:text-indigo-100"
                                    placeholder="Name this target"
                                    autoComplete="off"
                                  />
                                </div>
                              ) : null}
                              <label
                                htmlFor={`goal-note-${selectedGoalId}`}
                                className="mt-3 block text-xs font-medium text-gray-600 dark:text-gray-300 sm:mt-2"
                              >
                                Per-goal note
                              </label>
                              <textarea
                                id={`goal-note-${selectedGoalId}`}
                                {...register(fieldKey)}
                                rows={2}
                                className="mt-1 w-full rounded-md border-gray-300 bg-white shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-dark dark:text-gray-200"
                                placeholder="Add progress notes for this goal..."
                              />
                              <input
                                type="hidden"
                                {...register(metricLabelFieldKey)}
                                defaultValue={existingMeasurementEntry?.data.metric_label ?? measurementFieldMeta.primaryLabel}
                              />
                              <input
                                type="hidden"
                                {...register(metricUnitFieldKey)}
                                defaultValue={existingMeasurementEntry?.data.metric_unit ?? measurementFieldMeta.primaryUnit ?? ''}
                              />
                              <input
                                type="hidden"
                                {...register(measurementTypeFieldKey)}
                                defaultValue={existingMeasurementEntry?.data.measurement_type ?? selectedGoal?.measurement_type ?? ''}
                              />
                              <input
                                type="hidden"
                                {...register(opportunitiesFieldKey, { setValueAs: toFormNumber })}
                                defaultValue={toFormNumber(existingMeasurementEntry?.data.opportunities)}
                              />
                              <input
                                type="hidden"
                                {...register(promptLevelFieldKey)}
                                defaultValue={existingMeasurementEntry?.data.prompt_level ?? ''}
                              />
                              <input
                                type="hidden"
                                {...register(noteFieldKey)}
                                defaultValue={existingMeasurementEntry?.data.note ?? ''}
                              />
                              <div className="mt-3 rounded-md border border-indigo-100 bg-indigo-50/70 p-3 dark:border-indigo-900/40 dark:bg-indigo-900/10">
                                <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-200">
                                  Trials
                                </p>
                                <p className="mt-1 text-[11px] text-indigo-700/90 dark:text-indigo-200/80">
                                  + correct or achieved · − incorrect or no response. Admin or BCBA can complete
                                  additional measurement fields in Client Details.
                                </p>
                                {minTrials != null && (
                                  <p className="mt-2 text-[11px] font-medium text-indigo-800 dark:text-indigo-100">
                                    Min trials (therapist target): {minTrials}
                                  </p>
                                )}
                                <div className="mt-3 flex flex-wrap items-center gap-3">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300">+</span>
                                    <button
                                      type="button"
                                      aria-label="Increase correct trials"
                                      className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 text-lg font-bold text-white shadow-sm hover:bg-emerald-700"
                                      onClick={() => bumpTrialCount(selectedGoalId, 'metric_value', 1)}
                                    >
                                      +
                                    </button>
                                    <span className="min-w-[2rem] rounded-md border border-gray-200 bg-white px-2 py-1 text-center text-sm dark:border-gray-600 dark:bg-dark">
                                      {correctDisplay}
                                    </span>
                                    <button
                                      type="button"
                                      aria-label="Decrease correct trials"
                                      className="flex h-10 w-10 items-center justify-center rounded-full border border-emerald-700 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-400 dark:text-emerald-200"
                                      onClick={() => bumpTrialCount(selectedGoalId, 'metric_value', -1)}
                                    >
                                      −
                                    </button>
                                    <button
                                      type="button"
                                      aria-label="Add 5 correct trials"
                                      className="rounded-md border border-emerald-200 bg-white px-2 py-1 text-[11px] font-semibold text-emerald-800 shadow-sm hover:bg-emerald-50 dark:border-emerald-800 dark:bg-dark-lighter dark:text-emerald-100 dark:hover:bg-emerald-950/40"
                                      onClick={() => bumpTrialCount(selectedGoalId, 'metric_value', 5)}
                                    >
                                      +5
                                    </button>
                                    <button
                                      type="button"
                                      aria-label="Subtract 5 correct trials"
                                      disabled={correctDisplay < 5}
                                      className="rounded-md border border-emerald-200 bg-white px-2 py-1 text-[11px] font-semibold text-emerald-800 shadow-sm hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-emerald-800 dark:bg-dark-lighter dark:text-emerald-100 dark:hover:bg-emerald-950/40"
                                      onClick={() => bumpTrialCount(selectedGoalId, 'metric_value', -5)}
                                    >
                                      −5
                                    </button>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300">−</span>
                                    <button
                                      type="button"
                                      aria-label="Increase incorrect or no-response trials"
                                      className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-600 text-lg font-bold text-white shadow-sm hover:bg-rose-700"
                                      onClick={() => bumpTrialCount(selectedGoalId, 'incorrect_trials', 1)}
                                    >
                                      +
                                    </button>
                                    <span className="min-w-[2rem] rounded-md border border-gray-200 bg-white px-2 py-1 text-center text-sm dark:border-gray-600 dark:bg-dark">
                                      {incorrectDisplay}
                                    </span>
                                    <button
                                      type="button"
                                      aria-label="Decrease incorrect trials"
                                      className="flex h-10 w-10 items-center justify-center rounded-full border border-rose-700 text-rose-700 hover:bg-rose-50 dark:border-rose-400 dark:text-rose-200"
                                      onClick={() => bumpTrialCount(selectedGoalId, 'incorrect_trials', -1)}
                                    >
                                      −
                                    </button>
                                    <button
                                      type="button"
                                      aria-label="Add 5 incorrect or no-response trials"
                                      className="rounded-md border border-rose-200 bg-white px-2 py-1 text-[11px] font-semibold text-rose-800 shadow-sm hover:bg-rose-50 dark:border-rose-800 dark:bg-dark-lighter dark:text-rose-100 dark:hover:bg-rose-950/40"
                                      onClick={() => bumpTrialCount(selectedGoalId, 'incorrect_trials', 5)}
                                    >
                                      +5
                                    </button>
                                    <button
                                      type="button"
                                      aria-label="Subtract 5 incorrect trials"
                                      disabled={incorrectDisplay < 5}
                                      className="rounded-md border border-rose-200 bg-white px-2 py-1 text-[11px] font-semibold text-rose-800 shadow-sm hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-rose-800 dark:bg-dark-lighter dark:text-rose-100 dark:hover:bg-rose-950/40"
                                      onClick={() => bumpTrialCount(selectedGoalId, 'incorrect_trials', -5)}
                                    >
                                      −5
                                    </button>
                                  </div>
                                </div>
                                <input
                                  type="number"
                                  className="sr-only"
                                  tabIndex={-1}
                                  aria-hidden
                                  {...register(metricValueFieldKey, { setValueAs: toFormNumber })}
                                  defaultValue={toFormNumber(existingMeasurementEntry?.data.metric_value) ?? ''}
                                />
                                <input
                                  type="number"
                                  className="sr-only"
                                  tabIndex={-1}
                                  aria-hidden
                                  {...register(incorrectTrialsFieldKey, { setValueAs: toFormNumber })}
                                  defaultValue={toFormNumber(existingMeasurementEntry?.data.incorrect_trials) ?? ''}
                                />
                                <label
                                  htmlFor={`trial-prompt-note-${selectedGoalId}`}
                                  className="mt-3 block text-xs font-medium text-gray-600 dark:text-gray-300"
                                >
                                  Prompts &amp; reactions (verbal / physical)
                                </label>
                                <textarea
                                  id={`trial-prompt-note-${selectedGoalId}`}
                                  {...register(trialPromptNoteFieldKey)}
                                  rows={2}
                                  className="mt-1 w-full rounded-md border-gray-300 bg-white text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-dark dark:text-gray-200"
                                  placeholder="Record prompts used and client reactions for these trials..."
                                />
                              </div>
                            </details>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </section>
            )}
          </form>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 z-10 border-t border-gray-200/80 bg-white/90 px-4 py-2 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] backdrop-blur-md dark:border-gray-700 dark:bg-dark-lighter/90 sm:px-5 sm:py-4 sm:pb-4">
          <div className="flex flex-col gap-3">
            <div
              role="group"
              aria-label="Session actions"
              className="flex flex-wrap items-center justify-center gap-2 border-b border-gray-200/70 pb-2 dark:border-gray-700/80 sm:justify-end sm:border-0 sm:pb-0"
            >
              <button
                type="button"
                onClick={handleAttemptClose}
                disabled={isSubmitting}
                className="min-h-11 shrink-0 rounded-full px-4 text-sm font-medium text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800 sm:min-h-11 sm:w-auto sm:rounded-md sm:border sm:border-gray-300 sm:bg-white sm:px-4 sm:text-gray-700 sm:shadow-sm sm:hover:bg-gray-50"
              >
                Cancel
              </button>
              {session?.id && session.status === 'scheduled' && !hasStartedSession ? (
                <button
                  type="button"
                  onClick={handleStartSession}
                  disabled={!canStartSession || isDependentDataLoading}
                  className="min-h-11 shrink-0 rounded-full px-3 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:text-emerald-300 dark:hover:bg-emerald-950/40 sm:min-h-11 sm:w-auto sm:rounded-md sm:border sm:border-emerald-200 sm:bg-emerald-50/90 sm:px-4 sm:font-medium sm:text-emerald-800 sm:shadow-sm sm:hover:bg-emerald-100"
                >
                  Start Session
                </button>
              ) : null}
              {session?.id && isInProgressSession ? (
                <button
                  type="button"
                  onClick={handleCloseSession}
                  disabled={isSubmitting || isDependentDataLoading || isLoadingAlternatives}
                  className="min-h-11 shrink-0 rounded-full px-3 text-sm font-semibold text-violet-700 hover:bg-violet-50 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:text-violet-300 dark:hover:bg-violet-950/40 sm:min-h-11 sm:w-auto sm:rounded-md sm:border sm:border-violet-200 sm:bg-violet-50/90 sm:px-4 sm:font-medium sm:text-violet-800 sm:shadow-sm sm:hover:bg-violet-100"
                >
                  Close Session
                </button>
              ) : null}
            </div>
            <div className="flex justify-center sm:justify-end">
              <button
                type="submit"
                form="session-form"
                disabled={isSubmitting || isDependentDataLoading || isLoadingAlternatives}
                className="flex min-h-12 w-full items-center justify-center rounded-xl border border-transparent bg-blue-600 px-4 py-2.5 text-base font-semibold text-white shadow-lg shadow-blue-600/25 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-11 sm:w-auto sm:min-w-[12rem] sm:rounded-md sm:py-2 sm:text-sm sm:font-medium sm:shadow-sm sm:shadow-none"
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
                      ? (isInProgressSession ? 'Save progress' : 'Update Session')
                      : 'Create Session'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
