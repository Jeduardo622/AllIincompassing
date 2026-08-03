import { useState } from "react";
import type { AgentWorkItem } from "../../lib/agent-work-ledger";

const titleCase = (value: string): string =>
  value
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");

type Approval = AgentWorkItem["approvals"][number];

export function WorkApprovalCard({
  approvals,
  runtimeMode,
  onDecision,
}: {
  approvals: AgentWorkItem["approvals"];
  runtimeMode: "shadow" | "advisory";
  onDecision?: (approval: Approval, decision: "approve" | "reject") => void | Promise<void>;
}) {
  const [confirmation, setConfirmation] = useState<{
    approval: Approval;
    decision: "approve" | "reject";
  } | null>(null);
  if (approvals.length === 0) return null;

  return (
    <section aria-labelledby="work-ledger-approvals-heading">
      <h3 id="work-ledger-approvals-heading" className="text-sm font-semibold text-slate-100">
        {runtimeMode === "shadow" ? "Read-only approvals" : "Clinical review handoffs"}
      </h3>
      <ul className="mt-2 space-y-2">
        {approvals.map((approval) => {
          const canAct = runtimeMode === "advisory" && approval.status === "pending" &&
            approval.canDecide && approval.evidenceCount !== null &&
            approval.evidenceHashSuffix !== null && Boolean(onDecision);
          return (
          <li key={approval.id} className="rounded-lg border border-slate-700 bg-slate-950/50 px-3 py-2 text-xs text-slate-300">
            <span className="font-semibold text-slate-100">{titleCase(approval.status)}</span>
            {` · Required role: ${titleCase(approval.requiredRole)}`}
            {approval.evidenceCount !== null && (
              <p className="mt-1">
                {approval.evidenceCount} evidence {approval.evidenceCount === 1 ? "item" : "items"}
              </p>
            )}
            {canAct && (
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded border border-emerald-500/60 px-2 py-1 font-semibold text-emerald-100"
                  aria-label="Approve clinical review handoff"
                  onClick={() => setConfirmation({ approval, decision: "approve" })}
                >
                  Approve handoff
                </button>
                <button
                  type="button"
                  className="rounded border border-rose-500/60 px-2 py-1 font-semibold text-rose-100"
                  aria-label="Reject clinical review handoff"
                  onClick={() => setConfirmation({ approval, decision: "reject" })}
                >
                  Reject handoff
                </button>
              </div>
            )}
          </li>
        )})}
      </ul>
      <p className="mt-2 text-xs text-slate-400">
        A handoff decision records ledger review state only. It does not publish, sign, submit, bill, or create a final clinical record.
      </p>
      {confirmation && (
        <div role="dialog" aria-modal="true" aria-labelledby="approval-confirmation-title" className="mt-3 rounded-lg border border-amber-500/40 bg-amber-950/30 p-3 text-xs text-amber-50">
          <h4 id="approval-confirmation-title" className="font-semibold">Confirm {confirmation.decision} handoff</h4>
          <p className="mt-1">
            Target: clinical review handoff · {confirmation.approval.evidenceCount} evidence items · Hash suffix {confirmation.approval.evidenceHashSuffix}.
          </p>
          <p className="mt-1">This decision changes only advisory ledger state and cannot perform a clinical or publication action.</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="rounded bg-amber-100 px-2 py-1 font-semibold text-amber-950"
              onClick={() => {
                const selected = confirmation;
                setConfirmation(null);
                void onDecision?.(selected.approval, selected.decision);
              }}
            >
              Confirm {confirmation.decision}
            </button>
            <button type="button" className="rounded border border-amber-200/50 px-2 py-1" onClick={() => setConfirmation(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
