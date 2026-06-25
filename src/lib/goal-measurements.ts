import type { Goal, SessionGoalMeasurementData, SessionGoalMeasurementEntry, SessionTargetTrialData } from '../types';

export const GOAL_MEASUREMENT_VERSION = 1 as const;

export interface GoalMeasurementFieldMeta {
  readonly primaryLabel: string;
  readonly primaryUnit: string | null;
  readonly secondaryLabel: string | null;
  readonly helperText: string;
  readonly min?: number;
  readonly max?: number;
  readonly step: number;
}

const normalizeMeasurementTypeToken = (value: string | null | undefined): string =>
  value?.trim().toLowerCase() ?? '';

const toOptionalNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toOptionalString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => toOptionalString(entry))
    .filter((entry): entry is string => Boolean(entry));
};

const normalizeEditableStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => (typeof entry === 'string' ? entry : ''));
};

const getPrimaryNonEmptyTarget = (targets: readonly string[]): string | null =>
  targets.map((target) => toOptionalString(target)).find((target): target is string => Boolean(target)) ?? null;

const hasTargetTrialData = (trial: SessionTargetTrialData | null | undefined): trial is SessionTargetTrialData =>
  Boolean(
    trial &&
      ((trial.metric_value !== null && trial.metric_value !== undefined) ||
        (trial.incorrect_trials !== null && trial.incorrect_trials !== undefined) ||
        (trial.opportunities !== null && trial.opportunities !== undefined) ||
        (trial.trial_prompt_note?.trim().length ?? 0) > 0 ||
        (trial.target?.trim().length ?? 0) > 0),
  );

const normalizeTargetTrials = (
  value: unknown,
  targets: readonly string[],
): SessionTargetTrialData[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry, index) => {
      const source = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
      const trial: SessionTargetTrialData = {
        target: toOptionalString(source.target) ?? toOptionalString(targets[index]) ?? null,
        metric_value: toOptionalNumber(source.metric_value ?? source.count ?? source.value),
        incorrect_trials: toOptionalNumber(source.incorrect_trials ?? source.incorrectTrials),
        opportunities: toOptionalNumber(source.opportunities ?? source.trials),
        trial_prompt_note: toOptionalString(source.trial_prompt_note ?? source.trialPromptNote),
      };
      return hasTargetTrialData(trial) ? trial : null;
    })
    .filter((entry): entry is SessionTargetTrialData => Boolean(entry));
};

const buildLegacyTargetTrial = (
  sourceData: Record<string, unknown>,
  targets: readonly string[],
): SessionTargetTrialData | null => {
  const trial: SessionTargetTrialData = {
    target: getPrimaryNonEmptyTarget(targets),
    metric_value: toOptionalNumber(sourceData.metric_value ?? sourceData.count ?? sourceData.value),
    incorrect_trials: toOptionalNumber(sourceData.incorrect_trials ?? sourceData.incorrectTrials),
    opportunities: toOptionalNumber(sourceData.opportunities ?? sourceData.trials),
    trial_prompt_note: toOptionalString(sourceData.trial_prompt_note ?? sourceData.trialPromptNote),
  };
  return hasTargetTrialData(trial) ? trial : null;
};

const sumTargetTrialNumber = (
  trials: readonly SessionTargetTrialData[],
  field: 'metric_value' | 'incorrect_trials' | 'opportunities',
): number | null => {
  let sum = 0;
  let hasValue = false;

  for (const trial of trials) {
    const value = trial[field];
    if (typeof value === 'number' && Number.isFinite(value)) {
      sum += value;
      hasValue = true;
    }
  }

  return hasValue ? sum : null;
};

const summarizeTargetTrialPromptNotes = (trials: readonly SessionTargetTrialData[]): string | null => {
  const notes = trials
    .map((trial) => trial.trial_prompt_note?.trim() ?? '')
    .filter((note) => note.length > 0);
  return notes.length > 0 ? notes.join('; ') : null;
};

export const getGoalMeasurementTargets = (
  data: SessionGoalMeasurementData | null | undefined,
): string[] => {
  if (!data) {
    return [];
  }

  const normalizedTargets = normalizeStringList(data.targets);
  if (normalizedTargets.length > 0) {
    return normalizedTargets;
  }

  const legacyTarget = toOptionalString(data.target);
  return legacyTarget ? [legacyTarget] : [];
};

