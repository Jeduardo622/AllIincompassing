import { describe, expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { renderWithProviders, screen, within } from "../../../test/utils";
import { AssessmentWorkLedgerPanel } from "../AssessmentWorkLedgerPanel";
import type { AssessmentWorkLedgerPanelState } from "../../../lib/agent-work-ledger";

const buildAvailableState = (
  overrides: Partial<Extract<AssessmentWorkLedgerPanelState, { kind: "available" }>> = {},
): Extract<AssessmentWorkLedgerPanelState, { kind: "available" }> => ({
  kind: "available",
  runtimeMode: "advisory",
  item: {
    id: "55555555-5555-4555-8555-555555555555",
    workflowKey: "assessment.iehp.prepare_for_clinical_review",
    workflowVersion: 1,
    objective: "Prepare this assessment for clinical review",
    status: "waiting",
    risk: "clinical",
    ownerUserId: "11111111-1111-4111-8111-111111111111",
    dueAt: null,
    blockers: [
      {
        code: "missing_required_evidence",
        stepKey: "request_clinical_review",
        action: "resolve_required_evidence",
      },
    ],
    steps: [
      {
        id: "step-1",
        key: "await_extraction",
        status: "waiting",
        executionMode: "deterministic",
        evidenceCount: 2,
        lastReasonCode: "waiting_for_extraction",
      },
      {
        id: "step-2",
        key: "request_clinical_review",
        status: "pending",
        executionMode: "human",
        evidenceCount: 0,
        lastReasonCode: "owner_assignment_required",
      },
    ],
    approvals: [
      {
        id: "approval-1",
        stepId: "step-2",
        status: "pending",
        requiredRole: "bcba",
        expiresAt: null,
        requestedAt: "2026-08-02T12:00:00.000Z",
        evidenceCount: 2,
        evidenceHashSuffix: "89abcdef",
        canDecide: true,
      },
    ],
    updatedAt: "2026-08-02T12:00:00.000Z",
  },
  ...overrides,
});

describe("AssessmentWorkLedgerPanel", () => {
  it("announces asynchronous loading accessibly", () => {
    renderWithProviders(<AssessmentWorkLedgerPanel state={{ kind: "loading" }} />);

    expect(screen.getByRole("status")).toHaveTextContent(/Loading work ledger/i);
  });

  it("renders a no-ledger advisory state without exposing technical payloads", () => {
    renderWithProviders(
      <AssessmentWorkLedgerPanel state={{ kind: "no-ledger", runtimeMode: "advisory" }} />,
    );

    expect(screen.getByText("Advisory work ledger")).toBeInTheDocument();
    expect(screen.getByText(/No read-only advisory work item is available yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/workflowKey/i)).not.toBeInTheDocument();
  });

  it("renders shadow mode with read-only approvals and no approval controls", () => {
    renderWithProviders(
      <AssessmentWorkLedgerPanel state={buildAvailableState({ runtimeMode: "shadow" })} />,
    );

    expect(screen.getByText("Shadow mode")).toBeInTheDocument();
    expect(screen.getByText("Await extraction")).toBeInTheDocument();
    expect(screen.getByText("Read-only approvals")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
  });

  it("shows decision controls only for an authorized pending approval in advisory mode", () => {
    const onApprovalDecision = vi.fn();
    renderWithProviders(
      <AssessmentWorkLedgerPanel state={buildAvailableState()} onApprovalDecision={onApprovalDecision} />,
    );

    expect(screen.getByRole("button", { name: "Approve clinical review handoff" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject clinical review handoff" })).toBeInTheDocument();
    expect(screen.getAllByText(/2 evidence items/i)).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Approve clinical review handoff" }));
    expect(screen.getByRole("dialog", { name: /Confirm approve handoff/i })).toBeInTheDocument();
    expect(screen.getByText(/89abcdef/i)).toBeInTheDocument();
    expect(screen.getByText(/does not publish, sign, submit, bill, or create a final clinical record/i)).toBeInTheDocument();
    expect(onApprovalDecision).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm approve" }));
    expect(onApprovalDecision).toHaveBeenCalledWith(
      buildAvailableState().item.approvals[0],
      "approve",
    );
  });

  it("keeps controls hidden for stale authority, terminal approvals, and shadow mode", () => {
    const base = buildAvailableState();
    const renderState = (
      runtimeMode: "shadow" | "advisory",
      status: "pending" | "approved",
      canDecide: boolean,
    ) => ({
      ...base,
      runtimeMode,
      item: {
        ...base.item,
        approvals: [{ ...base.item.approvals[0], status, canDecide }],
      },
    });
    const { rerender } = renderWithProviders(
      <AssessmentWorkLedgerPanel state={renderState("advisory", "pending", false)} onApprovalDecision={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: /clinical review handoff/i })).not.toBeInTheDocument();
    rerender(<AssessmentWorkLedgerPanel state={renderState("advisory", "approved", true)} onApprovalDecision={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /clinical review handoff/i })).not.toBeInTheDocument();
    rerender(<AssessmentWorkLedgerPanel state={renderState("shadow", "pending", true)} onApprovalDecision={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /clinical review handoff/i })).not.toBeInTheDocument();
  });

  it("does not expose confirmation metadata for historical approvals", () => {
    const base = buildAvailableState();
    renderWithProviders(
      <AssessmentWorkLedgerPanel
        state={{
          ...base,
          item: {
            ...base.item,
            approvals: [{
              ...base.item.approvals[0],
              status: "approved",
              evidenceCount: null,
              evidenceHashSuffix: null,
              canDecide: false,
            }],
          },
        }}
      />,
    );

    const approvalSection = screen.getByRole("heading", { name: /clinical review handoffs/i }).closest("section");
    expect(approvalSection).not.toBeNull();
    expect(within(approvalSection!).queryByText(/evidence item/i)).not.toBeInTheDocument();
    expect(within(approvalSection!).queryByText(/hash suffix/i)).not.toBeInTheDocument();
  });

  it.each([
    ["blocked", "Blocked"],
    ["waiting", "Waiting"],
    ["needs_review", "Needs review"],
    ["failed", "Failed"],
    ["cancelled", "Cancelled"],
  ] as const)("renders truthful status text for %s work items", (status, label) => {
    renderWithProviders(
      <AssessmentWorkLedgerPanel state={buildAvailableState({ item: { ...buildAvailableState().item, status } })} />,
    );

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("shows a stale-data warning when the work item update is old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T13:30:00.000Z"));

    renderWithProviders(
      <AssessmentWorkLedgerPanel state={buildAvailableState()} />,
    );

    expect(screen.getByText(/Status may be stale/i)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("renders unauthorized, forbidden, and unavailable states without replacing the panel heading", () => {
    const { rerender } = renderWithProviders(
      <AssessmentWorkLedgerPanel state={{ kind: "unauthorized" }} />,
    );

    expect(screen.getByText(/Sign in again to view advisory ledger status/i)).toBeInTheDocument();

    rerender(<AssessmentWorkLedgerPanel state={{ kind: "forbidden" }} />);
    expect(screen.getByText(/You do not have access to this advisory ledger/i)).toBeInTheDocument();

    rerender(<AssessmentWorkLedgerPanel state={{ kind: "unavailable" }} />);
    expect(screen.getByText(/Advisory work ledger is currently unavailable/i)).toBeInTheDocument();
  });

  it("renders blockers, evidence counts, owner status, and the review jump link only", () => {
    renderWithProviders(
      <AssessmentWorkLedgerPanel
        state={buildAvailableState()}
        reviewHref="#iehp-current-review-section"
      />,
    );

    const blockers = screen.getByTestId("work-ledger-blockers");
    expect(within(blockers).getByText("Resolve required evidence")).toBeInTheDocument();
    expect(within(blockers).getByRole("link", { name: /Open current IEHP review section/i })).toHaveAttribute(
      "href",
      "#iehp-current-review-section",
    );
    expect(screen.getByText("Owner assigned")).toBeInTheDocument();
    expect(screen.getAllByText("2 evidence items")).toHaveLength(2);
    expect(screen.queryByText(/hash/i)).not.toBeInTheDocument();
  });
});
