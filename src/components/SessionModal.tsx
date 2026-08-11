import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  GoalTarget,
  SessionCaptureTrialEventInput,
  SessionGoalMeasurementData,
  SessionGoalMeasurementEntry,
  TrialEvent,
  Therapist,
  Client,
  Goal,
  Program,
  SessionNoteUpsertResult,
  SessionPromptCount,
  PromptOutcome,
  BtAbaSessionNotePayload,
  BtAbaFinalizeResult,
} from '../types';
import {
  validateBtAbaSessionNoteResponses,
  type BtAbaSessionNoteResponses,
} from '../lib/bt-aba-session-note';
import { checkSchedulingConflicts, suggestAlternativeTimes, type Conflict, type AlternativeTime } from '../lib/conflicts';
import { logger } from '../lib/logger/logger';
import { toError } from '../lib/logger/normalizeError';
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
  getGoalMeasurementTargets,
  getGoalMeasurementFieldMeta,
  hasMeaningfulGoalMeasurementEntry,
  mergeUniqueGoalIds,
  normalizeGoalMeasurementEntry,
  normalizePromptCounts,
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
import { resolveSessionCloseRequiredGoalIds } from '../lib/sessionCloseRequiredGoals';
import {
  finalizeBtAbaSessionNote,
  getBtAbaSessionNote,
  saveBtAbaSessionNoteDraft,
} from '../lib/session-notes';
import { BtAbaSessionNoteForm } from './session-notes/BtAbaSessionNoteForm';
import {
  firstServiceCodeOnAuthorization,
  pickPrimaryBillingAuthorization,
  SESSION_CAPTURE_RELAXED_FALLBACK_SERVICE_CODE,
} from '../lib/sessionCaptureBillingGate';

const ENABLE_ALTERNATIVE_TIME_SUGGESTIONS = false;
const MODAL_TRANSITION_MS = 160;

export interface SessionModalClinicalNotesPayload {
  session_note_narrative?: string;
  session_note_goal_notes?: Record<string, string>;
  session_note_goal_measurements?: Record<string, SessionGoalMeasurementEntry>;
  session_note_goal_ids?: string[];
  session_note_goals_addressed?: string[];
  session_note_authorization_id?: string;
  session_note_service_code?: string;
  /** Explicitly signals that this submit should persist session-capture content. */
  session_note_persist_requested?: boolean;
  /** When set, POST /api/session-notes/upsert merges only these goal keys from this payload (server-authoritative). */
  session_note_capture_merge_goal_ids?: string[];
  /** Raw trial-level events generated from configured goal targets during Schedule capture. */
  session_note_trial_events?: SessionCaptureTrialEventInput[];
  /** Keeps the BT modal open while capture transitions to the required closeout note. */
  session_note_begin_closeout?: boolean;
}

interface AssignedBtSessionCaptureBillingDefaultsRow {
  authorization_id: string | null;
  service_code: string | null;
  strict_billing: boolean | null;
}

const responseRequiredMeasurementTypes = new Set(['correctIncorrect', 'taskAnalysis']);
const valueRequiredMeasurementTypes = new Set(['frequency', 'rate', 'duration', 'timeSample', 'latency', 'IRT']);

const valueMeasurementMeta: Record<string, { label: string; unit: string; step: number }> = {
  frequency: { label: 'Frequency', unit: 'count', step: 1 },
  rate: { label: 'Rate', unit: 'per hour', step: 0.1 },
  duration: { label: 'Duration', unit: 'minutes', step: 0.1 },
  timeSample: { label: 'Time sample', unit: 'intervals', step: 1 },
  latency: { label: 'Latency', unit: 'seconds', step: 0.1 },
  IRT: { label: 'IRT', unit: 'seconds', step: 0.1 },
};

const responseOptionsByMeasurementType: Record<string, Array<{ response: NonNullable<TrialEvent['response']>; label: string }>> = {
  correctIncorrect: [
    { response: 'correct', label: 'Correct' },
    { response: 'incorrect', label: 'Incorrect' },
    { response: 'noResponse', label: 'No response' },
  ],
  taskAnalysis: [
    { response: 'independent', label: 'Independent' },
    { response: 'prompted', label: 'Prompted' },
    { response: 'incorrect', label: 'Incorrect' },
    { response: 'noResponse', label: 'No response' },
  ],
};

const promptCaptureOptions = [
  { label: 'Full verbal', promptType: 'verbal', promptLevel: 'full' },
  { label: 'Partial verbal', promptType: 'verbal', promptLevel: 'partial' },
  { label: 'Gesture', promptType: 'gesture', promptLevel: null },
  { label: 'Model', promptType: 'model', promptLevel: null },
  { label: 'Visual', promptType: 'visual', promptLevel: null },
  { label: 'Full physical', promptType: 'physical', promptLevel: 'full' },
  { label: 'Partial physical', promptType: 'physical', promptLevel: 'partial' },
] as const;

const promptOutcomeOptions: Array<{ value: PromptOutcome; label: string }> = [
  { value: 'correct', label: 'Correct' },
  { value: 'incorrect', label: 'Incorrect' },
  { value: 'noResponse', label: 'No response' },
];

const getPromptOutcomeSegmentClasses = (selected: boolean, outcome: PromptOutcome): string => {
  if (selected) {
    if (outcome === 'correct') {
      return 'border-emerald-600 bg-emerald-600 text-white';
    }
    if (outcome === 'incorrect') {
      return 'border-rose-600 bg-rose-600 text-white';
    }
    return 'border-amber-500 bg-amber-500 text-white';
  }

  if (outcome === 'correct') {
    return 'border-emerald-200 bg-white text-emerald-900 hover:bg-emerald-50 dark:border-emerald-800 dark:bg-dark dark:text-emerald-100 dark:hover:bg-emerald-950/40';
  }
  if (outcome === 'incorrect') {
    return 'border-rose-200 bg-white text-rose-900 hover:bg-rose-50 dark:border-rose-800 dark:bg-dark dark:text-rose-100 dark:hover:bg-rose-950/40';
  }
  return 'border-amber-200 bg-white text-amber-900 hover:bg-amber-50 dark:border-amber-800 dark:bg-dark dark:text-amber-100 dark:hover:bg-amber-950/40';
};

export const setPromptOutcomeForTarget = (
  current: Record<string, PromptOutcome>,
  targetId: string,
  outcome: PromptOutcome,
): Record<string, PromptOutcome> => ({ ...current, [targetId]: outcome });

export const incrementLegacyPromptCount = (
  current: SessionPromptCount[] | null | undefined,
  prompt: { promptType: SessionPromptCount['prompt_type']; promptLevel: SessionPromptCount['prompt_level'] },
  outcome: PromptOutcome,
): SessionPromptCount[] => normalizePromptCounts([
  ...(current ?? []),
  {
    prompt_type: prompt.promptType,
    prompt_level: prompt.promptLevel,
    correct_trials: outcome === 'correct' ? 1 : 0,
    incorrect_trials: outcome === 'incorrect' ? 1 : 0,
    ...(outcome === 'noResponse' ? { no_response_trials: 1 } : {}),
  },
]);

export const decrementLegacyPromptCounts = (
  current: SessionPromptCount[] | null | undefined,
  field: 'correct_trials' | 'incorrect_trials',
  amount: number,
  preferredOutcome: PromptOutcome,
): SessionPromptCount[] => {
  const next = normalizePromptCounts(current).map((count) => ({ ...count }));
  let remaining = Math.max(0, amount);
  for (let index = next.length - 1; index >= 0 && remaining > 0; index -= 1) {
    if (field === 'correct_trials') {
      const removable = Math.min(next[index].correct_trials, remaining);
      next[index].correct_trials -= removable;
      remaining -= removable;
      continue;
    }

    const unsuccessfulFields: Array<'incorrect_trials' | 'no_response_trials'> = preferredOutcome === 'noResponse'
      ? ['no_response_trials', 'incorrect_trials']
      : ['incorrect_trials', 'no_response_trials'];
    for (const unsuccessfulField of unsuccessfulFields) {
      const currentValue = unsuccessfulField === 'no_response_trials'
        ? next[index].no_response_trials ?? 0
        : next[index].incorrect_trials;
      if (currentValue <= 0) {
        continue;
      }
      const removable = Math.min(currentValue, remaining);
      if (unsuccessfulField === 'no_response_trials') {
        next[index].no_response_trials = currentValue - removable;
      } else {
        next[index].incorrect_trials -= removable;
      }
      remaining -= removable;
      if (remaining === 0) {
        break;
      }
    }
  }
  return normalizePromptCounts(next);
};

export const remapLegacyPromptCorrectnessAfterRemoval = (
  current: Record<string, PromptOutcome>,
  goalId: string,
  removedIndex: number,
  previousLength: number,
): Record<string, PromptOutcome> => {
  const next = { ...current };
  for (let index = removedIndex; index < previousLength - 1; index += 1) {
    const nextKey = `legacy:${goalId}:${index + 1}`;
    const currentKey = `legacy:${goalId}:${index}`;
    if (Object.prototype.hasOwnProperty.call(current, nextKey)) {
      next[currentKey] = current[nextKey];
    } else {
      delete next[currentKey];
    }
  }
  delete next[`legacy:${goalId}:${previousLength - 1}`];
  return next;
};

export const sumLegacyPromptCounts = (
  counts: SessionPromptCount[] | null | undefined,
  field: 'correct_trials' | 'incorrect_trials',
): number => normalizePromptCounts(counts).reduce(
  (total, count) => Math.min(
    Number.MAX_SAFE_INTEGER,
    total + count[field] + (field === 'incorrect_trials' ? count.no_response_trials ?? 0 : 0),
  ),
  0,
);

const getValueMeasurementMeta = (measurementType: string) =>
  valueRequiredMeasurementTypes.has(measurementType)
    ? valueMeasurementMeta[measurementType] ?? { label: 'Value', unit: 'value', step: 0.1 }
    : null;

const isPositiveResponse = (response: TrialEvent['response']): boolean =>
  response === 'correct' || response === 'independent' || response === 'prompted';

export type SessionModalSubmitData = Partial<Session> & SessionModalClinicalNotesPayload;

export const selectSessionCaptureTargets = (
  targets: readonly GoalTarget[],
  historicalTargetIds: ReadonlySet<string>,
): GoalTarget[] => targets.filter((target) => (
  (target.is_current === true && target.status === 'active') || historicalTargetIds.has(target.id)
));

export const formatProgressionNotices = (
  results: readonly import('../types').GoalTargetProgressionResult[],
  targetNames: ReadonlyMap<string, string>,
): string[] => results.flatMap((result) => {
  if (result.outcome === 'advanced' && result.current_phase) {
    return [`Advanced to ${result.current_phase[0].toUpperCase()}${result.current_phase.slice(1)}`];
  }
  if (result.outcome === 'target_mastered') {
    return [`Target mastered${result.next_target_id ? ` · Next: ${targetNames.get(result.next_target_id) ?? 'next target'}` : ''}`];
  }
  if (result.outcome === 'goal_mastered') return ['Goal mastered'];
  if (result.outcome === 'criteria_incomplete') return [result.warning ?? 'Progression criteria are incomplete'];
  return [];
});

export const dedupeProgressionNotices = (...groups: readonly string[][]): string[] =>
  Array.from(new Set(groups.flat()));

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

const hasNestedDirtyEntries = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') {
    return Boolean(value);
  }

  return Object.values(value as Record<string, unknown>).some((entry) => hasNestedDirtyEntries(entry));
};

const normalizeMeasurementMetadata = (value: string | null | undefined): string =>
  value?.trim().toLowerCase() ?? '';

const isCountTrialMeasurementMetadata = (
  measurementType: string | null | undefined,
  metricLabel: string | null | undefined,
  metricUnit: string | null | undefined,
): boolean => {
  const metadata = [
    normalizeMeasurementMetadata(measurementType),
    normalizeMeasurementMetadata(metricLabel),
    normalizeMeasurementMetadata(metricUnit),
  ].filter((value) => value.length > 0);

  if (
    metadata.some((value) =>
      value.includes('percent') ||
      value.includes('%') ||
      value.includes('accuracy') ||
      value.includes('fidelity') ||
      value.includes('duration') ||
      value.includes('minute') ||
      value.includes('time') ||
      value.includes('rate') ||
      value.includes('per hour')
    )
  ) {
    return false;
  }

  return metadata.some((value) =>
    value.includes('count') ||
    value.includes('correct') ||
    value.includes('incorrect') ||
    value.includes('trial') ||
    value.includes('response') ||
    value.includes('task analysis') ||
    value.includes('taskanalysis') ||
    value.includes('occurrence')
  );
};

const hasSuccessesBeyondOpportunities = (
  metricValue: number | null | undefined,
  opportunities: number | null | undefined,
): boolean =>
  typeof metricValue === 'number' &&
  Number.isFinite(metricValue) &&
  typeof opportunities === 'number' &&
  Number.isFinite(opportunities) &&
  metricValue > opportunities;

const getCorrectTrialsOpportunityError = (
  metricValue: number | null | undefined,
  opportunities: number | null | undefined,
  shouldValidate: boolean,
): string | null =>
  shouldValidate && hasSuccessesBeyondOpportunities(metricValue, opportunities)
    ? 'Correct trials cannot exceed opportunities.'
    : null;

const getGoalMeasurementOpportunityError = (
  measurements: Record<string, SessionGoalMeasurementEntry>,
  measurementGoalIds?: ReadonlySet<string>,
): string | null => {
  for (const [goalId, entry] of Object.entries(measurements)) {
    if (measurementGoalIds && !measurementGoalIds.has(goalId)) {
      continue;
    }
    const shouldValidate = isCountTrialMeasurementMetadata(
      entry.data.measurement_type,
      entry.data.metric_label,
      entry.data.metric_unit,
    );
    const entryError = getCorrectTrialsOpportunityError(
      entry.data.metric_value,
      entry.data.opportunities,
      shouldValidate,
    );
    if (entryError) {
      return entryError;
    }

    for (const trial of entry.data.target_trials ?? []) {
      const trialError = getCorrectTrialsOpportunityError(
        trial.metric_value,
        trial.opportunities,
        shouldValidate,
      );
      if (trialError) {
        return trialError;
      }
    }
  }

  return null;
};

const trimString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export interface CloseoutDataPoint {
  label: string;
  value: string | number;
  linked: boolean;
}

interface BuildCloseoutDataPointsArgs {
  existingTrialEvents: readonly TrialEvent[];
  pendingTrialEvents: readonly SessionCaptureTrialEventInput[];
  goalTargetsById: ReadonlyMap<string, GoalTarget>;
  goalsById: ReadonlyMap<string, Goal>;
  goalLabelsById?: ReadonlyMap<string, string>;
  linkedGoalIds: readonly string[];
  goalMeasurements: Record<string, unknown> | null | undefined;
}

const toCloseoutAggregateKey = (goalId: string | null, targetLabel: string | null): string =>
  `${goalId ?? '__unknown_goal__'}::${targetLabel ?? '__goal__'}`;

const toCloseoutTargetIndexKey = (goalId: string, targetIndex: number): string =>
  `${goalId}::index:${targetIndex}`;

const getTrialEventGoalId = (
  event: TrialEvent | SessionCaptureTrialEventInput,
  goalTargetsById: ReadonlyMap<string, GoalTarget>,
): string | null =>
  'goal_id' in event && typeof event.goal_id === 'string'
    ? event.goal_id
    : goalTargetsById.get(event.target_id)?.goal_id ?? null;

const getTrialEventTargetIndex = (
  event: TrialEvent | SessionCaptureTrialEventInput,
): number | null => {
  const targetIndex = toOptionalNumber(event.metadata?.target_index);
  return targetIndex !== null && Number.isInteger(targetIndex) && targetIndex >= 0
    ? targetIndex
    : null;
};

const getTrialEventLabel = (
  event: TrialEvent | SessionCaptureTrialEventInput,
  goalTargetsById: ReadonlyMap<string, GoalTarget>,
  aggregateTargetLabels: readonly (string | null)[],
): string => {
  const targetIndex = getTrialEventTargetIndex(event);
  if (targetIndex !== null && aggregateTargetLabels[targetIndex]) {
    return aggregateTargetLabels[targetIndex];
  }

  const currentTargetLabel = goalTargetsById.get(event.target_id)?.name;
  if (currentTargetLabel) {
    return currentTargetLabel;
  }

  return aggregateTargetLabels.length === 1 && aggregateTargetLabels[0]
    ? aggregateTargetLabels[0]
    : event.target_id;
};

const getCloseoutAggregateValue = (
  measurement: Pick<SessionGoalMeasurementData, 'metric_value' | 'incorrect_trials' | 'opportunities'>,
  metadata: Pick<SessionGoalMeasurementData, 'measurement_type' | 'metric_label' | 'metric_unit'>,
): string | number | null => {
  const metricValue = toOptionalNumber(measurement.metric_value);
  const incorrectTrials = toOptionalNumber(measurement.incorrect_trials);
  if (metricValue !== null) {
    const isCountMeasurement = isCountTrialMeasurementMetadata(
      metadata.measurement_type,
      metadata.metric_label,
      metadata.metric_unit,
    );
    const metricUnit = trimString(metadata.metric_unit);
    const metricLabel = trimString(metadata.metric_label);
    const formattedMetricValue = isCountMeasurement || (!metricUnit && !metricLabel)
      ? metricValue
      : metricUnit === '%'
        ? `${metricValue}%`
        : `${metricValue} ${metricUnit ?? metricLabel}`;
    if (incorrectTrials !== null && incorrectTrials > 0) {
      return isCountMeasurement
        ? metricValue > 0
          ? `${metricValue} correct / ${incorrectTrials} incorrect`
          : `${incorrectTrials} incorrect`
        : `${formattedMetricValue} / ${incorrectTrials} incorrect`;
    }
    return formattedMetricValue;
  }
  if (incorrectTrials !== null) {
    return `${incorrectTrials} incorrect`;
  }
  const opportunities = toOptionalNumber(measurement.opportunities);
  return opportunities === null ? null : `${opportunities} opportunities`;
};

const getPersistedMeasurementType = (rawValue: unknown): string | null => {
  if (!rawValue || typeof rawValue !== 'object') {
    return null;
  }
  const candidate = rawValue as { data?: unknown } & Record<string, unknown>;
  const sourceData = candidate.data && typeof candidate.data === 'object'
    ? candidate.data as Record<string, unknown>
    : candidate;
  return trimString(sourceData.measurement_type);
};

