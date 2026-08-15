import React from "react";
import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUseAuth = vi.fn();
const mockUseActiveOrganizationId = vi.fn();
const mockUsePayrollApprovals = vi.fn();

vi.mock("../../lib/authContext", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("../../lib/organization", () => ({
  useActiveOrganizationId: () => mockUseActiveOrganizationId(),
}));

vi.mock("../../features/payroll/usePayrollApprovals", () => ({
  usePayrollApprovals: (...args: unknown[]) => mockUsePayrollApprovals(...args),
}));

import { TimeReview } from "../TimeReview";

const SNAPSHOT_A = {
  snapshotId: "11111111-1111-1111-1111-111111111111",
  snapshotHash: "a".repeat(64),
};
const SNAPSHOT_B = {
  snapshotId: "22222222-2222-4222-8222-222222222222",
  snapshotHash: "b".repeat(64),
};
const SNAPSHOT_C = {
  snapshotId: "33333333-3333-4333-8333-333333333333",
  snapshotHash: "c".repeat(64),
};

const buildQueueItem = (
  employeeLabel: string,
  snapshot: typeof SNAPSHOT_A,
  state = "submitted",
) => ({
  employeeLabel,
  employmentProfileId: snapshot.snapshotId,
  payPeriodId: snapshot.snapshotId,
  periodStart: "2026-08-10",
  periodEnd: "2026-08-16",
  state,
  blockerCount: 1,
  submittedAt: state === "submitted" ? "2026-08-12T18:00:00.000Z" : null,
  snapshot: {
    id: snapshot.snapshotId,
    hash: snapshot.snapshotHash,
  },
  classifiedSeconds: { regular: 14400, overtime: 0, doubleTime: 0 },
});

const buildDetails = (
  snapshot: typeof SNAPSHOT_A,
  compensation?: { grossEarningsCents: number },
) => ({
  state: "ok",
  snapshotId: snapshot.snapshotId,
  snapshotHash: snapshot.snapshotHash,
  periodStart: "2026-08-10",
  periodEnd: "2026-08-16",
  punches: [],
  classifiedSeconds: { regular: 14400, overtime: 0, doubleTime: 0 },
  approvalHistory: [],
  blockers: [],
  unresolvedBlockerCount: 1,
  ...(compensation ? { compensation } : {}),
});

const buildPage = () => (
  <MemoryRouter initialEntries={["/time/review"]}>
    <TimeReview />
  </MemoryRouter>
);

const renderPage = () => render(buildPage());

describe("TimeReview", () => {
  let queueData: {
    state: string;
    selectedLocalDate: string;
    capabilities: {
      canReviewAssigned: boolean;
      canApproveAssigned: boolean;
      canViewCompensation: boolean;
      hasOrgPayrollAccess: boolean;
    };
    queue: ReturnType<typeof buildQueueItem>[];
  };
  let injectedCompensation: { grossEarningsCents: number } | undefined;

  beforeEach(() => {
    mockUseActiveOrganizationId.mockReturnValue("org-1");
    mockUseAuth.mockReturnValue({
      user: { id: "user-1", email: "reviewer@example.com" },
      loading: false,
      profileLoading: false,
    });
    queueData = {
      state: "ok",
      selectedLocalDate: "2026-08-12",
      capabilities: {
        canReviewAssigned: true,
        canApproveAssigned: true,
        canViewCompensation: false,
        hasOrgPayrollAccess: false,
      },
      queue: [buildQueueItem("Employee 1001", SNAPSHOT_A)],
    };
    injectedCompensation = undefined;
    mockUsePayrollApprovals.mockImplementation((
      _scope: unknown,
      options: { details?: typeof SNAPSHOT_A | null },
    ) => ({
      payrollReviewQueueQuery: {
        data: queueData,
        isLoading: false,
        isError: false,
      },
      payrollReviewDetailsQuery: {
        data: options.details ? buildDetails(options.details, injectedCompensation) : undefined,
        isError: false,
      },
      approvePayrollTimesheetMutation: { mutateAsync: vi.fn() },
      returnPayrollTimesheetMutation: { mutateAsync: vi.fn() },
    }));
  });

  it("renders the authoritative review queue and immutable details", async () => {
    renderPage();

    expect(screen.getByText(/time review/i)).toBeInTheDocument();
    expect(screen.getByText(/employee 1001/i)).toBeInTheDocument();
    expect(await screen.findByText(/immutable snapshot details/i)).toBeInTheDocument();
    expect(screen.getByText(/no blocker details are available for this reviewer/i)).toBeInTheDocument();
  });

  it("requires a non-empty return comment before enabling return", async () => {
    renderPage();

    const returnButton = await screen.findByRole("button", { name: /return/i });
    expect(returnButton).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText(/return comment/i), "Needs correction.");
    expect(returnButton).not.toBeDisabled();
  });

  it("preserves the return comment across same-snapshot refresh and clears it when the selected snapshot changes", async () => {
    const { rerender } = renderPage();

    const returnCommentField = await screen.findByPlaceholderText(/return comment/i);
    await userEvent.type(returnCommentField, "Needs correction.");
    expect(returnCommentField).toHaveValue("Needs correction.");

    queueData = {
      ...queueData,
      queue: [buildQueueItem("Employee 1001", SNAPSHOT_A)],
    };
    rerender(buildPage());
    expect(screen.getByPlaceholderText(/return comment/i)).toHaveValue("Needs correction.");

    queueData = {
      ...queueData,
      queue: [
        buildQueueItem("Employee 1001", SNAPSHOT_A),
        buildQueueItem("Employee 1002", SNAPSHOT_B),
      ],
    };
    rerender(buildPage());
    await userEvent.click(screen.getByRole("button", { name: /employee 1002/i }));
    expect(screen.getByPlaceholderText(/return comment/i)).toHaveValue("");
  });

  it("clears the return comment when the queue replaces the selected snapshot with a new head", async () => {
    queueData.queue = [
      buildQueueItem("Employee 1001", SNAPSHOT_A),
      buildQueueItem("Employee 1002", SNAPSHOT_B),
    ];
    const { rerender } = renderPage();

    await userEvent.click(screen.getByRole("button", { name: /employee 1002/i }));
    const returnCommentField = await screen.findByPlaceholderText(/return comment/i);
    await userEvent.type(returnCommentField, "Needs correction.");
    expect(returnCommentField).toHaveValue("Needs correction.");

    queueData = {
      ...queueData,
      queue: [buildQueueItem("Employee 1003", SNAPSHOT_C)],
    };
    rerender(buildPage());

    await waitFor(() => expect(mockUsePayrollApprovals).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ details: SNAPSHOT_C }),
    ));
    expect(screen.getByPlaceholderText(/return comment/i)).toHaveValue("");
  });

  it("preserves the exact selected snapshot when the refreshed queue still contains it", async () => {
    queueData.queue = [
      buildQueueItem("Employee 1001", SNAPSHOT_A),
      buildQueueItem("Employee 1002", SNAPSHOT_B),
    ];
    const { rerender } = renderPage();

    await userEvent.click(screen.getByRole("button", { name: /employee 1002/i }));
    await waitFor(() => expect(mockUsePayrollApprovals).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ details: SNAPSHOT_B }),
    ));

    queueData = {
      ...queueData,
      queue: queueData.queue.map((item) => ({ ...item, snapshot: { ...item.snapshot } })),
    };
    rerender(buildPage());

    await waitFor(() => expect(mockUsePayrollApprovals).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ details: SNAPSHOT_B }),
    ));
  });

  it("rebinds to the new queue head when the selected snapshot disappears", async () => {
    queueData.queue = [
      buildQueueItem("Employee 1001", SNAPSHOT_A),
      buildQueueItem("Employee 1002", SNAPSHOT_B),
    ];
    const { rerender } = renderPage();

    await userEvent.click(screen.getByRole("button", { name: /employee 1002/i }));
    await waitFor(() => expect(mockUsePayrollApprovals).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ details: SNAPSHOT_B }),
    ));

    queueData = {
      ...queueData,
      queue: [buildQueueItem("Employee 1003", SNAPSHOT_C)],
    };
    rerender(buildPage());

    await waitFor(() => expect(mockUsePayrollApprovals).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ details: SNAPSHOT_C }),
    ));
  });

  it.each(["approved", "returned", "draft"])(
    "does not render approval actions for a selected %s queue row",
    async (state) => {
      queueData.queue = [buildQueueItem("Employee 1001", SNAPSHOT_A, state)];

      renderPage();

      expect(await screen.findByText(/immutable snapshot details/i)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^return$/i })).not.toBeInTheDocument();
    },
  );

  it("hides injected compensation when the authoritative queue capability is false", async () => {
    injectedCompensation = { grossEarningsCents: 123456 };

    renderPage();

    expect(await screen.findByText(/immutable snapshot details/i)).toBeInTheDocument();
    expect(screen.queryByText(/gross:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/1234\.56/)).not.toBeInTheDocument();
  });

  it("renders the empty review state when authoritative org payroll access exists without assigned-review booleans", async () => {
    queueData = {
      state: "ok",
      selectedLocalDate: "2026-08-12",
      capabilities: {
        canReviewAssigned: false,
        canApproveAssigned: false,
        canViewCompensation: false,
        hasOrgPayrollAccess: true,
      },
      queue: [],
    };

    renderPage();

    expect(await screen.findByText(/no assigned payroll reviews/i)).toBeInTheDocument();
    expect(screen.queryByText(/did not grant review access for this route/i)).not.toBeInTheDocument();
  });
});
