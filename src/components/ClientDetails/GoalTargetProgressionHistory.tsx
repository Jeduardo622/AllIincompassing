import React from "react";
import type { GoalTargetPhase, GoalTargetTransition } from "../../types";

const label = (phase: GoalTargetPhase | null): string => phase ? `${phase.charAt(0).toUpperCase()}${phase.slice(1)}` : "None";

export function GoalTargetProgressionHistory({ transitions, loading, error }: { transitions: GoalTargetTransition[]; loading: boolean; error: string | null }) {
  return <section aria-label="Progression history" className="mt-3 rounded-md border border-slate-200 p-3 dark:border-slate-700">
    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">Progression history</h4>
    {loading ? <p className="mt-2 text-xs text-slate-500">Loading progression history...</p>
      : error ? <p role="alert" className="mt-2 text-xs text-rose-700 dark:text-rose-300">{error}</p>
      : transitions.length === 0 ? <p className="mt-2 text-xs text-slate-500">No progression changes yet.</p>
      : <ol className="mt-2 space-y-2">{transitions.map((transition) => <li key={transition.id} className="rounded-md bg-slate-50 px-3 py-2 text-xs dark:bg-slate-900/40">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{label(transition.previous_phase)} → {label(transition.resulting_phase)}</span><span className="uppercase text-slate-500">{transition.source}</span></div>
          <time dateTime={transition.transitioned_at} className="mt-1 block text-slate-500">{new Date(transition.transitioned_at).toLocaleString()}</time>
          {transition.reason && <p className="mt-1 text-slate-700 dark:text-slate-200">{transition.reason}</p>}
        </li>)}</ol>}
  </section>;
}
