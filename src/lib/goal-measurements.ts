import type { Goal, SessionGoalMeasurementEntry } from '../types';

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
    (data.opportunities !== null && data.opportunities !== undefined) ||
    (data.prompt_level?.trim().length ?? 0) > 0 ||
    (data.note?.trim().length ?? 0) > 0
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
  const normalizedEntry: SessionGoalMeasurementEntry = {
    version: GOAL_MEASUREMENT_VERSION,
    data: {
      measurement_type: goal?.measurement_type ?? toOptionalString(sourceData.measurement_type),
      metric_label: toOptionalString(sourceData.metric_label) ?? fieldMeta.primaryLabel,
      metric_unit: toOptionalString(sourceData.metric_unit) ?? fallbackMetricUnit,
      metric_value: toOptionalNumber(
        sourceData.metric_value ?? sourceData.count ?? sourceData.value,
      ),
      opportunities: toOptionalNumber(
        sourceData.opportunities ?? sourceData.trials,
      ),
      prompt_level: toOptionalString(
        sourceData.prompt_level ?? sourceData.promptLevel,
      ),
      note: toOptionalString(sourceData.note ?? sourceData.comment),
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
  const nextEntry: SessionGoalMeasurementEntry = {
    version: GOAL_MEASUREMENT_VERSION,
    data: {
      measurement_type: goal?.measurement_type ?? normalizedExisting?.data.measurement_type ?? null,
      metric_label: normalizedExisting?.data.metric_label ?? fieldMeta.primaryLabel,
      metric_unit: normalizedExisting?.data.metric_unit ?? fieldMeta.primaryUnit,
      metric_value: normalizedExisting?.data.metric_value ?? null,
      opportunities: normalizedExisting?.data.opportunities ?? null,
      prompt_level: normalizedExisting?.data.prompt_level ?? null,
      note: normalizedExisting?.data.note ?? null,
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
  const nextEntry: SessionGoalMeasurementEntry = {
    version: GOAL_MEASUREMENT_VERSION,
    data: {
      measurement_type: goal?.measurement_type ?? existing?.data.measurement_type ?? null,
      metric_label: existing?.data.metric_label ?? fieldMeta.primaryLabel,
      metric_unit: existing?.data.metric_unit ?? fieldMeta.primaryUnit,
      metric_value: updates.metric_value !== undefined
        ? updates.metric_value ?? null
        : existing?.data.metric_value ?? null,
      opportunities: updates.opportunities !== undefined
        ? updates.opportunities ?? null
        : existing?.data.opportunities ?? null,
      prompt_level: updates.prompt_level !== undefined
        ? updates.prompt_level ?? null
        : existing?.data.prompt_level ?? null,
      note: updates.note !== undefined
        ? updates.note ?? null
        : existing?.data.note ?? null,
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
