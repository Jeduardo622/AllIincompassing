import type { AgentWorkItem } from "../../lib/agent-work-ledger";

const sentenceCase = (value: string): string => {
  const label = value.replaceAll("_", " ");
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
};

export function WorkStepTimeline({ steps }: { steps: AgentWorkItem["steps"] }) {
  return (
    <ol className="space-y-2" aria-label="Work step timeline">
      {steps.map((step) => (
        <li key={step.id} className="rounded-lg border border-slate-700 bg-slate-950/50 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-slate-100">{sentenceCase(step.key)}</span>
            <span className="text-xs font-medium text-slate-300">Status: {sentenceCase(step.status)}</span>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {step.evidenceCount} evidence {step.evidenceCount === 1 ? "item" : "items"}
          </p>
        </li>
      ))}
    </ol>
  );
}