export const buildCloseoutDataPoints = ({
  existingTrialEvents,
  pendingTrialEvents,
  goalTargetsById,
  goalsById,
  goalLabelsById = new Map(),
  linkedGoalIds,
  goalMeasurements,
}: BuildCloseoutDataPointsArgs): CloseoutDataPoint[] => {
  const seenTrialKeys = new Set<string>();
  const rawTargetIndexKeys = new Set<string>();
  const rawFallbackAggregateKeys = new Set<string>();
  const normalizedMeasurements = !goalMeasurements || typeof goalMeasurements !== 'object'
    ? []
    : Object.entries(goalMeasurements).flatMap(([goalId, rawValue]) => {
        const goal = goalsById.get(goalId);
        const persistedMeasurementType = getPersistedMeasurementType(rawValue);
        const normalizationGoal = goal && persistedMeasurementType
          ? { ...goal, measurement_type: persistedMeasurementType }
          : goal;
        const normalized = normalizeGoalMeasurementEntry(rawValue, normalizationGoal);
        return normalized ? [{ goalId, goal, normalized }] : [];
      });
  const aggregateTargetLabelsByGoal = new Map(
    normalizedMeasurements.map(({ goalId, normalized }) => {
      const measurementTargets = getGoalMeasurementTargets(normalized.data);
      const targetTrials = normalized.data.target_trials ?? [];
      const targetLabels = targetTrials.length > 0
        ? targetTrials
            .map((trial, index) => trimString(trial.target) ?? measurementTargets[index] ?? null)
        : measurementTargets;
      return [goalId, targetLabels] as const;
    }),
  );

  const rawDataPoints = [...existingTrialEvents, ...pendingTrialEvents]
    .filter((event) => {
      const key = `${event.target_id}:${event.trial_number}`;
      if (seenTrialKeys.has(key)) {
        return false;
      }
      seenTrialKeys.add(key);
      return true;
    })
    .map((event) => {
      const goalId = getTrialEventGoalId(event, goalTargetsById);
      const targetIndex = getTrialEventTargetIndex(event);
      const label = getTrialEventLabel(
        event,
        goalTargetsById,
        goalId ? aggregateTargetLabelsByGoal.get(goalId) ?? [] : [],
      );
      if (goalId && targetIndex !== null) {
        rawTargetIndexKeys.add(toCloseoutTargetIndexKey(goalId, targetIndex));
      } else {
        rawFallbackAggregateKeys.add(toCloseoutAggregateKey(goalId, label));
      }
      return {
        label,
        value: event.response ?? event.value ?? '',
        linked: Boolean(goalId && linkedGoalIds.includes(goalId)),
      };
    });

  if (!goalMeasurements || typeof goalMeasurements !== 'object') {
    return rawDataPoints;
  }

  const aggregateDataPoints = normalizedMeasurements.flatMap(({ goalId, goal, normalized }) => {
    const fallbackLabel = goalLabelsById.get(goalId) ?? goal?.title ?? goalId;
    const measurementTargets = getGoalMeasurementTargets(normalized.data);
    const targetTrials = Array.isArray(normalized.data.target_trials) ? normalized.data.target_trials : [];
    const linked = linkedGoalIds.includes(goalId);

    if (targetTrials.length > 0) {
      const hasQuantitativeTargetValue = targetTrials.some(
        (trial) => getCloseoutAggregateValue(trial, normalized.data) !== null,
      );
      const targetDataPoints = targetTrials.flatMap((trial, index) => {
        const value = getCloseoutAggregateValue(trial, normalized.data);
        if (value === null) {
          return [];
        }
        const targetLabel = trimString(trial.target) ?? measurementTargets[index] ?? null;
        if (
          rawTargetIndexKeys.has(toCloseoutTargetIndexKey(goalId, index)) ||
          rawFallbackAggregateKeys.has(toCloseoutAggregateKey(goalId, targetLabel))
        ) {
          return [];
        }
        return [{
          label: targetLabel ?? fallbackLabel,
          value,
          linked,
        }];
      });
      if (hasQuantitativeTargetValue) {
        return targetDataPoints;
      }
    }

    const value = getCloseoutAggregateValue(normalized.data, normalized.data);
    if (value === null) {
      return [];
    }

    const targetLabel = trimString(normalized.data.target) ?? measurementTargets[0] ?? null;
    const matchingTargetIndexes = targetTrials.flatMap((trial, index) => {
      const trialLabel = trimString(trial.target) ?? measurementTargets[index] ?? null;
      return trialLabel === targetLabel ? [index] : [];
    });
    const hasIndexedRawFallbackMatch =
      matchingTargetIndexes.length === 1 &&
      rawTargetIndexKeys.has(toCloseoutTargetIndexKey(goalId, matchingTargetIndexes[0]));
    if (
      hasIndexedRawFallbackMatch ||
      rawFallbackAggregateKeys.has(toCloseoutAggregateKey(goalId, targetLabel))
    ) {
      return [];
    }

    return [{
      label: targetLabel ?? fallbackLabel,
      value,
      linked,
    }];
  });

  return [...rawDataPoints, ...aggregateDataPoints];
};

export const reconcileGoalMeasurementTargets = (
  entry: SessionGoalMeasurementEntry | null,
  goal: Goal | undefined,
  goalId: string,
): SessionGoalMeasurementEntry | null => {
  if (!entry) {
    return entry;
  }

  const sourceTargets = Array.isArray(entry.data.targets) ? entry.data.targets : [];
  const trialTargets = Array.isArray(entry.data.target_trials)
    ? entry.data.target_trials.map((trial) => trial.target?.trim() ?? '')
    : [];
  const recoveredTargetCount =
    sourceTargets.length > 0 || trialTargets.some((target) => target.length > 0)
      ? Math.max(sourceTargets.length, trialTargets.length)
      : 0;
  const recoveredTargets = Array.from(
    { length: recoveredTargetCount },
    (_, index) => sourceTargets[index]?.trim() || trialTargets[index] || '',
  );
  const planTarget = isAdhocSessionTargetId(goalId) ? '' : goal?.target_criteria?.trim() ?? '';
  const primaryTarget =
    (planTarget && recoveredTargets.some((target) => target.trim() === planTarget)
      ? planTarget
      : entry.data.target?.trim()) ||
    recoveredTargets.find((target) => target.trim().length > 0) ||
    null;
  if (recoveredTargets.length === 0 && primaryTarget === entry.data.target) {
    return entry;
  }

  return {
    ...entry,
    data: {
      ...entry.data,
      targets: recoveredTargets.length > 0 ? recoveredTargets : entry.data.targets,
      target: primaryTarget,
    },
  };
};

interface SessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: SessionModalSubmitData) => Promise<void | SessionNoteUpsertResult>;
  onReactivate?: (input: { session: Session; start_time: string; end_time: string }) => Promise<void>;
  onDeleteAppointment?: (input: { session: Session }) => Promise<void>;
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
  dataCollectionOnly?: boolean;
  allowStartSession?: boolean;
  canCreateSchedules?: boolean;
  canDeleteAppointments?: boolean;
  isReactivating?: boolean;
  isDeletingAppointment?: boolean;
  hideGoalCaptureFields?: boolean;
  onBtAbaSessionFinalized?: (result: BtAbaFinalizeResult & { sessionId: string }) => void | Promise<void>;
}

