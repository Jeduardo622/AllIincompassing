import type { PromptOutcome, SessionNote, SessionPromptCount, TrialEvent } from "../types";
import type { SessionTrendDisplayPeriod } from "./session-trends";

export const PROMPT_OUTCOME_ORDER = ["correct", "incorrect", "noResponse"] as const satisfies ReadonlyArray<PromptOutcome>;

export const PROMPT_OUTCOME_LABELS: Record<PromptOutcome, string> = {
  correct: "Correct",
  incorrect: "Incorrect",
  noResponse: "No response",
};

export const PROMPT_OUTCOME_COLORS: Record<PromptOutcome, string> = {
  correct: "#16a34a",
  incorrect: "#dc2626",
  noResponse: "#d97706",
};

type PromptOutcomeCounts = Record<PromptOutcome, number>;

export interface PromptOutcomeEvidenceRow extends PromptOutcomeCounts {
  sessionKey: string;
  sessionDate: string;
  therapistId: string | null;
  therapistName: string;
  targetKey: string;
  targetLabel: string;
  total: number;
  source: "raw" | "legacy";
}

export interface PromptOutcomeBucket {
  key: string;
  label: string;
  correct: number;
  incorrect: number;
  noResponse: number;
  total: number;
  segments: Array<{
    outcome: PromptOutcome;
    label: string;
    value: number;
    percentage: number;
    color: string;
  }>;
}

export interface PromptOutcomeModel {
  summary: PromptOutcomeCounts & { total: number };
  evidence: PromptOutcomeEvidenceRow[];
  buckets: PromptOutcomeBucket[];
}

const emptyCounts = (): PromptOutcomeCounts => ({
  correct: 0,
  incorrect: 0,
  noResponse: 0,
});

const addCount = (counts: PromptOutcomeCounts, outcome: PromptOutcome, value: number): PromptOutcomeCounts => ({
  ...counts,
  [outcome]: counts[outcome] + value,
});

const totalCounts = (counts: PromptOutcomeCounts): number =>
  counts.correct + counts.incorrect + counts.noResponse;

const toDate = (value: string): Date | null => {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toLocalIsoDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const getWeekStart = (date: Date): Date => {
  const copy = new Date(date);
  const day = copy.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + offset);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

const formatBucketLabel = (date: Date, displayPeriod: SessionTrendDisplayPeriod): string => {
  if (displayPeriod === "week") {
    return `Week of ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date)}`;
  }
  if (displayPeriod === "day") {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
  }
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(date);
};

const buildBucketParts = (
  sessionDate: string,
  displayPeriod: SessionTrendDisplayPeriod,
): { key: string; label: string } | null => {
  const date = toDate(sessionDate);
  if (!date) {
    return null;
  }
  if (displayPeriod === "week") {
    const weekStart = getWeekStart(date);
    return { key: toLocalIsoDate(weekStart), label: formatBucketLabel(weekStart, displayPeriod) };
  }
  if (displayPeriod === "day") {
    return { key: toLocalIsoDate(date), label: formatBucketLabel(date, displayPeriod) };
  }
  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
  return {
    key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
    label: formatBucketLabel(monthStart, displayPeriod),
  };
};

const normalizeTargetLabel = (value: string | null | undefined, fallback: string): string => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
};

const buildGoalTargetKey = (goalId: string, targetLabel: string): string =>
  `${goalId}::${targetLabel.trim().toLowerCase()}`;

const sumLegacyPromptCounts = (promptCounts: SessionPromptCount[] | null | undefined): PromptOutcomeCounts => {
  return (promptCounts ?? []).reduce((counts, promptCount) => {
    let nextCounts = counts;
    if (promptCount.correct_trials > 0) {
      nextCounts = addCount(nextCounts, "correct", promptCount.correct_trials);
    }
    if (promptCount.incorrect_trials > 0) {
      nextCounts = addCount(nextCounts, "incorrect", promptCount.incorrect_trials);
    }
    const noResponseTrials = promptCount.no_response_trials ?? 0;
    if (noResponseTrials > 0) {
      nextCounts = addCount(nextCounts, "noResponse", noResponseTrials);
    }
    return nextCounts;
  }, emptyCounts());
};

const formatTherapistName = (therapistId: string | null | undefined, therapistName: string | null | undefined): string => {
  const trimmedName = therapistName?.trim();
  if (trimmedName) {
    return trimmedName;
  }
  return therapistId ? `Therapist ${therapistId.slice(0, 8)}` : "Unknown therapist";
};

const buildLegacyRows = (
  sessionNotes: SessionNote[],
  goalId: string,
  targetLabelsById: Record<string, string>,
): PromptOutcomeEvidenceRow[] => {
  const targetIdsByLabel = new Map(
    Object.entries(targetLabelsById).map(([targetId, targetLabel]) => [targetLabel.trim().toLowerCase(), targetId] as const),
  );
  const rows: PromptOutcomeEvidenceRow[] = [];

  sessionNotes.forEach((note) => {
    const measurement = note.goal_measurements?.[goalId]?.data;
    const targetTrials = measurement?.target_trials ?? [];
    targetTrials.forEach((trial, index) => {
      const counts = sumLegacyPromptCounts(trial.prompt_counts);
      const total = totalCounts(counts);
      if (total === 0) {
        return;
      }
      const targetLabel = normalizeTargetLabel(trial.target, measurement?.targets?.[index] ?? measurement?.target ?? "Target");
      const matchedTargetId = targetIdsByLabel.get(targetLabel.trim().toLowerCase()) ?? null;
      rows.push({
        sessionKey: note.session_id ?? note.id,
        sessionDate: note.date,
        therapistId: note.therapist_id ?? null,
        therapistName: formatTherapistName(note.therapist_id, note.therapist_name),
        targetKey: matchedTargetId ? `target:${matchedTargetId}` : buildGoalTargetKey(goalId, targetLabel),
        targetLabel,
        source: "legacy",
        total,
        ...counts,
      });
    });
  });

  return rows;
};

