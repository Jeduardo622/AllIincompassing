import type { AgentWorkItem } from "../../lib/agent-work-ledger";

const titleCase = (value: string): string =>
  value
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");

export function WorkApprovalCard({ approvals }: { approvals: AgentWorkItem["approvals"] }) {
  if (approvals.length === 0) return null;

  return (
    <section aria-labelledby="work-ledger-approvals-heading">
      <h3 id="work-ledger-approvals-heading" className="text-sm font-semibold text-slate-100">Read-only approvals</h3>
      <ul className="mt-2 space-y-2">
        {approvals.map((approval) => (
          <li key={approval.id} className="rounded-lg border border-slate-700 bg-slate-950/50 px-3 py-2 text-xs text-slate-300">
            <span className="font-semibold text-slate-100">{titleCase(approval.status)}</span>
            {` · Required role: ${titleCase(approval.requiredRole)}`}
          </li>
        ))}
      </ul>
    </section>
  );
}
