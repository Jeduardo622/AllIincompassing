import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Calendar, Clock, FileText, CheckCircle } from 'lucide-react';
import type { Goal, Program, SessionGoalMeasurementEntry, SessionNote, Therapist } from '../types';
import {
  buildGoalMeasurementEntry,
  getGoalMeasurementFieldMeta,
  mergeGoalMeasurementEntry,
  mergeUniqueGoalIds,
} from '../lib/goal-measurements';
import { useActiveOrganizationId } from '../lib/organization';
import { showError } from '../lib/toast';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/authContext';

interface AddSessionNoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (note: SessionNoteFormValues) => void;
  therapists: Therapist[];
  clientId: string;
  selectedAuth?: string;
  isSaving?: boolean;
  existingNote?: SessionNote | null;
}

export interface SessionNoteFormValues {
  id?: string;
  date: string;
  start_time: string;
  end_time: string;
  service_code: string;
  therapist_id: string;
  therapist_name: string;
  goals_addressed: string[];
  goal_ids: string[];
  goal_notes?: Record<string, string> | null;
  goal_measurements?: Record<string, SessionGoalMeasurementEntry> | null;
  session_id?: string | null;
  narrative: string;
  is_locked: boolean;
}

const MAX_GOAL_NOTE_LENGTH = 5000;

const toOptionalNumber = (value: string): number | null => {
  if (value.trim().length === 0) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toOptionalString = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

function useMinWidthSm(): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') {
      return true;
    }
    return window.matchMedia('(min-width: 640px)').matches;
  });

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 640px)');
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return matches;
}

