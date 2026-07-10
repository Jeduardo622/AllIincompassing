import React, { useEffect, useMemo, useState } from "react";
import type {
  GoalTarget,
  GoalTargetCriterionMetric,
  GoalTargetPhase,
  GoalTargetPhaseCriterion,
} from "../../types";

export type SaveCriterionInput = {
  action: "set_criteria";
  target_id: string;
  phase: GoalTargetPhase;
  metric: GoalTargetCriterionMetric | null;
  comparator: "gte" | "lte" | null;
  threshold: number | null;
  min_observations: number | null;
  consecutive_sessions: number | null;
  clinical_note: string | null;
  expected_version: number;
};

export type ManualOverrideInput = {
  action: "override_progression";
  target_id: string;
  target_phase: GoalTargetPhase;
  current_target_id: string | null;
  reason: string;
  expected_version: number;
};

const PHASES: GoalTargetPhase[] = ["baseline", "teaching", "generalization", "mastery"];
const LABELS: Record<GoalTargetPhase, string> = {
  baseline: "Baseline", teaching: "Teaching", generalization: "Generalization", mastery: "Mastery",
};
const METRIC_LABELS: Record<GoalTargetCriterionMetric, string> = {
  percent_correct: "Percent correct", percent_independent: "Percent independent",
  total_value: "Total value", average_value: "Average value",
};

export const canRoleManageGoalTargetProgression = (role: string | null | undefined): boolean =>
  role === "bcba" || role === "midtier" || role === "super_admin";

export const compatibleMetrics = (measurementType: GoalTarget["measurement_type"]): GoalTargetCriterionMetric[] =>
  measurementType === "correctIncorrect" ? ["percent_correct"]
    : measurementType === "taskAnalysis" ? ["percent_independent"]
      : measurementType === "frequency" || measurementType === "timeSample" ? ["total_value"]
        : ["average_value"];

export const isCriterionComplete = (criterion?: GoalTargetPhaseCriterion): boolean => Boolean(
  criterion?.metric && criterion.comparator && criterion.threshold !== null &&
  criterion.min_observations && criterion.min_observations > 0 &&
  criterion.consecutive_sessions && criterion.consecutive_sessions > 0,
);

type Draft = {
  metric: GoalTargetCriterionMetric | "";
  comparator: "gte" | "lte" | "";
  threshold: string;
  minObservations: string;
  consecutiveSessions: string;
  note: string;
};

const toDraft = (criterion?: GoalTargetPhaseCriterion): Draft => ({
  metric: criterion?.metric ?? "", comparator: criterion?.comparator ?? "",
  threshold: criterion?.threshold == null ? "" : String(criterion.threshold),
  minObservations: criterion?.min_observations == null ? "" : String(criterion.min_observations),
  consecutiveSessions: criterion?.consecutive_sessions == null ? "" : String(criterion.consecutive_sessions),
  note: criterion?.clinical_note ?? "",
});