export const getGoalMeasurementFieldMeta = (goal: Goal | undefined): GoalMeasurementFieldMeta => {
  const measurementType = normalizeMeasurementTypeToken(goal?.measurement_type);

  if (
    measurementType.includes('percent') ||
    measurementType.includes('%') ||
    measurementType.includes('accuracy') ||
    measurementType.includes('fidelity')
  ) {
    return {
      primaryLabel: 'Percent',
      primaryUnit: '%',
      secondaryLabel: 'Opportunities',
      helperText: 'Capture the observed percentage and, if known, the number of opportunities.',
      min: 0,
      max: 100,
      step: 1,
    };
  }

  if (
    measurementType.includes('duration') ||
    measurementType.includes('minute') ||
    measurementType.includes('time')
  ) {
    return {
      primaryLabel: 'Duration',
      primaryUnit: 'minutes',
      secondaryLabel: 'Occurrences',
      helperText: 'Capture how long the skill or behavior was observed during the session.',
      min: 0,
      step: 1,
    };
  }

  if (measurementType.includes('rate')) {
    return {
      primaryLabel: 'Rate',
      primaryUnit: 'per hour',
      secondaryLabel: 'Observation minutes',
      helperText: 'Capture the observed rate and how long the observation window lasted.',
      min: 0,
      step: 0.1,
    };
  }

  return {
    primaryLabel: 'Count',
    primaryUnit: 'responses',
    secondaryLabel: 'Opportunities',
    helperText: 'Capture the observed count for this goal during the session.',
    min: 0,
    step: 1,
  };
};

export const hasMeaningfulGoalMeasurementEntry = (
  entry: SessionGoalMeasurementEntry | null | undefined,
): boolean => {
  if (!entry) {
    return false;
  }

  const { data } = entry;
  return (
    (data.metric_value !== null && data.metric_value !== undefined) ||
    (data.incorrect_trials !== null && data.incorrect_trials !== undefined) ||
    (data.opportunities !== null && data.opportunities !== undefined) ||
    (data.prompt_level?.trim().length ?? 0) > 0 ||
    (data.note?.trim().length ?? 0) > 0 ||
    getGoalMeasurementTargets(data).length > 0 ||
    (data.target_trials ?? []).some(hasTargetTrialData) ||
    (data.trial_prompt_note?.trim().length ?? 0) > 0
  );
};

export const normalizeGoalMeasurementEntry = (
  rawValue: unknown,
  goal?: Goal,
  options?: {
    readonly fallbackMetricUnit?: string | null;
  },
): SessionGoalMeasurementEntry | null => {
  if (!rawValue || typeof rawValue !== 'object') {
    return null;
  }

  const candidate = rawValue as {
    data?: Record<string, unknown>;
  } & Record<string, unknown>;
  const sourceData =
    candidate.data && typeof candidate.data === 'object'
      ? candidate.data
      : candidate;
  const fieldMeta = getGoalMeasurementFieldMeta(goal);
  const fallbackMetricUnit =
    options && 'fallbackMetricUnit' in options
      ? options.fallbackMetricUnit
      : fieldMeta.primaryUnit;
  const normalizedTargets = normalizeStringList(sourceData.targets);
  const fallbackLegacyTarget = toOptionalString(sourceData.target);
  const resolvedTargets =
    normalizedTargets.length > 0
      ? normalizedTargets
      : (fallbackLegacyTarget ? [fallbackLegacyTarget] : []);
  const normalizedTargetTrials = normalizeTargetTrials(sourceData.target_trials, resolvedTargets);
  const legacyTargetTrial = normalizedTargetTrials.length === 0
    ? buildLegacyTargetTrial(sourceData, resolvedTargets)
    : null;
  const resolvedTargetTrials = normalizedTargetTrials.length > 0
    ? normalizedTargetTrials
    : (legacyTargetTrial ? [legacyTargetTrial] : []);
  const normalizedEntry: SessionGoalMeasurementEntry = {
    version: GOAL_MEASUREMENT_VERSION,
    data: {
      measurement_type: goal?.measurement_type ?? toOptionalString(sourceData.measurement_type),
      metric_label: toOptionalString(sourceData.metric_label) ?? fieldMeta.primaryLabel,
      metric_unit: toOptionalString(sourceData.metric_unit) ?? fallbackMetricUnit,
      metric_value: sumTargetTrialNumber(resolvedTargetTrials, 'metric_value') ?? toOptionalNumber(
        sourceData.metric_value ?? sourceData.count ?? sourceData.value,
      ),
      incorrect_trials: sumTargetTrialNumber(resolvedTargetTrials, 'incorrect_trials') ?? toOptionalNumber(
        sourceData.incorrect_trials ?? sourceData.incorrectTrials,
      ),
      opportunities: sumTargetTrialNumber(resolvedTargetTrials, 'opportunities') ?? toOptionalNumber(
        sourceData.opportunities ?? sourceData.trials,
      ),
      prompt_level: toOptionalString(sourceData.prompt_level) ?? toOptionalString(sourceData.promptLevel),
      note: toOptionalString(sourceData.note ?? sourceData.comment),
      targets: resolvedTargets.length > 0 ? resolvedTargets : null,
      target: resolvedTargets[0] ?? null,
      target_trials: resolvedTargetTrials.length > 0 ? resolvedTargetTrials : null,
      trial_prompt_note: summarizeTargetTrialPromptNotes(resolvedTargetTrials) ?? toOptionalString(
        sourceData.trial_prompt_note ?? sourceData.trialPromptNote,
      ),
    },
  };

  return hasMeaningfulGoalMeasurementEntry(normalizedEntry) ? normalizedEntry : null;
};