export function SessionModal({
  isOpen,
  onClose,
  onSubmit,
  onReactivate,
  onDeleteAppointment,
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
  dataCollectionOnly = false,
  allowStartSession = false,
  canCreateSchedules = true,
  canDeleteAppointments = false,
  isReactivating = false,
  isDeletingAppointment = false,
  hideGoalCaptureFields = false,
  onBtAbaSessionFinalized,
}: SessionModalProps) {
  const [isPlanSectionExpanded, setIsPlanSectionExpanded] = useState(() => !session?.id);
  const [selectedProgramIds, setSelectedProgramIds] = useState<string[]>(() =>
    session?.program_id ? [session.program_id] : [],
  );
  const [isClinicalSectionExpanded, setIsClinicalSectionExpanded] = useState(
    () => Boolean(dataCollectionOnly && session?.id && (session.status === 'scheduled' || session.status === 'in_progress')),
  );
  const [mobileProgramsExpanded, setMobileProgramsExpanded] = useState(false);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [alternativeTimes, setAlternativeTimes] = useState<AlternativeTime[]>([]);
  const [isLoadingAlternatives, setIsLoadingAlternatives] = useState(false);
  const [pendingTrialEvents, setPendingTrialEventsState] = useState<SessionCaptureTrialEventInput[]>([]);
  const pendingTrialEventsRef = useRef<SessionCaptureTrialEventInput[]>([]);
  const setPendingTrialEvents = useCallback((
    update:
      | SessionCaptureTrialEventInput[]
      | ((current: SessionCaptureTrialEventInput[]) => SessionCaptureTrialEventInput[]),
  ) => {
    const next = typeof update === 'function'
      ? update(pendingTrialEventsRef.current)
      : update;
    pendingTrialEventsRef.current = next;
    setPendingTrialEventsState(next);
  }, []);
  const [promptOutcomeByTargetId, setPromptOutcomeByTargetId] = useState<Record<string, PromptOutcome>>({});
  const [pendingNumericTrialValues, setPendingNumericTrialValues] = useState<Record<string, string>>({});
  const [progressionNotices, setProgressionNotices] = useState<string[]>([]);
  const [progressionConflict, setProgressionConflict] = useState<string | null>(null);
  const [staleProgressionTargetIds, setStaleProgressionTargetIds] = useState<string[]>([]);
  const [modalStep, setModalStep] = useState<'capture' | 'closeout'>('capture');
  const [btAbaBusy, setBtAbaBusy] = useState(false);
  const [btAbaError, setBtAbaError] = useState<string | null>(null);
  const [, setBtAbaNoteId] = useState<string | null>(null);
  const [btAbaFinalized, setBtAbaFinalized] = useState(false);
  const btAbaTransitionRef = useRef<'idle' | 'finalizing' | 'finalized'>('idle');
  const planDisclosureSessionKeyRef = useRef<string | null>(null);
  const planDisclosureInitializedRef = useRef(false);
  const planDisclosureTouchedRef = useRef(false);
  const clinicalDisclosureSessionKeyRef = useRef<string | null>(null);
  const closeoutCaptureRef = useRef<{
    notePayload: BtAbaSessionNotePayload;
    trialEvents: SessionCaptureTrialEventInput[];
    expectedTargetVersions: Array<{ target_id: string; progression_version: number }>;
  } | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const sessionCaptureSectionRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const previousClientIdRef = useRef<string | null>(null);
  const conflictCheckRequestIdRef = useRef(0);
  const closeTimerRef = useRef<number | null>(null);
  const enterFrameRef = useRef<number | null>(null);
  const closeRequestedRef = useRef(false);
  const activeOrganizationId = useActiveOrganizationId();
  const dialogTitleId = 'session-modal-title';
  const dialogDescriptionId = 'session-modal-description';
  const retryHintDescriptionId = 'session-modal-retry-description';
  const retryHintHeadingId = 'session-modal-retry-heading';
  const conflictDescriptionId = 'session-modal-conflicts-description';
  const conflictHeadingId = 'session-modal-conflicts-heading';
  const queryClient = useQueryClient();
  const [isEntered, setIsEntered] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isDeleteSubmitting, setIsDeleteSubmitting] = useState(false);
  const [isDeleteConfirmationOpen, setIsDeleteConfirmationOpen] = useState(false);
  const [deleteAppointmentError, setDeleteAppointmentError] = useState<string | null>(null);
  const isDataCollectionOnly = Boolean(dataCollectionOnly && session?.id);
  const canUseStartSessionAction = !isDataCollectionOnly || allowStartSession;
  const canReactivateSession = Boolean(
    session?.id &&
    session.status === 'cancelled' &&
    canCreateSchedules &&
    onReactivate,
  );
  const canDeleteAppointment = Boolean(
    session?.id &&
    (session.status === 'scheduled' || session.status === 'in_progress') &&
    canDeleteAppointments &&
    onDeleteAppointment,
  );
  const isBtClinicalCaptureSession = Boolean(
    isDataCollectionOnly && (session?.status === 'scheduled' || session?.status === 'in_progress'),
  );
  const isCompletedBtAbaSession = Boolean(isDataCollectionOnly && session?.status === 'completed');
  const shouldHideGoalCaptureFields = hideGoalCaptureFields;
  const shouldShowPromptCorrectnessToggle = true;

  const {
    data: btAbaNoteState,
    error: btAbaNoteLoadError,
    isError: isBtAbaNoteLoadError,
    isLoading: isBtAbaNoteLoading,
    refetch: refetchBtAbaNoteState,
  } = useQuery({
    queryKey: ['bt-aba-session-note', session?.id],
    queryFn: () => getBtAbaSessionNote(session!.id),
    enabled: Boolean((isBtClinicalCaptureSession || isCompletedBtAbaSession) && session?.id),
  });

  useEffect(() => {
    setBtAbaNoteId(btAbaNoteState?.noteId ?? null);
  }, [btAbaNoteState?.noteId, session?.id]);

  useEffect(() => {
    setModalStep('capture');
    setBtAbaError(null);
    setBtAbaFinalized(false);
    btAbaTransitionRef.current = 'idle';
    closeoutCaptureRef.current = null;
  }, [session?.id]);

  useEffect(() => {
    if (!isOpen) {
      setIsDeleteSubmitting(false);
      setIsDeleteConfirmationOpen(false);
      setDeleteAppointmentError(null);
      return;
    }
    setIsDeleteSubmitting(false);
    setDeleteAppointmentError(null);
  }, [isOpen, session?.id]);

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

  const getInitialCancellationAttribution = (): Session['cancellation_attribution'] | '' => {
    if (session?.status !== 'cancelled') {
      return '';
    }

    if (session.cancellation_attribution === 'client' || session.cancellation_attribution === 'staff') {
      return session.cancellation_attribution;
    }

    return 'unknown';
  };

  type SessionModalFormValues = Partial<Session> & SessionModalClinicalNotesPayload;
  
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    reset,
    getValues,
    formState: { errors, isSubmitting, isDirty, dirtyFields },
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
      cancellation_attribution: getInitialCancellationAttribution(),
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
  const sessionStatus = watch('status');
  const cancellationAttribution = watch('cancellation_attribution');
  const sessionNoteGoalNotes = watch('session_note_goal_notes') as Record<string, string> | undefined;
  const sessionNoteStoredGoalIds = watch('session_note_goal_ids') as string[] | undefined;
  const sessionNoteGoalsAddressed = watch('session_note_goals_addressed') as string[] | undefined;
  const sessionNoteGoalMeasurements = watch('session_note_goal_measurements') as
    | Record<string, SessionGoalMeasurementEntry | Record<string, unknown>>
    | undefined;

  const {
    data: sessionDetails,
    isFetched: isSessionDetailsFetched,
    isFetching: isSessionDetailsFetching,
    isError: isSessionDetailsError,
  } = useQuery({
    queryKey: ['session-details', session?.id, activeOrganizationId ?? 'MISSING_ORG'],
    queryFn: async () => {
      if (!session?.id || !activeOrganizationId) {
        return null;
      }
      const { data, error } = await supabase
        .from('sessions')
        .select('program_id, goal_id, started_at, location_type, cancellation_attribution')
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

  const {
    data: sessionGoalRows = [],
    isFetched: isSessionGoalsFetched,
    isFetching: isSessionGoalsFetching,
    isError: isSessionGoalsError,
  } = useQuery({
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

  const { data: goalTargets = [] } = useQuery({
    queryKey: ['client-goal-targets', clientId, activeOrganizationId ?? 'MISSING_ORG'],
    queryFn: async () => {
      if (!clientId || !activeOrganizationId) {
        return [];
      }
      const { data, error } = await supabase
        .from('goal_targets')
        .select('id, organization_id, client_id, goal_id, name, measurement_type, graph_config, status, sort_order, current_phase, is_current, evaluation_window_started_at, progression_version, created_by, updated_by, created_at, updated_at')
        .eq('client_id', clientId)
        .eq('organization_id', activeOrganizationId)
        .neq('status', 'archived')
        .order('sort_order', { ascending: true });
      if (error) {
        throw error;
      }
      return (data ?? []) as GoalTarget[];
    },
    enabled: Boolean(clientId && activeOrganizationId),
  });

  const sessionTrialEventsQueryKey = useMemo(
    () => ['session-trial-events', session?.id, activeOrganizationId ?? 'MISSING_ORG'] as const,
    [activeOrganizationId, session?.id],
  );

  const { data: existingTrialEvents = [] } = useQuery({
    queryKey: sessionTrialEventsQueryKey,
    queryFn: async () => {
      if (!session?.id || !activeOrganizationId) {
        return [];
      }
      const { data, error } = await supabase
        .from('trial_events')
        .select('*')
        .eq('session_id', session.id)
        .eq('organization_id', activeOrganizationId)
        .order('trial_number', { ascending: true });
      if (error) {
        throw error;
      }
      return (data ?? []) as TrialEvent[];
    },
    enabled: Boolean(session?.id && activeOrganizationId),
  });

  const { data: captureStrictBilling = true } = useQuery({
    queryKey: ['session-capture-strict-billing-policy', activeOrganizationId ?? 'MISSING_ORG'],
    queryFn: async () => {
      if (!activeOrganizationId) return false;
      const { data, error } = await supabase.rpc('get_session_capture_strict_billing_gate', {
        target_organization_id: activeOrganizationId,
      } as never);
      if (error) throw error;
      return data === true;
    },
    enabled: Boolean(activeOrganizationId),
  });
  const shouldUseAssignedBtBillingResolver = Boolean(isDataCollectionOnly && session?.id);

  const { data: assignedBtSessionCaptureBillingDefaults = null } = useQuery({
    queryKey: ['assigned-bt-session-capture-billing-defaults', session?.id],
    queryFn: async () => {
      if (!session?.id) {
        return null;
      }
      const { data, error } = await supabase.rpc('resolve_assigned_bt_session_capture_billing', {
        p_session_id: session.id,
      } as never);
      if (error) {
        throw error;
      }
      const [row] = ((data ?? []) as AssignedBtSessionCaptureBillingDefaultsRow[]);
      return row ?? null;
    },
    enabled: shouldUseAssignedBtBillingResolver,
  });

  const effectiveCaptureStrictBilling = shouldUseAssignedBtBillingResolver
    ? assignedBtSessionCaptureBillingDefaults?.strict_billing ?? true
    : captureStrictBilling;
  const captureBillingRelaxed = !effectiveCaptureStrictBilling;

  const { data: billingAuthorizations = [] } = useQuery({
    queryKey: [
      'session-note-billing-authorizations',
      clientId,
      activeOrganizationId ?? 'MISSING_ORG',
      captureBillingRelaxed ? 'relaxed' : 'strict',
    ],
    queryFn: async () => {
      if (!clientId || !activeOrganizationId || shouldUseAssignedBtBillingResolver) {
        return [];
      }
      let query = supabase
        .from('authorizations')
        .select(
          'id, status, authorization_number, services:authorization_services(service_code)',
        )
        .eq('client_id', clientId)
        .eq('organization_id', activeOrganizationId)
        .order('start_date', { ascending: false });
      if (!captureBillingRelaxed) {
        query = query.eq('status', 'approved');
      }
      const { data, error } = await query;
      if (error) {
        throw error;
      }
      return (
        data as Array<{
          id: string;
          status: string;
          authorization_number: string;
          services?: Array<{ service_code: string | null }> | null;
        }>
      ) ?? [];
    },
    enabled: Boolean(clientId && activeOrganizationId && !shouldUseAssignedBtBillingResolver),
  });

  const resolvedBillingAuthorizations = useMemo(() => {
    if (!shouldUseAssignedBtBillingResolver) {
      return billingAuthorizations;
    }

    if (!assignedBtSessionCaptureBillingDefaults?.authorization_id) {
      return [];
    }

    return [{
      id: assignedBtSessionCaptureBillingDefaults.authorization_id,
      status: effectiveCaptureStrictBilling ? 'approved' : 'available',
      authorization_number: '',
      services: assignedBtSessionCaptureBillingDefaults.service_code
        ? [{ service_code: assignedBtSessionCaptureBillingDefaults.service_code }]
        : [],
    }];
  }, [
    assignedBtSessionCaptureBillingDefaults,
    billingAuthorizations,
    effectiveCaptureStrictBilling,
    shouldUseAssignedBtBillingResolver,
  ]);

  const primaryBillingAuthorization = useMemo(
    () => pickPrimaryBillingAuthorization(resolvedBillingAuthorizations),
    [resolvedBillingAuthorizations],
  );

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
  const completedBtAbaResponses = useMemo(() => {
    if (!isCompletedBtAbaSession || btAbaNoteState?.status !== 'completed') {
      return null;
    }
    const result = validateBtAbaSessionNoteResponses(btAbaNoteState.responses);
    return result.success ? result.data : null;
  }, [btAbaNoteState?.responses, btAbaNoteState?.status, isCompletedBtAbaSession]);
  const initialBtAbaResponses = useMemo<BtAbaSessionNoteResponses>(() => ({
    purpose_of_session: [],
    client_status: '',
    skill_strategies: [],
    behavior_strategies: [],
    supervisor_support: [],
    progress_toward_goals: '',
    client_response_to_treatment: '',
    data_point_scope: 'linked',
    link_unlinked_data: false,
    bt_signature: { method: 'typed', value: '' },
    ...(completedBtAbaResponses ?? btAbaNoteState?.responses ?? {}),
  }), [btAbaNoteState?.responses, completedBtAbaResponses]);
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
  const planSummaryProgramName = programsById.get(programId ?? '')?.name ?? 'Domain needed';
  const planSummaryGoalName = selectedPrimaryGoal?.title ?? 'Goal needed';
  const canonicalStartGoalIds = useMemo(
    () => resolveSessionCloseRequiredGoalIds({
      sessionGoalIds: sessionGoalRows.map((row) => row.goal_id),
      primaryGoalId: sessionDetails?.goal_id ?? session?.goal_id ?? null,
    }).sort(),
    [session?.goal_id, sessionDetails?.goal_id, sessionGoalRows],
  );
  const selectedStartGoalIds = useMemo(
    () => mergeUniqueGoalIds(Array.isArray(goalIds) ? goalIds : [], goalId ? [goalId] : []).sort(),
    [goalId, goalIds],
  );
  const hasExactCanonicalStartGoalSet =
    canonicalStartGoalIds.length === selectedStartGoalIds.length &&
    canonicalStartGoalIds.every((id, index) => id === selectedStartGoalIds[index]);
  const hasStartableCanonicalGoals =
    canonicalStartGoalIds.length > 0 &&
    canonicalStartGoalIds.every((id) => {
      const goal = goalsById.get(id);
      return goal?.status === 'active' && activePrograms.some((program) => program.id === goal.program_id);
    });
  const hasProgramValue = typeof programId === 'string' && programId.length > 0;
  const hasGoalValue = typeof goalId === 'string' && goalId.length > 0;
  const hasProgramOptionForValue = hasProgramValue
    ? activePrograms.some((program) => program.id === programId)
    : false;
  const hasGoalOptionForValue = hasGoalValue
    ? selectedProgramGoals.some((goal) => goal.id === goalId)
    : false;
  const hasResolvedValidPlan = hasProgramOptionForValue && hasGoalOptionForValue;
  const hasDirtySessionCaptureFields = useMemo(
    () =>
      hasNestedDirtyEntries(dirtyFields.session_note_narrative) ||
      hasNestedDirtyEntries(dirtyFields.session_note_goal_ids) ||
      hasNestedDirtyEntries(dirtyFields.session_note_goals_addressed) ||
      hasNestedDirtyEntries(dirtyFields.session_note_goal_notes) ||
      hasNestedDirtyEntries(dirtyFields.session_note_goal_measurements) ||
      Object.values(pendingNumericTrialValues).some((value) => value.trim().length > 0),
    [
      dirtyFields.session_note_goal_ids,
      dirtyFields.session_note_goals_addressed,
      dirtyFields.session_note_goal_measurements,
      dirtyFields.session_note_goal_notes,
      dirtyFields.session_note_narrative,
      pendingNumericTrialValues,
    ],
  );
  const hasUnsavedSessionChanges = isDirty || hasDirtySessionCaptureFields;

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
    setPendingTrialEvents([]);
    setPromptOutcomeByTargetId({});
    setPendingNumericTrialValues({});
  }, [session?.id, clientId]);

  useEffect(() => {
    if (!sessionDetails) {
      return;
    }
    if (shouldHideGoalCaptureFields && clientId !== session?.client_id) {
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
  }, [clientId, session?.client_id, sessionDetails, setValue, shouldHideGoalCaptureFields]);

  useEffect(() => {
    if (!session?.id) {
      return;
    }

    const uniqueGoals = resolveSessionCloseRequiredGoalIds({
      sessionGoalIds: sessionGoalRows.map((row) => row.goal_id),
      primaryGoalId: sessionDetails?.goal_id ?? session?.goal_id ?? null,
    });

    if (uniqueGoals.length > 0) {
      const currentGoalIds = Array.isArray(getValues('goal_ids')) ? getValues('goal_ids') : [];
      const isSameGoalSet =
        currentGoalIds.length === uniqueGoals.length &&
        currentGoalIds.every((goalId, index) => goalId === uniqueGoals[index]);
      if (isSameGoalSet) {
        return;
      }
      setValue('goal_ids', uniqueGoals);
    }
  }, [getValues, session?.goal_id, session?.id, sessionDetails?.goal_id, sessionGoalRows, setValue]);

  useEffect(() => {
    if (shouldHideGoalCaptureFields) {
      return;
    }
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
    const activeProgramIdsSet = new Set(
      programs.filter((program) => program.status === 'active').map((program) => program.id)
    );
    if (!session?.id) {
      if (programId && !activeProgramIdsSet.has(programId)) {
        setValue('program_id', '');
      }
      setSelectedProgramIds((current) => current.filter((id) => activeProgramIdsSet.has(id)));
      return;
    }
    const nextProgram = programs.find((program) => program.status === 'active');
    if (!programId || !activeProgramIdsSet.has(programId)) {
      if (programId && !activeProgramIdsSet.has(programId)) {
        return;
      }
      if (nextProgram?.id) {
        setValue('program_id', nextProgram.id);
      } else if (programId) {
        setValue('program_id', '');
      }
    }

    setSelectedProgramIds((current) => {
      const filtered = current.filter((id) => activeProgramIdsSet.has(id));
      const preferredPrimaryProgram = activeProgramIdsSet.has(programId ?? '') ? programId : nextProgram?.id ?? '';
      const withPrimary =
        preferredPrimaryProgram && !filtered.includes(preferredPrimaryProgram)
          ? [preferredPrimaryProgram, ...filtered]
          : filtered;
      if (withPrimary.length > 0) {
        return withPrimary;
      }
      return nextProgram?.id ? [nextProgram.id] : [];
    });
  }, [goalId, goalIds, isProgramsFetched, programId, programs, session?.id, setValue, shouldHideGoalCaptureFields]);

  useEffect(() => {
    if (shouldHideGoalCaptureFields) {
      return;
    }
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
    const activeGoalIdsSet = new Set(activeGoals.map((goal) => goal.id));
    if (session?.id && goalId && !activeGoalIdsSet.has(goalId)) {
      return;
    }
    if (!session?.id) {
      if (goalId && !activeGoalIdsSet.has(goalId)) {
        setValue('goal_id', '');
      }
      return;
    }
    if (!goalId || !activeGoalIdsSet.has(goalId)) {
      const nextGoal = primaryProgramGoals[0] ?? activeGoals[0];
      if (nextGoal?.id) {
        setValue('goal_id', nextGoal.id);
        if (nextGoal.program_id) {
          setValue('program_id', nextGoal.program_id);
        }
      } else if (goalId) {
        setValue('goal_id', '');
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
    shouldHideGoalCaptureFields,
  ]);

  useEffect(() => {
    if (shouldHideGoalCaptureFields) {
      return;
    }
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
  }, [goalId, goalIds, goalsById, programId, setValue, shouldHideGoalCaptureFields]);

  useEffect(() => {
    if (shouldHideGoalCaptureFields) {
      return;
    }
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
  }, [goalId, goalIds, goalsById, programId, shouldHideGoalCaptureFields]);

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
      const canKeepCurrentPrimaryGoal =
        Boolean(session?.id) || currentPrimaryGoal?.status === 'active';
      const fallbackGoal =
        uniqueProgramIds.flatMap((id) => activeGoalsByProgram.get(id) ?? [])[0] ??
        activeGoals[0];
      const nextPrimaryGoal =
        currentPrimaryGoal && canKeepCurrentPrimaryGoal && uniqueProgramIds.includes(currentPrimaryGoal.program_id)
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
    [activeGoals, activeGoalsByProgram, goalId, goalIds, goalsById, programId, programsById, session?.id, setValue],
  );

  const toggleProgramSelection = useCallback(
    (targetProgramId: string) => {
      if (isDataCollectionOnly) {
        return;
      }
      const nextProgramIds = selectedProgramSet.has(targetProgramId)
        ? selectedProgramIds.filter((id) => id !== targetProgramId)
        : [...selectedProgramIds, targetProgramId];
      updateProgramSelection(nextProgramIds);
    },
    [isDataCollectionOnly, selectedProgramIds, selectedProgramSet, updateProgramSelection],
  );

  const toggleGoalSelection = (targetId: string) => {
    if (isDataCollectionOnly) {
      return;
    }
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

  const setPrimaryGoal = useCallback((targetId: string) => {
    if (isDataCollectionOnly) {
      return;
    }

    const nextGoalIds = Array.isArray(goalIds) ? [...goalIds] : [];
    if (!nextGoalIds.includes(targetId)) {
      setValue('goal_ids', [...nextGoalIds, targetId]);
    }

    setValue('goal_id', targetId);

    const nextProgramId = goalsById.get(targetId)?.program_id;
    if (nextProgramId) {
      if (programId !== nextProgramId) {
        setValue('program_id', nextProgramId);
      }
      setSelectedProgramIds((current) => (
        current.includes(nextProgramId) ? current : [nextProgramId, ...current]
      ));
    }
  }, [goalIds, goalsById, isDataCollectionOnly, programId, setValue]);

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
            if (session?.id && s.id === session.id) {
              return false;
            }
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
    options?: { captureMergeGoalIds?: string[]; discardTrialTargetIds?: readonly string[] },
  ) => {
    if (!isDataCollectionOnly && conflicts.length > 0) {
      if (!window.confirm('There are scheduling conflicts. Do you want to proceed anyway?')) {
        return;
      }
    }
    const isSavingUnstartedScheduledSession =
      Boolean(session?.id) &&
      !hasStartedSession &&
      data.status === 'scheduled';
    if (!isDataCollectionOnly && isSavingUnstartedScheduledSession && hasProgramValue && !hasProgramOptionForValue) {
      setError('program_id', {
        type: 'validate',
        message: 'Select an active domain before saving this scheduled session.',
      });
      return;
    }
    if (!isDataCollectionOnly && isSavingUnstartedScheduledSession && hasGoalValue && !hasGoalOptionForValue) {
      setError('goal_id', {
        type: 'validate',
        message: 'Select an active primary goal before saving this scheduled session.',
      });
      return;
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
      const mergeGoalIds = options?.captureMergeGoalIds?.filter((id) => id.trim().length > 0) ?? [];
      const isPartialCaptureSave = mergeGoalIds.length > 0;
      const discardedTargetIds = new Set(options?.discardTrialTargetIds ?? []);
      const trialEventsForSubmit = pendingTrialEventsRef.current.filter((event) => {
        if (discardedTargetIds.has(event.target_id)) return false;
        if (!isPartialCaptureSave) {
          return true;
        }
        const target = goalTargetsById.get(event.target_id);
        return Boolean(target && mergeGoalIds.includes(target.goal_id));
      });
      const rawTrialBackedGoalIds = new Set(
        [...existingTrialEvents, ...trialEventsForSubmit]
          .map((event) => goalTargetsById.get(event.target_id)?.goal_id)
          .filter((id): id is string => Boolean(id))
          .filter((id) => !isPartialCaptureSave || mergeGoalIds.includes(id)),
      );
      const submittedTrialGoalIds = new Set(
        trialEventsForSubmit
          .map((event) => goalTargetsById.get(event.target_id)?.goal_id)
          .filter((id): id is string => Boolean(id)),
      );
      const normalizedGoalMeasurementMap = Object.fromEntries(
        mergedGoalIds
          .map((goalEntryId) => {
            const goal = goalsById.get(goalEntryId);
            const entry = reconcileGoalMeasurementTargets(
              normalizeGoalMeasurementEntry(
                working.session_note_goal_measurements?.[goalEntryId],
                goal,
              ),
              goal,
              goalEntryId,
            );
            if (!entry) {
              return null;
            }
            if (!rawTrialBackedGoalIds.has(goalEntryId)) {
              return [goalEntryId, entry];
            }
            const rawEventBackedEntry: SessionGoalMeasurementEntry = {
              version: entry.version,
              data: {
                ...entry.data,
                metric_value: null,
                incorrect_trials: null,
                opportunities: null,
                target_trials: null,
                trial_prompt_note: entry.data.trial_prompt_note,
              },
            };
            return hasMeaningfulGoalMeasurementEntry(rawEventBackedEntry)
              ? [goalEntryId, rawEventBackedEntry]
              : null;
          })
          .filter((entry): entry is [string, SessionGoalMeasurementEntry] => Boolean(entry)),
      );
      const measurementBoundsGoalIds = isPartialCaptureSave ? new Set(mergeGoalIds) : undefined;
      const measurementBoundsError = getGoalMeasurementOpportunityError(
        normalizedGoalMeasurementMap,
        measurementBoundsGoalIds,
      );
      if (measurementBoundsError) {
        showError(measurementBoundsError);
        return;
      }
      const firstDefaultServiceCode = firstServiceCodeOnAuthorization(primaryBillingAuthorization);
      const resolvedAuthorizationId =
        working.session_note_authorization_id?.trim() ||
        primaryBillingAuthorization?.id ||
        '';
      let resolvedServiceCode =
        working.session_note_service_code?.trim() || firstDefaultServiceCode;
      if (
        captureBillingRelaxed &&
        resolvedAuthorizationId &&
        !resolvedServiceCode
      ) {
        resolvedServiceCode = SESSION_CAPTURE_RELAXED_FALLBACK_SERVICE_CODE;
      }
      const hasCaptureInputFromSubmit = isPartialCaptureSave
        ? mergeGoalIds.some((goalKey) => {
            const noteText = (working.session_note_goal_notes?.[goalKey] ?? '').trim();
            if (noteText.length > 0) {
              return true;
            }
            const rawValue = working.session_note_goal_measurements?.[goalKey];
            return hasMeaningfulGoalMeasurementEntry(
              reconcileGoalMeasurementTargets(
                normalizeGoalMeasurementEntry(rawValue, goalsById.get(goalKey)),
                goalsById.get(goalKey),
                goalKey,
              ),
            );
          }) || submittedTrialGoalIds.size > 0
        : Object.values(working.session_note_goal_notes ?? {}).some(
            (value) => typeof value === 'string' && value.trim().length > 0,
          ) ||
          Object.entries(working.session_note_goal_measurements ?? {}).some(([goalKey, rawValue]) =>
            hasMeaningfulGoalMeasurementEntry(
              reconcileGoalMeasurementTargets(
                normalizeGoalMeasurementEntry(rawValue, goalsById.get(goalKey)),
                goalsById.get(goalKey),
                goalKey,
              ),
            ),
          ) ||
          submittedTrialGoalIds.size > 0;
      const goalIdsRequiringNotes = isPartialCaptureSave
        ? mergedGoalIds.filter((id) => mergeGoalIds.includes(id))
        : mergedGoalIds;
      if (hasCaptureInputFromSubmit || isPartialCaptureSave) {
        if (!session?.id) {
          showError('Session capture can only be saved for existing sessions.');
          return;
        }
        if (!captureBillingRelaxed) {
          if (!resolvedAuthorizationId || !resolvedServiceCode) {
            showError(
              'No approved authorization or service is available for this client. Ask an admin to configure billing defaults.',
            );
            return;
          }
        } else if (!resolvedAuthorizationId) {
          showError(
            'No authorization on file for this client. Add an authorization (any status) before saving session capture, or ask an admin.',
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
      const isTerminalStatusSubmit =
        working.status === 'completed' ||
        working.status === 'cancelled' ||
        working.status === 'no-show';
      const lockedSessionFields: Partial<Session> = isDataCollectionOnly && session
        ? {
            id: session.id,
            therapist_id: session.therapist_id,
            client_id: session.client_id,
            program_id: session.program_id,
            goal_id: session.goal_id,
            goal_ids: session.goal_ids ?? [],
            start_time: session.start_time,
            end_time: session.end_time,
            status: isTerminalStatusSubmit ? working.status : session.status,
            notes: session.notes ?? '',
          }
        : {};
      const schedulerOnlyClinicalFields: Partial<Session> = shouldHideGoalCaptureFields
        ? session
          ? working.client_id === session.client_id
            ? {
                program_id: session.program_id ?? '',
                goal_id: session.goal_id ?? '',
                goal_ids: session.goal_ids ?? [],
              }
            : {
                program_id: '',
                goal_id: '',
                goal_ids: [],
              }
          : {
              program_id: '',
              goal_id: '',
              goal_ids: [],
            }
        : {};
      const versionedTrialEvents = trialEventsForSubmit.map((event) => ({
        ...event,
        expected_progression_version: goalTargetsById.get(event.target_id)?.progression_version,
      }));
      const transformed: SessionModalSubmitData = {
        ...working,
        ...(session?.id ? { id: session.id } : {}),
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
        session_note_persist_requested:
          isPartialCaptureSave || hasDirtySessionCaptureFields || isInProgressSession || trialEventsForSubmit.length > 0,
        ...(isPartialCaptureSave ? { session_note_capture_merge_goal_ids: mergeGoalIds } : {}),
        ...(versionedTrialEvents.length > 0 ? { session_note_trial_events: versionedTrialEvents } : {}),
        goal_ids: sessionGoalIds,
        // If a timezone prop is provided, normalize to UTC for consumers expecting Z times
        start_time: timeZone ? toUtcSessionIsoString(working.start_time, resolvedTimeZone) : working.start_time,
        end_time: timeZone ? toUtcSessionIsoString(working.end_time, resolvedTimeZone) : working.end_time,
        ...schedulerOnlyClinicalFields,
        ...lockedSessionFields,
      };
      const submitResult = await onSubmit(transformed);
      if (submitResult?.progression_results || submitResult?.progression_warnings) {
        const targetNames = new Map(goalTargets.map((target) => [target.id, target.name]));
        const notices = formatProgressionNotices(submitResult.progression_results ?? [], targetNames);
        setProgressionNotices(dedupeProgressionNotices(notices, submitResult.progression_warnings ?? []));
        setProgressionConflict(null);
        setStaleProgressionTargetIds([]);
        void queryClient.invalidateQueries({ queryKey: ['client-goal-targets', clientId, activeOrganizationId ?? 'MISSING_ORG'] });
      }
      if (trialEventsForSubmit.length > 0 && session?.id) {
        const submittedAt = new Date().toISOString();
        queryClient.setQueryData<TrialEvent[]>(sessionTrialEventsQueryKey, (current = []) => {
          const existingKeys = new Set(
            current.map((event) => `${event.session_id}:${event.target_id}:${event.trial_number}`),
          );
          const appended = trialEventsForSubmit
            .map((event): TrialEvent | null => {
              const target = goalTargetsById.get(event.target_id);
              if (!target) {
                return null;
              }
              return {
                id: `pending-${session.id}-${event.target_id}-${event.trial_number}`,
                organization_id: activeOrganizationId ?? target.organization_id,
                client_id: target.client_id,
                session_id: session.id,
                target_id: event.target_id,
                goal_id: target.goal_id,
                therapist_id: working.therapist_id ?? session.therapist_id,
                trial_number: event.trial_number,
                response: event.response ?? null,
                prompt_type: event.prompt_type ?? null,
                prompt_level: event.prompt_level ?? null,
                value: typeof event.value === 'number' ? event.value : null,
                event_timestamp: event.timestamp ?? submittedAt,
                metadata: event.metadata ?? {},
                created_by: null,
                updated_by: null,
                created_at: submittedAt,
                updated_at: submittedAt,
              };
            })
            .filter((event): event is TrialEvent => Boolean(event))
            .filter((event) => {
              const key = `${event.session_id}:${event.target_id}:${event.trial_number}`;
              if (existingKeys.has(key)) {
                return false;
              }
              existingKeys.add(key);
              return true;
            });
          return [...current, ...appended];
        });
        void queryClient.invalidateQueries({ queryKey: sessionTrialEventsQueryKey });
        void queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === 'trial-events' });
      }
      setPendingTrialEvents((current) =>
        trialEventsForSubmit.length > 0
          ? current.filter((event) => !trialEventsForSubmit.some((saved) => (
              saved.target_id === event.target_id && saved.trial_number === event.trial_number
            )))
          : current,
      );
      reset(getValues());
      setSaveState('saved');
      return transformed;
    } catch (error) {
      logger.error('Failed to submit session', {
        error,
        context: { component: 'SessionModal', operation: 'handleFormSubmit' }
      });
      setSaveState('error');
      const conflictError = error as Error & { status?: number; conflict?: { stale_target_id?: string; current_target_name?: string; current_phase?: string } };
      if (conflictError.status === 409) {
        const context = conflictError.conflict;
        setProgressionConflict(context
          ? `${conflictError.message} The completed session is preserved.${context.current_target_name ? ` Current target: ${context.current_target_name}` : ''}${context.current_phase ? ` (${context.current_phase})` : ''}`
          : conflictError.message);
        setStaleProgressionTargetIds(context?.stale_target_id ? [context.stale_target_id] : []);
        void queryClient.invalidateQueries({ queryKey: ['client-goal-targets', clientId, activeOrganizationId ?? 'MISSING_ORG'] });
      }
      return null;
    }
  };

  const handleAttemptClose = useCallback(() => {
    if (isSubmitting || btAbaBusy || btAbaFinalized || closeRequestedRef.current) {
      return;
    }
    const beginVisualClose = () => {
      if (closeRequestedRef.current) {
        return;
      }
      closeRequestedRef.current = true;
      setIsClosing(true);
      setIsEntered(false);
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
      if (reduceMotion) {
        onClose();
        return;
      }
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null;
        onClose();
      }, MODAL_TRANSITION_MS);
    };
    if (!hasUnsavedSessionChanges) {
      beginVisualClose();
      return;
    }
    const shouldDiscard = window.confirm(
      'You have unsaved changes in this session. Close without saving?'
    );
    if (shouldDiscard) {
      beginVisualClose();
    }
  }, [btAbaBusy, btAbaFinalized, hasUnsavedSessionChanges, isSubmitting, onClose]);

  const handleStartSession = async () => {
    if (
      !canUseStartSessionAction ||
      !canStartSession ||
      isDependentDataLoading ||
      isStartPlanDataLoading ||
      session?.status !== 'scheduled'
    ) {
      return;
    }
    if (!session?.id) {
      return;
    }
    if (!programId || !goalId) {
      showError("Select a domain and primary goal before starting.");
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
    if (isBtClinicalCaptureSession && session?.id) {
      void handleSubmit(async (formData) => {
        const transformed = await handleFormSubmit({
          ...formData,
          status: 'in_progress',
          session_note_begin_closeout: true,
        });
        if (!transformed) return;
        const refreshedBtAbaNote = await refetchBtAbaNoteState();
        if (refreshedBtAbaNote.error || !refreshedBtAbaNote.data?.templateId) {
          closeoutCaptureRef.current = null;
          setModalStep('capture');
          setBtAbaNoteId(null);
          const message = refreshedBtAbaNote.error instanceof Error
            ? refreshedBtAbaNote.error.message
            : 'Unable to load the saved ABA session note draft.';
          setBtAbaError(message);
          showError(message);
          return;
        }

        setBtAbaNoteId(refreshedBtAbaNote.data.noteId ?? null);
        const trialEvents = transformed.session_note_trial_events ?? [];
        closeoutCaptureRef.current = {
          notePayload: {
            goals_addressed: transformed.session_note_goals_addressed ?? [],
            goal_ids: transformed.session_note_goal_ids ?? null,
            goal_measurements: transformed.session_note_goal_measurements ?? null,
            goal_notes: transformed.session_note_goal_notes ?? null,
            narrative: transformed.session_note_narrative ?? '',
          },
          trialEvents,
          expectedTargetVersions: trialEvents
            .filter((event) => typeof event.expected_progression_version === 'number')
            .map((event) => ({
              target_id: event.target_id,
              progression_version: event.expected_progression_version as number,
            })),
        };
        setBtAbaError(null);
        setModalStep('closeout');
      })();
      return;
    }
    setValue('status', 'completed', { shouldDirty: true });
    void handleSubmit(async (formData) => {
      await handleFormSubmit({
        ...formData,
        status: 'completed',
      });
    })();
  };

  const persistBtAbaDraft = async (
    draftResponses: BtAbaSessionNoteResponses,
    options?: { announceSuccess?: boolean },
  ) => {
    if (!session?.id || !btAbaNoteState?.templateId || !closeoutCaptureRef.current) {
      throw new Error('The ABA session note is still loading. Please retry.');
    }

    const result = await saveBtAbaSessionNoteDraft({
      sessionId: session.id,
      templateId: btAbaNoteState.templateId,
      notePayload: closeoutCaptureRef.current.notePayload,
      responses: draftResponses,
    });
    setBtAbaNoteId(result.noteId);
    if (options?.announceSuccess) {
      showSuccess('ABA session note draft saved');
    }
    return result.noteId;
  };

  const handleSaveBtAbaDraft = async (responses: BtAbaSessionNoteResponses) => {
    setBtAbaBusy(true);
    setBtAbaError(null);
    try {
      await persistBtAbaDraft(responses, { announceSuccess: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save the ABA session note draft.';
      setBtAbaError(message);
      showError(message);
    } finally {
      setBtAbaBusy(false);
    }
  };

  const handleFinalizeBtAba = async (responses: BtAbaSessionNoteResponses) => {
    if (btAbaTransitionRef.current !== 'idle') return;
    if (!session?.id || !btAbaNoteState?.templateId || !closeoutCaptureRef.current) {
      const message = 'The ABA session note is still loading. Please retry.';
      setBtAbaError(message);
      showError(message);
      return;
    }
    btAbaTransitionRef.current = 'finalizing';
    setBtAbaBusy(true);
    setBtAbaError(null);
    let result: BtAbaFinalizeResult;
    try {
      const noteId = await persistBtAbaDraft(responses);
      result = await finalizeBtAbaSessionNote({
        sessionId: session.id,
        noteId,
        notePayload: closeoutCaptureRef.current.notePayload,
        responses,
        trialEvents: closeoutCaptureRef.current.trialEvents,
        expectedTargetVersions: closeoutCaptureRef.current.expectedTargetVersions,
      });
      if (result.status !== 'completed') throw new Error('Session finalization did not complete. Please retry.');
      queryClient.setQueryData(['bt-aba-session-note', session.id], {
        noteId: result.noteId,
        templateId: btAbaNoteState?.templateId ?? null,
        responses,
        status: 'completed',
      });
      void queryClient.invalidateQueries({ queryKey: ['bt-aba-session-note', session.id] });
    } catch (error) {
      btAbaTransitionRef.current = 'idle';
      const message = error instanceof Error ? error.message : 'Unable to finalize the ABA session note.';
      setBtAbaError(message);
      showError(message);
      setBtAbaBusy(false);
      return;
    }

    btAbaTransitionRef.current = 'finalized';
    setBtAbaFinalized(true);
    try {
      await onBtAbaSessionFinalized?.({ ...result, sessionId: session.id });
    } catch (error) {
      logger.warn('BT ABA session completed but schedule refresh callback failed', {
        metadata: { sessionId: session.id, reason: error instanceof Error ? error.message : String(error) },
      });
      showError('Session completed, but the schedule refresh failed. Refresh the page to see the completed session.');
      onClose();
    } finally {
      setBtAbaBusy(false);
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

  useEffect(() => {
    if (sessionStatus === 'cancelled') {
      if (!cancellationAttribution) {
        setValue('cancellation_attribution', 'staff', { shouldDirty: false, shouldTouch: false });
      }
      return;
    }

    if (cancellationAttribution) {
      setValue('cancellation_attribution', '', { shouldDirty: false, shouldTouch: false });
    }
  }, [cancellationAttribution, sessionStatus, setValue]);

  const resolvedCancellationAttribution =
    cancellationAttribution === 'client'
      ? 'client'
      : cancellationAttribution === 'staff'
        ? 'staff'
        : 'unknown';
  const statusSelectValue =
    sessionStatus === 'cancelled'
      ? (canCreateSchedules ? `cancelled:${resolvedCancellationAttribution}` : 'cancelled')
      : (sessionStatus ?? 'scheduled');

  const handleStatusChange = (value: string) => {
    if (value === 'cancelled:staff' || value === 'cancelled:client') {
      setValue('status', 'cancelled', { shouldDirty: true, shouldTouch: true });
      setValue(
        'cancellation_attribution',
        value === 'cancelled:client' ? 'client' : 'staff',
        { shouldDirty: true, shouldTouch: true },
      );
      return;
    }

    setValue('status', value as Session['status'], { shouldDirty: true, shouldTouch: true });
    setValue('cancellation_attribution', '', { shouldDirty: true, shouldTouch: true });
  };

  useEffect(() => {
    if (
      sessionStatus !== 'cancelled' ||
      !sessionDetails ||
      dirtyFields.status ||
      dirtyFields.cancellation_attribution
    ) {
      return;
    }

    const nextCancellationAttribution =
      sessionDetails.cancellation_attribution === 'client' || sessionDetails.cancellation_attribution === 'staff'
        ? sessionDetails.cancellation_attribution
        : 'unknown';

    if (cancellationAttribution !== nextCancellationAttribution) {
      setValue('cancellation_attribution', nextCancellationAttribution, {
        shouldDirty: false,
        shouldTouch: false,
      });
    }
  }, [
    cancellationAttribution,
    dirtyFields.cancellation_attribution,
    dirtyFields.status,
    sessionDetails,
    sessionStatus,
    setValue,
  ]);

  const hasStartedSession = Boolean(sessionDetails?.started_at ?? session?.started_at);
  const hasTerminalSessionStatus =
    session?.status === 'completed' ||
    session?.status === 'cancelled' ||
    session?.status === 'no-show';
  const isInProgressSession =
    !hasTerminalSessionStatus &&
    (session?.status === 'in_progress' || hasStartedSession);
  const isDependentDataLoading =
    Boolean(clientId) &&
    (isProgramsFetching ||
      isGoalsFetching ||
      !isProgramsFetched ||
      !isGoalsFetched);
  const isStartPlanDataLoading =
    isDataCollectionOnly &&
    Boolean(session?.id) &&
    (isSessionDetailsFetching ||
      !isSessionDetailsFetched ||
      isSessionDetailsError ||
      isSessionGoalsFetching ||
      !isSessionGoalsFetched ||
      isSessionGoalsError);
  const canStartSession = Boolean(
    session?.id &&
      !hasStartedSession &&
      session?.status !== 'in_progress' &&
      programId &&
      goalId &&
      hasProgramOptionForValue &&
      hasGoalOptionForValue &&
      (!isDataCollectionOnly || (hasStartableCanonicalGoals && hasExactCanonicalStartGoalSet)),
  );
  const sessionModalMode = useMemo(() => {
    if (!session) {
      return 'create';
    }
    return isInProgressSession ? 'live' : 'edit';
  }, [session, isInProgressSession]);
  const isPrimaryClinicalCaptureMode = isDataCollectionOnly || isBtClinicalCaptureSession || isInProgressSession;
  const planDisclosureSessionKey = session?.id ?? '__new__';
  const modalTitle = useMemo(() => {
    if (!session) {
      return 'New Session';
    }
    if (isCompletedBtAbaSession) {
      return 'Completed ABA Session Note';
    }
    return isInProgressSession ? 'Live session' : 'Edit Session';
  }, [isCompletedBtAbaSession, session, isInProgressSession]);
  const modalSubtitle = useMemo(() => {
    if (!session) {
      return shouldHideGoalCaptureFields
        ? 'Choose therapist, client, and time before creating this appointment.'
        : 'Choose therapist, client, time, and plan details before creating this appointment.';
    }
    if (isBtClinicalCaptureSession) {
      return 'Appointment details are locked. Edit the clinical capture below, then save it with this session.';
    }
    if (isCompletedBtAbaSession) {
      return 'Review the finalized session documentation.';
    }
    if (isInProgressSession) {
      return shouldHideGoalCaptureFields
        ? 'Review scheduling details and save updates while the visit is active.'
        : 'Log trials and per-goal notes, then save to sync. Use Close session when the visit ends.';
    }
    return 'Review core details first, then add notes before saving.';
  }, [isBtClinicalCaptureSession, isCompletedBtAbaSession, session, isInProgressSession, shouldHideGoalCaptureFields]);
  const isCompletedBtAbaNoteReady = Boolean(
    isCompletedBtAbaSession &&
    btAbaNoteState?.status === 'completed' &&
    btAbaNoteState.templateId &&
    completedBtAbaResponses &&
    btAbaNoteState.noteId,
  );
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

  const goalTargetsByGoalId = useMemo(() => {
    const grouped = new Map<string, GoalTarget[]>();
    const historicalTargetIds = new Set([...existingTrialEvents, ...pendingTrialEvents].map((event) => event.target_id));
    selectSessionCaptureTargets(goalTargets, historicalTargetIds).forEach((target) => {
      const list = grouped.get(target.goal_id) ?? [];
      list.push(target);
      grouped.set(target.goal_id, list);
    });
    return grouped;
  }, [existingTrialEvents, goalTargets, pendingTrialEvents]);

  const goalTargetsById = useMemo(
    () => new Map(goalTargets.map((target) => [target.id, target])),
    [goalTargets],
  );

  const resolveConfiguredGoalTarget = useCallback(
    (goalId: string, targetValue: string): GoalTarget | null => {
      if (isAdhocSessionTargetId(goalId)) {
        return null;
      }
      const trimmedTarget = targetValue.trim();
      if (!trimmedTarget) {
        return null;
      }
      return goalTargetsByGoalId
        .get(goalId)
        ?.find((target) => target.name.trim() === trimmedTarget) ?? null;
    },
    [goalTargetsByGoalId],
  );

  const getRawTrialCount = useCallback(
    (
      targetId: string,
      measurementType: string,
      field: 'metric_value' | 'incorrect_trials',
      scope: 'all' | 'pending' = 'all',
    ) => {
      const currentPendingTrialEvents = pendingTrialEventsRef.current;
      const sourceEvents = scope === 'pending'
        ? currentPendingTrialEvents
        : [...existingTrialEvents, ...currentPendingTrialEvents];
      return sourceEvents.filter((event) => {
        if (event.target_id !== targetId) {
          return false;
        }
        if (responseRequiredMeasurementTypes.has(measurementType)) {
          return field === 'metric_value'
            ? isPositiveResponse(event.response)
            : event.response === 'incorrect' || event.response === 'noResponse';
        }
        return field === 'metric_value'
          ? typeof event.value === 'number' && event.value > 0
          : event.value === 0;
      }).length;
    },
    [existingTrialEvents],
  );

  const getRawTrialNumericSummary = useCallback(
    (targetId: string, scope: 'all' | 'pending' = 'all') => {
      const currentPendingTrialEvents = pendingTrialEventsRef.current;
      const sourceEvents = scope === 'pending'
        ? currentPendingTrialEvents
        : [...existingTrialEvents, ...currentPendingTrialEvents];
      return sourceEvents
        .filter((event) => event.target_id === targetId && typeof event.value === 'number')
        .reduce(
          (summary, event) => ({
            count: summary.count + 1,
            total: summary.total + (typeof event.value === 'number' ? event.value : 0),
          }),
          { count: 0, total: 0 },
        );
    },
    [existingTrialEvents],
  );

  const getNextRawTrialNumber = useCallback(
    (targetId: string): number => {
      const maxTrialNumber = [...existingTrialEvents, ...pendingTrialEventsRef.current]
        .filter((event) => event.target_id === targetId)
        .reduce((max, event) => Math.max(max, Number(event.trial_number) || 0), 0);
      return maxTrialNumber + 1;
    },
    [existingTrialEvents],
  );

  const bumpTrialCount = useCallback(
    (
      goalId: string,
      targetIndex: number,
      field: 'metric_value' | 'incorrect_trials',
      delta: number,
      configuredTarget?: GoalTarget | null,
      preferredPromptOutcome: PromptOutcome = 'correct',
    ) => {
      if (configuredTarget) {
        const dirtyPath =
          `session_note_goal_measurements.${goalId}.data.target_trials.${targetIndex}.${field}` as const;
        const nextDisplayedCount = Math.max(
          0,
          getRawTrialCount(configuredTarget.id, configuredTarget.measurement_type, field) + delta,
        );
        if (delta > 0) {
          const startTrialNumber = getNextRawTrialNumber(configuredTarget.id);
          const newEvents = Array.from({ length: delta }, (_, index): SessionCaptureTrialEventInput => {
            const trialNumber = startTrialNumber + index;
            const usesResponse = responseRequiredMeasurementTypes.has(configuredTarget.measurement_type);
            return {
              target_id: configuredTarget.id,
              trial_number: trialNumber,
              ...(usesResponse
                ? { response: field === 'metric_value' ? 'correct' : 'incorrect' }
                : { value: field === 'metric_value' ? 1 : 0 }),
              metadata: { source: 'schedule_capture', goal_id: goalId, target_index: targetIndex },
            };
          });
          setPendingTrialEvents((current) => [...current, ...newEvents]);
          setValue(dirtyPath, nextDisplayedCount, { shouldDirty: true, shouldTouch: true });
        } else if (delta < 0) {
          const removeCount = Math.abs(delta);
          setPendingTrialEvents((current) => {
            let remainingToRemove = removeCount;
            const next = current.slice();
            for (let index = next.length - 1; index >= 0 && remainingToRemove > 0; index -= 1) {
              const event = next[index];
              if (event.target_id !== configuredTarget.id) {
                continue;
              }
              const matchesField = responseRequiredMeasurementTypes.has(configuredTarget.measurement_type)
                ? (field === 'metric_value'
                    ? isPositiveResponse(event.response)
                    : event.response === 'incorrect' || event.response === 'noResponse')
                : (field === 'metric_value'
                    ? typeof event.value === 'number' && event.value > 0
                    : event.value === 0);
              if (!matchesField) {
                continue;
              }
              next.splice(index, 1);
              remainingToRemove -= 1;
            }
            return next;
          });
          setValue(dirtyPath, nextDisplayedCount, { shouldDirty: true, shouldTouch: true });
        }
        return;
      }
      const path = `session_note_goal_measurements.${goalId}.data.target_trials.${targetIndex}.${field}` as const;
      const raw = getValues(path);
      const cur =
        typeof raw === 'number' && Number.isFinite(raw)
          ? raw
          : typeof raw === 'string' && raw.trim().length > 0
            ? Number(raw)
            : 0;
      const safe = Number.isFinite(cur) ? cur : 0;
      const nextCount = Math.max(0, safe + delta);
      if (delta < 0) {
        const promptCountsPath =
          `session_note_goal_measurements.${goalId}.data.target_trials.${targetIndex}.prompt_counts` as const;
        const promptField = field === 'metric_value' ? 'correct_trials' : 'incorrect_trials';
        const currentPromptCounts = getValues(promptCountsPath) as SessionPromptCount[] | null | undefined;
        const promptedTotal = sumLegacyPromptCounts(currentPromptCounts, promptField);
        const promptReduction = Math.max(0, promptedTotal - nextCount);
        if (promptReduction > 0) {
          setValue(
            promptCountsPath,
            decrementLegacyPromptCounts(currentPromptCounts, promptField, promptReduction, preferredPromptOutcome),
            { shouldDirty: true, shouldTouch: true },
          );
        }
      }
      setValue(path, nextCount, { shouldDirty: true, shouldTouch: true });
    },
    [getNextRawTrialNumber, getRawTrialCount, getValues, setValue],
  );

  const recordResponseTrial = useCallback(
    (
      goalId: string,
      targetIndex: number,
      configuredTarget: GoalTarget,
      response: NonNullable<TrialEvent['response']>,
      prompt?: { promptType: string; promptLevel: string | null },
    ) => {
      const field = isPositiveResponse(response) ? 'metric_value' : 'incorrect_trials';
      const dirtyPath =
        `session_note_goal_measurements.${goalId}.data.target_trials.${targetIndex}.${field}` as const;
      const nextDisplayedCount = getRawTrialCount(configuredTarget.id, configuredTarget.measurement_type, field) + 1;
      const newEvent: SessionCaptureTrialEventInput = {
        target_id: configuredTarget.id,
        trial_number: getNextRawTrialNumber(configuredTarget.id),
        response,
        ...(prompt ? {
          prompt_type: prompt.promptType,
          prompt_level: prompt.promptLevel,
        } : {}),
        metadata: { source: 'schedule_capture', goal_id: goalId, target_index: targetIndex },
      };
      setPendingTrialEvents((current) => [...current, newEvent]);
      setValue(dirtyPath, nextDisplayedCount, { shouldDirty: true, shouldTouch: true });
    },
    [getNextRawTrialNumber, getRawTrialCount, setValue],
  );

  const recordPromptTrial = useCallback(
    (
      goalId: string,
      targetIndex: number,
      configuredTarget: GoalTarget | null,
      prompt: { promptType: SessionPromptCount['prompt_type']; promptLevel: SessionPromptCount['prompt_level'] },
      outcome: PromptOutcome,
    ) => {
      if (configuredTarget && responseRequiredMeasurementTypes.has(configuredTarget.measurement_type)) {
        recordResponseTrial(
          goalId,
          targetIndex,
          configuredTarget,
          outcome,
          prompt,
        );
        return;
      }

      const aggregateField = outcome === 'correct' ? 'metric_value' : 'incorrect_trials';
      bumpTrialCount(goalId, targetIndex, aggregateField, 1, null, outcome);
      const promptCountsPath =
        `session_note_goal_measurements.${goalId}.data.target_trials.${targetIndex}.prompt_counts` as const;
      const current = getValues(promptCountsPath) as SessionPromptCount[] | null | undefined;
      setValue(promptCountsPath, incrementLegacyPromptCount(current, prompt, outcome), {
        shouldDirty: true,
        shouldTouch: true,
      });
    },
    [bumpTrialCount, getValues, recordResponseTrial, setValue],
  );

  const recordNumericTrial = useCallback(
    (goalId: string, targetIndex: number, configuredTarget: GoalTarget, rawValue: string) => {
      if (rawValue.trim().length === 0) {
        showError('Enter a non-negative value before adding the trial.');
        return;
      }
      const value = Number(rawValue);
      if (!Number.isFinite(value) || value < 0) {
        showError('Enter a non-negative value before adding the trial.');
        return;
      }
      const metricValuePath =
        `session_note_goal_measurements.${goalId}.data.target_trials.${targetIndex}.metric_value` as const;
      const opportunitiesPath =
        `session_note_goal_measurements.${goalId}.data.target_trials.${targetIndex}.opportunities` as const;
      const currentSummary = getRawTrialNumericSummary(configuredTarget.id);
      const nextSummary = {
        count: currentSummary.count + 1,
        total: currentSummary.total + value,
      };
      const newEvent: SessionCaptureTrialEventInput = {
        target_id: configuredTarget.id,
        trial_number: getNextRawTrialNumber(configuredTarget.id),
        value,
        metadata: { source: 'schedule_capture', goal_id: goalId, target_index: targetIndex },
      };
      setPendingTrialEvents((current) => [...current, newEvent]);
      setValue(metricValuePath, nextSummary.total, { shouldDirty: true, shouldTouch: true });
      setValue(opportunitiesPath, nextSummary.count, { shouldDirty: true, shouldTouch: true });
      setPendingNumericTrialValues((current) => ({
        ...current,
        [configuredTarget.id]: '',
      }));
    },
    [getNextRawTrialNumber, getRawTrialNumericSummary, setValue],
  );

  const updateGoalTargets = useCallback(
    (goalId: string, nextTargets: string[], nextTargetTrialsSource?: unknown[]) => {
      const targetsPath = `session_note_goal_measurements.${goalId}.data.targets` as const;
      const targetPath = `session_note_goal_measurements.${goalId}.data.target` as const;
      const targetTrialsPath = `session_note_goal_measurements.${goalId}.data.target_trials` as const;
      const currentTargetTrials = nextTargetTrialsSource ?? getValues(targetTrialsPath);
      const nextTargetTrials = Array.isArray(currentTargetTrials)
        ? nextTargets.map((target, index) => ({
          ...(typeof currentTargetTrials[index] === 'object' && currentTargetTrials[index] !== null
            ? currentTargetTrials[index]
            : {}),
          target,
        }))
        : nextTargets.map((target) => ({ target }));
      setValue(targetsPath, nextTargets, { shouldDirty: true, shouldTouch: true });
      setValue(
        targetPath,
        nextTargets
          .map((target) => (typeof target === 'string' ? target.trim() : ''))
          .find((target) => target.length > 0) ?? '',
        { shouldDirty: true, shouldTouch: true },
      );
      setValue(targetTrialsPath, nextTargetTrials, { shouldDirty: true, shouldTouch: true });
    },
    [getValues, setValue],
  );

  const addGoalTarget = useCallback(
    (goalId: string, existingTargets: string[]) => {
      updateGoalTargets(goalId, [...existingTargets, '']);
    },
    [updateGoalTargets],
  );

  const removeGoalTarget = useCallback(
    (goalId: string, targetIndex: number, existingTargets: string[]) => {
      const nextTargets = existingTargets.filter((_, index) => index !== targetIndex);
      const targetTrialsPath = `session_note_goal_measurements.${goalId}.data.target_trials` as const;
      const currentTargetTrials = getValues(targetTrialsPath);
      const nextTargetTrials = Array.isArray(currentTargetTrials)
        ? currentTargetTrials.filter((_, index) => index !== targetIndex)
        : undefined;
      setPromptOutcomeByTargetId((current) =>
        remapLegacyPromptCorrectnessAfterRemoval(current, goalId, targetIndex, existingTargets.length));
      updateGoalTargets(goalId, nextTargets.length > 0 ? nextTargets : [''], nextTargetTrials);
    },
    [getValues, updateGoalTargets],
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
    if (hasUnsavedSessionChanges) {
      return { tone: 'warning' as const, text: 'Unsaved changes.' };
    }
    return null;
  }, [hasUnsavedSessionChanges, isSubmitting, saveState]);
  const dialogDescriptionIds = [
    dialogDescriptionId,
    ...(retryHint ? [retryHintDescriptionId] : []),
    ...(conflicts.length > 0 ? [conflictDescriptionId] : []),
  ].join(' ');
  const isCloseInteractionDisabled = isSubmitting || btAbaBusy || btAbaFinalized || isClosing;
  const isReactivateDisabled =
    isCloseInteractionDisabled ||
    isDependentDataLoading ||
    isLoadingAlternatives ||
    isReactivating ||
    isDeletingAppointment ||
    isDeleteSubmitting;
  const isDeleteAppointmentBusy = isDeletingAppointment || isDeleteSubmitting;
  const isDeleteAppointmentDisabled =
    isCloseInteractionDisabled ||
    isDependentDataLoading ||
    isLoadingAlternatives ||
    isReactivating ||
    isDeleteAppointmentBusy;

  const deleteAppointmentSummary = useMemo(() => {
    const currentClientId = session?.client_id;
    const currentTherapistId = session?.therapist_id;
    const currentStartTime = session?.start_time || '';
    const currentEndTime = session?.end_time || '';
    const clientLabel =
      clients.find((client) => client.id === currentClientId)?.full_name ??
      session?.client?.full_name ??
      'Unknown client';
    const therapistLabel =
      therapists.find((therapist) => therapist.id === currentTherapistId)?.full_name ??
      session?.therapist?.full_name ??
      'Unknown therapist';

    const parsedStart = parseISO(currentStartTime);
    const parsedEnd = parseISO(currentEndTime);
    const appointmentDate = Number.isNaN(parsedStart.getTime())
      ? currentStartTime
      : format(parsedStart, 'PPP');
    const startLabel = Number.isNaN(parsedStart.getTime())
      ? currentStartTime
      : format(parsedStart, 'p');
    const endLabel = Number.isNaN(parsedEnd.getTime())
      ? currentEndTime
      : format(parsedEnd, 'p');

    return {
      clientLabel,
      therapistLabel,
      appointmentDate,
      startLabel,
      endLabel,
    };
  }, [clients, session?.client?.full_name, session?.client_id, session?.end_time, session?.start_time, session?.therapist?.full_name, session?.therapist_id, therapists]);

  const handleReactivateSession = useCallback(async () => {
    if (!session || !onReactivate) {
      return;
    }

    const currentStartTime = getValues("start_time");
    const currentEndTime = getValues("end_time");
    if (!currentStartTime || !currentEndTime) {
      return;
    }

    const currentDate = format(parseISO(currentStartTime), 'PPP');
    const currentTime = `${format(parseISO(currentStartTime), 'p')} - ${format(parseISO(currentEndTime), 'p')}`;
    const confirmed = window.confirm(
      `Reactivate this cancelled appointment for ${currentDate} at ${currentTime}?`,
    );
    if (!confirmed) {
      return;
    }

    await onReactivate({
      session,
      start_time: timeZone ? toUtcSessionIsoString(currentStartTime, resolvedTimeZone) : currentStartTime,
      end_time: timeZone ? toUtcSessionIsoString(currentEndTime, resolvedTimeZone) : currentEndTime,
    });
  }, [getValues, onReactivate, resolvedTimeZone, session, timeZone]);

  const handleDeleteAppointment = useCallback(async () => {
    if (!session || !onDeleteAppointment) {
      return;
    }
    setDeleteAppointmentError(null);
    setIsDeleteConfirmationOpen(true);
  }, [onDeleteAppointment, session]);

  const handleConfirmDeleteAppointment = useCallback(async () => {
    if (!session || !onDeleteAppointment || isDeleteAppointmentDisabled) {
      return;
    }

    try {
      setIsDeleteSubmitting(true);
      await onDeleteAppointment({ session });
      setIsDeleteConfirmationOpen(false);
      setDeleteAppointmentError(null);
    } catch (error) {
      setDeleteAppointmentError(`Unable to delete appointment. ${toError(error, 'Appointment deletion failed').message}`);
    } finally {
      setIsDeleteSubmitting(false);
    }
  }, [isDeleteAppointmentDisabled, onDeleteAppointment, session]);

  useEffect(() => {
    if (!isOpen) {
      setIsEntered(false);
      setIsClosing(false);
      closeRequestedRef.current = false;
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      if (enterFrameRef.current !== null) {
        window.cancelAnimationFrame(enterFrameRef.current);
        enterFrameRef.current = null;
      }
      return;
    }

    setIsClosing(false);
    setIsEntered(false);
    closeRequestedRef.current = false;
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (enterFrameRef.current !== null) {
      window.cancelAnimationFrame(enterFrameRef.current);
    }
    enterFrameRef.current = window.requestAnimationFrame(() => {
      setIsEntered(true);
      enterFrameRef.current = null;
    });

    return () => {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      if (enterFrameRef.current !== null) {
        window.cancelAnimationFrame(enterFrameRef.current);
        enterFrameRef.current = null;
      }
    };
  }, [isOpen, session?.id]);

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
    if (!isOpen || !hasUnsavedSessionChanges || isSubmitting) {
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
  }, [isOpen, hasUnsavedSessionChanges, isSubmitting]);

  useEffect(() => {
    if (!hasUnsavedSessionChanges && saveState === 'error') {
      setSaveState('idle');
    }
  }, [hasUnsavedSessionChanges, saveState]);

  useEffect(() => {
    if (!isOpen) {
      setSaveState('idle');
    }
  }, [isOpen, session?.id]);

  useEffect(() => {
    if (!linkedSessionNote || !session?.id || hasUnsavedSessionChanges) {
      return;
    }
    const linkedMeasurements = (linkedSessionNote.goal_measurements as Record<string, unknown> | null) ?? {};
    const normalizedLinkedMeasurements = Object.fromEntries(
      Object.entries(linkedMeasurements)
        .map(([goalEntryId, rawValue]) => {
          const goal = goalsById.get(goalEntryId);
          const normalized = reconcileGoalMeasurementTargets(
            normalizeGoalMeasurementEntry(rawValue, goal),
            goal,
            goalEntryId,
          );
          return normalized ? [goalEntryId, normalized] : null;
        })
        .filter((entry): entry is [string, SessionGoalMeasurementEntry] => Boolean(entry)),
    );
    setValue(
      'session_note_goal_notes',
      (linkedSessionNote.goal_notes as Record<string, string> | null) ?? {},
    );
    setValue(
      'session_note_goal_measurements',
      normalizedLinkedMeasurements,
    );
    setValue('session_note_goal_ids', linkedSessionNote.goal_ids ?? []);
    setValue('session_note_goals_addressed', linkedSessionNote.goals_addressed ?? []);
    setValue('session_note_authorization_id', linkedSessionNote.authorization_id ?? '');
    setValue('session_note_service_code', linkedSessionNote.service_code ?? '');
  }, [goalsById, linkedSessionNote, session?.id, setValue, hasUnsavedSessionChanges]);

  useEffect(() => {
    if (
      !isOpen ||
      !isBtClinicalCaptureSession ||
      session?.status !== 'in_progress' ||
      btAbaNoteState?.status !== 'draft' ||
      !btAbaNoteState.templateId ||
      !btAbaNoteState.responses ||
      !btAbaNoteState.noteId
    ) {
      return;
    }
    closeoutCaptureRef.current = {
      notePayload: {
        goals_addressed: linkedSessionNote?.goals_addressed ?? getValues('session_note_goals_addressed') ?? [],
        goal_ids: linkedSessionNote?.goal_ids ?? getValues('session_note_goal_ids') ?? null,
        goal_measurements: linkedSessionNote?.goal_measurements ?? getValues('session_note_goal_measurements') ?? null,
        goal_notes: linkedSessionNote?.goal_notes ?? getValues('session_note_goal_notes') ?? null,
        narrative: linkedSessionNote?.narrative ?? getValues('session_note_narrative') ?? '',
      },
      trialEvents: [],
      expectedTargetVersions: [],
    };
    setBtAbaNoteId(btAbaNoteState.noteId);
    setBtAbaError(null);
    setModalStep('closeout');
  }, [btAbaNoteState, getValues, isBtClinicalCaptureSession, isOpen, linkedSessionNote, session?.status]);

  useEffect(() => {
    if (
      !isOpen ||
      !isCompletedBtAbaSession ||
      !isCompletedBtAbaNoteReady ||
      !btAbaNoteState?.noteId
    ) {
      return;
    }
    setBtAbaNoteId(btAbaNoteState.noteId);
    setBtAbaError(null);
    setModalStep('closeout');
  }, [btAbaNoteState?.noteId, isCompletedBtAbaNoteReady, isCompletedBtAbaSession, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      planDisclosureSessionKeyRef.current = null;
      planDisclosureInitializedRef.current = false;
      planDisclosureTouchedRef.current = false;
      clinicalDisclosureSessionKeyRef.current = null;
      setIsPlanSectionExpanded(!session?.id);
      setIsClinicalSectionExpanded(isPrimaryClinicalCaptureMode);
    }
  }, [isOpen, isPrimaryClinicalCaptureMode, session?.id]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    if (planDisclosureSessionKeyRef.current !== planDisclosureSessionKey) {
      planDisclosureSessionKeyRef.current = planDisclosureSessionKey;
      planDisclosureInitializedRef.current = false;
      planDisclosureTouchedRef.current = false;
    }
    if (!session?.id) {
      if (!planDisclosureInitializedRef.current) {
        setIsPlanSectionExpanded(true);
        planDisclosureInitializedRef.current = true;
      }
      return;
    }
    if (!planDisclosureInitializedRef.current && hasResolvedValidPlan) {
      if (!planDisclosureTouchedRef.current) {
        setIsPlanSectionExpanded(false);
      }
      planDisclosureInitializedRef.current = true;
    }
    if (!planDisclosureInitializedRef.current && !hasResolvedValidPlan && !planDisclosureTouchedRef.current) {
      setIsPlanSectionExpanded(true);
    }
  }, [hasResolvedValidPlan, isOpen, isPrimaryClinicalCaptureMode, planDisclosureSessionKey, session?.id]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const clinicalDisclosureSessionKey =
      `${planDisclosureSessionKey}:${isPrimaryClinicalCaptureMode ? 'primary' : 'secondary'}`;
    if (clinicalDisclosureSessionKeyRef.current !== clinicalDisclosureSessionKey) {
      clinicalDisclosureSessionKeyRef.current = clinicalDisclosureSessionKey;
      setIsClinicalSectionExpanded(isPrimaryClinicalCaptureMode);
    }
  }, [isOpen, isPrimaryClinicalCaptureMode, planDisclosureSessionKey]);

  useEffect(() => {
    if (!isOpen || (!progressionConflict && progressionNotices.length === 0)) {
      return;
    }
    setIsClinicalSectionExpanded(true);
  }, [isOpen, progressionConflict, progressionNotices]);

  useEffect(() => {
    if (!isOpen || !isInProgressSession) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      sessionCaptureSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen, isInProgressSession, session?.id]);

  const closeoutDataPoints = useMemo(() => {
    const finalizedGoalIds = linkedSessionNote?.goal_ids ?? [];
    const finalizedGoalLabels = linkedSessionNote?.goals_addressed ?? [];
    const goalMeasurements = isCompletedBtAbaSession
      ? (linkedSessionNote?.goal_measurements as Record<string, unknown> | null | undefined)
      : sessionNoteGoalMeasurements ?? closeoutCaptureRef.current?.notePayload.goal_measurements;
    const measurementGoalIds = goalMeasurements && typeof goalMeasurements === 'object'
      ? Object.keys(goalMeasurements)
      : [];
    const finalizedGoalLabelIds = finalizedGoalIds.length > 0
      ? finalizedGoalIds
      : measurementGoalIds.length === 1 && finalizedGoalLabels.length === 1
        ? measurementGoalIds
        : [];
    const finalizedGoalLabelsById = new Map(
      finalizedGoalLabelIds.flatMap((goalEntryId, index) => {
        const label = trimString(finalizedGoalLabels[index]);
        return label ? [[goalEntryId, label] as const] : [];
      }),
    );
    const completedLinkedGoalIds = Array.from(new Set([
      ...finalizedGoalIds,
      ...measurementGoalIds,
    ]));

    return buildCloseoutDataPoints({
      existingTrialEvents,
      pendingTrialEvents: closeoutCaptureRef.current?.trialEvents ?? [],
      goalTargetsById,
      goalsById,
      goalLabelsById: finalizedGoalLabelsById,
      linkedGoalIds: isCompletedBtAbaSession ? completedLinkedGoalIds : sessionNoteGoalIds,
      goalMeasurements,
    });
  }, [
    existingTrialEvents,
    goalTargetsById,
    goalsById,
    isCompletedBtAbaSession,
    linkedSessionNote,
    modalStep,
    sessionNoteGoalIds,
    sessionNoteGoalMeasurements,
  ]);

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      className={`fixed inset-0 z-50 flex items-end justify-center p-0 transition-colors motion-reduce:transition-none sm:items-center sm:p-4 ${
        isEntered && !isClosing ? 'bg-black/50' : 'bg-black/0'
      }`}
      role="presentation"
      {...(isClosing ? { inert: '' } : {})}
      style={{ transitionDuration: `${MODAL_TRANSITION_MS}ms` }}
      onMouseDown={(event) => {
        if (!isClosing && event.target === overlayRef.current) {
          handleAttemptClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        className={`flex h-[100dvh] w-full max-w-2xl flex-col overflow-hidden bg-white shadow-xl transition-[opacity,transform] motion-reduce:transition-none dark:bg-dark-lighter sm:h-auto sm:max-h-[86vh] sm:rounded-xl ${
          isEntered && !isClosing ? 'scale-100 opacity-100' : 'scale-[0.985] opacity-0'
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={dialogTitleId}
        aria-describedby={dialogDescriptionIds}
        data-session-status={session?.status ?? ""}
        data-session-modal-mode={sessionModalMode}
        data-transition-state={isClosing ? 'closing' : isEntered ? 'open' : 'opening'}
        style={{ transitionDuration: `${MODAL_TRANSITION_MS}ms` }}
        tabIndex={-1}
      >
        {/* Header */}
        <div className="border-b bg-white px-4 py-2.5 dark:border-gray-700 dark:bg-dark-lighter sm:px-5 sm:py-3">
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
            disabled={isCloseInteractionDisabled}
            aria-label="Close session modal"
            title="Close session modal"
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-500 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
          </div>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 pb-24 sm:p-4 sm:pb-5 max-sm:pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))]">
          <p id={dialogDescriptionId} className="sr-only">
            Use this form to create or update a therapy session.
          </p>
          {isBtAbaNoteLoadError ? (
            <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {btAbaNoteLoadError instanceof Error ? btAbaNoteLoadError.message : 'Unable to load the saved ABA session note draft.'}
            </p>
          ) : null}
          {isCompletedBtAbaSession && !isCompletedBtAbaNoteReady ? (
            <section data-testid="completed-bt-aba-note-unavailable" className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-900/20">
              <h2 className="font-semibold text-amber-900 dark:text-amber-100">
                {isBtAbaNoteLoading ? 'Loading finalized ABA session note...' : 'Finalized ABA session note is unavailable.'}
              </h2>
              {!isBtAbaNoteLoading && (
                <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">
                  Close this dialog and retry. The completed session remains unchanged.
                </p>
              )}
            </section>
          ) : modalStep === 'closeout' && session?.id ? (
            <div className="space-y-4">
              {btAbaError ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{btAbaError}</p> : null}
              <BtAbaSessionNoteForm
                initialResponses={initialBtAbaResponses}
                context={{
                  sessionId: session.id,
                  clientName: selectedClient?.full_name ?? 'Unknown client',
                  behaviorTechnicianName: selectedTherapist?.full_name ?? 'Unknown behavior technician',
                  serviceDate: format(parseISO(session.start_time), 'yyyy-MM-dd'),
                  sessionTime: `${format(parseISO(session.start_time), 'HH:mm')} - ${format(parseISO(session.end_time), 'HH:mm')}`,
                  placeOfService: sessionDetails?.location_type?.trim() || 'Not recorded',
                  billingCode: linkedSessionNote?.service_code || getValues('session_note_service_code') || firstServiceCodeOnAuthorization(primaryBillingAuthorization) || 'Not recorded',
                  modifiers: ['Not recorded'],
                  programs: isCompletedBtAbaSession
                    ? [{
                        name: 'Finalized session goals',
                        goals: (linkedSessionNote?.goals_addressed ?? [])
                          .map((goalLabel) => goalLabel.trim())
                          .filter(Boolean),
                      }]
                    : selectedProgramIds.map((selectedProgramId) => ({
                        name: programsById.get(selectedProgramId)?.name ?? 'Domain',
                        goals: sessionNoteGoalIds
                          .map((selectedGoalId) => goalsById.get(selectedGoalId))
                          .filter((selectedGoal): selectedGoal is Goal => Boolean(selectedGoal?.program_id === selectedProgramId))
                          .map((selectedGoal) => selectedGoal.title),
                      })),
                  collectedDataPointCount: closeoutDataPoints.length,
                  linkedDataPoints: closeoutDataPoints.filter((point) => point.linked),
                  allDataPoints: closeoutDataPoints,
                  collectedBy: selectedTherapist?.full_name ?? 'Unknown behavior technician',
                }}
                onSaveDraft={handleSaveBtAbaDraft}
                onFinalize={handleFinalizeBtAba}
                busy={btAbaBusy}
                readOnly={isCompletedBtAbaSession}
              />
              {!isCompletedBtAbaSession && (
                <button type="button" disabled={btAbaBusy || btAbaFinalized} onClick={() => setModalStep('capture')} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700">Back to capture</button>
              )}
            </div>
          ) : (
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
                  {isDataCollectionOnly
                    ? 'Session details are read-only. Save clinical capture to sync data collection.'
                    : shouldHideGoalCaptureFields
                      ? 'Session details stay focused on scheduling fields while active.'
                      : 'You can adjust domains and goals while active; save to keep the plan in sync with the schedule.'}
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
                    {shouldHideGoalCaptureFields
                      ? 'Pick the therapist and client for this session.'
                      : 'Pick the therapist, client, and care-plan details for this session.'}
                  </p>
                </div>
                <button
                  type="button"
                  aria-expanded={isPlanSectionExpanded}
                  aria-controls="session-modal-plan-goals"
                  onClick={() => {
                    planDisclosureTouchedRef.current = true;
                    setIsPlanSectionExpanded((current) => !current);
                  }}
                  className="flex min-w-0 items-center gap-2 rounded-full border border-gray-200 px-3 py-1 text-left text-xs font-medium text-gray-600 hover:bg-white dark:border-gray-700 dark:text-gray-300 dark:hover:bg-dark"
                >
                  <span>Plan &amp; goals</span>
                  <span aria-hidden="true" className="truncate text-[11px] text-gray-500 dark:text-gray-400">
                    {planSummaryProgramName} · {planSummaryGoalName}
                  </span>
                </button>
              </div>

              {(selectedTherapist || selectedClient || selectedPrimaryGoal) && (
                <div className="grid gap-2 rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-600 dark:border-gray-700 dark:bg-dark-lighter dark:text-gray-300 sm:grid-cols-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 dark:text-white">Therapist</p>
                    <p className="mt-1 truncate">{selectedTherapist?.full_name ?? 'Not selected'}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 dark:text-white">Client</p>
                    <p className="mt-1 truncate">{selectedClient?.full_name ?? 'Not selected'}</p>
                  </div>
                  {!shouldHideGoalCaptureFields ? (
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900 dark:text-white">Primary goal</p>
                      <p className="mt-1 truncate">{selectedPrimaryGoal?.title ?? 'Not selected'}</p>
                    </div>
                  ) : null}
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
                  disabled={isDataCollectionOnly}
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
                  disabled={isDataCollectionOnly}
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

            <div id="session-modal-plan-goals" hidden={!isPlanSectionExpanded} className="space-y-4">
            {!shouldHideGoalCaptureFields && selectedPrimaryGoal && (
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

            {!shouldHideGoalCaptureFields && (isProgramsError || isGoalsError) && (
              <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200 sm:p-4">
                {isProgramsError && (
                  <div className="flex items-center justify-between gap-3">
                    <span>Could not load domains.</span>
                    <button
                      type="button"
                      aria-label="Retry domains"
                      onClick={() => {
                        void refetchPrograms();
                      }}
                      className="font-semibold underline underline-offset-2"
                    >
                      Retry
                    </button>
                  </div>
                )}
                {isGoalsError && (
                  <div className="flex items-center justify-between gap-3">
                    <span>Could not load goals.</span>
                    <button
                      type="button"
                      aria-label="Retry goals"
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
            )}

            {!shouldHideGoalCaptureFields &&
              !isProgramsError &&
              !isGoalsError &&
              (programs.length === 0 || activePrograms.length === 0 || availableProgramGroups.length === 0) && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200 sm:p-4">
                {programs.length === 0 || activePrograms.length === 0
                  ? 'No active domains found for this client.'
                  : 'No active goals found for this client. Add or activate a goal before starting a session.'}
              </div>
            )}

            {!shouldHideGoalCaptureFields ? (
              <>
            <div className="space-y-2 sm:space-y-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 sm:sr-only">
                Domains &amp; goals
              </p>
              <input type="hidden" {...register('program_id')} />
              <input type="hidden" {...register('goal_id')} />
              {errors.program_id && (
                <p className="text-sm text-red-600 dark:text-red-400">{errors.program_id.message}</p>
              )}
              {errors.goal_id && (
                <p className="text-sm text-red-600 dark:text-red-400">{errors.goal_id.message}</p>
              )}

              <div className="space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Domains in this session</p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Choose one or more domains, then select the goals you want to track without waiting on another fetch.
                    </p>
                  </div>
                  <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 dark:bg-blue-900/20 dark:text-blue-200">
                    {selectedProgramIds.length} selected
                  </span>
                </div>
                {availableProgramGroups.length > 0 ? (
                  <>
                <div className="hidden flex-wrap gap-2 sm:flex">
                  {availableProgramGroups.map(({ program, goals: groupedGoals }) => {
                    const isSelected = selectedProgramSet.has(program.id);
                    return (
                      <button
                        key={program.id}
                        type="button"
                        data-program-id={program.id}
                        aria-pressed={isSelected}
                        onClick={() => toggleProgramSelection(program.id)}
                        disabled={isDataCollectionOnly}
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
                      <span>Selected domains</span>
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
                          data-program-id={program.id}
                          checked={selectedProgramSet.has(program.id)}
                          onChange={() => toggleProgramSelection(program.id)}
                          disabled={isDataCollectionOnly}
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
                    Tracking domains: {selectedPrograms.map((program) => program.name).join(', ')}
                  </p>
                )}
                  </>
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Select a client to load active domains and goals.
                  </p>
                )}
              </div>
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
                            {groupedGoals.map((goal) => {
                              const isPrimaryGoal = goalId === goal.id;
                              return (
                                <div
                                  key={`m-${goal.id}`}
                                  className="flex min-w-0 items-center gap-2 text-sm text-gray-600 dark:text-gray-300"
                                >
                                  <label className="flex min-w-0 flex-1 items-center gap-2">
                                    <input
                                      type="checkbox"
                                      data-goal-id={goal.id}
                                      checked={Array.isArray(goalIds) && goalIds.includes(goal.id)}
                                      onChange={() => toggleGoalSelection(goal.id)}
                                      disabled={isDataCollectionOnly}
                                      className="h-5 w-5 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                    />
                                    <span className="min-w-0 flex-1 truncate">{goal.title}</span>
                                  </label>
                                  <button
                                    type="button"
                                    aria-pressed={isPrimaryGoal}
                                    aria-label={
                                      isPrimaryGoal
                                        ? `${goal.title} is primary goal`
                                        : `Set ${goal.title} as primary goal`
                                    }
                                    onClick={() => setPrimaryGoal(goal.id)}
                                    disabled={isDataCollectionOnly}
                                    className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                                      isPrimaryGoal
                                        ? 'bg-blue-600 text-white'
                                        : 'border border-blue-200 bg-white text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:bg-dark dark:text-blue-200'
                                    }`}
                                  >
                                    {isPrimaryGoal ? 'Primary goal' : 'Set as primary'}
                                  </button>
                                  <span className="shrink-0 text-[11px] text-gray-500 dark:text-gray-400">
                                    {Array.isArray(goal.objective_data_points) ? goal.objective_data_points.length : 0} pts
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                    {selectedPrograms.length === 0 && (
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Select at least one domain to choose goals.
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
                            {groupedGoals.map((goal) => {
                              const isPrimaryGoal = goalId === goal.id;
                              return (
                                <div key={goal.id} className="flex min-w-0 items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                                  <label className="flex min-w-0 flex-1 items-center gap-2">
                                    <input
                                      type="checkbox"
                                      data-goal-id={goal.id}
                                      checked={Array.isArray(goalIds) && goalIds.includes(goal.id)}
                                      onChange={() => toggleGoalSelection(goal.id)}
                                      disabled={isDataCollectionOnly}
                                      className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                    />
                                    <span className="truncate">{goal.title}</span>
                                  </label>
                                  <button
                                    type="button"
                                    aria-pressed={isPrimaryGoal}
                                    aria-label={
                                      isPrimaryGoal
                                        ? `${goal.title} is primary goal`
                                        : `Set ${goal.title} as primary goal`
                                    }
                                    onClick={() => setPrimaryGoal(goal.id)}
                                    disabled={isDataCollectionOnly}
                                    className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                                      isPrimaryGoal
                                        ? 'bg-blue-600 text-white'
                                        : 'border border-blue-200 bg-white text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:bg-dark dark:text-blue-200'
                                    }`}
                                  >
                                    {isPrimaryGoal ? 'Primary goal' : 'Set as primary'}
                                  </button>
                                  <span className="text-[11px] text-gray-500 dark:text-gray-400">
                                    ({Array.isArray(goal.objective_data_points) ? goal.objective_data_points.length : 0} data points)
                                  </span>
                                </div>
                              );
                            })}
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
                        Select at least one domain to choose goals.
                      </p>
                    )}
                  </div>
                </div>
              </>
            )}
            {availableProgramGroups.length > 0 && selectedProgramGoals.length === 0 && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-200">
                Select one or more domains above to load goals instantly on mobile and desktop.
              </div>
            )}
              </>
            ) : (
              <>
                <input type="hidden" {...register('program_id')} />
                <input type="hidden" {...register('goal_id')} />
              </>
            )}
            </div>
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
                    disabled={isDataCollectionOnly}
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
                    disabled={isDataCollectionOnly}
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
              <input type="hidden" {...register('status')} value={sessionStatus ?? ''} readOnly />
              <input
                type="hidden"
                {...register('cancellation_attribution')}
                value={cancellationAttribution ?? ''}
                readOnly
              />
              <select
                id="status-select"
                value={statusSelectValue}
                onChange={(event) => handleStatusChange(event.target.value)}
                disabled={isDataCollectionOnly}
                className="min-h-11 w-full rounded-md border-gray-300 bg-white shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-dark dark:text-gray-200"
              >
                <option value="scheduled" disabled={session?.status === 'cancelled'}>Scheduled</option>
                <option value="in_progress" disabled>In Progress</option>
                <option value="completed" disabled={!session}>Completed</option>
                {canCreateSchedules ? (
                  <>
                    {resolvedCancellationAttribution === 'unknown' ? (
                      <option value="cancelled:unknown" disabled>Cancelled — attribution unavailable</option>
                    ) : null}
                    <option value="cancelled:staff">Staff cancellation</option>
                    <option value="cancelled:client">Client cancellation</option>
                  </>
                ) : sessionStatus === 'cancelled' ? (
                  <option value="cancelled" disabled>Cancelled</option>
                ) : null}
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
                disabled={isDataCollectionOnly}
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

            {session?.id && !shouldHideGoalCaptureFields && (
              <>
                {!isPrimaryClinicalCaptureMode ? (
                  <button
                    type="button"
                    aria-expanded={isClinicalSectionExpanded}
                    aria-controls="session-modal-clinical-details"
                    onClick={() => setIsClinicalSectionExpanded((current) => !current)}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50/70 px-4 py-3 text-left dark:border-indigo-900/40 dark:bg-indigo-900/10"
                  >
                    <span className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">
                      Clinical capture and secondary details
                    </span>
                    <span className="text-xs text-indigo-700 dark:text-indigo-300">
                      {isClinicalSectionExpanded ? 'Expanded' : 'Collapsed'}
                    </span>
                  </button>
                ) : null}
              <section
                id="session-modal-clinical-details"
                ref={sessionCaptureSectionRef}
                hidden={!isClinicalSectionExpanded}
                className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-4 space-y-4 dark:border-indigo-900/40 dark:bg-indigo-900/10"
                data-testid="session-modal-capture-section"
              >
                {(progressionConflict || progressionNotices.length > 0) && (
                  <div role={progressionConflict ? 'alert' : 'status'} className={`rounded-lg border p-3 text-sm ${progressionConflict ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-emerald-300 bg-emerald-50 text-emerald-900'}`}>
                    <p>{progressionConflict ?? progressionNotices.join(' · ')}</p>
                    {progressionConflict && staleProgressionTargetIds.length > 0 && (
                      <button
                        type="button"
                        className="mt-2 rounded-md border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold"
                        onClick={() => {
                          const staleIds = [...staleProgressionTargetIds];
                          setPendingTrialEvents((events) => events.filter((event) => !staleIds.includes(event.target_id)));
                          void handleFormSubmit(getValues(), { discardTrialTargetIds: staleIds });
                        }}
                      >
                        Discard stale trials and retry
                      </button>
                    )}
                  </div>
                )}
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
                        {captureBillingRelaxed
                          ? 'Billing defaults prefer an approved authorization when one exists; otherwise the most recent authorization for this client may be used so capture can save. See docs/session-capture-billing-gate.md to re-enable strict checks.'
                          : 'Billing uses the first approved authorization on file when defaults exist. Full narrative, signatures, and additional measurement fields are completed in Client Details.'}
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
                    Select a domain and goals under People &amp; Plan, or tap Add skill / Add behavior to record ad-hoc
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
                          const reconciledMeasurementEntry = reconcileGoalMeasurementTargets(
                            existingMeasurementEntry,
                            selectedGoal,
                            selectedGoalId,
                          );
                          const minTrials = getTherapistMinTrialsTarget(selectedGoal);
                          const fieldKey = `session_note_goal_notes.${selectedGoalId}` as const;
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
                          const targetsFieldBaseKey =
                            `session_note_goal_measurements.${selectedGoalId}.data.targets` as const;
                          const targetFieldKey =
                            `session_note_goal_measurements.${selectedGoalId}.data.target` as const;
                          const targetTrialsFieldBaseKey =
                            `session_note_goal_measurements.${selectedGoalId}.data.target_trials` as const;
                          const watchedTargets = watch(targetsFieldBaseKey) as unknown;
                          const watchedTargetTrials = watch(targetTrialsFieldBaseKey) as unknown;
                          const isAdhocTarget = isAdhocSessionTargetId(selectedGoalId);
                          const planTargetText = isAdhocTarget ? '' : selectedGoal?.target_criteria?.trim() ?? '';
                          const planGoalHasNoConfiguredTarget = !isAdhocTarget && Boolean(selectedGoal) && !planTargetText;
                          const sessionTargets = (() => {
                            if (Array.isArray(watchedTargets)) {
                              const normalizedWatchedTargets = watchedTargets
                                .map((target) => (typeof target === 'string' ? target : ''));
                              if (normalizedWatchedTargets.length > 0) {
                                return normalizedWatchedTargets;
                              }
                            }
                            const normalizedExistingTargets = getGoalMeasurementTargets(reconciledMeasurementEntry?.data);
                            return normalizedExistingTargets.length > 0 ? normalizedExistingTargets : [''];
                          })();
                          const rawTargetTrialRows = Array.isArray(watchedTargetTrials)
                            ? watchedTargetTrials
                            : reconciledMeasurementEntry?.data.target_trials ?? [];
                          const getTargetTrialNullableValue = (
                            targetIndex: number,
                            field: 'metric_value' | 'incorrect_trials' | 'opportunities',
                          ): number | null => {
                            const trialRow = rawTargetTrialRows[targetIndex];
                            if (!trialRow || typeof trialRow !== 'object') {
                              return null;
                            }
                            const raw = (trialRow as Record<string, unknown>)[field];
                            if (typeof raw === 'number' && Number.isFinite(raw)) {
                              return raw;
                            }
                            if (typeof raw === 'string' && raw.trim().length > 0) {
                              const parsed = Number(raw);
                              return Number.isFinite(parsed) ? parsed : null;
                            }
                            return null;
                          };
                          const getTargetTrialValue = (
                            targetIndex: number,
                            field: 'metric_value' | 'incorrect_trials' | 'opportunities',
                          ) => {
                            return getTargetTrialNullableValue(targetIndex, field) ?? 0;
                          };
                          const getTargetTrialNote = (targetIndex: number) => {
                            const trialRow = rawTargetTrialRows[targetIndex];
                            if (!trialRow || typeof trialRow !== 'object') {
                              return '';
                            }
                            const raw = (trialRow as Record<string, unknown>).trial_prompt_note;
                            return typeof raw === 'string' ? raw : '';
                          };
                          const mobileGoalSummaryLabel = isAdhocSessionTargetId(selectedGoalId)
                            ? (storedTitle.trim() ? storedTitle : 'Ad-hoc target')
                            : (selectedGoal?.title ?? selectedGoalId);
                          const selectedPlanTargets = sessionTargets.flatMap((target, sourceIndex) => {
                            const trimmed = target.trim();
                            return trimmed.length > 0 && trimmed === planTargetText
                              ? [{ targetValue: trimmed, sourceIndex }]
                              : [];
                          });
                          const hasSelectedPlanTarget = Boolean(
                            planTargetText && selectedPlanTargets.length > 0,
                          );
                          const unconfiguredTargetItems = sessionTargets.length > 0
                            ? sessionTargets.map((targetValue, sourceIndex) => ({ targetValue, sourceIndex }))
                            : [{ targetValue: '', sourceIndex: 0 }];
                          const persistedTargetItems = sessionTargets.flatMap((targetValue, sourceIndex) => {
                            const hasPersistedEvidence =
                              targetValue.trim().length > 0 ||
                              getTargetTrialNullableValue(sourceIndex, 'metric_value') !== null ||
                              getTargetTrialNullableValue(sourceIndex, 'incorrect_trials') !== null ||
                              getTargetTrialNullableValue(sourceIndex, 'opportunities') !== null ||
                              getTargetTrialNote(sourceIndex).trim().length > 0;
                            return hasPersistedEvidence ? [{ targetValue, sourceIndex }] : [];
                          });
                          const visibleSessionTargetItems =
                            isAdhocTarget || planGoalHasNoConfiguredTarget || !planTargetText
                              ? unconfiguredTargetItems
                              : persistedTargetItems;
                          const getDisplayedTargetTrialValue = (
                            item: { targetValue: string; sourceIndex: number },
                            field: 'metric_value' | 'incorrect_trials',
                          ) => {
                            const configuredTarget = resolveConfiguredGoalTarget(selectedGoalId, item.targetValue);
                            return configuredTarget
                              ? getRawTrialCount(configuredTarget.id, configuredTarget.measurement_type, field)
                              : getTargetTrialValue(item.sourceIndex, field);
                          };
                          const correctDisplay = visibleSessionTargetItems.reduce(
                            (sum, item) => sum + getDisplayedTargetTrialValue(item, 'metric_value'),
                            0,
                          );
                          const incorrectDisplay = visibleSessionTargetItems.reduce(
                            (sum, item) => sum + getDisplayedTargetTrialValue(item, 'incorrect_trials'),
                            0,
                          );
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
                                {isAdhocTarget ? (
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
                                {isAdhocTarget ? (
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
                                {isAdhocTarget && (
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
                              {isAdhocTarget ? (
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
                              <div className="mt-3">
                                <div className="flex items-center justify-between gap-2">
                                  <label
                                    htmlFor={`goal-target-${selectedGoalId}-0`}
                                    className="block text-xs font-medium text-gray-600 dark:text-gray-300"
                                  >
                                    Targets
                                  </label>
                                  {isAdhocTarget ? (
                                    <button
                                      type="button"
                                      onClick={() => addGoalTarget(selectedGoalId, sessionTargets)}
                                      className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-white px-2 py-1 text-[11px] font-semibold text-indigo-700 shadow-sm hover:bg-indigo-50 dark:border-indigo-800 dark:bg-dark dark:text-indigo-200 dark:hover:bg-indigo-950/40"
                                    >
                                      <Plus className="h-3.5 w-3.5" />
                                      Add target
                                    </button>
                                  ) : null}
                                </div>
                                {minTrials != null && (
                                  <p className="mt-1 text-[11px] font-medium text-indigo-800 dark:text-indigo-100">
                                    Min trials per target (therapist target): {minTrials}
                                  </p>
                                )}
                                {!isAdhocTarget ? (
                                  <div className="mt-2">
                                    {planTargetText && !hasSelectedPlanTarget ? (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const blankTargetIndex = sessionTargets.findIndex(
                                            (target) => target.trim().length === 0,
                                          );
                                          if (blankTargetIndex >= 0) {
                                            const nextTargets = sessionTargets.slice();
                                            nextTargets[blankTargetIndex] = planTargetText;
                                            updateGoalTargets(selectedGoalId, nextTargets);
                                            return;
                                          }
                                          updateGoalTargets(selectedGoalId, [...sessionTargets, planTargetText]);
                                        }}
                                        className="w-full rounded-md border border-indigo-200 bg-white px-3 py-2 text-left text-sm font-medium text-indigo-900 shadow-sm hover:bg-indigo-50 dark:border-indigo-800 dark:bg-dark dark:text-indigo-100 dark:hover:bg-indigo-950/40"
                                      >
                                        <span className="block text-[11px] font-semibold uppercase tracking-wide">
                                          Use plan target
                                        </span>
                                        <span className="mt-1 block break-words">{planTargetText}</span>
                                      </button>
                                    ) : !planTargetText ? (
                                      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-100">
                                        No plan target is set for this goal. Ask an admin to add the target under
                                        Domains &amp; Goals.
                                      </p>
                                    ) : null}
                                  </div>
                                ) : null}
                                <div className="mt-1 space-y-2">
                                  {visibleSessionTargetItems.map(({ targetValue, sourceIndex }, targetIndex) => {
                                    const indexedTargetFieldKey =
                                      `${targetsFieldBaseKey}.${sourceIndex}` as const;
                                    const targetTrialMetricValueFieldKey =
                                      `${targetTrialsFieldBaseKey}.${sourceIndex}.metric_value` as const;
                                    const targetTrialIncorrectTrialsFieldKey =
                                      `${targetTrialsFieldBaseKey}.${sourceIndex}.incorrect_trials` as const;
                                    const targetTrialOpportunitiesFieldKey =
                                      `${targetTrialsFieldBaseKey}.${sourceIndex}.opportunities` as const;
                                    const targetTrialPromptNoteFieldKey =
                                      `${targetTrialsFieldBaseKey}.${sourceIndex}.trial_prompt_note` as const;
                                    const targetTrialTargetFieldKey =
                                      `${targetTrialsFieldBaseKey}.${sourceIndex}.target` as const;
                                    const configuredTarget = resolveConfiguredGoalTarget(selectedGoalId, targetValue);
                                    const valueCaptureMeta = configuredTarget
                                      ? getValueMeasurementMeta(configuredTarget.measurement_type)
                                      : null;
                                    const responseCaptureOptions = configuredTarget
                                      ? responseOptionsByMeasurementType[configuredTarget.measurement_type] ?? []
                                      : [];
                                    const numericInputValue = configuredTarget
                                      ? pendingNumericTrialValues[configuredTarget.id] ?? ''
                                      : '';
                                    const numericSummary = configuredTarget && valueCaptureMeta
                                      ? getRawTrialNumericSummary(configuredTarget.id)
                                      : { count: 0, total: 0 };
                                    const pendingNumericSummary = configuredTarget && valueCaptureMeta
                                      ? getRawTrialNumericSummary(configuredTarget.id, 'pending')
                                      : { count: 0, total: 0 };
                                    const targetCorrectDisplay = configuredTarget
                                      ? (valueCaptureMeta
                                          ? numericSummary.total
                                          : getRawTrialCount(configuredTarget.id, configuredTarget.measurement_type, 'metric_value'))
                                      : getTargetTrialValue(sourceIndex, 'metric_value');
                                    const targetIncorrectDisplay = configuredTarget
                                      ? (valueCaptureMeta
                                          ? 0
                                          : getRawTrialCount(configuredTarget.id, configuredTarget.measurement_type, 'incorrect_trials'))
                                      : getTargetTrialValue(sourceIndex, 'incorrect_trials');
                                    const pendingCorrectDisplay = configuredTarget
                                      ? (valueCaptureMeta
                                          ? pendingNumericSummary.total
                                          : getRawTrialCount(configuredTarget.id, configuredTarget.measurement_type, 'metric_value', 'pending'))
                                      : targetCorrectDisplay;
                                    const pendingIncorrectDisplay = configuredTarget
                                      ? (valueCaptureMeta
                                          ? 0
                                          : getRawTrialCount(configuredTarget.id, configuredTarget.measurement_type, 'incorrect_trials', 'pending'))
                                      : targetIncorrectDisplay;
                                    const promptCorrectnessKey = configuredTarget?.id ??
                                      `legacy:${selectedGoalId}:${sourceIndex}`;
                                    const promptOutcome = promptOutcomeByTargetId[promptCorrectnessKey] ?? 'correct';
                                    const targetOpportunitiesDisplay = getTargetTrialNullableValue(sourceIndex, 'opportunities');
                                    const targetTrialBoundsError = getCorrectTrialsOpportunityError(
                                      targetCorrectDisplay,
                                      targetOpportunitiesDisplay,
                                      !valueCaptureMeta &&
                                        isCountTrialMeasurementMetadata(
                                          configuredTarget?.measurement_type ?? selectedGoal?.measurement_type,
                                          existingMeasurementEntry?.data.metric_label ?? measurementFieldMeta.primaryLabel,
                                          existingMeasurementEntry?.data.metric_unit ?? measurementFieldMeta.primaryUnit,
                                        ),
                                    );
                                    const shouldRenderTargetTrialFields =
                                      isAdhocTarget ||
                                      planGoalHasNoConfiguredTarget ||
                                      targetValue.trim().length > 0 ||
                                      targetCorrectDisplay > 0 ||
                                      targetIncorrectDisplay > 0 ||
                                      (targetOpportunitiesDisplay ?? 0) > 0 ||
                                      getTargetTrialNote(sourceIndex).trim().length > 0;
                                    const indexedTargetRegistration = register(indexedTargetFieldKey, {
                                      onChange: (event) => {
                                        const nextTargets = sessionTargets.slice();
                                        nextTargets[sourceIndex] = String(event.target.value ?? '');
                                        updateGoalTargets(selectedGoalId, nextTargets);
                                      },
                                    });
                                    return (
                                      <div
                                        key={`${selectedGoalId}-target-${targetIndex}`}
                                        className="rounded-md border border-indigo-100 bg-indigo-50/50 p-2 dark:border-indigo-900/40 dark:bg-indigo-900/10"
                                      >
                                        {isAdhocTarget ? (
                                          <div className="flex items-start gap-2">
                                            <textarea
                                              id={`goal-target-${selectedGoalId}-${targetIndex}`}
                                              aria-label={targetIndex === 0 ? 'Target' : `Target ${targetIndex + 1}`}
                                              {...indexedTargetRegistration}
                                              rows={2}
                                              value={targetValue}
                                              className="w-full rounded-md border-gray-300 bg-white shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-dark dark:text-gray-200"
                                              placeholder="Record the target for this session..."
                                            />
                                            {sessionTargets.length > 1 ? (
                                              <button
                                                type="button"
                                                onClick={() => removeGoalTarget(selectedGoalId, targetIndex, sessionTargets)}
                                                aria-label={`Remove target ${targetIndex + 1}`}
                                                className="mt-1 shrink-0 rounded-full p-2 text-gray-500 hover:bg-gray-100 hover:text-rose-600 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-rose-300"
                                              >
                                                <Trash2 className="h-4 w-4" />
                                              </button>
                                            ) : null}
                                          </div>
                                        ) : (
                                          <div>
                                            <p
                                              id={`goal-target-${selectedGoalId}-${targetIndex}`}
                                              className="break-words rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm font-medium text-indigo-950 shadow-sm dark:border-indigo-800 dark:bg-dark dark:text-indigo-100"
                                            >
                                              {targetValue || 'No target selected'}
                                            </p>
                                            <input
                                              type="hidden"
                                              {...indexedTargetRegistration}
                                              value={targetValue}
                                              readOnly
                                            />
                                          </div>
                                        )}
                                        {shouldRenderTargetTrialFields ? (
                                          <div className="contents">
                                            <input
                                              type="hidden"
                                              {...register(targetTrialTargetFieldKey)}
                                              value={targetValue}
                                              readOnly
                                            />
                                            <div className="mt-3">
                                          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-200">
                                            Trials for target {targetIndex + 1}
                                          </p>
                                          {valueCaptureMeta && configuredTarget ? (
                                            <div className="mt-3">
                                              <label
                                                htmlFor={`numeric-trial-${selectedGoalId}-${targetIndex}`}
                                                className="block text-xs font-medium text-gray-700 dark:text-gray-300"
                                              >
                                                {valueCaptureMeta.label} value for target {targetIndex + 1} ({valueCaptureMeta.unit})
                                              </label>
                                              <div className="mt-1 flex flex-wrap items-center gap-2">
                                                <input
                                                  id={`numeric-trial-${selectedGoalId}-${targetIndex}`}
                                                  type="number"
                                                  min={0}
                                                  step={valueCaptureMeta.step}
                                                  value={numericInputValue}
                                                  onChange={(event) =>
                                                    setPendingNumericTrialValues((current) => ({
                                                      ...current,
                                                      [configuredTarget.id]: event.target.value,
                                                    }))
                                                  }
                                                  className="min-h-10 w-32 rounded-md border-gray-300 bg-white px-3 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-dark dark:text-gray-200"
                                                />
                                                <button
                                                  type="button"
                                                  aria-label={`Add ${valueCaptureMeta.label.toLowerCase()} trial for target ${targetIndex + 1}`}
                                                  className="rounded-md bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700"
                                                  onClick={() => recordNumericTrial(selectedGoalId, sourceIndex, configuredTarget, numericInputValue)}
                                                >
                                                  Add trial
                                                </button>
                                                <span className="text-xs tabular-nums text-gray-600 dark:text-gray-300">
                                                  {numericSummary.count} trials · total {numericSummary.total}
                                                </span>
                                              </div>
                                            </div>
                                          ) : (
                                            <>
                                              <p className="mt-1 text-[11px] text-indigo-700/90 dark:text-indigo-200/80">
                                                + correct or achieved · − incorrect or no response.
                                              </p>
                                              {configuredTarget && responseCaptureOptions.length > 0 ? (
                                                <div>
                                                  <div className="mt-3 flex flex-wrap items-center gap-2">
                                                    {responseCaptureOptions.map((option) => (
                                                      <button
                                                        key={option.response}
                                                        type="button"
                                                        aria-label={
                                                          option.response === 'correct'
                                                            ? `Increase correct trials for target ${targetIndex + 1}`
                                                            : option.response === 'incorrect'
                                                              ? `Increase incorrect or no-response trials for target ${targetIndex + 1}`
                                                              : `Record ${option.label.toLowerCase()} response for target ${targetIndex + 1}`
                                                        }
                                                        className={[
                                                          'rounded-md px-3 py-2 text-xs font-semibold shadow-sm',
                                                          isPositiveResponse(option.response)
                                                            ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                                                            : 'bg-rose-600 text-white hover:bg-rose-700',
                                                        ].join(' ')}
                                                        onClick={() => recordResponseTrial(selectedGoalId, sourceIndex, configuredTarget, option.response)}
                                                      >
                                                        {option.label}
                                                      </button>
                                                    ))}
                                                    <span className="text-xs tabular-nums text-gray-600 dark:text-gray-300">
                                                      +{targetCorrectDisplay} · −{targetIncorrectDisplay}
                                                    </span>
                                                  </div>
                                                  <div className="mt-3 rounded-md border border-indigo-200 bg-white/80 p-2 dark:border-indigo-800 dark:bg-dark/70">
                                                    {shouldShowPromptCorrectnessToggle ? (
                                                      <fieldset>
                                                        <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-200">
                                                          Prompt outcome
                                                        </legend>
                                                        <div
                                                          className="flex flex-wrap gap-2"
                                                          role="radiogroup"
                                                          aria-label={`Prompt outcome for target ${targetIndex + 1}: ${configuredTarget.name}`}
                                                        >
                                                          {promptOutcomeOptions.map((option) => (
                                                            <label
                                                              key={option.value}
                                                              className={[
                                                                'flex min-h-10 min-w-[7rem] cursor-pointer items-center justify-center rounded-md border px-3 py-2 text-xs font-semibold transition',
                                                                getPromptOutcomeSegmentClasses(promptOutcome === option.value, option.value),
                                                              ].join(' ')}
                                                            >
                                                              <input
                                                                type="radio"
                                                                name={`prompt-outcome-${promptCorrectnessKey}`}
                                                                value={option.value}
                                                                checked={promptOutcome === option.value}
                                                                onChange={() => setPromptOutcomeByTargetId((current) =>
                                                                  setPromptOutcomeForTarget(current, promptCorrectnessKey, option.value))}
                                                                aria-label={`${option.label} for target ${targetIndex + 1}: ${configuredTarget.name}`}
                                                                className="sr-only"
                                                              />
                                                              {option.label}
                                                            </label>
                                                          ))}
                                                        </div>
                                                      </fieldset>
                                                    ) : null}
                                                    <div
                                                      className={`${shouldShowPromptCorrectnessToggle ? 'mt-2' : ''} flex flex-wrap gap-2`}
                                                      role="group"
                                                      aria-label={`Prompt types for target ${targetIndex + 1}: ${configuredTarget.name}`}
                                                    >
                                                      {promptCaptureOptions.map((prompt) => (
                                                        <button
                                                          key={prompt.label}
                                                          type="button"
                                                          aria-label={`Record ${prompt.label.toLowerCase()} prompt for target ${targetIndex + 1}: ${configuredTarget.name}`}
                                                          className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-900 shadow-sm hover:bg-indigo-100 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-100 dark:hover:bg-indigo-900/60"
                                                          onClick={() => recordPromptTrial(
                                                            selectedGoalId,
                                                            sourceIndex,
                                                            configuredTarget,
                                                            { promptType: prompt.promptType, promptLevel: prompt.promptLevel },
                                                            promptOutcome,
                                                          )}
                                                        >
                                                          {prompt.label}
                                                        </button>
                                                      ))}
                                                    </div>
                                                  </div>
                                                </div>
                                              ) : (
                                                <div className="mt-3 flex flex-wrap items-center gap-3">
                                            <div className="flex flex-wrap items-center gap-2">
                                              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">+</span>
                                              <button
                                                type="button"
                                                aria-label={`Increase correct trials for target ${targetIndex + 1}`}
                                                className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 text-lg font-bold text-white shadow-sm hover:bg-emerald-700"
                                                onClick={() => bumpTrialCount(selectedGoalId, sourceIndex, 'metric_value', 1, configuredTarget, promptOutcome)}
                                              >
                                                +
                                              </button>
                                              <span className="min-w-[2rem] rounded-md border border-gray-200 bg-white px-2 py-1 text-center text-sm dark:border-gray-600 dark:bg-dark">
                                                {targetCorrectDisplay}
                                              </span>
                                              <button
                                                type="button"
                                                aria-label={`Decrease correct trials for target ${targetIndex + 1}`}
                                                disabled={pendingCorrectDisplay < 1}
                                                className="flex h-10 w-10 items-center justify-center rounded-full border border-emerald-700 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-400 dark:text-emerald-200"
                                                onClick={() => bumpTrialCount(selectedGoalId, sourceIndex, 'metric_value', -1, configuredTarget, promptOutcome)}
                                              >
                                                -
                                              </button>
                                              <button
                                                type="button"
                                                aria-label={`Add 5 correct trials for target ${targetIndex + 1}`}
                                                className="rounded-md border border-emerald-200 bg-white px-2 py-1 text-[11px] font-semibold text-emerald-800 shadow-sm hover:bg-emerald-50 dark:border-emerald-800 dark:bg-dark-lighter dark:text-emerald-100 dark:hover:bg-emerald-950/40"
                                                onClick={() => bumpTrialCount(selectedGoalId, sourceIndex, 'metric_value', 5, configuredTarget, promptOutcome)}
                                              >
                                                +5
                                              </button>
                                              <button
                                                type="button"
                                                aria-label={`Subtract 5 correct trials for target ${targetIndex + 1}`}
                                                disabled={pendingCorrectDisplay < 5}
                                                className="rounded-md border border-emerald-200 bg-white px-2 py-1 text-[11px] font-semibold text-emerald-800 shadow-sm hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-emerald-800 dark:bg-dark-lighter dark:text-emerald-100 dark:hover:bg-emerald-950/40"
                                                onClick={() => bumpTrialCount(selectedGoalId, sourceIndex, 'metric_value', -5, configuredTarget, promptOutcome)}
                                              >
                                                -5
                                              </button>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2">
                                              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">-</span>
                                              <button
                                                type="button"
                                                aria-label={`Increase incorrect or no-response trials for target ${targetIndex + 1}`}
                                                className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-600 text-lg font-bold text-white shadow-sm hover:bg-rose-700"
                                                onClick={() => bumpTrialCount(selectedGoalId, sourceIndex, 'incorrect_trials', 1, configuredTarget, promptOutcome)}
                                              >
                                                +
                                              </button>
                                              <span className="min-w-[2rem] rounded-md border border-gray-200 bg-white px-2 py-1 text-center text-sm dark:border-gray-600 dark:bg-dark">
                                                {targetIncorrectDisplay}
                                              </span>
                                              <button
                                                type="button"
                                                aria-label={`Decrease incorrect trials for target ${targetIndex + 1}`}
                                                disabled={pendingIncorrectDisplay < 1}
                                                className="flex h-10 w-10 items-center justify-center rounded-full border border-rose-700 text-rose-700 hover:bg-rose-50 dark:border-rose-400 dark:text-rose-200"
                                                onClick={() => bumpTrialCount(selectedGoalId, sourceIndex, 'incorrect_trials', -1, configuredTarget, promptOutcome)}
                                              >
                                                -
                                              </button>
                                              <button
                                                type="button"
                                                aria-label={`Add 5 incorrect or no-response trials for target ${targetIndex + 1}`}
                                                className="rounded-md border border-rose-200 bg-white px-2 py-1 text-[11px] font-semibold text-rose-800 shadow-sm hover:bg-rose-50 dark:border-rose-800 dark:bg-dark-lighter dark:text-rose-100 dark:hover:bg-rose-950/40"
                                                onClick={() => bumpTrialCount(selectedGoalId, sourceIndex, 'incorrect_trials', 5, configuredTarget, promptOutcome)}
                                              >
                                                +5
                                              </button>
                                              <button
                                                type="button"
                                                aria-label={`Subtract 5 incorrect trials for target ${targetIndex + 1}`}
                                                disabled={pendingIncorrectDisplay < 5}
                                                className="rounded-md border border-rose-200 bg-white px-2 py-1 text-[11px] font-semibold text-rose-800 shadow-sm hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-rose-800 dark:bg-dark-lighter dark:text-rose-100 dark:hover:bg-rose-950/40"
                                                onClick={() => bumpTrialCount(selectedGoalId, sourceIndex, 'incorrect_trials', -5, configuredTarget, promptOutcome)}
                                              >
                                                -5
                                              </button>
                                            </div>
                                            {!configuredTarget ? (
                                            <div className="w-full rounded-md border border-indigo-200 bg-white/80 p-2 dark:border-indigo-800 dark:bg-dark/70">
                                              {shouldShowPromptCorrectnessToggle ? (
                                                <fieldset>
                                                  <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-200">
                                                    Prompt outcome
                                                  </legend>
                                                  <div
                                                    className="flex flex-wrap gap-2"
                                                    role="radiogroup"
                                                    aria-label={`Prompt outcome for target ${targetIndex + 1}: ${targetValue}`}
                                                  >
                                                    {promptOutcomeOptions.map((option) => (
                                                      <label
                                                        key={option.value}
                                                        className={[
                                                          'flex min-h-10 min-w-[7rem] cursor-pointer items-center justify-center rounded-md border px-3 py-2 text-xs font-semibold transition',
                                                          getPromptOutcomeSegmentClasses(promptOutcome === option.value, option.value),
                                                        ].join(' ')}
                                                      >
                                                        <input
                                                          type="radio"
                                                          name={`prompt-outcome-${promptCorrectnessKey}`}
                                                          value={option.value}
                                                          checked={promptOutcome === option.value}
                                                          onChange={() => setPromptOutcomeByTargetId((current) =>
                                                            setPromptOutcomeForTarget(current, promptCorrectnessKey, option.value))}
                                                          aria-label={`${option.label} for target ${targetIndex + 1}: ${targetValue}`}
                                                          className="sr-only"
                                                        />
                                                        {option.label}
                                                      </label>
                                                    ))}
                                                  </div>
                                                </fieldset>
                                              ) : null}
                                              <div
                                                className={`${shouldShowPromptCorrectnessToggle ? 'mt-2' : ''} flex flex-wrap gap-2`}
                                                role="group"
                                                aria-label={`Prompt types for target ${targetIndex + 1}: ${targetValue}`}
                                              >
                                                {promptCaptureOptions.map((prompt) => (
                                                  <button
                                                    key={prompt.label}
                                                    type="button"
                                                    aria-label={`Record ${prompt.label.toLowerCase()} prompt for target ${targetIndex + 1}: ${targetValue}`}
                                                    className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-900 shadow-sm hover:bg-indigo-100 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-100 dark:hover:bg-indigo-900/60"
                                                    onClick={() => recordPromptTrial(
                                                      selectedGoalId,
                                                      sourceIndex,
                                                      configuredTarget,
                                                      { promptType: prompt.promptType, promptLevel: prompt.promptLevel },
                                                      promptOutcome,
                                                    )}
                                                  >
                                                    {prompt.label}
                                                  </button>
                                                ))}
                                              </div>
                                            </div>
                                            ) : null}
                                          </div>
                                              )}
                                            </>
                                          )}
                                          <input
                                            type="number"
                                            className="sr-only"
                                            tabIndex={-1}
                                            aria-hidden
                                            {...register(targetTrialMetricValueFieldKey, { setValueAs: toFormNumber })}
                                            defaultValue={targetCorrectDisplay || ''}
                                          />
                                          <input
                                            type="number"
                                            className="sr-only"
                                            tabIndex={-1}
                                            aria-hidden
                                            {...register(targetTrialIncorrectTrialsFieldKey, { setValueAs: toFormNumber })}
                                            defaultValue={targetIncorrectDisplay || ''}
                                          />
                                          <input
                                            type="hidden"
                                            {...register(targetTrialOpportunitiesFieldKey, { setValueAs: toFormNumber })}
                                            defaultValue={targetOpportunitiesDisplay ?? ''}
                                          />
                                          {targetTrialBoundsError ? (
                                            <p className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">
                                              {targetTrialBoundsError}
                                            </p>
                                          ) : null}
                                          <label
                                            htmlFor={`trial-prompt-note-${selectedGoalId}-${targetIndex}`}
                                            className="mt-3 block text-xs font-medium text-gray-600 dark:text-gray-300"
                                          >
                                            Prompts &amp; reactions for target {targetIndex + 1}
                                          </label>
                                          <textarea
                                            id={`trial-prompt-note-${selectedGoalId}-${targetIndex}`}
                                            {...register(targetTrialPromptNoteFieldKey)}
                                            rows={2}
                                            defaultValue={getTargetTrialNote(sourceIndex)}
                                            className="mt-1 w-full rounded-md border-gray-300 bg-white text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-dark dark:text-gray-200"
                                            placeholder="Record prompts used and client reactions for this target..."
                                          />
                                            </div>
                                          </div>
                                        ) : null}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                              <input
                                type="hidden"
                                {...register(targetFieldKey)}
                                defaultValue={existingMeasurementEntry?.data.target ?? ''}
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
                                value={existingMeasurementEntry?.data.prompt_level ?? ''}
                                readOnly
                              />
                              <input
                                type="hidden"
                                {...register(noteFieldKey)}
                                defaultValue={existingMeasurementEntry?.data.note ?? ''}
                              />
                            </details>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </section>
              </>
            )}
          </form>
          )}
        </div>

        {/* Footer */}
        {modalStep === 'capture' && !isCompletedBtAbaSession ? (
        <div className="sticky bottom-0 z-10 border-t border-gray-200/80 bg-white/90 px-4 py-2 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] backdrop-blur-md dark:border-gray-700 dark:bg-dark-lighter/90 sm:px-5 sm:py-3 sm:pb-3">
          <div className="flex flex-col gap-3">
            <div
              role="group"
              aria-label="Session actions"
              className="flex flex-wrap items-center justify-center gap-2 border-b border-gray-200/70 pb-2 dark:border-gray-700/80 sm:justify-end sm:border-0 sm:pb-0"
            >
              <button
                type="button"
                onClick={handleAttemptClose}
                disabled={isCloseInteractionDisabled}
                className="min-h-11 shrink-0 rounded-full px-4 text-sm font-medium text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800 sm:min-h-11 sm:w-auto sm:rounded-md sm:border sm:border-gray-300 sm:bg-white sm:px-4 sm:text-gray-700 sm:shadow-sm sm:hover:bg-gray-50"
              >
                Cancel
              </button>
              {session?.id && session.status === 'scheduled' && !hasStartedSession && canUseStartSessionAction ? (
                <button
                  type="button"
                  onClick={handleStartSession}
                  disabled={isClosing || !canStartSession || isDependentDataLoading || isStartPlanDataLoading}
                  className="min-h-11 shrink-0 rounded-full px-3 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:text-emerald-300 dark:hover:bg-emerald-950/40 sm:min-h-11 sm:w-auto sm:rounded-md sm:border sm:border-emerald-200 sm:bg-emerald-50/90 sm:px-4 sm:font-medium sm:text-emerald-800 sm:shadow-sm sm:hover:bg-emerald-100"
                >
                  Start Session
                </button>
              ) : null}
              {session?.id && isInProgressSession ? (
                <button
                  type="button"
                  onClick={handleCloseSession}
                  disabled={isClosing || isSubmitting || isDependentDataLoading || isLoadingAlternatives || isBtAbaNoteLoadError}
                  className="min-h-11 shrink-0 rounded-full px-3 text-sm font-semibold text-violet-700 hover:bg-violet-50 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:text-violet-300 dark:hover:bg-violet-950/40 sm:min-h-11 sm:w-auto sm:rounded-md sm:border sm:border-violet-200 sm:bg-violet-50/90 sm:px-4 sm:font-medium sm:text-violet-800 sm:shadow-sm sm:hover:bg-violet-100"
                >
                  Close Session
                </button>
              ) : null}
              {canReactivateSession ? (
                <button
                  type="button"
                  onClick={() => void handleReactivateSession()}
                  disabled={isReactivateDisabled}
                  className="min-h-11 shrink-0 rounded-full px-3 text-sm font-semibold text-amber-700 hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:text-amber-300 dark:hover:bg-amber-950/40 sm:min-h-11 sm:w-auto sm:rounded-md sm:border sm:border-amber-200 sm:bg-amber-50/90 sm:px-4 sm:font-medium sm:text-amber-800 sm:shadow-sm sm:hover:bg-amber-100"
                >
                  {isReactivating ? 'Reactivating...' : 'Reactivate appointment'}
                </button>
              ) : null}
              {canDeleteAppointment ? (
                <button
                  type="button"
                  onClick={() => void handleDeleteAppointment()}
                  disabled={isDeleteAppointmentDisabled}
                  className="min-h-11 shrink-0 rounded-full px-3 text-sm font-semibold text-rose-700 hover:bg-rose-50 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:text-rose-300 dark:hover:bg-rose-950/40 sm:min-h-11 sm:w-auto sm:rounded-md sm:border sm:border-rose-200 sm:bg-rose-50/90 sm:px-4 sm:font-medium sm:text-rose-800 sm:shadow-sm sm:hover:bg-rose-100"
                >
                  {isDeletingAppointment ? 'Deleting...' : 'Delete appointment'}
                </button>
              ) : null}
            </div>
            <div className="flex justify-center sm:justify-end">
              <button
                type="submit"
                form="session-form"
                disabled={isClosing || isSubmitting || isDependentDataLoading || isLoadingAlternatives}
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
                      ? (isBtClinicalCaptureSession ? 'Save clinical capture' : (isInProgressSession ? 'Save progress' : 'Update Session'))
                      : 'Create Session'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
        ) : null}
        {isDeleteConfirmationOpen && canDeleteAppointment ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-gray-950/45 px-4 backdrop-blur-[1px]">
            <div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="delete-appointment-title"
              aria-describedby="delete-appointment-description"
              className="w-full max-w-md rounded-2xl border border-rose-200 bg-white p-5 shadow-2xl dark:border-rose-900/60 dark:bg-dark-lighter"
            >
              <div className="flex items-start gap-3">
                <div className="rounded-full bg-rose-100 p-2 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                  <Trash2 className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 id="delete-appointment-title" className="text-lg font-semibold text-gray-900 dark:text-white">
                    Delete appointment
                  </h2>
                  <p id="delete-appointment-description" className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                    This deletes only the selected appointment.
                  </p>
                </div>
              </div>
              <dl className="mt-4 space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm dark:border-gray-700 dark:bg-dark">
                <div className="flex justify-between gap-4">
                  <dt className="font-medium text-gray-600 dark:text-gray-300">Client</dt>
                  <dd className="text-right text-gray-900 dark:text-white">{deleteAppointmentSummary.clientLabel}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="font-medium text-gray-600 dark:text-gray-300">Therapist</dt>
                  <dd className="text-right text-gray-900 dark:text-white">{deleteAppointmentSummary.therapistLabel}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="font-medium text-gray-600 dark:text-gray-300">Date</dt>
                  <dd className="text-right text-gray-900 dark:text-white">{deleteAppointmentSummary.appointmentDate}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="font-medium text-gray-600 dark:text-gray-300">Time</dt>
                  <dd className="text-right text-gray-900 dark:text-white">
                    {deleteAppointmentSummary.startLabel} - {deleteAppointmentSummary.endLabel}
                  </dd>
                </div>
              </dl>
              {deleteAppointmentError ? (
                <div
                  role="alert"
                  className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200"
                >
                  {deleteAppointmentError}
                </div>
              ) : null}
              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => {
                    if (isDeleteAppointmentBusy) {
                      return;
                    }
                    setDeleteAppointmentError(null);
                    setIsDeleteConfirmationOpen(false);
                  }}
                  disabled={isDeleteAppointmentBusy}
                  className="min-h-11 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
                >
                  Keep appointment
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmDeleteAppointment()}
                  disabled={isDeleteAppointmentBusy}
                  className="min-h-11 rounded-md border border-transparent bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isDeleteAppointmentBusy ? 'Deleting...' : 'Confirm delete appointment'}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
