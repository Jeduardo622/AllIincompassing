import type { Goal, SessionGoalMeasurementData, SessionNote, SessionTargetTrialData } from '../types';

export type SessionTrendDisplayPeriod = 'month' | 'week' | 'day';

export interface SessionTrendDateRange {
  readonly startDate?: string;
  readonly endDate?: string;
}

export interface SessionTrendGoalOption {
  readonly id: string;
  readonly label: string;
  readonly programName: string | null;
}

export interface SessionTrendTargetOption {
  readonly key: string;
  readonly goalId: string;
  readonly label: string;
}

export interface SessionTrendEvidencePoint {
  readonly noteId: string;
  readonly sessionDate: string;
  readonly therapistName: string;
  readonly goalId: string;
  readonly goalLabel: string;
  readonly targetKey: string;
  readonly targetLabel: string;
  readonly percent: number;
  readonly numerator: number | null;
  readonly denominator: number | null;
  readonly source: 'target_trials' | 'flat_percent' | 'flat_trials';
}

export interface SessionTrendBucketPoint {
  readonly bucketKey: string;
  readonly label: string;
  readonly median: number;
  readonly sampleSize: number;
  readonly evidence: SessionTrendEvidencePoint[];
}

export interface SessionTrendModel {
  readonly goalOptions: SessionTrendGoalOption[];
  readonly targetOptions: SessionTrendTargetOption[];
  readonly selectedGoalId: string | null;
  readonly selectedTargetKey: string | null;
  readonly buckets: SessionTrendBucketPoint[];
  readonly includedEvidence: SessionTrendEvidencePoint[];
  readonly excludedSessionCount: number;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const toDate = (value: string): Date | null => {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const isWithinRange = (sessionDate: string, range: SessionTrendDateRange): boolean => {
  const date = toDate(sessionDate);
  if (!date) {
    return false;
  }

  if (range.startDate) {
    const start = toDate(range.startDate);
    if (start && date < start) {
      return false;
    }
  }

  if (range.endDate) {
    const end = toDate(range.endDate);
    if (end && date > end) {
      return false;
    }
  }

  return true;
};

const formatMonthLabel = (date: Date): string =>
  new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(date);

const formatWeekLabel = (date: Date): string =>
  `Week of ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date)}`;

const formatDayLabel = (date: Date): string =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);

const getWeekStart = (date: Date): Date => {
  const copy = new Date(date);
  const day = copy.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + offset);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

const toLocalIsoDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const buildBucket = (
  sessionDate: string,
  displayPeriod: SessionTrendDisplayPeriod,
): { key: string; label: string } | null => {
  const date = toDate(sessionDate);
  if (!date) {
    return null;
  }

  if (displayPeriod === 'week') {
    const weekStart = getWeekStart(date);
    return {
      key: toLocalIsoDate(weekStart),
      label: formatWeekLabel(weekStart),
    };
  }

  if (displayPeriod === 'day') {
    return {
      key: toLocalIsoDate(date),
      label: formatDayLabel(date),
    };
  }

  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
  return {
    key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
    label: formatMonthLabel(monthStart),
  };
};

const getGoalLabel = (goalId: string, goalsById: Map<string, Goal>): string =>
  goalsById.get(goalId)?.title ?? `Goal ${goalId.slice(0, 8)}`;

const getProgramName = (goalId: string, goalsById: Map<string, Goal>): string | null =>
  (goalsById.get(goalId) as (Goal & { program_name?: string | null }) | undefined)?.program_name ?? null;

const looksPercentBased = (data: SessionGoalMeasurementData): boolean => {
  const haystack = [
    data.measurement_type,
    data.metric_label,
    data.metric_unit,
  ].filter((entry): entry is string => typeof entry === 'string').join(' ').toLowerCase();

  return haystack.includes('percent') || haystack.includes('%') || haystack.includes('accuracy') || haystack.includes('fidelity');
};

const buildTrialPercent = (
  metricValue: number | null | undefined,
  incorrectTrials: number | null | undefined,
  opportunities: number | null | undefined,
): { percent: number; numerator: number | null; denominator: number | null; source: 'flat_trials' } | null => {
  if (!isFiniteNumber(metricValue)) {
    return null;
  }

  if (isFiniteNumber(opportunities) && opportunities > 0) {
    return {
      percent: (metricValue / opportunities) * 100,
      numerator: metricValue,
      denominator: opportunities,
      source: 'flat_trials',
    };
  }

  if (isFiniteNumber(incorrectTrials)) {
    const denominator = metricValue + incorrectTrials;
    if (denominator > 0) {
      return {
        percent: (metricValue / denominator) * 100,
        numerator: metricValue,
        denominator,
        source: 'flat_trials',
      };
    }
  }

  return null;
};

const buildFlatPercentPoint = (
  data: SessionGoalMeasurementData,
): { percent: number; numerator: null; denominator: null; source: 'flat_percent' } | null => {
  if (looksPercentBased(data) && isFiniteNumber(data.metric_value) && data.metric_value >= 0 && data.metric_value <= 100) {
    return {
      percent: data.metric_value,
      numerator: null,
      denominator: null,
      source: 'flat_percent',
    };
  }

  return null;
};

const buildPercentPoint = (
  data: SessionGoalMeasurementData,
): { percent: number; numerator: number | null; denominator: number | null; source: 'flat_percent' | 'flat_trials' } | null => {
  const flatPercent = buildFlatPercentPoint(data);
  const trialPercent = buildTrialPercent(data.metric_value, data.incorrect_trials, data.opportunities);
  if (flatPercent && (!trialPercent || trialPercent.percent > 100)) {
    return flatPercent;
  }

  if (trialPercent) {
    return trialPercent;
  }

  return flatPercent;
};

const normalizeTargetLabel = (target: string | null | undefined, fallback: string): string => {
  const trimmed = target?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
};

const buildTargetKey = (goalId: string, targetLabel: string): string =>
  `${goalId}::${targetLabel.trim().toLowerCase()}`;

const shouldPreferFlatPercentSnapshot = (
  data: SessionGoalMeasurementData,
  targetTrials: readonly SessionTargetTrialData[],
): boolean => {
  if (!buildFlatPercentPoint(data) || targetTrials.length !== 1) {
    return false;
  }

  const trial = targetTrials[0];
  const trialPercent = buildTrialPercent(trial.metric_value, trial.incorrect_trials, trial.opportunities);
  if (!trialPercent) {
    return true;
  }

  return trialPercent.percent > 100;
};

const extractEvidenceForNote = (
  note: SessionNote,
  goalsById: Map<string, Goal>,
): SessionTrendEvidencePoint[] => {
  const entries = Object.entries(note.goal_measurements ?? {});
  const points: SessionTrendEvidencePoint[] = [];

  entries.forEach(([goalId, measurement]) => {
    const data = measurement?.data;
    if (!data) {
      return;
    }

    const goalLabel = getGoalLabel(goalId, goalsById);
    const targetTrials = data.target_trials ?? [];

    if (targetTrials.length > 0) {
      if (shouldPreferFlatPercentSnapshot(data, targetTrials)) {
        const percentPoint = buildFlatPercentPoint(data);
        if (!percentPoint) {
          return;
        }

        const targetLabel = normalizeTargetLabel(data.target ?? targetTrials[0]?.target, goalLabel);
        points.push({
          noteId: note.id,
          sessionDate: note.date,
          therapistName: note.therapist_name,
          goalId,
          goalLabel,
          targetKey: buildTargetKey(goalId, targetLabel),
          targetLabel,
          percent: percentPoint.percent,
          numerator: percentPoint.numerator,
          denominator: percentPoint.denominator,
          source: percentPoint.source,
        });
        return;
      }

      targetTrials.forEach((trial: SessionTargetTrialData, index) => {
        const targetLabel = normalizeTargetLabel(trial.target, data.targets?.[index] ?? data.target ?? goalLabel);
        const trialPercent = buildTrialPercent(
          trial.metric_value,
          trial.incorrect_trials,
          trial.opportunities,
        );
        if (!trialPercent) {
          return;
        }

        points.push({
          noteId: note.id,
          sessionDate: note.date,
          therapistName: note.therapist_name,
          goalId,
          goalLabel,
          targetKey: buildTargetKey(goalId, targetLabel),
          targetLabel,
          percent: trialPercent.percent,
          numerator: trialPercent.numerator,
          denominator: trialPercent.denominator,
          source: 'target_trials',
        });
      });
      return;
    }

    const percentPoint = buildPercentPoint(data);
    if (!percentPoint) {
      return;
    }

    const targetLabel = normalizeTargetLabel(data.target, goalLabel);
    points.push({
      noteId: note.id,
      sessionDate: note.date,
      therapistName: note.therapist_name,
      goalId,
      goalLabel,
      targetKey: buildTargetKey(goalId, targetLabel),
      targetLabel,
      percent: percentPoint.percent,
      numerator: percentPoint.numerator,
      denominator: percentPoint.denominator,
      source: percentPoint.source,
    });
  });

  return points;
};

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }
  return (sorted[middle - 1] + sorted[middle]) / 2;
};

