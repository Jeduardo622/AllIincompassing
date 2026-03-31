import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders, screen } from "../../test/utils";
import { Schedule } from "../Schedule";
import {
  useScheduleDataBatch,
  useSessionsOptimized,
  useDropdownData,
} from "../../lib/optimizedQueries";

// Control org context per test without depending on runtime-config resolution
const mockUseActiveOrganizationId = vi.fn<[], string | null>();

vi.mock("../../lib/organization", () => ({
  useActiveOrganizationId: () => mockUseActiveOrganizationId(),
}));

vi.mock("../../lib/optimizedQueries", () => ({
  useScheduleDataBatch: vi.fn(() => ({ data: null, isLoading: false })),
  useSessionsOptimized: vi.fn(() => ({ data: [], isLoading: false })),
  useDropdownData: vi.fn(() => ({ data: null, isLoading: false })),
}));

const batchMock = vi.mocked(useScheduleDataBatch);
const sessionsMock = vi.mocked(useSessionsOptimized);
const dropdownMock = vi.mocked(useDropdownData);

describe("Schedule org-context guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default return values after clearAllMocks
    batchMock.mockReturnValue({ data: null, isLoading: false } as ReturnType<typeof useScheduleDataBatch>);
    sessionsMock.mockReturnValue({ data: [], isLoading: false } as ReturnType<typeof useSessionsOptimized>);
    dropdownMock.mockReturnValue({ data: null, isLoading: false } as ReturnType<typeof useDropdownData>);
  });

  describe("when activeOrganizationId is null", () => {
    beforeEach(() => {
      mockUseActiveOrganizationId.mockReturnValue(null);
    });

    it("renders the missing-org state", () => {
      renderWithProviders(<Schedule />);
      expect(screen.getByTestId("schedule-missing-org")).toBeInTheDocument();
      expect(
        screen.getByText(/Organization context unavailable/i),
      ).toBeInTheDocument();
    });

    it("does not render the normal schedule heading", () => {
      renderWithProviders(<Schedule />);
      expect(
        screen.queryByRole("heading", { name: /^Schedule$/i }),
      ).not.toBeInTheDocument();
    });

    it("passes enabled: false to useScheduleDataBatch", () => {
      renderWithProviders(<Schedule />);
      expect(batchMock).toHaveBeenCalledWith(
        expect.any(Date),
        expect.any(Date),
        { enabled: false },
      );
    });

    it("passes enabled: false to useDropdownData", () => {
      renderWithProviders(<Schedule />);
      expect(dropdownMock).toHaveBeenCalledWith({ enabled: false });
    });

    it("passes enabled: false to useSessionsOptimized via enableFallbackSessionsQuery", () => {
      renderWithProviders(<Schedule />);
      // The 5th positional argument is the `enabled` flag
      const calls = sessionsMock.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const enabledArg = calls[0][4];
      expect(enabledArg).toBe(false);
    });
  });

  describe("when activeOrganizationId is set", () => {
    beforeEach(() => {
      mockUseActiveOrganizationId.mockReturnValue("org-abc-123");
    });

    it("does not render the missing-org state", () => {
      renderWithProviders(<Schedule />);
      expect(screen.queryByTestId("schedule-missing-org")).not.toBeInTheDocument();
    });

    it("renders the normal schedule heading", async () => {
      renderWithProviders(<Schedule />);
      expect(
        await screen.findByRole("heading", { name: /^Schedule$/i }),
      ).toBeInTheDocument();
    });

    it("passes enabled: true to useScheduleDataBatch", () => {
      renderWithProviders(<Schedule />);
      expect(batchMock).toHaveBeenCalledWith(
        expect.any(Date),
        expect.any(Date),
        { enabled: true },
      );
    });

    it("passes enabled: true to useDropdownData", () => {
      renderWithProviders(<Schedule />);
      expect(dropdownMock).toHaveBeenCalledWith({ enabled: true });
    });
  });
});