function PhaseEditor({ target, phase, criterion, canManage, busy, onSave }: {
  target: GoalTarget; phase: GoalTargetPhase; criterion?: GoalTargetPhaseCriterion;
  canManage: boolean; busy: boolean; onSave: (input: SaveCriterionInput) => void;
}) {
  const [draft, setDraft] = useState(() => toDraft(criterion));
  useEffect(() => setDraft(toDraft(criterion)), [criterion]);
  const metrics = compatibleMetrics(target.measurement_type);
  const threshold = Number(draft.threshold);
  const observations = Number(draft.minObservations);
  const sessions = Number(draft.consecutiveSessions);
  const observationsInvalid = draft.minObservations !== "" && (!Number.isInteger(observations) || observations < 1);
  const sessionsInvalid = draft.consecutiveSessions !== "" && (!Number.isInteger(sessions) || sessions < 1);
  const thresholdInvalid = draft.threshold !== "" && (!Number.isFinite(threshold) || threshold < 0 ||
    ((draft.metric === "percent_correct" || draft.metric === "percent_independent") && threshold > 100));
  const valid = Boolean(draft.metric && metrics.includes(draft.metric as GoalTargetCriterionMetric) && draft.comparator &&
    draft.threshold !== "" && !thresholdInvalid && draft.minObservations !== "" &&
    !observationsInvalid && draft.consecutiveSessions !== "" && !sessionsInvalid);

  return (
    <fieldset aria-label={`${LABELS[phase]} criteria`} className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
      <legend className="px-1 text-xs font-semibold text-slate-700 dark:text-slate-200">{LABELS[phase]} criteria</legend>
      {!canManage ? (
        isCriterionComplete(criterion) ? (
          <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
            <div><dt className="text-slate-500">Metric</dt><dd>{criterion?.metric ? METRIC_LABELS[criterion.metric] : "—"}</dd></div>
            <div><dt className="text-slate-500">Threshold</dt><dd>{criterion?.comparator === "gte" ? "≥" : "≤"} {criterion?.threshold}</dd></div>
            <div><dt className="text-slate-500">Window</dt><dd>{criterion?.min_observations} observations · {criterion?.consecutive_sessions} sessions</dd></div>
            {criterion?.clinical_note && <div className="col-span-full"><dt className="text-slate-500">Clinical note</dt><dd>{criterion.clinical_note}</dd></div>}
          </dl>
        ) : <p className="text-xs text-amber-700 dark:text-amber-300">Not configured</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-xs">Metric
            <select aria-label="Metric" value={draft.metric} onChange={(e) => setDraft({ ...draft, metric: e.target.value as Draft["metric"] })} className="mt-1 w-full rounded-md border-slate-300 text-sm dark:border-slate-600 dark:bg-dark">
              <option value="">Select metric</option>
              {(Object.keys(METRIC_LABELS) as GoalTargetCriterionMetric[]).map((metric) => <option key={metric} value={metric} disabled={!metrics.includes(metric)}>{METRIC_LABELS[metric]}</option>)}
            </select>
          </label>
          <label className="text-xs">Operator
            <select aria-label="Operator" value={draft.comparator} onChange={(e) => setDraft({ ...draft, comparator: e.target.value as Draft["comparator"] })} className="mt-1 w-full rounded-md border-slate-300 text-sm dark:border-slate-600 dark:bg-dark">
              <option value="">Select operator</option><option value="gte">At least (≥)</option><option value="lte">At most (≤)</option>
            </select>
          </label>
          <label className="text-xs">Threshold
            <input aria-label="Threshold" type="number" min="0" value={draft.threshold} onChange={(e) => setDraft({ ...draft, threshold: e.target.value })} className="mt-1 w-full rounded-md border-slate-300 text-sm dark:border-slate-600 dark:bg-dark" />
            {thresholdInvalid && <span className="mt-1 block text-rose-700">Threshold must be between 0 and {draft.metric.startsWith("percent_") ? "100" : "a valid value"}.</span>}
          </label>
          <label className="text-xs">Minimum observations
            <input aria-label="Minimum observations" type="number" min="1" step="1" value={draft.minObservations} onChange={(e) => setDraft({ ...draft, minObservations: e.target.value })} className="mt-1 w-full rounded-md border-slate-300 text-sm dark:border-slate-600 dark:bg-dark" />
            {observationsInvalid && <span className="mt-1 block text-rose-700">Minimum observations must be at least 1.</span>}
          </label>
          <label className="text-xs">Consecutive sessions
            <input aria-label="Consecutive sessions" type="number" min="1" step="1" value={draft.consecutiveSessions} onChange={(e) => setDraft({ ...draft, consecutiveSessions: e.target.value })} className="mt-1 w-full rounded-md border-slate-300 text-sm dark:border-slate-600 dark:bg-dark" />
            {sessionsInvalid && <span className="mt-1 block text-rose-700">Consecutive sessions must be at least 1.</span>}
          </label>
          <label className="text-xs sm:col-span-2 lg:col-span-3">Clinical note (optional)
            <textarea aria-label="Clinical note" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} rows={2} className="mt-1 w-full rounded-md border-slate-300 text-sm dark:border-slate-600 dark:bg-dark" />
          </label>
          <div className="sm:col-span-2 lg:col-span-3 flex justify-end">
            <button type="button" aria-label={`Save ${phase} criteria`} disabled={!valid || busy} onClick={() => onSave({ action: "set_criteria", target_id: target.id, phase, metric: draft.metric as GoalTargetCriterionMetric, comparator: draft.comparator as "gte" | "lte", threshold, min_observations: observations, consecutive_sessions: sessions, clinical_note: draft.note.trim() || null, expected_version: target.progression_version })} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">{busy ? "Saving..." : "Save criteria"}</button>
          </div>
        </div>
      )}
    </fieldset>
  );
}

