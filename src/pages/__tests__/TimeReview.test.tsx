import React from "react";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
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

const renderPage = () => render(
  <MemoryRouter initialEntries={["/time/review"]}>
    <TimeReview />
  </MemoryRouter>,
);

describe("TimeReview", () => {
  beforeEach(() => {
    mockUseActiveOrganizationId.mockReturnValue("org-1");
    mockUseAuth.mockReturnValue({
      user: { id: "user-1", email: "reviewer@example.com" },
      loading: false,
      profileLoading: false,
    });
    mockUsePayrollApprovals.mockReturnValue({
      payrollReviewQueueQuery: {
        data: {
          state: "ok",
          selectedLocalDate: "2026-08-12",
          capabilities: {
            canReviewAssigned: true,
            canApproveAssigned: true,
            canViewCompensation: false,
            hasOrgPayrollAccess: false,
          },
          queue: [{
            employeeLabel: "Employee 1001",
            employmentProfileId: "99999999-9999-4999-8999-999999999999",
            payPeriodId: "88888888-8888-4888-8888-888888888888",
            periodStart: "2026-08-10",
            periodEnd: "2026-08-16",
            state: "submitted",
            blockerCount: 1,
            submittedAt: "2026-08-12T18:00:00.000Z",
            snapshot: {
              id: "11111111-1111-1111-1111-111111111111",
              hash: "a".repeat(64),
            },
            classifiedSeconds: { regular: 14400, overtime: 0, doubleTime: 0 },
          }],
        },
        isLoading: false,
        isError: false,
      },
      payrollReviewDetailsQuery: {
        data: {
          state: "ok",
          snapshotId: "11111111-1111-1111-1111-111111111111",
          snapshotHash: "a".repeat(64),
          periodStart: "2026-08-10",
          periodEnd: "2026-08-16",
          punches: [],
          classifiedSeconds: { regular: 14400, overtime: 0, doubleTime: 0 },
          approvalHistory: [],
          blockers: [],
          unresolvedBlockerCount: 1,
        },
        isError: false,
      },
      approvePayrollTimesheetMutation: {
        mutateAsync: vi.fn(),
      },
      returnPayrollTimesheetMutation: {
        mutateAsync: vi.fn(),
      },
    });
  });

  it("renders the authoritative review queue and immutable details", () => {
    renderPage();

    expect(screen.getByText(/time review/i)).toBeInTheDocument();
    expect(screen.getByText(/employee 1001/i)).toBeInTheDocument();
    expect(screen.getByText(/immutable snapshot details/i)).toBeInTheDocument();
    expect(screen.getByText(/no blocker details are available for this reviewer/i)).toBeInTheDocument();
  });

  it("requires a non-empty return comment before enabling return", async () => {
    renderPage();

    const returnButton = screen.getByRole("button", { name: /return/i });
    expect(returnButton).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText(/return comment/i), "Needs correction.");
    expect(returnButton).not.toBeDisabled();
  });
});
