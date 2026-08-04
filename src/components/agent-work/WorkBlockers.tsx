import type { AgentWorkItem } from "../../lib/agent-work-ledger";

const actionLabel = (action: string): string => {
  const label = action.replaceAll("_", " ");
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
};

export function WorkBlockers({
  blockers,
  reviewHref,
}: {
  blockers: AgentWorkItem["blockers"];
  reviewHref: string;
}) {
  if (blockers.length === 0) return null;

  return (
    <section data-testid="work-ledger-blockers" aria-labelledby="work-ledger-blockers-heading">
      <h3 id="work-ledger-blockers-heading" className="text-sm font-semibold text-amber-100">Current blockers</h3>
      <ul className="mt-2 space-y-2">
        {blockers.map((blocker) => (
          <li key={`${blocker.stepKey}:${blocker.code}`} className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-3">
            <p className="text-sm font-medium text-amber-50">{actionLabel(blocker.action)}</p>
            <a className="mt-2 inline-flex text-xs font-semibold text-cyan-200 underline underline-offset-2" href={reviewHref}>
              Open current IEHP review section
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