export const buildGoalMeasurementEntry = (
  goal: Goal | undefined,
  rawValue: unknown,
): SessionGoalMeasurementEntry | null => {
  const fieldMeta = getGoalMeasurementFieldMeta(goal);
  const normalizedExisting = normalizeGoalMeasurementEntry(rawValue, goal);
  const sourceData =
    rawValue && typeof rawValue === 'object' && 'data' in rawValue && rawValue.data && typeof rawValue.data === 'object'
      ? rawValue.data
      : rawValue;
  const editableTargets = normalizeEditableStringList(
    sourceData && typeof sourceData === 'object' && 'targets' in sourceData ? sourceData.targets : undefined,
  );
  const existingTargets = editableTargets.length > 0 ? editableTargets : getGoalMeasurementTargets(normalizedExisting?.data);
  const existingTargetTrials =
    sourceData && typeof sourceData === 'object' && 'target_trials' in sourceData
      ? normalizeTargetTrials(sourceData.target_trials, existingTargets)
      : normalizedExisting?.data.target_trials ?? [];
  const nextEntry: SessionGoalMeasurementEntry = {
    version: GOAL_MEASUREMENT_VERSION,
    data: {
      measurement_type: goal?.measurement_type ?? normalizedExisting?.data.measurement_type ?? null,
      metric_label: normalizedExisting?.data.metric_label ?? fieldMeta.primaryLabel,
      metric_unit: normalizedExisting?.data.metric_unit ?? fieldMeta.primaryUnit,
      metric_value: normalizedExisting?.data.metric_value ?? null,
      incorrect_trials: normalizedExisting?.data.incorrect_trials ?? null,
      opportunities: normalizedExisting?.data.opportunities ?? null,
      prompt_level: normalizedExisting?.data.prompt_level ?? null,
      note: normalizedExisting?.data.note ?? null,
      targets: existingTargets.length > 0 ? existingTargets : null,
      target: getPrimaryNonEmptyTarget(existingTargets),
      target_trials: existingTargetTrials.length > 0 ? existingTargetTrials : null,
      trial_prompt_note: summarizeTargetTrialPromptNotes(existingTargetTrials) ?? normalizedExisting?.data.trial_prompt_note ?? null,
    },
  };

  return hasMeaningfulGoalMeasurementEntry(nextEntry) ? nextEntry : null;
};

