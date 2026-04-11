import React from "react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sidebar } from "../Sidebar";

const mockUseAuth = vi.fn();
const mockUseTheme = vi.fn();

vi.mock("../../lib/authContext", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("../../lib/theme", () => ({
  useTheme: () => mockUseTheme(),
}));

vi.mock("../ChatBot", () => ({
  ChatBot: ({ isOpen }: { isOpen?: boolean }) =>
    isOpen ? <div data-testid="chatbot-mock" /> : null,
}));

vi.mock("../ThemeToggle", () => ({
  ThemeToggle: () => <div data-testid="theme-toggle-mock" />,
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
      isGuardian: false,
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

  it("hides therapist-inapplicable docs and authorization links", () => {
    const hasRole = vi.fn(
      (role: "client" | "therapist" | "admin" | "super_admin") => role === "therapist"
    );

    mockUseAuth.mockReturnValue({
      signOut: vi.fn(),
      hasRole,
      user: {
        email: "therapist@example.com",
        user_metadata: {
          therapist_id: "therapist-123",
        },
      },
      profile: {
        role: "therapist",
      },
      isGuardian: false,
      hasAnyRole: vi.fn((roles: ("client" | "therapist" | "admin" | "super_admin")[]) =>
        roles.some(role => hasRole(role))
      ),
    });

    render(
      <MemoryRouter initialEntries={["/schedule"]}>
        <Sidebar />
      </MemoryRouter>
    );

    expect(screen.queryByRole("link", { name: /authorizations/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /documentation/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /fill docs/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /schedule/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /clients/i })).toBeInTheDocument();
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
      isGuardian: false,
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
      isGuardian: true,
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

  it("lazily loads the chat assistant only when opened", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Sidebar />
      </MemoryRouter>
    );

    expect(screen.getByRole("button", { name: /chat assistant/i })).toBeInTheDocument();
    expect(screen.queryByTestId("chatbot-mock")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /chat assistant/i }));
    expect(await screen.findByTestId("chatbot-mock")).toBeInTheDocument();
  });

  it("hides family navigation for non-guardian clients", () => {
    const hasRole = vi.fn(
      (role: "client" | "therapist" | "admin" | "super_admin") => role === "client"
    );

    mockUseAuth.mockReturnValue({
      signOut: vi.fn(),
      hasRole,
      user: {
        email: "client@example.com",
        user_metadata: {},
      },
      profile: {
        role: "client",
      },
      isGuardian: false,
      hasAnyRole: vi.fn((roles: ("client" | "therapist" | "admin" | "super_admin")[]) =>
        roles.some(role => hasRole(role))
      ),
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Sidebar />
      </MemoryRouter>
    );

    expect(screen.queryByRole("link", { name: /family/i })).not.toBeInTheDocument();
  });

  it("keeps mobile sidebar sections scrollable so footer actions stay reachable", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/"]}>
        <Sidebar />
      </MemoryRouter>
    );

    const sidebar = container.querySelector("#app-sidebar");
    expect(sidebar).not.toBeNull();
    expect(sidebar).toHaveClass("overflow-y-auto");

    const nav = sidebar?.querySelector("nav");
    expect(nav).not.toBeNull();
    expect(nav).toHaveClass("min-h-0");
    expect(nav).toHaveClass("overflow-y-auto");
  });
});
