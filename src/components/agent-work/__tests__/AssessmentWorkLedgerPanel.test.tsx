import { describe, expect, it, vi } from "vitest";
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
    expect(screen.getByText("2 evidence items")).toBeInTheDocument();
    expect(screen.queryByText(/hash/i)).not.toBeInTheDocument();
  });
});
