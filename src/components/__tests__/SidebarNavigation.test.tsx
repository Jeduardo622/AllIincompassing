import React from "react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import Sidebar from "../Sidebar";

const mockUseAuth = vi.fn();
const mockUseTheme = vi.fn();

vi.mock("../../lib/authContext", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("../../lib/theme", () => ({
  useTheme: () => mockUseTheme(),
}));

vi.mock("../ChatBot", () => ({
  __esModule: true,
  default: () => <div data-testid="chatbot-mock" />,
}));

vi.mock("../ThemeToggle", () => ({
  __esModule: true,
  default: () => <div data-testid="theme-toggle-mock" />,
}));

describe("Sidebar navigation active styling", () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
    mockUseTheme.mockReset();
    mockUseAuth.mockReturnValue({
      signOut: vi.fn(),
      hasRole: vi.fn(() => true),
      user: {
        email: "therapist@example.com",
        user_metadata: {
          therapist_id: "therapist-123",
        },
      },
      profile: {
        role: "therapist",
      },
      hasAnyRole: vi.fn(() => true),
    });

    mockUseTheme.mockReturnValue({
      isDark: false,
      toggleTheme: vi.fn(),
    });
  });

  it("keeps the clients link icon highlighted for nested routes", () => {
    render(
      <MemoryRouter initialEntries={["/clients/123"]}>
        <Sidebar />
      </MemoryRouter>
    );

    const clientsLink = screen.getByRole("link", { name: /clients/i });
    expect(clientsLink).toHaveClass("border-blue-500");
    expect(clientsLink).toHaveClass("text-blue-600");

    const icon = clientsLink.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon).toHaveClass("text-blue-500");
    expect(icon).toHaveClass("dark:text-blue-400");
  });
});
