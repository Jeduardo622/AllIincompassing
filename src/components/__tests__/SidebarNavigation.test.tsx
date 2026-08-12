import React from "react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sidebar } from "../Sidebar";

const mockUseAuth = vi.fn();
const mockUseTheme = vi.fn();
const mockPreloadRouteModule = vi.fn();
const mockFetchMessageThreads = vi.fn();
const mockFetchPendingSupervisionSessionNoteCount = vi.fn();
const mockUsePayrollDayReadOnly = vi.fn();
const mockUsePayrollApprovals = vi.fn();
const mockUsePayrollAdministration = vi.fn();

const capabilityForRole = (role: string) => (capability: string) => {
  const matrix: Record<string, string[]> = {
    viewSchedule: ["bt", "therapist", "midtier", "admin_schedule", "admin", "bcba", "super_admin"],
    dataTaking: ["bt", "therapist", "midtier"],
    viewMessages: ["bt", "therapist", "midtier", "admin_schedule", "admin", "bcba", "super_admin"],
    staffDashboard: ["admin_schedule", "admin", "bcba", "super_admin"],
  };
  return matrix[capability]?.includes(role) ?? false;
};

vi.mock("../../lib/authContext", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("../../lib/theme", () => ({
  useTheme: () => mockUseTheme(),
}));

vi.mock("../../lib/routeModulePrefetch", () => ({
  preloadRouteModule: (...args: unknown[]) => mockPreloadRouteModule(...args),
}));

vi.mock("../../lib/organization", () => ({
  useActiveOrganizationId: () => "org-1",
}));

vi.mock("../../features/payroll/usePayrollTime", () => ({
  usePayrollDayReadOnly: (...args: unknown[]) => mockUsePayrollDayReadOnly(...args),
}));
vi.mock("../../features/payroll/usePayrollApprovals", () => ({
  usePayrollApprovals: (...args: unknown[]) => mockUsePayrollApprovals(...args),
}));
vi.mock("../../features/payroll/usePayrollAdministration", () => ({
  usePayrollAdministration: (...args: unknown[]) => mockUsePayrollAdministration(...args),
}));

vi.mock("../../lib/messages/fetchers", () => ({
  fetchMessageThreads: (...args: unknown[]) => mockFetchMessageThreads(...args),
}));

vi.mock("../../lib/supervision-session-notes", () => ({
  SUPERVISION_SESSION_NOTES_QUERY_KEY: "supervision-session-note-requests",
  fetchPendingSupervisionSessionNoteCount: (...args: unknown[]) =>
    mockFetchPendingSupervisionSessionNoteCount(...args),
}));

vi.mock("../ChatBot", () => ({
  ChatBot: ({ isOpen }: { isOpen?: boolean }) =>
    isOpen ? <div data-testid="chatbot-mock" /> : null,
}));

vi.mock("../ThemeToggle", () => ({
  ThemeToggle: () => <div data-testid="theme-toggle-mock" />,
}));

describe("Sidebar navigation active styling", () => {
  const renderSidebar = (initialEntries: string[] = ["/"]) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={initialEntries}>
          <Sidebar />
        </MemoryRouter>
      </QueryClientProvider>
    );
  };

  beforeEach(() => {
    mockUseAuth.mockReset();
    mockUseTheme.mockReset();
    mockPreloadRouteModule.mockReset();
    mockFetchMessageThreads.mockReset();
    mockFetchPendingSupervisionSessionNoteCount.mockReset();
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
        id: "user-1",
        role: "therapist",
      },
      isGuardian: false,
      hasAnyRole: vi.fn(() => true),
      effectiveRole: "therapist",
      hasCapability: vi.fn(capabilityForRole("therapist")),
      hasAnyCapability: vi.fn((capabilities: string[]) => capabilities.some(capabilityForRole("therapist"))),
    });

    mockUseTheme.mockReturnValue({
      isDark: false,
      toggleTheme: vi.fn(),
    });
    mockFetchMessageThreads.mockResolvedValue({
      threads: [],
      schemaUnavailable: false,
      unreadThreadCount: 0,
    });
    mockFetchPendingSupervisionSessionNoteCount.mockResolvedValue(0);
    mockUsePayrollDayReadOnly.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
    });
    mockUsePayrollApprovals.mockReturnValue({
      payrollReviewQueueQuery: {
        data: undefined,
        isLoading: false,
        isError: false,
      },
    });
    mockUsePayrollAdministration.mockReturnValue({
      administrationQuery: {
        data: undefined,
        isLoading: false,
        isError: false,
      },
      reviewQueueQuery: {
        data: undefined,
      },
      reviewDetailsQuery: {
        data: undefined,
      },
      administrationActionMutation: { mutateAsync: vi.fn(), isPending: false, error: null },
      lockPayrollTimesheetMutation: { mutateAsync: vi.fn(), isPending: false, error: null },
      reopenPayrollTimesheetMutation: { mutateAsync: vi.fn(), isPending: false, error: null },
    });
  });

  it("keeps the clients link icon highlighted for nested routes", () => {
    renderSidebar(["/clients/123"]);

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
        id: "user-1",
        role: "therapist",
      },
      isGuardian: false,
      hasAnyRole: vi.fn((roles: ("client" | "therapist" | "admin" | "super_admin")[]) =>
        roles.some(role => hasRole(role))
      ),
      effectiveRole: "therapist",
      hasCapability: vi.fn(capabilityForRole("therapist")),
      hasAnyCapability: vi.fn((capabilities: string[]) => capabilities.some(capabilityForRole("therapist"))),
    });

    renderSidebar(["/schedule"]);

    expect(screen.queryByRole("link", { name: /authorizations/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /documentation/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /fill docs/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /schedule/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /messages/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /clients/i })).toBeInTheDocument();
  });

  it("hides the dashboard link for admin_schedule while preserving schedule access", () => {
    const hasRole = vi.fn((role: string) => role === "admin_schedule");

    mockUseAuth.mockReturnValue({
      signOut: vi.fn(),
      hasRole,
      user: {
        email: "admin-schedule@example.com",
        user_metadata: {},
      },
      profile: {
        id: "admin-schedule-user-1",
        role: "admin_schedule",
      },
      isGuardian: false,
      hasAnyRole: vi.fn((roles: string[]) => roles.some(role => hasRole(role))),
      effectiveRole: "admin_schedule",
      hasCapability: vi.fn(capabilityForRole("admin_schedule")),
      hasAnyCapability: vi.fn((capabilities: string[]) => capabilities.some(capabilityForRole("admin_schedule"))),
    });

    renderSidebar(["/schedule"]);

    expect(screen.queryByRole("link", { name: /^dashboard$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /schedule/i })).toBeInTheDocument();
    expect(mockFetchPendingSupervisionSessionNoteCount).not.toHaveBeenCalled();
  });

  it("shows schedule and client links for canonical BT users", () => {
    const hasRole = vi.fn((role: string) => role === "bt");

    mockUseAuth.mockReturnValue({
      signOut: vi.fn(),
      hasRole,
      user: {
        email: "bt@example.com",
        user_metadata: {
          therapist_id: "therapist-123",
        },
      },
      profile: {
        id: "user-1",
        role: "bt",
      },
      isGuardian: false,
      hasAnyRole: vi.fn((roles: string[]) => roles.some(role => hasRole(role))),
      effectiveRole: "bt",
      hasCapability: vi.fn(capabilityForRole("bt")),
      hasAnyCapability: vi.fn((capabilities: string[]) => capabilities.some(capabilityForRole("bt"))),
    });

    renderSidebar(["/schedule"]);

    expect(screen.getByRole("link", { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /schedule/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /clients/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /messages/i })).toBeInTheDocument();
    expect(screen.getByText("Behavioral Therapist Account")).toBeInTheDocument();
  });

  it("hides the dashboard link for legacy therapist users", () => {
    const legacyTherapist = mockUseAuth();
    mockUseAuth.mockReturnValue({
      ...legacyTherapist,
      effectiveRole: "bt",
      hasCapability: vi.fn(capabilityForRole("bt")),
      hasAnyCapability: vi.fn((capabilities: string[]) => capabilities.some(capabilityForRole("bt"))),
    });

    renderSidebar(["/"]);

    expect(screen.queryByRole("link", { name: /dashboard/i })).not.toBeInTheDocument();
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
        id: "user-1",
        role: "super_admin",
      },
      isGuardian: false,
      hasAnyRole: vi.fn((roles: ("client" | "therapist" | "admin" | "super_admin")[]) =>
        roles.some(role => hasRole(role))
      ),
      effectiveRole: "super_admin",
      hasCapability: vi.fn(capabilityForRole("super_admin")),
      hasAnyCapability: vi.fn((capabilities: string[]) => capabilities.some(capabilityForRole("super_admin"))),
    });

    renderSidebar(["/"]);

    expect(screen.getByRole("link", { name: /bts/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /billing/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /reports/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /monitoring/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /settings/i })).toBeInTheDocument();
  });

  it("hides monitoring and settings for BCBA while preserving My Account", () => {
    mockUseAuth.mockReturnValue({
      signOut: vi.fn(),
      hasRole: vi.fn((role: string) => role === "bcba"),
      user: {
        email: "bcba@example.com",
        user_metadata: {},
      },
      profile: {
        id: "user-1",
        role: "bcba",
      },
      isGuardian: false,
      hasAnyRole: vi.fn(() => true),
      effectiveRole: "bcba",
      hasCapability: vi.fn(capabilityForRole("bcba")),
      hasAnyCapability: vi.fn((capabilities: string[]) => capabilities.some(capabilityForRole("bcba"))),
    });

    renderSidebar(["/clients"]);

    expect(screen.queryByRole("link", { name: /monitoring/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /settings/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /my account/i })).toBeInTheDocument();
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
        id: "user-1",
        role: "client",
      },
      isGuardian: true,
      hasAnyRole: vi.fn((roles: ("client" | "therapist" | "admin" | "super_admin")[]) =>
        roles.some(role => hasRole(role))
      ),
      effectiveRole: "client",
      hasCapability: vi.fn(capabilityForRole("client")),
      hasAnyCapability: vi.fn((capabilities: string[]) => capabilities.some(capabilityForRole("client"))),
    });

    renderSidebar(["/"]);

    expect(screen.queryByRole("button", { name: /chat assistant/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("chatbot-mock")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /messages/i })).not.toBeInTheDocument();
  });

  it("lazily loads the chat assistant only when opened", async () => {
    renderSidebar(["/"]);

    expect(screen.getByRole("button", { name: /chat assistant/i })).toBeInTheDocument();
    expect(screen.queryByTestId("chatbot-mock")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /chat assistant/i }));
    expect(await screen.findByTestId("chatbot-mock")).toBeInTheDocument();
  });

  it("prefetches a route module on hover intent without preloading on initial render", async () => {
    renderSidebar(["/"]);

    expect(mockPreloadRouteModule).not.toHaveBeenCalled();

    await userEvent.hover(screen.getByRole("link", { name: /schedule/i }));

    expect(mockPreloadRouteModule).toHaveBeenCalledTimes(1);
    expect(mockPreloadRouteModule).toHaveBeenCalledWith("/schedule");
  });

  it("prefetches a route module on keyboard focus intent", async () => {
    renderSidebar(["/"]);

    fireEvent.focus(screen.getByRole("link", { name: /schedule/i }));

    expect(mockPreloadRouteModule).toHaveBeenCalledWith("/schedule");
  });

  it("prefetches messages route module on hover intent", async () => {
    renderSidebar(["/"]);

    await userEvent.hover(screen.getByRole("link", { name: /messages/i }));

    expect(mockPreloadRouteModule).toHaveBeenCalledWith("/messages");
  });

  it("shows the Time navigation only when protected payroll bootstrap view capability resolves true", () => {
    mockUsePayrollDayReadOnly.mockReturnValue({
      data: {
        state: "ok",
        bootstrap: {
          capabilities: {
            canViewSelf: true,
          },
        },
      },
      isLoading: false,
      isError: false,
    });

    renderSidebar(["/"]);

    expect(screen.getByRole("link", { name: /^time$/i })).toBeInTheDocument();
  });

  it("shows the Time Review navigation only when the authoritative review queue grants review capability", () => {
    mockUsePayrollApprovals.mockReturnValue({
      payrollReviewQueueQuery: {
        data: {
          state: "ok",
          capabilities: {
            canReviewAssigned: true,
            canApproveAssigned: false,
            canViewCompensation: false,
            hasOrgPayrollAccess: false,
          },
          queue: [],
        },
        isLoading: false,
        isError: false,
      },
    });

    renderSidebar(["/"]);

    expect(screen.getByRole("link", { name: /time review/i })).toBeInTheDocument();
  });

  it("shows the Payroll navigation only when the authoritative administration capability view grants access", () => {
    mockUseAuth.mockReturnValue({
      signOut: vi.fn(),
      hasRole: vi.fn((role: string) => role === "admin"),
      user: {
        id: "admin-1",
        email: "admin@example.com",
        user_metadata: {},
      },
      profile: {
        id: "admin-1",
        role: "admin",
      },
      isGuardian: false,
      hasAnyRole: vi.fn(() => true),
      effectiveRole: "admin",
      hasCapability: vi.fn(capabilityForRole("admin")),
      hasAnyCapability: vi.fn((capabilities: string[]) => capabilities.some(capabilityForRole("admin"))),
    });
    mockUsePayrollAdministration.mockReturnValue({
      administrationQuery: {
        data: {
          state: "ok",
          capabilities: {
            canConfigureEmployment: true,
            canResolveExceptions: false,
            canLockPeriod: false,
            canReopenPeriod: false,
            canGeneratePeriods: false,
            canViewCompensation: false,
            canManagePolicyMutations: false,
          },
        },
        isLoading: false,
        isError: false,
      },
      reviewQueueQuery: { data: undefined },
      reviewDetailsQuery: { data: undefined },
      administrationActionMutation: { mutateAsync: vi.fn(), isPending: false, error: null },
      lockPayrollTimesheetMutation: { mutateAsync: vi.fn(), isPending: false, error: null },
      reopenPayrollTimesheetMutation: { mutateAsync: vi.fn(), isPending: false, error: null },
    });

    renderSidebar(["/"]);

    expect(screen.getByRole("link", { name: /^payroll$/i })).toBeInTheDocument();
  });

  it("keeps Payroll hidden when the static admin role lacks authoritative payroll administration capabilities", () => {
    mockUseAuth.mockReturnValue({
      signOut: vi.fn(),
      hasRole: vi.fn((role: string) => role === "admin"),
      user: {
        id: "admin-1",
        email: "admin@example.com",
        user_metadata: {},
      },
      profile: {
        id: "admin-1",
        role: "admin",
      },
      isGuardian: false,
      hasAnyRole: vi.fn(() => true),
      effectiveRole: "admin",
      hasCapability: vi.fn(capabilityForRole("admin")),
      hasAnyCapability: vi.fn((capabilities: string[]) => capabilities.some(capabilityForRole("admin"))),
    });
    mockUsePayrollAdministration.mockReturnValue({
      administrationQuery: {
        data: {
          state: "ok",
          capabilities: {
            canConfigureEmployment: false,
            canResolveExceptions: false,
            canLockPeriod: false,
            canReopenPeriod: false,
            canGeneratePeriods: false,
            canViewCompensation: false,
            canManagePolicyMutations: false,
          },
        },
        isLoading: false,
        isError: false,
      },
      reviewQueueQuery: { data: undefined },
      reviewDetailsQuery: { data: undefined },
      administrationActionMutation: { mutateAsync: vi.fn(), isPending: false, error: null },
      lockPayrollTimesheetMutation: { mutateAsync: vi.fn(), isPending: false, error: null },
      reopenPayrollTimesheetMutation: { mutateAsync: vi.fn(), isPending: false, error: null },
    });

    renderSidebar(["/"]);

    expect(screen.queryByRole("link", { name: /^payroll$/i })).not.toBeInTheDocument();
  });

  it("keeps the Time navigation hidden during loading, transport errors, and non-ok payroll states", () => {
    const { rerender } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/"]}>
          <Sidebar />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.queryByRole("link", { name: /^time$/i })).not.toBeInTheDocument();

    mockUsePayrollDayReadOnly.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });
    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/"]}>
          <Sidebar />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.queryByRole("link", { name: /^time$/i })).not.toBeInTheDocument();

    mockUsePayrollDayReadOnly.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });
    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/"]}>
          <Sidebar />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.queryByRole("link", { name: /^time$/i })).not.toBeInTheDocument();

    mockUsePayrollDayReadOnly.mockReturnValue({
      data: {
        state: "feature_disabled",
        bootstrap: {
          capabilities: {
            canViewSelf: false,
          },
        },
      },
      isLoading: false,
      isError: false,
    });
    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/"]}>
          <Sidebar />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.queryByRole("link", { name: /^time$/i })).not.toBeInTheDocument();
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
        id: "user-1",
        role: "client",
      },
      isGuardian: false,
      hasAnyRole: vi.fn((roles: ("client" | "therapist" | "admin" | "super_admin")[]) =>
        roles.some(role => hasRole(role))
      ),
      effectiveRole: "client",
      hasCapability: vi.fn(capabilityForRole("client")),
      hasAnyCapability: vi.fn((capabilities: string[]) => capabilities.some(capabilityForRole("client"))),
    });

    renderSidebar(["/"]);

    expect(screen.queryByRole("link", { name: /family/i })).not.toBeInTheDocument();
  });

  it("keeps mobile sidebar sections scrollable so footer actions stay reachable", () => {
    const { container } = renderSidebar(["/"]);

    const sidebar = container.querySelector("#app-sidebar");
    expect(sidebar).not.toBeNull();
    expect(sidebar).toHaveClass("overflow-y-auto");

    const nav = sidebar?.querySelector("nav");
    expect(nav).not.toBeNull();
    expect(nav).toHaveClass("min-h-0");
    expect(nav).toHaveClass("overflow-y-auto");
  });

  it("shows an unread badge on the messages nav item when unread threads exist", async () => {
    mockFetchMessageThreads.mockResolvedValueOnce({
      threads: [],
      schemaUnavailable: false,
      unreadThreadCount: 3,
    });

    renderSidebar(["/"]);

    expect(await screen.findByTestId("sidebar-messages-unread-badge")).toHaveTextContent("3");
  });

  it("shows pending supervision notes on the dashboard nav item for admins", async () => {
    const hasRole = vi.fn(
      (role: "client" | "therapist" | "admin" | "super_admin") => role === "admin"
    );
    mockUseAuth.mockReturnValue({
      signOut: vi.fn(),
      hasRole,
      user: {
        email: "admin@example.com",
        user_metadata: {},
      },
      profile: {
        id: "admin-user-1",
        role: "admin",
      },
      isGuardian: false,
      hasAnyRole: vi.fn((roles: ("client" | "therapist" | "admin" | "super_admin")[]) =>
        roles.some(role => hasRole(role))
      ),
      effectiveRole: "admin",
      hasCapability: vi.fn(capabilityForRole("admin")),
      hasAnyCapability: vi.fn((capabilities: string[]) => capabilities.some(capabilityForRole("admin"))),
    });
    mockFetchPendingSupervisionSessionNoteCount.mockResolvedValueOnce(4);

    renderSidebar(["/clients"]);

    expect(await screen.findByTestId("sidebar-supervision-notes-badge")).toHaveTextContent("4");
    expect(mockFetchPendingSupervisionSessionNoteCount).toHaveBeenCalledWith("org-1");
  });

  it("does not query dashboard action notifications for therapists without staff capability expansion", () => {
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
        id: "therapist-user-1",
        role: "therapist",
      },
      isGuardian: false,
      hasAnyRole: vi.fn((roles: ("client" | "therapist" | "admin" | "super_admin")[]) =>
        roles.some(role => hasRole(role))
      ),
      effectiveRole: "therapist",
      hasCapability: vi.fn(capabilityForRole("therapist")),
      hasAnyCapability: vi.fn((capabilities: string[]) => capabilities.some(capabilityForRole("therapist"))),
    });
    renderSidebar(["/schedule"]);

    expect(mockFetchPendingSupervisionSessionNoteCount).not.toHaveBeenCalled();
    expect(screen.queryByTestId("sidebar-supervision-notes-badge")).not.toBeInTheDocument();
    expect(mockUseAuth.mock.results.at(-1)?.value.hasCapability("staffDashboard")).toBe(false);
  });

  it("does not reuse dashboard action badge state across same-org actor switch with the same query client", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mockFetchPendingSupervisionSessionNoteCount
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(0);

    mockUseAuth.mockReturnValue({
      signOut: vi.fn(),
      hasRole: vi.fn((role: string) => role === "bt"),
      user: {
        id: "bt-user-1",
        email: "bt1@example.com",
        user_metadata: {
          therapist_id: "therapist-123",
        },
      },
      profile: {
        id: "profile-bt-1",
        role: "bt",
      },
      isGuardian: false,
      hasAnyRole: vi.fn(() => true),
      effectiveRole: "bt",
      hasCapability: vi.fn(capabilityForRole("bt")),
      hasAnyCapability: vi.fn((capabilities: string[]) => capabilities.some(capabilityForRole("bt"))),
    });

    const view = render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/"]}>
          <Sidebar />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(await screen.findByTestId("sidebar-supervision-notes-badge")).toHaveTextContent("3");

    mockUseAuth.mockReturnValue({
      signOut: vi.fn(),
      hasRole: vi.fn((role: string) => role === "bt"),
      user: {
        id: "bt-user-2",
        email: "bt2@example.com",
        user_metadata: {
          therapist_id: "therapist-456",
        },
      },
      profile: {
        id: "profile-bt-2",
        role: "bt",
      },
      isGuardian: false,
      hasAnyRole: vi.fn(() => true),
      effectiveRole: "bt",
      hasCapability: vi.fn(capabilityForRole("bt")),
      hasAnyCapability: vi.fn((capabilities: string[]) => capabilities.some(capabilityForRole("bt"))),
    });

    view.rerender(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/"]}>
          <Sidebar />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await screen.findByText("bt2@example.com");
    await waitFor(() => {
      expect(screen.queryByTestId("sidebar-supervision-notes-badge")).not.toBeInTheDocument();
    });
  });
});