export function GoalTargetProgressionEditor({ target, criteria, sequencePosition, sequenceCount, canManage, busy, error, onSaveCriterion, onManualOverride }: {
  target: GoalTarget; criteria: GoalTargetPhaseCriterion[]; sequencePosition: number; sequenceCount: number;
  canManage: boolean; busy: boolean; error?: string | null;
  onSaveCriterion: (input: SaveCriterionInput) => void; onManualOverride: (input: ManualOverrideInput) => void;
}) {
  const byPhase = useMemo(() => new Map(criteria.map((item) => [item.phase, item])), [criteria]);
  const incomplete = PHASES.some((phase) => !isCriterionComplete(byPhase.get(phase)));
  const [manualAction, setManualAction] = useState<"advance" | "back" | "select" | "reopen" | null>(null);
  const [reason, setReason] = useState("");
  const phaseIndex = Math.max(0, PHASES.indexOf(target.current_phase ?? "baseline"));
  const targetPhase = manualAction === "advance" ? PHASES[Math.min(PHASES.length - 1, phaseIndex + 1)]
    : manualAction === "back" ? PHASES[Math.max(0, phaseIndex - 1)] : "baseline";
  const actionLabel = manualAction === "select" ? "Select as current" : manualAction === "reopen" ? "Reopen target" : manualAction === "back" ? "Move back" : "Manual advance";
  return (
    <section aria-label={`Progression for ${target.name}`} className="mt-3 space-y-3 rounded-md border border-indigo-100 bg-indigo-50/40 p-3 dark:border-indigo-900/60 dark:bg-indigo-950/20">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-indigo-800 dark:text-indigo-200">Progression</h4>
        <span className="rounded-full bg-white px-2 py-0.5 text-xs dark:bg-dark">Sequence {sequencePosition} of {sequenceCount}</span>
        {target.is_current && <span className="rounded-full bg-indigo-700 px-2 py-0.5 text-xs text-white">Current · {LABELS[target.current_phase ?? "baseline"]}</span>}
        {incomplete && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Criteria incomplete</span>}
      </div>
      {error && <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:bg-rose-900/30 dark:text-rose-200">{error}</p>}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">{PHASES.map((phase) => <PhaseEditor key={phase} target={target} phase={phase} criterion={byPhase.get(phase)} canManage={canManage} busy={busy} onSave={onSaveCriterion} />)}</div>
      {canManage && (
        <div className="flex flex-wrap gap-2 border-t border-indigo-100 pt-3 dark:border-indigo-900/60">
          {target.is_current && target.status !== "mastered" && phaseIndex > 0 && <button type="button" onClick={() => setManualAction("back")} className="rounded-md border border-slate-300 px-2 py-1 text-xs">Move back</button>}
          {target.is_current && target.status !== "mastered" && phaseIndex < PHASES.length - 1 && <button type="button" aria-label="Manual advance" onClick={() => setManualAction("advance")} className="rounded-md border border-slate-300 px-2 py-1 text-xs">Manual advance</button>}
          {!target.is_current && target.status !== "mastered" && <button type="button" onClick={() => setManualAction("select")} className="rounded-md border border-slate-300 px-2 py-1 text-xs">Select as current</button>}
          {target.status === "mastered" && <button type="button" onClick={() => setManualAction("reopen")} className="rounded-md border border-slate-300 px-2 py-1 text-xs">Reopen target</button>}
        </div>
      )}
      {manualAction && (
        <div role="dialog" aria-label={actionLabel} className="rounded-md border border-indigo-200 bg-white p-3 dark:border-indigo-800 dark:bg-dark">
          <p className="text-sm font-semibold">{actionLabel}</p>
          <label className="mt-2 block text-xs">Reason for manual change
            <textarea aria-label="Reason for manual change" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded-md border-slate-300 text-sm dark:border-slate-600 dark:bg-dark" />
          </label>
          <div className="mt-2 flex justify-end gap-2"><button type="button" onClick={() => { setManualAction(null); setReason(""); }} className="rounded-md border px-3 py-1.5 text-xs">Cancel</button><button type="button" aria-label="Confirm manual change" disabled={!reason.trim() || busy} onClick={() => { onManualOverride({ action: "override_progression", target_id: target.id, target_phase: targetPhase, current_target_id: manualAction === "select" || manualAction === "reopen" ? target.id : target.id, reason: reason.trim(), expected_version: target.progression_version }); setManualAction(null); setReason(""); }} className="rounded-md bg-indigo-700 px-3 py-1.5 text-xs text-white disabled:opacity-50">Confirm manual change</button></div>
        </div>
      )}
    </section>
  );
}
