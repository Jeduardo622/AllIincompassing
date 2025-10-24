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

  it("shows admin navigation items for super admin users", () => {
    const hasRole = vi.fn(
      (role: "client" | "therapist" | "admin" | "super_admin") =>
        ["client", "therapist", "admin", "super_admin"].includes(role)
    );

    mockUseAuth.mockReturnValue({
      signOut: vi.fn(),
      hasRole,
      user: {
        email: "superadmin@example.com",
        user_metadata: {},
      },
      profile: {
        role: "super_admin",
      },
      hasAnyRole: vi.fn((roles: ("client" | "therapist" | "admin" | "super_admin")[]) =>
        roles.some(role => hasRole(role))
      ),
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Sidebar />
      </MemoryRouter>
    );

    expect(screen.getByRole("link", { name: /therapists/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /billing/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /reports/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /monitoring/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /settings/i })).toBeInTheDocument();
  });

  it("hides the chat assistant for guardian users", () => {
    const hasRole = vi.fn(
      (role: "client" | "therapist" | "admin" | "super_admin") => role === "client"
    );

    mockUseAuth.mockReturnValue({
      signOut: vi.fn(),
      hasRole,
      user: {
        email: "guardian@example.com",
        user_metadata: {},
      },
      profile: {
        role: "client",
      },
      hasAnyRole: vi.fn((roles: ("client" | "therapist" | "admin" | "super_admin")[]) =>
        roles.some(role => hasRole(role))
      ),
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Sidebar />
      </MemoryRouter>
    );

    expect(screen.queryByRole("button", { name: /chat assistant/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("chatbot-mock")).not.toBeInTheDocument();
  });

  it("shows the chat assistant for therapist users", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Sidebar />
      </MemoryRouter>
    );

    expect(screen.getByRole("button", { name: /chat assistant/i })).toBeInTheDocument();
    expect(screen.getByTestId("chatbot-mock")).toBeInTheDocument();
  });
});