const roundPercent = (value: number): number => Math.round(value * 10) / 10;

export const buildSessionTrendModel = (
  notes: SessionNote[],
  goals: Goal[],
  options: {
    readonly selectedGoalId?: string | null;
    readonly selectedTargetKey?: string | null;
    readonly displayPeriod: SessionTrendDisplayPeriod;
    readonly dateRange?: SessionTrendDateRange;
  },
): SessionTrendModel => {
  const goalsById = new Map(goals.map((goal) => [goal.id, goal]));
  const range = options.dateRange ?? {};
  const inRangeNotes = notes.filter((note) => isWithinRange(note.date, range));
  const evidenceByNote = inRangeNotes.map((note) => extractEvidenceForNote(note, goalsById));
  const allEvidence = evidenceByNote.flat();
  const excludedSessionCount = evidenceByNote.filter((points) => points.length === 0).length;

  const goalIds = Array.from(new Set(allEvidence.map((point) => point.goalId)));
  const goalOptions = goalIds.map((goalId) => ({
    id: goalId,
    label: getGoalLabel(goalId, goalsById),
    programName: getProgramName(goalId, goalsById),
  }));

  const selectedGoalId = options.selectedGoalId && goalIds.includes(options.selectedGoalId)
    ? options.selectedGoalId
    : goalOptions[0]?.id ?? null;

  const targetOptions = selectedGoalId
    ? Array.from(
      new Map(
        allEvidence
          .filter((point) => point.goalId === selectedGoalId)
          .map((point) => [point.targetKey, {
            key: point.targetKey,
            goalId: point.goalId,
            label: point.targetLabel,
          }]),
      ).values(),
    )
    : [];

  const selectedTargetKey =
    options.selectedTargetKey && targetOptions.some((target) => target.key === options.selectedTargetKey)
      ? options.selectedTargetKey
      : targetOptions[0]?.key ?? null;

  const includedEvidence = allEvidence.filter((point) =>
    (!selectedGoalId || point.goalId === selectedGoalId) &&
    (!selectedTargetKey || point.targetKey === selectedTargetKey)
  );

  const grouped = new Map<string, { label: string; evidence: SessionTrendEvidencePoint[] }>();
  includedEvidence.forEach((point) => {
    const bucket = buildBucket(point.sessionDate, options.displayPeriod);
    if (!bucket) {
      return;
    }
    const existing = grouped.get(bucket.key) ?? { label: bucket.label, evidence: [] };
    existing.evidence.push(point);
    grouped.set(bucket.key, existing);
  });

  const buckets = Array.from(grouped.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([bucketKey, bucket]) => ({
      bucketKey,
      label: bucket.label,
      median: roundPercent(median(bucket.evidence.map((point) => point.percent))),
      sampleSize: bucket.evidence.length,
      evidence: bucket.evidence,
    }));

  return {
    goalOptions,
    targetOptions,
    selectedGoalId,
    selectedTargetKey,
    buckets,
    includedEvidence,
    excludedSessionCount,
  };
};
