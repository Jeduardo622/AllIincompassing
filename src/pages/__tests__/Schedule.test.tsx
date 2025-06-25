import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen, userEvent } from "../../test/utils";
import Schedule from "../Schedule";
import { server } from "../../test/setup";
import { http, HttpResponse } from "msw";

describe("Schedule", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });
  it("renders schedule page with calendar", async () => {
    renderWithProviders(<Schedule />);

    // Check for main elements
    expect(await screen.findByText(/Schedule/i)).toBeInTheDocument();
    expect(await screen.findByText(/Auto Schedule/i)).toBeInTheDocument();
  });

  it("displays sessions from API", async () => {
    // Mock session data
    server.use(
      http.get("*/rest/v1/sessions*", () => {
        return HttpResponse.json([
          {
            id: "test-session-1",
            client: { full_name: "Test Client" },
            therapist: { full_name: "Test Therapist" },
            start_time: "2025-03-18T10:00:00Z",
            end_time: "2025-03-18T11:00:00Z",
            status: "scheduled",
          },
        ]);
      }),
    );

    renderWithProviders(<Schedule />);

    // Wait for session data to load
    expect(await screen.findByText("Test Client")).toBeInTheDocument();
    expect(screen.getByText("Test Therapist")).toBeInTheDocument();
  });

  it("allows switching between views", async () => {
    renderWithProviders(<Schedule />);

    // Test view switches
    const dayButton = screen.getByRole("button", { name: /Day/i });
    const weekButton = screen.getByRole("button", { name: /Week/i });
    const matrixButton = screen.getByRole("button", { name: /Matrix/i });

    await userEvent.click(dayButton);
    await userEvent.click(weekButton);
    await userEvent.click(matrixButton);

    expect(screen.getByRole("button", { name: /Matrix/i })).toHaveClass(
      "bg-blue-600",
    );
  });

  it("handles session filtering", async () => {
    renderWithProviders(<Schedule />);

    // Wait for data to load
    await screen.findByText("Test Client");

    // Find and interact with filters
    const therapistFilter = await screen.findByLabelText(/Therapist/i);
    const clientFilter = await screen.findByLabelText(/Client/i);

    await userEvent.selectOptions(therapistFilter, [""]);
    await userEvent.selectOptions(clientFilter, [""]);

    expect(screen.getByText("Test Client")).toBeInTheDocument();
  });
});
