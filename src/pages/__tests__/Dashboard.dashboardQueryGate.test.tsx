import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

let capturedDashboardEnabled: boolean | undefined;
let capturedActorScope:
  | { userId?: string | null; effectiveRole?: string | null; organizationId?: string | null }
  | undefined;

const mockFetchPendingSupervisionSessionNoteRequests = vi.hoisted(() => vi.fn());
const mockReconcilePendingSupervisionSessionNoteRequests = vi.hoisted(() => vi.fn());
const mockUseQuery = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: mockUseQuery,
  };
});

vi.mock("../../lib/supervision-session-notes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/supervision-session-notes")>();
  return {
    ...actual,
    fetchPendingSupervisionSessionNoteRequests: mockFetchPendingSupervisionSessionNoteRequests,
    reconcilePendingSupervisionSessionNoteRequests: mockReconcilePendingSupervisionSessionNoteRequests,
  };
});

vi.mock("../../lib/optimizedQueries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/optimizedQueries")>();
  return {
    ...actual,
    useDashboardData: (options?: {
      enabled?: boolean;
      actorScope?: { userId?: string | null; effectiveRole?: string | null; organizationId?: string | null };
    }) => {
      capturedDashboardEnabled = options?.enabled;
      capturedActorScope = options?.actorScope;
      return actual.useDashboardData(options);
    },
  };
});

const mockUseAuth = vi.fn();
vi.mock("../../lib/authContext", () => ({
  useAuth: () => mockUseAuth(),
}));

import { Dashboard } from "../Dashboard";

const authStub = (partial: Record<string, unknown>) =>
  ({
    user: null,
    profile: null,
    metadataRole: null,
    effectiveRole: "client",
    roleMismatch: false,
    isGuardian: false,
    authFlow: "normal" as const,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    resetPassword: vi.fn(),
    updateProfile: vi.fn(),
    hasRole: vi.fn(() => false),
    hasAnyRole: vi.fn(() => false),
    isAdmin: vi.fn(() => false),
    isSuperAdmin: vi.fn(() => false),
    ...partial,
  }) as ReturnType<typeof import("../../lib/authContext").useAuth>;

const renderDashboard = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <Dashboard />
      </QueryClientProvider>
    </MemoryRouter>,
  );
};

describe("Dashboard staff dashboard query gate", () => {
  beforeEach(() => {
    capturedDashboardEnabled = undefined;
    capturedActorScope = undefined;
    mockFetchPendingSupervisionSessionNoteRequests.mockReset();
    mockFetchPendingSupervisionSessionNoteRequests.mockResolvedValue({ requests: [], template: null });
    mockReconcilePendingSupervisionSessionNoteRequests.mockReset();
    mockReconcilePendingSupervisionSessionNoteRequests.mockResolvedValue(undefined);
    mockUseQuery.mockReset();
    mockUseQuery.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseAuth.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("disables useDashboardData until auth loading completes and a bearer exists", () => {
    mockUseAuth.mockReturnValue(
      authStub({
        effectiveRole: "admin",
        session: { access_token: "t" } as import("@supabase/supabase-js").Session,
        loading: true,
        isAdmin: () => true,
        isSuperAdmin: () => false,
      }),
    );

    renderDashboard();
    expect(capturedDashboardEnabled).toBe(false);
  });

  it("disables useDashboardData for therapist even with a bearer (staff dashboard only)", () => {
    mockUseAuth.mockReturnValue(
      authStub({
        effectiveRole: "therapist",
        session: { access_token: "valid-token" } as import("@supabase/supabase-js").Session,
        loading: false,
        isAdmin: () => false,
        isSuperAdmin: () => false,
      }),
    );

    renderDashboard();
    expect(capturedDashboardEnabled).toBe(false);
  });

  it("disables useDashboardData for admin without access token", () => {
    mockUseAuth.mockReturnValue(
      authStub({
        effectiveRole: "admin",
        session: null,
        loading: false,
        isAdmin: () => true,
        isSuperAdmin: () => false,
      }),
    );

    renderDashboard();
    expect(capturedDashboardEnabled).toBe(false);
  });

  it("passes actor-scoped dashboard cache context for admin users", () => {
    mockUseAuth.mockReturnValue(
      authStub({
        user: { id: "user-7" },
        profile: { organization_id: "org-9" },
        effectiveRole: "admin",
        session: { access_token: "valid-token" } as import("@supabase/supabase-js").Session,
        loading: false,
        isAdmin: () => true,
        isSuperAdmin: () => false,
      }),
    );

    renderDashboard();

    expect(capturedActorScope).toEqual({
      userId: "user-7",
      effectiveRole: "admin",
      organizationId: "org-9",
    });
  });

  it("polls only read-only supervision note requests on the notification cadence", () => {
    mockUseAuth.mockReturnValue(
      authStub({
        user: { id: "user-7" },
        profile: { organization_id: "org-9" },
        effectiveRole: "admin",
        session: { access_token: "valid-token" } as import("@supabase/supabase-js").Session,
        loading: false,
        isAdmin: () => true,
        isSuperAdmin: () => false,
      }),
    );

    renderDashboard();

    const queryConfigs = mockUseQuery.mock.calls.map(([config]) => config);
    const listQuery = queryConfigs.find((config) =>
      JSON.stringify(config.queryKey) === JSON.stringify(["supervision-session-note-requests", "org-9"]),
    );
    const reconcileQuery = queryConfigs.find((config) =>
      JSON.stringify(config.queryKey) === JSON.stringify(["supervision-session-note-requests", "reconcile", "org-9"]),
    );

    expect(listQuery).toEqual(expect.objectContaining({
      refetchInterval: 30_000,
      staleTime: 30_000,
    }));
    expect(reconcileQuery).toEqual(expect.objectContaining({
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    }));
    expect(reconcileQuery).not.toHaveProperty("refetchInterval");
  });
});