export function AddSessionNoteModal({
  isOpen,
  onClose,
  onSubmit,
  therapists,
  clientId,
  selectedAuth,
  isSaving = false,
  existingNote = null,
}: AddSessionNoteModalProps) {
  const { profile } = useAuth();
  const canLockSessionNotes = profile?.role === 'admin' || profile?.role === 'super_admin';
  const organizationId = useActiveOrganizationId();
  const isMinWidthSm = useMinWidthSm();
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [serviceCode, setServiceCode] = useState('97153');
  const [therapistId, setTherapistId] = useState('');
  const [selectedGoalIds, setSelectedGoalIds] = useState<string[]>([]);
  const [goalNotes, setGoalNotes] = useState<Record<string, string>>({});
  const [goalMeasurements, setGoalMeasurements] = useState<Record<string, SessionGoalMeasurementEntry>>({});
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [narrative, setNarrative] = useState('');
  const [isLocked, setIsLocked] = useState(false);
  /** Mobile goals bank disclosure; default open for scannability and test environments without CSS breakpoints. */
  const [mobileGoalsDisclosureOpen, setMobileGoalsDisclosureOpen] = useState(true);
  const isEditingUnlinkedNote = Boolean(existingNote?.id) && !existingNote?.session_id;

  // ---------------------------------------------------------------------------
  // Programs — still loaded for goal group headers (display only).
  // The program <select> has been removed; goals are now fetched client-wide.
  // ---------------------------------------------------------------------------
  const { data: programs = [], isLoading: isLoadingPrograms } = useQuery({
    queryKey: ['client-programs', clientId, organizationId ?? 'MISSING_ORG'],
    queryFn: async () => {
      if (!clientId || !organizationId) {
        return [];
      }
      const { data, error } = await supabase
        .from('programs')
        .select('id, name, status, client_id')
        .eq('client_id', clientId)
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });

      if (error) {
        throw error;
      }
      return (data ?? []) as Program[];
    },
    enabled: Boolean(clientId && organizationId),
  });

  // Client-scoped goals query — fetches all goals regardless of program.
  const { data: goals = [], isLoading: isLoadingGoals } = useQuery({
    queryKey: ['client-goals', clientId, organizationId ?? 'MISSING_ORG'],
    queryFn: async () => {
      if (!clientId || !organizationId) {
        return [];
      }
      const { data, error } = await supabase
        .from('goals')
        .select(
          'id, title, status, program_id, measurement_type, baseline_data, target_criteria, mastery_criteria, maintenance_criteria, generalization_criteria, objective_data_points',
        )
        .eq('client_id', clientId)
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });

      if (error) {
        throw error;
      }
      return (data ?? []) as Goal[];
    },
    enabled: Boolean(clientId && organizationId),
  });

  const availableGoals = useMemo(
    () => goals.filter((goal) => goal.status !== 'archived'),
    [goals],
  );

  // Goals grouped by program_id, ordered by the programs array.
  const goalsByProgram = useMemo(() => {
    const map = new Map<string, Goal[]>();
    for (const goal of availableGoals) {
      const pid = goal.program_id ?? '__unknown__';
      if (!map.has(pid)) map.set(pid, []);
      map.get(pid)!.push(goal);
    }
    return map;
  }, [availableGoals]);

  // Programs that have at least one non-archived goal, in fetch order.
  const programsWithGoals = useMemo(
    () => programs.filter((p) => goalsByProgram.has(p.id)),
    [programs, goalsByProgram],
  );

  const { data: sessions = [], isLoading: isLoadingSessions } = useQuery({
    queryKey: ['client-sessions', clientId, organizationId ?? 'MISSING_ORG'],
    queryFn: async () => {
      if (!clientId || !organizationId) {
        return [];
      }
      const { data, error } = await supabase
        .from('sessions')
        .select('id, start_time, end_time, therapist_id, therapist:therapist_id(full_name)')
        .eq('client_id', clientId)
        .eq('organization_id', organizationId)
        .order('start_time', { ascending: false })
        .limit(50);

      if (error) {
        throw error;
      }
      return (data ?? []) as Array<{
        id: string;
        start_time: string;
        end_time: string;
        therapist_id: string;
        therapist: { full_name: string | null } | null;
      }>;
    },
    enabled: Boolean(clientId && organizationId),
  });

  const hasSessions = sessions.length > 0;

  // Tracks which session ID has already been auto-populated so that manual
  // edits the therapist makes after auto-population are not overwritten on
  // subsequent renders.
  const appliedForSession = useRef<string | null>(null);

  // Fetch session_goals when a session is linked.  This is the authoritative
  // list of goals that were worked during that session, written by sessions-start.
  const { data: sessionGoalsData } = useQuery({
    queryKey: ['session-goals-for-note', selectedSessionId, organizationId ?? 'MISSING_ORG'],
    queryFn: async () => {
      if (!selectedSessionId || !organizationId) {
        return [];
      }
      const { data, error } = await supabase
        .from('session_goals')
        .select('goal_id, program_id')
        .eq('session_id', selectedSessionId)
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: true });
      if (error) {
        throw error;
      }
      return (data ?? []) as Array<{ goal_id: string; program_id: string }>;
    },
    enabled: Boolean(selectedSessionId && organizationId),
  });

  // Pre-populate goals from session_goals when a session is linked.
  //
  // Handles both orderings:
  //   (a) goals load first  — waits for sessionGoalsData
  //   (b) session_goals arrives first — waits for goals
  //   (c) both ready simultaneously — applies immediately
  //
  // The appliedForSession ref ensures pre-selection fires exactly once per
  // session ID so that any manual edits the therapist makes afterwards are
  // preserved.  The ref is reset in resetForm() when the modal closes.
  useEffect(() => {
    if (!sessionGoalsData || sessionGoalsData.length === 0 || goals.length === 0) {
      return;
    }
    if (selectedSessionId && selectedSessionId === appliedForSession.current) {
      return;
    }

    const goalIds = sessionGoalsData.map((sg) => sg.goal_id);
    const validIds = goals
      .filter((g) => g.status !== 'archived' && goalIds.includes(g.id))
      .map((g) => g.id);

    if (validIds.length > 0) {
      setSelectedGoalIds(validIds);
      appliedForSession.current = selectedSessionId;
    }
  }, [sessionGoalsData, goals, selectedSessionId]);

  const toggleGoalSelection = (goalId: string) => {
    setSelectedGoalIds((prev) => {
      if (prev.includes(goalId)) {
        // Remove the per-goal note when the goal is deselected.
        setGoalNotes((n) => {
          const next = { ...n };
          delete next[goalId];
          return next;
        });
        setGoalMeasurements((measurements) => {
          const next = { ...measurements };
          delete next[goalId];
          return next;
        });
        return prev.filter((id) => id !== goalId);
      }
      return [...prev, goalId];
    });
  };

  const updateGoalNote = (goalId: string, text: string) => {
    setGoalNotes((prev) => ({ ...prev, [goalId]: text }));
  };

  const updateGoalMeasurement = (
    goal: Goal,
    updates: Partial<SessionGoalMeasurementEntry['data']>,
  ) => {
    setGoalMeasurements((prev) => {
      const nextEntry = mergeGoalMeasurementEntry(goal, prev[goal.id], updates);

      if (!nextEntry) {
        const next = { ...prev };
        delete next[goal.id];
        return next;
      }

      return { ...prev, [goal.id]: nextEntry };
    });
  };

  useEffect(() => {
    if (!hasSessions || selectedSessionId || isEditingUnlinkedNote) {
      return;
    }

    const findBestMatch = () => {
      const targetDate = date;
      const targetStart = startTime;
      const targetEnd = endTime;
      const targetTherapist = therapistId;

      const formatLocalDate = (value: string) => {
        const local = new Date(value);
        const year = local.getFullYear();
        const month = String(local.getMonth() + 1).padStart(2, '0');
        const day = String(local.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };

      const formatLocalTime = (value: string) => {
        const local = new Date(value);
        const hours = String(local.getHours()).padStart(2, '0');
        const minutes = String(local.getMinutes()).padStart(2, '0');
        return `${hours}:${minutes}`;
      };

      const exactMatch = sessions.find((session) => {
        const sessionDate = formatLocalDate(session.start_time);
        const sessionStart = formatLocalTime(session.start_time);
        const sessionEnd = formatLocalTime(session.end_time);
        const matchesTherapist = targetTherapist.length === 0 || session.therapist_id === targetTherapist;
        return sessionDate === targetDate && sessionStart === targetStart && sessionEnd === targetEnd && matchesTherapist;
      });

      if (exactMatch) {
        return exactMatch.id;
      }

      const sameDay = sessions.find((session) => {
        const sessionDate = formatLocalDate(session.start_time);
        return sessionDate === targetDate;
      });

      return sameDay?.id ?? sessions[0]?.id ?? '';
    };

    const nextSessionId = findBestMatch();
    if (nextSessionId) {
      setSelectedSessionId(nextSessionId);
    }
  }, [date, endTime, hasSessions, isEditingUnlinkedNote, sessions, selectedSessionId, startTime, therapistId]);

  const resetForm = () => {
    setDate(new Date().toISOString().split('T')[0]);
    setStartTime('09:00');
    setEndTime('10:00');
    setServiceCode('97153');
    setTherapistId('');
    setSelectedGoalIds([]);
    setGoalNotes({});
    setGoalMeasurements({});
    setSelectedSessionId('');
    setNarrative('');
    setIsLocked(false);
    appliedForSession.current = null;
  };

  useEffect(() => {
    if (!isOpen) {
      resetForm();
    } else {
      setMobileGoalsDisclosureOpen(true);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (!existingNote) {
      return;
    }

    const hydratedGoalNotes = existingNote.goal_notes ?? {};
    const hydratedGoalMeasurements = existingNote.goal_measurements ?? {};
    const hydratedGoalIds = mergeUniqueGoalIds(
      existingNote.goal_ids ?? [],
      Object.keys(hydratedGoalNotes),
      Object.keys(hydratedGoalMeasurements),
      { trimValues: true },
    );

    setDate(existingNote.date ?? new Date().toISOString().split('T')[0]);
    setStartTime(existingNote.start_time?.slice(0, 5) ?? '09:00');
    setEndTime(existingNote.end_time?.slice(0, 5) ?? '10:00');
    setServiceCode(existingNote.service_code ?? '97153');
    setTherapistId(existingNote.therapist_id ?? '');
    setSelectedGoalIds(hydratedGoalIds);
    setGoalNotes(hydratedGoalNotes);
    setGoalMeasurements(hydratedGoalMeasurements);
    setSelectedSessionId(existingNote.session_id ?? '');
    setNarrative(existingNote.narrative ?? '');
    setIsLocked(Boolean(existingNote.is_locked));
    appliedForSession.current = existingNote.session_id ?? null;
  }, [existingNote, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (!selectedAuth) {
      showError('Select an authorization before adding a session note');
      return;
    }

    if (!date) {
      showError('Session date is required');
      return;
    }

    if (!startTime) {
      showError('Start time is required');
      return;
    }

    if (!endTime) {
      showError('End time is required');
      return;
    }

    if (!serviceCode) {
      showError('Service code is required');
      return;
    }

    if (!therapistId) {
      showError('Therapist is required');
      return;
    }

    if (hasSessions && !selectedSessionId && !isEditingUnlinkedNote) {
      showError('Select a scheduled session to link this note.');
      return;
    }

    if (availableGoals.length === 0 && !isLoadingGoals && !isLoadingPrograms) {
      showError('Add goals to a program before logging this note.');
      return;
    }

    if (selectedGoalIds.length === 0) {
      showError('Select at least one goal from the goals bank.');
      return;
    }

    // Every selected goal must have a non-empty note within the character limit.
    for (const goalId of selectedGoalIds) {
      const note = (goalNotes[goalId] ?? '').trim();
      if (!note) {
        const goalTitle = availableGoals.find((g) => g.id === goalId)?.title ?? goalId;
        showError(`A note is required for goal: ${goalTitle}`);
        return;
      }
      if (note.length > MAX_GOAL_NOTE_LENGTH) {
        const goalTitle = availableGoals.find((g) => g.id === goalId)?.title ?? goalId;
        showError(`Note for "${goalTitle}" exceeds ${MAX_GOAL_NOTE_LENGTH.toLocaleString()} characters.`);
        return;
      }
    }

    const submittedGoalIds = mergeUniqueGoalIds(
      selectedGoalIds,
      Object.keys(goalNotes),
      Object.keys(goalMeasurements),
      { trimValues: true },
    );
    const selectedTherapist = therapists.find((t) => t.id === therapistId);
    const existingGoalLabelsById = new Map(
      (existingNote?.goal_ids ?? []).map((goalId, index) => [goalId, existingNote?.goals_addressed?.[index] ?? goalId]),
    );
    const selectedGoalTitles = submittedGoalIds.map((goalId) => {
      const availableGoal = availableGoals.find((goal) => goal.id === goalId);
      return availableGoal?.title ?? existingGoalLabelsById.get(goalId) ?? goalId;
    });

    // Build goal_notes map — preserve any hydrated note content unless the therapist explicitly removed it.
    const submittedGoalNotes: Record<string, string> = {};
    for (const goalId of submittedGoalIds) {
      const trimmedNote = (goalNotes[goalId] ?? '').trim();
      if (trimmedNote) {
        submittedGoalNotes[goalId] = trimmedNote;
      }
    }
    const submittedGoalMeasurements = Object.fromEntries(
      submittedGoalIds
        .map((goalId) => {
          const goal = availableGoals.find((entry) => entry.id === goalId);
          const entry = buildGoalMeasurementEntry(goal, goalMeasurements[goalId]);
          return entry ? [goalId, entry] : null;
        })
        .filter((entry): entry is [string, SessionGoalMeasurementEntry] => Boolean(entry)),
    );

    onSubmit({
      id: existingNote?.id,
      date,
      start_time: startTime,
      end_time: endTime,
      service_code: serviceCode,
      therapist_id: therapistId,
      therapist_name: selectedTherapist?.full_name || 'Unknown Therapist',
      goals_addressed: selectedGoalTitles,
      goal_ids: submittedGoalIds,
      goal_notes: Object.keys(submittedGoalNotes).length > 0 ? submittedGoalNotes : null,
      goal_measurements: Object.keys(submittedGoalMeasurements).length > 0 ? submittedGoalMeasurements : null,
      session_id: selectedSessionId || null,
      narrative,
      is_locked: isLocked,
    });
  };

  const renderGoalsBankBody = () => (
    <div className="space-y-4">
      {programsWithGoals.map((program) => {
        const programGoals = goalsByProgram.get(program.id) ?? [];
        return (
          <div key={program.id}>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {program.name}
            </p>
            <div className="space-y-3">
              {programGoals.map((goal) => {
                const isSelected = selectedGoalIds.includes(goal.id);
                const noteText = goalNotes[goal.id] ?? '';
                const measurementEntry = buildGoalMeasurementEntry(goal, goalMeasurements[goal.id]);
                const measurementFieldMeta = getGoalMeasurementFieldMeta(goal);
                const remaining = MAX_GOAL_NOTE_LENGTH - noteText.length;
                return (
                  <div key={goal.id} className="rounded-md border border-gray-200 p-2 dark:border-gray-700">
                    <label className="flex cursor-pointer items-start gap-2 text-sm text-gray-600 dark:text-gray-300">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleGoalSelection(goal.id)}
                        className="mt-0.5 h-5 w-5 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        aria-label={goal.title}
                      />
                      <span className="min-w-0 flex-1 font-medium">{goal.title}</span>
                      <span className="ml-auto shrink-0 whitespace-nowrap text-[11px] text-gray-400 dark:text-gray-500">
                        ({Array.isArray(goal.objective_data_points) ? goal.objective_data_points.length : 0} data pts)
                      </span>
                    </label>
                    {isSelected && (
                      <div className="mt-2 pl-7 sm:pl-6">
                        <label
                          htmlFor={`goal-note-${goal.id}`}
                          className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400"
                        >
                          Note for this goal <span className="text-red-500">*</span>
                        </label>
                        <textarea
                          id={`goal-note-${goal.id}`}
                          value={noteText}
                          onChange={(e) => updateGoalNote(goal.id, e.target.value)}
                          rows={3}
                          maxLength={MAX_GOAL_NOTE_LENGTH}
                          placeholder={`Describe progress on "${goal.title}"…`}
                          className="w-full rounded-md border border-gray-300 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-dark dark:text-gray-200"
                        />
                        <p
                          className={`mt-0.5 text-right text-[11px] ${remaining < 100 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-gray-500'}`}
                        >
                          {remaining.toLocaleString()} characters remaining
                        </p>
                        <div className="mt-3 rounded-md border border-indigo-100 bg-indigo-50/70 p-3 dark:border-indigo-900/40 dark:bg-indigo-900/10">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-200">
                                Measurement snapshot
                              </p>
                              <p className="mt-1 text-[11px] text-indigo-700/90 dark:text-indigo-200/80">
                                {measurementFieldMeta.helperText}
                              </p>
                            </div>
                            {goal.measurement_type && (
                              <span className="rounded-full bg-white px-2 py-1 text-[11px] font-medium text-indigo-700 shadow-sm dark:bg-dark dark:text-indigo-200">
                                {goal.measurement_type}
                              </span>
                            )}
                          </div>
                          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div>
                              <label
                                htmlFor={`goal-measurement-value-${goal.id}`}
                                className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300"
                              >
                                {measurementFieldMeta.primaryLabel}
                                {measurementFieldMeta.primaryUnit ? ` (${measurementFieldMeta.primaryUnit})` : ''}
                              </label>
                              <input
                                id={`goal-measurement-value-${goal.id}`}
                                type="number"
                                min={measurementFieldMeta.min}
                                max={measurementFieldMeta.max}
                                step={measurementFieldMeta.step}
                                value={measurementEntry?.data.metric_value ?? ''}
                                onChange={(e) => updateGoalMeasurement(goal, { metric_value: toOptionalNumber(e.target.value) })}
                                className="w-full rounded-md border border-gray-300 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-dark dark:text-gray-200"
                                placeholder={measurementFieldMeta.primaryLabel}
                              />
                            </div>
                            {measurementFieldMeta.secondaryLabel && (
                              <div>
                                <label
                                  htmlFor={`goal-measurement-opportunities-${goal.id}`}
                                  className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300"
                                >
                                  {measurementFieldMeta.secondaryLabel}
                                </label>
                                <input
                                  id={`goal-measurement-opportunities-${goal.id}`}
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={measurementEntry?.data.opportunities ?? ''}
                                  onChange={(e) => updateGoalMeasurement(goal, { opportunities: toOptionalNumber(e.target.value) })}
                                  className="w-full rounded-md border border-gray-300 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-dark dark:text-gray-200"
                                  placeholder={measurementFieldMeta.secondaryLabel}
                                />
                              </div>
                            )}
                            <div>
                              <label
                                htmlFor={`goal-measurement-prompt-${goal.id}`}
                                className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300"
                              >
                                Prompt level
                              </label>
                              <input
                                id={`goal-measurement-prompt-${goal.id}`}
                                type="text"
                                value={measurementEntry?.data.prompt_level ?? ''}
                                onChange={(e) => updateGoalMeasurement(goal, { prompt_level: toOptionalString(e.target.value) })}
                                className="w-full rounded-md border border-gray-300 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-dark dark:text-gray-200"
                                placeholder="Independent, verbal, gestural..."
                              />
                            </div>
                            <div>
                              <label
                                htmlFor={`goal-measurement-note-${goal.id}`}
                                className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300"
                              >
                                Measurement note
                              </label>
                              <input
                                id={`goal-measurement-note-${goal.id}`}
                                type="text"
                                value={measurementEntry?.data.note ?? ''}
                                onChange={(e) => updateGoalMeasurement(goal, { note: toOptionalString(e.target.value) })}
                                className="w-full rounded-md border border-gray-300 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-dark dark:text-gray-200"
                                placeholder="Optional qualifier for the observed data"
                              />
                            </div>
                          </div>
                        </div>
                        {(goal.measurement_type || goal.target_criteria || goal.mastery_criteria) && (
                          <details className="mt-2 rounded-md border border-blue-100 bg-blue-50 px-2 py-1 text-[11px] text-blue-800 open:border-blue-200 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-100">
                            <summary className="cursor-pointer font-medium text-blue-900 dark:text-blue-100">
                              Goal criteria
                            </summary>
                            <div className="mt-1 space-y-0.5">
                              {goal.measurement_type && <p>Measurement: {goal.measurement_type}</p>}
                              {goal.target_criteria && <p>Target: {goal.target_criteria}</p>}
                              {goal.mastery_criteria && <p>Mastery: {goal.mastery_criteria}</p>}
                            </div>
                          </details>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {goalsByProgram.has('__unknown__') && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Uncategorized
          </p>
          <div className="space-y-3">
            {(goalsByProgram.get('__unknown__') ?? []).map((goal) => {
              const isSelected = selectedGoalIds.includes(goal.id);
              const noteText = goalNotes[goal.id] ?? '';
              const measurementEntry = buildGoalMeasurementEntry(goal, goalMeasurements[goal.id]);
              const measurementFieldMeta = getGoalMeasurementFieldMeta(goal);
              const remaining = MAX_GOAL_NOTE_LENGTH - noteText.length;
              return (
                <div key={goal.id} className="rounded-md border border-gray-200 p-2 dark:border-gray-700">
                  <label className="flex cursor-pointer items-start gap-2 text-sm text-gray-600 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleGoalSelection(goal.id)}
                      className="mt-0.5 h-5 w-5 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      aria-label={goal.title}
                    />
                    <span className="min-w-0 flex-1 font-medium">{goal.title}</span>
                  </label>
                  {isSelected && (
                    <div className="mt-2 pl-7 sm:pl-6">
                      <label
                        htmlFor={`goal-note-${goal.id}`}
                        className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400"
                      >
                        Note for this goal <span className="text-red-500">*</span>
                      </label>
                      <textarea
                        id={`goal-note-${goal.id}`}
                        value={noteText}
                        onChange={(e) => updateGoalNote(goal.id, e.target.value)}
                        rows={3}
                        maxLength={MAX_GOAL_NOTE_LENGTH}
                        placeholder={`Describe progress on "${goal.title}"…`}
                        className="w-full rounded-md border border-gray-300 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-dark dark:text-gray-200"
                      />
                      <p
                        className={`mt-0.5 text-right text-[11px] ${remaining < 100 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-gray-500'}`}
                      >
                        {remaining.toLocaleString()} characters remaining
                      </p>
                      <div className="mt-3 rounded-md border border-indigo-100 bg-indigo-50/70 p-3 dark:border-indigo-900/40 dark:bg-indigo-900/10">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-200">
                              Measurement snapshot
                            </p>
                            <p className="mt-1 text-[11px] text-indigo-700/90 dark:text-indigo-200/80">
                              {measurementFieldMeta.helperText}
                            </p>
                          </div>
                          {goal.measurement_type && (
                            <span className="rounded-full bg-white px-2 py-1 text-[11px] font-medium text-indigo-700 shadow-sm dark:bg-dark dark:text-indigo-200">
                              {goal.measurement_type}
                            </span>
                          )}
                        </div>
                        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div>
                            <label
                              htmlFor={`goal-measurement-value-${goal.id}`}
                              className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300"
                            >
                              {measurementFieldMeta.primaryLabel}
                              {measurementFieldMeta.primaryUnit ? ` (${measurementFieldMeta.primaryUnit})` : ''}
                            </label>
                            <input
                              id={`goal-measurement-value-${goal.id}`}
                              type="number"
                              min={measurementFieldMeta.min}
                              max={measurementFieldMeta.max}
                              step={measurementFieldMeta.step}
                              value={measurementEntry?.data.metric_value ?? ''}
                              onChange={(e) => updateGoalMeasurement(goal, { metric_value: toOptionalNumber(e.target.value) })}
                              className="w-full rounded-md border border-gray-300 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-dark dark:text-gray-200"
                              placeholder={measurementFieldMeta.primaryLabel}
                            />
                          </div>
                          {measurementFieldMeta.secondaryLabel && (
                            <div>
                              <label
                                htmlFor={`goal-measurement-opportunities-${goal.id}`}
                                className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300"
                              >
                                {measurementFieldMeta.secondaryLabel}
                              </label>
                              <input
                                id={`goal-measurement-opportunities-${goal.id}`}
                                type="number"
                                min={0}
                                step={1}
                                value={measurementEntry?.data.opportunities ?? ''}
                                onChange={(e) => updateGoalMeasurement(goal, { opportunities: toOptionalNumber(e.target.value) })}
                                className="w-full rounded-md border border-gray-300 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-dark dark:text-gray-200"
                                placeholder={measurementFieldMeta.secondaryLabel}
                              />
                            </div>
                          )}
                          <div>
                            <label
                              htmlFor={`goal-measurement-prompt-${goal.id}`}
                              className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300"
                            >
                              Prompt level
                            </label>
                            <input
                              id={`goal-measurement-prompt-${goal.id}`}
                              type="text"
                              value={measurementEntry?.data.prompt_level ?? ''}
                              onChange={(e) => updateGoalMeasurement(goal, { prompt_level: toOptionalString(e.target.value) })}
                              className="w-full rounded-md border border-gray-300 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-dark dark:text-gray-200"
                              placeholder="Independent, verbal, gestural..."
                            />
                          </div>
                          <div>
                            <label
                              htmlFor={`goal-measurement-note-${goal.id}`}
                              className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300"
                            >
                              Measurement note
                            </label>
                            <input
                              id={`goal-measurement-note-${goal.id}`}
                              type="text"
                              value={measurementEntry?.data.note ?? ''}
                              onChange={(e) => updateGoalMeasurement(goal, { note: toOptionalString(e.target.value) })}
                              className="w-full rounded-md border border-gray-300 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-dark dark:text-gray-200"
                              placeholder="Optional qualifier for the observed data"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black bg-opacity-50 sm:items-center sm:p-4"
      role="presentation"
    >
      <div
        className="flex h-[100dvh] max-h-[100dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl dark:bg-dark-lighter sm:h-auto sm:max-h-[90vh] sm:rounded-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-session-note-modal-title"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700 sm:px-6">
          <h2 id="add-session-note-modal-title" className="text-lg font-semibold text-gray-900 dark:text-white sm:text-xl">
            Add Session Note
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close add session note modal"
            title="Close add session note modal"
            className="flex h-11 w-11 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 pb-28 sm:space-y-6 sm:px-6 sm:pb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="session-date" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                <Calendar className="w-4 h-4 inline-block mr-1" />
                Session Date
              </label>
              <input
                id="session-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
              />
            </div>

            <div>
              <label htmlFor="service-code" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                <FileText className="w-4 h-4 inline-block mr-1" />
                Service Code
              </label>
              <select
                id="service-code"
                value={serviceCode}
                onChange={(e) => setServiceCode(e.target.value)}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
              >
                <option value="">Select service code</option>
                <option value="97151">97151 - Behavior identification assessment</option>
                <option value="97152">97152 - Behavior identification supporting assessment</option>
                <option value="97153">97153 - Adaptive behavior treatment by protocol</option>
                <option value="97154">97154 - Group adaptive behavior treatment by protocol</option>
                <option value="97155">97155 - Adaptive behavior treatment with protocol modification</option>
                <option value="97156">97156 - Family adaptive behavior treatment guidance</option>
                <option value="97157">97157 - Multiple-family group adaptive behavior treatment guidance</option>
                <option value="97158">97158 - Group adaptive behavior treatment with protocol modification</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="start-time" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                <Clock className="w-4 h-4 inline-block mr-1" />
                Start Time
              </label>
              <input
                id="start-time"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
              />
            </div>

            <div>
              <label htmlFor="end-time" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                <Clock className="w-4 h-4 inline-block mr-1" />
                End Time
              </label>
              <input
                id="end-time"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
              />
            </div>
          </div>

          <div>
            <label htmlFor="therapist-select" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Therapist
            </label>
            <select
              id="therapist-select"
              value={therapistId}
              onChange={(e) => setTherapistId(e.target.value)}
              className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
            >
              <option value="">Select therapist</option>
              {therapists.map((therapist) => (
                <option key={therapist.id} value={therapist.id}>
                  {therapist.full_name} - {therapist.title || 'Therapist'}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="session-select" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Link to Session
            </label>
            <select
              id="session-select"
              value={selectedSessionId}
              onChange={(e) => setSelectedSessionId(e.target.value)}
              className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
              disabled={isLoadingSessions || !hasSessions}
            >
              <option value="">
                {isLoadingSessions ? 'Loading sessions...' : hasSessions ? 'Select a session' : 'No sessions available'}
              </option>
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {new Date(session.start_time).toLocaleDateString()}{' '}
                  {new Date(session.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} -{' '}
                  {new Date(session.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ·{' '}
                  {session.therapist?.full_name ?? 'Therapist'}
                </option>
              ))}
            </select>
            {!hasSessions && !isLoadingSessions && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-300">
                No scheduled sessions found for this client.
              </p>
            )}
          </div>

          <div>
            <p className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Goals Addressed</p>
            {isLoadingGoals || isLoadingPrograms ? (
              <div className="text-sm text-gray-500 dark:text-gray-400">Loading goals…</div>
            ) : availableGoals.length === 0 ? (
              <div className="text-sm text-gray-500 dark:text-gray-400">
                No goals available for this client. Add goals in Programs &amp; Goals before logging.
              </div>
            ) : isMinWidthSm ? (
              <div>{renderGoalsBankBody()}</div>
            ) : (
              <details
                className="rounded-lg border border-gray-200 dark:border-gray-700"
                open={mobileGoalsDisclosureOpen}
                onToggle={(event) => setMobileGoalsDisclosureOpen(event.currentTarget.open)}
              >
                <summary className="cursor-pointer list-none px-3 py-2.5 [&::-webkit-details-marker]:hidden">
                  <div className="flex min-h-11 items-center justify-between gap-2 text-sm font-medium text-gray-800 dark:text-gray-100">
                    <span>Goals &amp; per-goal notes</span>
                    <span className="shrink-0 text-xs font-normal text-gray-500 dark:text-gray-400">
                      {selectedGoalIds.length} selected
                    </span>
                  </div>
                </summary>
                <div className="border-t border-gray-200 px-3 pb-3 pt-3 dark:border-gray-700">
                  {renderGoalsBankBody()}
                </div>
              </details>
            )}
          </div>

          <div>
            <label htmlFor="session-notes" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Overall Session Notes <span className="font-normal text-gray-400 dark:text-gray-500">(optional)</span>
            </label>
            <textarea
              id="session-notes"
              value={narrative}
              onChange={(e) => setNarrative(e.target.value)}
              rows={4}
              className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
              placeholder="Enter any overall session observations or context…"
            />
          </div>

          {canLockSessionNotes && (
            <div className="flex items-center">
              <input
                type="checkbox"
                id="is-locked"
                checked={isLocked}
                onChange={(e) => setIsLocked(e.target.checked)}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <label htmlFor="is-locked" className="ml-2 block text-sm text-gray-900 dark:text-gray-100 flex items-center">
                <CheckCircle className="w-4 h-4 mr-1 text-green-500" />
                Sign and lock note
              </label>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 z-10 flex shrink-0 flex-col gap-2 border-t border-gray-200 bg-white/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] backdrop-blur dark:border-gray-700 dark:bg-dark-lighter/95 sm:flex-row sm:justify-end sm:gap-3 sm:px-6 sm:pb-4">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 w-full rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-gray-600 dark:bg-dark dark:text-gray-300 dark:hover:bg-gray-800 sm:w-auto"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSaving}
            className="flex min-h-11 w-full items-center justify-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:min-w-[10rem]"
          >
            {isSaving ? 'Saving…' : 'Save Note'}
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}