const groupRawRows = (
  rawEvents: TrialEvent[],
  goalId: string,
  sessionNotes: SessionNote[],
  targetLabelsById: Record<string, string>,
  requireSessionMembership: boolean,
  rawEventsArePromptOnly: boolean,
): PromptOutcomeEvidenceRow[] => {
  const sessionNotesByKey = new Map(
    sessionNotes.map((note) => [note.session_id ?? note.id, note] as const),
  );
  const grouped = new Map<string, PromptOutcomeEvidenceRow>();

  rawEvents.forEach((event) => {
    if ((!rawEventsArePromptOnly && !event.prompt_type) || !event.response || !PROMPT_OUTCOME_ORDER.includes(event.response as PromptOutcome)) {
      return;
    }
    const note = sessionNotesByKey.get(event.session_id);
    if (requireSessionMembership && !note) {
      return;
    }
    const outcome = event.response as PromptOutcome;
    const targetLabel = normalizeTargetLabel(targetLabelsById[event.target_id], "Configured target");
    const targetKey = `target:${event.target_id}`;
    const groupKey = `${event.session_id}:${targetKey}`;
    const current = grouped.get(groupKey) ?? {
      sessionKey: event.session_id,
      sessionDate: note?.date ?? event.event_timestamp.slice(0, 10),
      therapistId: note?.therapist_id ?? event.therapist_id ?? null,
      therapistName: formatTherapistName(note?.therapist_id ?? event.therapist_id, note?.therapist_name),
      targetKey,
      targetLabel,
      source: "raw" as const,
      total: 0,
      ...emptyCounts(),
    };
    const nextCounts = addCount(current, outcome, 1);
    grouped.set(groupKey, {
      ...current,
      ...nextCounts,
      total: totalCounts(nextCounts),
    });
  });

  return Array.from(grouped.values());
};

export const buildPromptOutcomeModel = ({
  goalId,
  displayPeriod,
  rawEvents,
  sessionNotes,
  targetLabelsById,
  selectedTherapistId,
  selectedTargetLabel,
  requireSessionMembership,
  rawEventsArePromptOnly,
}: {
  goalId: string;
  displayPeriod: SessionTrendDisplayPeriod;
  rawEvents: TrialEvent[];
  sessionNotes: SessionNote[];
  targetLabelsById?: Record<string, string>;
  selectedTherapistId?: string | null;
  selectedTargetLabel?: string | null;
  requireSessionMembership?: boolean;
  rawEventsArePromptOnly?: boolean;
}): PromptOutcomeModel => {
  const normalizedTargetLabels = targetLabelsById ?? {};
  const rawRows = groupRawRows(
    rawEvents,
    goalId,
    sessionNotes,
    normalizedTargetLabels,
    requireSessionMembership ?? false,
    rawEventsArePromptOnly ?? false,
  );
  const rawKeys = new Set(rawRows.map((row) => `${row.sessionKey}:${row.targetKey}`));
  const legacyRows = buildLegacyRows(sessionNotes, goalId, normalizedTargetLabels).filter((row) => !rawKeys.has(`${row.sessionKey}:${row.targetKey}`));

  const mergedRows = [...rawRows, ...legacyRows]
    .filter((row) => !selectedTherapistId || row.therapistId === selectedTherapistId)
    .filter((row) => !selectedTargetLabel || row.targetLabel === selectedTargetLabel)
    .sort((left, right) => {
      const dateComparison = left.sessionDate.localeCompare(right.sessionDate);
      if (dateComparison !== 0) {
        return dateComparison;
      }
      return left.targetLabel.localeCompare(right.targetLabel);
    });

  const summary = mergedRows.reduce(
    (counts, row) => ({
      correct: counts.correct + row.correct,
      incorrect: counts.incorrect + row.incorrect,
      noResponse: counts.noResponse + row.noResponse,
      total: counts.total + row.total,
    }),
    { ...emptyCounts(), total: 0 },
  );

  const groupedBuckets = new Map<string, PromptOutcomeBucket>();
  mergedRows.forEach((row) => {
    const bucketParts = buildBucketParts(row.sessionDate, displayPeriod);
    if (!bucketParts) {
      return;
    }
    const current = groupedBuckets.get(bucketParts.key) ?? {
      key: bucketParts.key,
      label: bucketParts.label,
      correct: 0,
      incorrect: 0,
      noResponse: 0,
      total: 0,
      segments: [],
    };
    current.correct += row.correct;
    current.incorrect += row.incorrect;
    current.noResponse += row.noResponse;
    current.total += row.total;
    groupedBuckets.set(bucketParts.key, current);
  });

  const buckets = Array.from(groupedBuckets.values())
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((bucket) => ({
      ...bucket,
      segments: PROMPT_OUTCOME_ORDER.map((outcome) => ({
        outcome,
        label: PROMPT_OUTCOME_LABELS[outcome],
        value: bucket[outcome],
        percentage: bucket.total > 0 ? Math.round((bucket[outcome] / bucket.total) * 1000) / 10 : 0,
        color: PROMPT_OUTCOME_COLORS[outcome],
      })),
    }));

  return {
    summary,
    evidence: mergedRows,
    buckets,
  };
};
