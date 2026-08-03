import type { AssessmentWorkLedgerPanelState } from "../../lib/agent-work-ledger";
import { WorkApprovalCard } from "./WorkApprovalCard";
import { WorkBlockers } from "./WorkBlockers";
import { WorkStepTimeline } from "./WorkStepTimeline";

const STALE_AFTER_MS = 60 * 60 * 1000;

const statusLabel = (status: string): string => {
  if (status === "needs_review") return "Needs review";
  return `${status.charAt(0).toUpperCase()}${status.slice(1).replaceAll("_", " ")}`;
};

const modeHeading = (mode: "shadow" | "advisory"): string =>
  mode === "shadow" ? "Shadow work ledger" : "Advisory work ledger";

export function AssessmentWorkLedgerPanel({
  state,
  reviewHref = "#iehp-current-review-section",
  onApprovalDecision,
}: {
  state: AssessmentWorkLedgerPanelState;
  reviewHref?: string;
  onApprovalDecision?: (
    approval: Extract<AssessmentWorkLedgerPanelState, { kind: "available" }>["item"]["approvals"][number],
    decision: "approve" | "reject",
  ) => void | Promise<void>;
}) {
  if (state.kind === "disabled" || state.kind === "aborted") return null;

  if (state.kind === "loading") {
    return (
      <section className="rounded-xl border border-cyan-800/50 bg-slate-950 p-4 text-slate-100">
        <h2 className="text-sm font-semibold">Work ledger</h2>
        <p role="status" aria-live="polite" className="mt-2 text-sm text-slate-300">Loading work ledger...</p>
      </section>
    );
  }

  if (state.kind === "unauthorized" || state.kind === "forbidden" || state.kind === "unavailable") {
    return (
      <section className="rounded-xl border border-slate-700 bg-slate-950 p-4 text-slate-100" aria-live="polite">
        <h2 className="text-sm font-semibold">Advisory work ledger</h2>
        <p className="mt-2 text-sm text-slate-300">
          {state.kind === "unauthorized"
            ? "Sign in again to view advisory ledger status."
            : state.kind === "forbidden"
              ? "You do not have access to this advisory ledger. The IEHP review remains available."
            : "Advisory work ledger is currently unavailable. The IEHP review remains available."}
        </p>
      </section>
    );
  }

  if (state.kind === "no-ledger") {
    return (
      <section className="rounded-xl border border-slate-700 bg-slate-950 p-4 text-slate-100">
        <h2 className="text-sm font-semibold">{modeHeading(state.runtimeMode)}</h2>
        <p className="mt-2 text-sm text-slate-300">No read-only advisory work item is available yet.</p>
        <p className="mt-2 text-xs text-slate-400">AI actions cannot approve or publish this assessment.</p>
      </section>
    );
  }

  const { item, runtimeMode } = state;
  const updatedAt = Date.parse(item.updatedAt);
  const stale = Number.isFinite(updatedAt) && Date.now() - updatedAt > STALE_AFTER_MS;

  return (
    <section className="rounded-xl border border-cyan-700/40 bg-gradient-to-br from-slate-950 via-slate-950 to-cyan-950/30 p-4 text-slate-100" aria-labelledby="work-ledger-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="work-ledger-heading" className="text-sm font-semibold">{modeHeading(runtimeMode)}</h2>
          <p className="mt-1 text-lg font-semibold text-white">{item.objective}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <span className="rounded-full border border-cyan-400/40 bg-cyan-500/10 px-3 py-1 text-cyan-100">
            {runtimeMode === "shadow" ? "Shadow mode" : "Advisory mode"}
          </span>
          <span className="rounded-full border border-slate-500 px-3 py-1 text-slate-100">{statusLabel(item.status)}</span>
        </div>
      </div>

      {stale && <p className="mt-3 rounded-lg border border-amber-400/30 bg-amber-500/10 p-2 text-xs text-amber-100">Status may be stale. Refresh before acting on it.</p>}

      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <p><span className="font-semibold text-slate-100">Owner:</span> {item.ownerUserId ? "Owner assigned" : "No owner assigned"}</p>
        <p><span className="font-semibold text-slate-100">Last update:</span> {new Date(item.updatedAt).toLocaleString()}</p>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(16rem,0.65fr)]">
        <WorkStepTimeline steps={item.steps} />
        <div className="space-y-4">
          <WorkBlockers blockers={item.blockers} reviewHref={reviewHref} />
          <WorkApprovalCard approvals={item.approvals} runtimeMode={runtimeMode} onDecision={onApprovalDecision} />
        </div>
      </div>

      <p className="mt-4 border-t border-slate-700 pt-3 text-xs font-medium text-slate-300">
        AI actions cannot approve or publish this assessment. Clinical review remains authoritative.
      </p>
    </section>
  );
}