export const mergeGoalMeasurementEntry = (
  goal: Goal | undefined,
  rawValue: unknown,
  updates: Partial<SessionGoalMeasurementEntry['data']>,
): SessionGoalMeasurementEntry | null => {
  const fieldMeta = getGoalMeasurementFieldMeta(goal);
  const existing = buildGoalMeasurementEntry(goal, rawValue);
  const nextTargets = updates.targets !== undefined
    ? normalizeEditableStringList(updates.targets)
    : normalizeEditableStringList(existing?.data.targets) ;
  const normalizedLegacyTarget = updates.target !== undefined
    ? toOptionalString(updates.target)
    : null;
  const resolvedTargets = nextTargets.length > 0
    ? nextTargets
    : (normalizedLegacyTarget ? [normalizedLegacyTarget] : []);
  const existingTargetTrials = normalizeTargetTrials(existing?.data.target_trials, resolvedTargets);
  const hasFlatTrialUpdates =
    updates.metric_value !== undefined ||
    updates.incorrect_trials !== undefined ||
    updates.opportunities !== undefined ||
    updates.trial_prompt_note !== undefined;
  const nextTargetTrials = updates.target_trials !== undefined
    ? normalizeTargetTrials(updates.target_trials, resolvedTargets)
    : hasFlatTrialUpdates
      ? normalizeTargetTrials(
        [
          {
            ...(existingTargetTrials[0] ?? {}),
            target: getPrimaryNonEmptyTarget(resolvedTargets),
            metric_value: updates.metric_value !== undefined
              ? updates.metric_value ?? null
              : existingTargetTrials[0]?.metric_value ?? null,
            incorrect_trials: updates.incorrect_trials !== undefined
              ? updates.incorrect_trials ?? null
              : existingTargetTrials[0]?.incorrect_trials ?? null,
            opportunities: updates.opportunities !== undefined
              ? updates.opportunities ?? null
              : existingTargetTrials[0]?.opportunities ?? null,
            trial_prompt_note: updates.trial_prompt_note !== undefined
              ? updates.trial_prompt_note ?? null
              : existingTargetTrials[0]?.trial_prompt_note ?? null,
          },
          ...existingTargetTrials.slice(1),
        ],
        resolvedTargets,
      )
      : existingTargetTrials;
  const nextEntry: SessionGoalMeasurementEntry = {
    version: GOAL_MEASUREMENT_VERSION,
    data: {
      measurement_type: goal?.measurement_type ?? existing?.data.measurement_type ?? null,
      metric_label: existing?.data.metric_label ?? fieldMeta.primaryLabel,
      metric_unit: existing?.data.metric_unit ?? fieldMeta.primaryUnit,
      metric_value: updates.metric_value !== undefined
        ? updates.metric_value ?? null
        : existing?.data.metric_value ?? null,
      incorrect_trials: updates.incorrect_trials !== undefined
        ? updates.incorrect_trials ?? null
        : existing?.data.incorrect_trials ?? null,
      opportunities: updates.opportunities !== undefined
        ? updates.opportunities ?? null
        : existing?.data.opportunities ?? null,
      prompt_level: updates.prompt_level !== undefined
        ? updates.prompt_level ?? null
        : existing?.data.prompt_level ?? null,
      note: updates.note !== undefined
        ? updates.note ?? null
        : existing?.data.note ?? null,
      targets: resolvedTargets.length > 0 ? resolvedTargets : null,
      target: getPrimaryNonEmptyTarget(resolvedTargets),
      target_trials: nextTargetTrials.length > 0 ? nextTargetTrials : null,
      trial_prompt_note: summarizeTargetTrialPromptNotes(nextTargetTrials) ?? (updates.trial_prompt_note !== undefined
        ? updates.trial_prompt_note ?? null
        : existing?.data.trial_prompt_note ?? null),
    },
  };

  return hasMeaningfulGoalMeasurementEntry(nextEntry) ? nextEntry : null;
};

interface MergeUniqueGoalIdsOptions {
  readonly trimValues?: boolean;
}

export const mergeUniqueGoalIds = (
  ...goalIdListsAndOptions: Array<ReadonlyArray<string | undefined | null> | MergeUniqueGoalIdsOptions | null | undefined>
): string[] => {
  const maybeOptions = goalIdListsAndOptions.at(-1);
  const hasOptions =
    typeof maybeOptions === 'object' &&
    maybeOptions !== null &&
    !Array.isArray(maybeOptions);
  const options = (hasOptions ? maybeOptions : undefined) as MergeUniqueGoalIdsOptions | undefined;
  const goalIdLists = (hasOptions ? goalIdListsAndOptions.slice(0, -1) : goalIdListsAndOptions) as Array<
    ReadonlyArray<string | undefined | null> | null | undefined
  >;

  return Array.from(
    new Set(
      goalIdLists
        .flatMap((goalIds) => goalIds ?? [])
        .filter((goalId): goalId is string => typeof goalId === 'string' && goalId.trim().length > 0)
        .map((goalId) => (options?.trimValues ? goalId.trim() : goalId)),
    ),
  );
};
