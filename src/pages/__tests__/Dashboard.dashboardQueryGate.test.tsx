import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import {
  BT_ABA_BEHAVIOR_STRATEGY_OPTIONS,
  BT_ABA_PURPOSE_OPTIONS,
  BT_ABA_SKILL_STRATEGY_OPTIONS,
  BT_ABA_SUPERVISOR_SUPPORT_OPTIONS,
} from "../../lib/bt-aba-session-note";

let capturedDashboardEnabled: boolean | undefined;
let capturedActorScope:
  | { userId?: string | null; effectiveRole?: string | null; organizationId?: string | null }
  | undefined;
let capturedDashboardOptions:
  | { enabled?: boolean; actorScope?: { userId?: string | null; effectiveRole?: string | null; organizationId?: string | null } }
  | undefined;
let capturedQueryConfigs: Array<Record<string, unknown>> = [];

const mockFetchPendingSupervisionSessionNoteRequests = vi.hoisted(() => vi.fn());
const mockReconcilePendingSupervisionSessionNoteRequests = vi.hoisted(() => vi.fn());
const mockFetchBtSupervisionCorrectionTasks = vi.hoisted(() => vi.fn());
const mockReturnSupervisionRequestToBt = vi.hoisted(() => vi.fn());
const mockResubmitBtSupervisionCorrection = vi.hoisted(() => vi.fn());
const mockUseQuery = vi.hoisted(() => vi.fn());
const mockShowSuccess = vi.hoisted(() => vi.fn());
const mockShowError = vi.hoisted(() => vi.fn());

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
    fetchBtSupervisionCorrectionTasks: mockFetchBtSupervisionCorrectionTasks,
    returnSupervisionRequestToBt: mockReturnSupervisionRequestToBt,
    resubmitBtSupervisionCorrection: mockResubmitBtSupervisionCorrection,
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
      capturedDashboardOptions = options;
      return {
        data: null,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
        refreshConfig: { isLiveRole: false, intervalMs: 120_000 },
      };
    },
  };
});

vi.mock("../../lib/toast", () => ({
  showSuccess: (...args: unknown[]) => mockShowSuccess(...args),
  showError: (...args: unknown[]) => mockShowError(...args),
}));

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
  const view = render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <Dashboard />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { ...view, client };
};

describe("Dashboard staff dashboard query gate", () => {
  const validBtResponses = {
    purpose_of_session: [BT_ABA_PURPOSE_OPTIONS[0]],
    client_status: "Client was engaged throughout the session.",
    skill_strategies: [BT_ABA_SKILL_STRATEGY_OPTIONS[0]],
    behavior_strategies: [BT_ABA_BEHAVIOR_STRATEGY_OPTIONS[0]],
    supervisor_support: [BT_ABA_SUPERVISOR_SUPPORT_OPTIONS[0]],
    progress_toward_goals: "The client made observable progress toward the active goals.",
    client_response_to_treatment: "The client responded well to prompts and reinforcement.",
    data_point_scope: "linked",
  };

  beforeEach(() => {
    capturedDashboardEnabled = undefined;
    capturedActorScope = undefined;
    capturedDashboardOptions = undefined;
    capturedQueryConfigs = [];
    mockFetchPendingSupervisionSessionNoteRequests.mockReset();
    mockFetchPendingSupervisionSessionNoteRequests.mockResolvedValue({ requests: [], template: null });
    mockReconcilePendingSupervisionSessionNoteRequests.mockReset();
    mockReconcilePendingSupervisionSessionNoteRequests.mockResolvedValue(undefined);
    mockFetchBtSupervisionCorrectionTasks.mockReset();
    mockFetchBtSupervisionCorrectionTasks.mockResolvedValue([]);
    mockReturnSupervisionRequestToBt.mockReset();
    mockReturnSupervisionRequestToBt.mockResolvedValue({ correctionId: "correction-1" });
    mockResubmitBtSupervisionCorrection.mockReset();
    mockResubmitBtSupervisionCorrection.mockResolvedValue({ amendmentId: "amendment-1" });
    mockShowSuccess.mockReset();
    mockShowError.mockReset();
    mockUseQuery.mockReset();
    mockUseQuery.mockImplementation((config: Record<string, unknown>) => {
      capturedQueryConfigs.push(config);
      const serializedKey = JSON.stringify(config.queryKey);

      if (serializedKey === JSON.stringify(["supervision-session-note-requests", "org-9"])) {
        return {
          data: { requests: [], template: null },
          isLoading: false,
          error: null,
          isSuccess: false,
        };
      }

      if (serializedKey === JSON.stringify(["supervision-session-note-requests", "bt-correction-tasks", "org-9"])) {
        return {
          data: [],
          isLoading: false,
          error: null,
          isSuccess: false,
        };
      }

      return {
        data: null,
        isLoading: false,
        error: null,
        isSuccess: false,
      };
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

  it("does not enable the BT correction task query for legacy therapist access", () => {
    mockUseAuth.mockReturnValue(
      authStub({
        user: { id: "user-7" },
        profile: { id: "profile-7", organization_id: "org-9", role: "therapist" },
        effectiveRole: "therapist",
        session: { access_token: "valid-token" } as import("@supabase/supabase-js").Session,
        loading: false,
        hasCapability: vi.fn((capability: string) => capability === "viewSchedule"),
      }),
    );

    renderDashboard();

    const correctionTasksQuery = capturedQueryConfigs.find((config) =>
      JSON.stringify(config.queryKey) === JSON.stringify(["supervision-session-note-requests", "bt-correction-tasks", "org-9", "user-7", "profile-7", "other"]),
    );

    expect(capturedDashboardOptions?.enabled).toBe(false);
    expect(correctionTasksQuery).toEqual(expect.objectContaining({ enabled: false }));
  });

  it("renders the admin-only fallback for therapist users", async () => {
    mockUseAuth.mockReturnValue(
      authStub({
        user: { id: "user-7" },
        profile: { id: "profile-7", organization_id: "org-9", role: "therapist" },
        effectiveRole: "therapist",
        session: { access_token: "valid-token" } as import("@supabase/supabase-js").Session,
        loading: false,
      }),
    );

    renderDashboard();

    expect(await screen.findByText("This dashboard is reserved for admin roles.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /go to schedule/i })).toBeInTheDocument();
    expect(screen.queryByText("Corrections Required")).not.toBeInTheDocument();
  });

  it("enables only the BT correction task query for exact BT dashboard access", () => {
    mockUseAuth.mockReturnValue(
      authStub({
        user: { id: "user-7" },
        profile: { id: "profile-7", organization_id: "org-9", role: "bt" },
        effectiveRole: "bt",
        session: { access_token: "valid-token" } as import("@supabase/supabase-js").Session,
        loading: false,
        hasCapability: vi.fn((capability: string) => capability === "viewSchedule"),
      }),
    );

    renderDashboard();

    const correctionTasksQuery = capturedQueryConfigs.find((config) =>
      JSON.stringify(config.queryKey) === JSON.stringify(["supervision-session-note-requests", "bt-correction-tasks", "org-9", "user-7", "profile-7", "bt"]),
    );
    const listQuery = capturedQueryConfigs.find((config) =>
      JSON.stringify(config.queryKey) === JSON.stringify(["supervision-session-note-requests", "org-9", "user-7", "profile-7", "bt"]),
    );
    const reconcileQuery = capturedQueryConfigs.find((config) =>
      JSON.stringify(config.queryKey) === JSON.stringify(["supervision-session-note-requests", "reconcile", "org-9", "user-7", "profile-7", "bt"]),
    );

    expect(capturedDashboardOptions?.enabled).toBe(false);
    expect(correctionTasksQuery).toEqual(expect.objectContaining({ enabled: true, refetchInterval: 30_000 }));
    expect(listQuery).toEqual(expect.objectContaining({ enabled: false }));
    expect(reconcileQuery).toEqual(expect.objectContaining({ enabled: false }));
  });

  it("uses actor-scoped cache keys for BT correction tasks and staff supervision queues", () => {
    mockUseAuth.mockReturnValue(
      authStub({
        user: { id: "bt-user-7" },
        profile: { id: "profile-7", organization_id: "org-9", role: "bt" },
        effectiveRole: "bt",
        session: { access_token: "valid-token" } as import("@supabase/supabase-js").Session,
        loading: false,
      }),
    );

    renderDashboard();

    expect(capturedQueryConfigs).toContainEqual(expect.objectContaining({
      queryKey: ["supervision-session-note-requests", "bt-correction-tasks", "org-9", "bt-user-7", "profile-7", "bt"],
    }));

    capturedQueryConfigs = [];

    mockUseAuth.mockReturnValue(
      authStub({
        user: { id: "bcba-user-7" },
        profile: { id: "profile-8", organization_id: "org-9" },
        effectiveRole: "bcba",
        session: { access_token: "valid-token" } as import("@supabase/supabase-js").Session,
        loading: false,
      }),
    );

    renderDashboard();

    expect(capturedQueryConfigs).toContainEqual(expect.objectContaining({
      queryKey: ["supervision-session-note-requests", "org-9", "bcba-user-7", "profile-8", "staff"],
    }));
    expect(capturedQueryConfigs).toContainEqual(expect.objectContaining({
      queryKey: ["supervision-session-note-requests", "reconcile", "org-9", "bcba-user-7", "profile-8", "staff"],
    }));
  });

  it("enables the BCBA review queue from stable profile scope while auth snapshots lag", () => {
    mockUseAuth.mockReturnValue(
      authStub({
        user: null,
        profile: { id: "profile-8", organization_id: "org-9", role: "bcba" },
        effectiveRole: "bcba",
        session: null,
        loading: true,
      }),
    );

    renderDashboard();

    const listQuery = capturedQueryConfigs.find((config) =>
      JSON.stringify(config.queryKey) === JSON.stringify(["supervision-session-note-requests", "org-9", "NO_USER", "profile-8", "staff"]),
    );
    const reconcileQuery = capturedQueryConfigs.find((config) =>
      JSON.stringify(config.queryKey) === JSON.stringify(["supervision-session-note-requests", "reconcile", "org-9", "NO_USER", "profile-8", "staff"]),
    );

    expect(listQuery).toEqual(expect.objectContaining({ enabled: true }));
    expect(reconcileQuery).toEqual(expect.objectContaining({ enabled: true }));
  });

  it("enables the BCBA review queue from active organization metadata before profile hydration", () => {
    mockUseAuth.mockReturnValue(
      authStub({
        user: { id: "bcba-user-7", user_metadata: { organization_id: "org-9" } },
        profile: null,
        effectiveRole: "bcba",
        session: { access_token: "valid-token" } as import("@supabase/supabase-js").Session,
        loading: true,
      }),
    );

    renderDashboard();

    const listQuery = capturedQueryConfigs.find((config) =>
      JSON.stringify(config.queryKey) === JSON.stringify(["supervision-session-note-requests", "org-9", "bcba-user-7", "NO_PROFILE", "staff"]),
    );
    const reconcileQuery = capturedQueryConfigs.find((config) =>
      JSON.stringify(config.queryKey) === JSON.stringify(["supervision-session-note-requests", "reconcile", "org-9", "bcba-user-7", "NO_PROFILE", "staff"]),
    );

    expect(listQuery).toEqual(expect.objectContaining({ enabled: true }));
    expect(reconcileQuery).toEqual(expect.objectContaining({ enabled: true }));
  });

  it("enables exact-BT correction tasks from stable profile scope while auth snapshots lag", () => {
    mockUseAuth.mockReturnValue(
      authStub({
        user: null,
        profile: { id: "profile-7", organization_id: "org-9", role: "bt" },
        effectiveRole: "bt",
        session: null,
        loading: true,
      }),
    );

    renderDashboard();

    const correctionTasksQuery = capturedQueryConfigs.find((config) =>
      JSON.stringify(config.queryKey) === JSON.stringify(["supervision-session-note-requests", "bt-correction-tasks", "org-9", "NO_USER", "profile-7", "bt"]),
    );

    expect(correctionTasksQuery).toEqual(expect.objectContaining({ enabled: true }));
  });

  it("enables exact-BT correction tasks from authoritative role and active organization metadata before profile hydration", () => {
    mockUseAuth.mockReturnValue(
      authStub({
        user: { id: "bt-user-7", user_metadata: { organization_id: "org-9" } },
        profile: null,
        effectiveRole: "bt",
        session: { access_token: "valid-token" } as import("@supabase/supabase-js").Session,
        loading: false,
      }),
    );

    renderDashboard();

    const correctionTasksQuery = capturedQueryConfigs.find((config) =>
      JSON.stringify(config.queryKey) === JSON.stringify(["supervision-session-note-requests", "bt-correction-tasks", "org-9", "bt-user-7", "NO_PROFILE", "bt"]),
    );

    expect(correctionTasksQuery).toEqual(expect.objectContaining({ enabled: true }));
  });

  it("renders a correction-only empty state for BT users without staff dashboard content", async () => {
    mockUseAuth.mockReturnValue(
      authStub({
        user: { id: "user-7" },
        profile: { id: "profile-7", organization_id: "org-9", role: "bt" },
        effectiveRole: "bt",
        session: { access_token: "valid-token" } as import("@supabase/supabase-js").Session,
        loading: false,
      }),
    );

    renderDashboard();

    expect(await screen.findByText("Corrections Required")).toBeInTheDocument();
    expect(screen.getByText("No correction tasks are waiting right now.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /go to schedule/i })).toBeInTheDocument();
    expect(screen.queryByText("Active Clients")).not.toBeInTheDocument();
    expect(screen.queryByText("Supervision Notes Due")).not.toBeInTheDocument();
  });

  it("does not reuse BT correction task cache across same-org actor switch with the same query client", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    mockUseQuery.mockImplementation((config: Record<string, unknown>) => {
      const serializedKey = JSON.stringify(config.queryKey);
      if (serializedKey === JSON.stringify(["supervision-session-note-requests", "bt-correction-tasks", "org-9", "bt-user-1", "profile-bt", "bt"])) {
        return {
          data: [{
            id: "request-1",
            organizationId: "org-9",
            sessionId: "session-1",
            clientId: "client-1",
            btTherapistId: "bt-1",
            assignedAdminUserId: "bcba-1",
            status: "correction_required",
            statusLabel: "Correction Required",
            createdAt: "2026-07-18T10:00:00Z",
            clientName: "Taylor Client",
            btTherapistName: "Jordan BT",
            btTherapistTitle: "BT",
            correction: {
              id: "correction-1",
              round: 1,
              reason: "Clarify the client response and re-sign.",
              requestedAt: "2026-07-18T11:00:00Z",
              reviewerUserId: "bcba-1",
            },
            originalVersion: {
              versionNumber: 1,
              noteId: "note-1",
              source: "original",
              correctionRound: null,
              responses: validBtResponses,
              templateSnapshot: { sections: [] },
              signatureMethod: "typed",
              signatureValue: "Jordan BT",
              signedAt: "2026-07-18T09:15:00Z",
            },
            latestVersion: {
              versionNumber: 1,
              noteId: "note-1",
              source: "original",
              correctionRound: null,
              responses: validBtResponses,
              templateSnapshot: { sections: [] },
              signatureMethod: "typed",
              signatureValue: "Jordan BT",
              signedAt: "2026-07-18T09:15:00Z",
            },
            versions: [],
          }],
          isLoading: false,
          error: null,
          isSuccess: true,
          refetch: vi.fn(),
        };
      }

      if (serializedKey === JSON.stringify(["supervision-session-note-requests", "bt-correction-tasks", "org-9", "bt-user-2", "profile-bt-2", "bt"])) {
        return {
          data: [],
          isLoading: false,
          error: null,
          isSuccess: true,
          refetch: vi.fn(),
        };
      }

      return {
        data: null,
        isLoading: false,
        error: null,
        isSuccess: false,
        refetch: vi.fn(),
      };
    });

    mockUseAuth.mockReturnValue(
      authStub({
        user: { id: "bt-user-1" },
        profile: { id: "profile-bt", organization_id: "org-9", role: "bt" },
        effectiveRole: "bt",
        session: { access_token: "valid-token" } as import("@supabase/supabase-js").Session,
        loading: false,
      }),
    );

    const view = render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <Dashboard />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Taylor Client")).toBeInTheDocument();

    mockUseAuth.mockReturnValue(
      authStub({
        user: { id: "bt-user-2" },
        profile: { id: "profile-bt-2", organization_id: "org-9", role: "bt" },
        effectiveRole: "bt",
        session: { access_token: "valid-token" } as import("@supabase/supabase-js").Session,
        loading: false,
      }),
    );

    view.rerender(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <Dashboard />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("No correction tasks are waiting right now.")).toBeInTheDocument();
    });
    expect(screen.queryByText("Taylor Client")).not.toBeInTheDocument();
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
        profile: { id: "profile-7", organization_id: "org-9" },
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
        profile: { id: "profile-7", organization_id: "org-9" },
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
      JSON.stringify(config.queryKey) === JSON.stringify(["supervision-session-note-requests", "org-9", "user-7", "profile-7", "staff"]),
    );
    const reconcileQuery = queryConfigs.find((config) =>
      JSON.stringify(config.queryKey) === JSON.stringify(["supervision-session-note-requests", "reconcile", "org-9", "user-7", "profile-7", "staff"]),
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

  it("returns a supervision request to BT and invalidates only supervision workflow keys", async () => {
    const request = {
      id: "request-1",
      organizationId: "org-9",
      sessionId: "session-1",
      clientId: "client-1",
      btTherapistId: "bt-1",
      assignedAdminUserId: "bcba-1",
      status: "pending",
      statusLabel: "Pending Review",
      createdAt: "2026-07-18T10:00:00Z",
      sessionStartTime: "2026-07-18T09:00:00Z",
      sessionEndTime: "2026-07-18T10:00:00Z",
      placeOfService: "Clinic",
      clientName: "Taylor Client",
      btTherapistName: "Jordan BT",
      btTherapistTitle: "BT",
      canComplete: true,
      canReturn: true,
      latestVersionNumber: 1,
      correction: null,
      versions: [],
      btReview: {
        noteId: "note-1",
        responses: {},
        templateSnapshot: { sections: [] },
        signatureMethod: "typed",
        signedAt: "2026-07-18T09:30:00Z",
      },
    };

    mockUseQuery.mockImplementation((config: Record<string, unknown>) => {
      capturedQueryConfigs.push(config);
      const serializedKey = JSON.stringify(config.queryKey);
      if (serializedKey === JSON.stringify(["supervision-session-note-requests", "org-9", "bcba-1", "profile-bcba", "staff"])) {
        return {
          data: { requests: [request], template: null },
          isLoading: false,
          error: null,
          isSuccess: true,
        };
      }
      return {
        data: null,
        isLoading: false,
        error: null,
        isSuccess: false,
      };
    });
    mockUseAuth.mockReturnValue(
      authStub({
        user: { id: "bcba-1" },
        profile: { id: "profile-bcba", organization_id: "org-9" },
        effectiveRole: "bcba",
        session: { access_token: "valid-token" } as import("@supabase/supabase-js").Session,
        loading: false,
      }),
    );

    const { client } = renderDashboard();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    await userEvent.click(await screen.findByRole("button", { name: /complete supervision note for taylor client/i }));
    await userEvent.type(screen.getByLabelText(/correction reason/i), "Please update the client status narrative.");
    await userEvent.click(screen.getByRole("button", { name: /return to bt/i }));

    await waitFor(() => {
      expect(mockReturnSupervisionRequestToBt).toHaveBeenCalledWith({
        organizationId: "org-9",
        requestId: "request-1",
        reason: "Please update the client status narrative.",
      });
    });

    expect(mockShowSuccess).toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["supervision-session-note-requests"] });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["supervision-session-note-requests", "pending-count", "org-9", "bcba-1", "profile-bcba", "staff"],
    });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ["dashboard"] });
  });

  it("shows a BT correction resubmission error without broad dashboard invalidation", async () => {
    const task = {
      id: "request-1",
      organizationId: "org-9",
      sessionId: "session-1",
      clientId: "client-1",
      btTherapistId: "bt-1",
      assignedAdminUserId: "bcba-1",
      status: "correction_required",
      statusLabel: "Correction Required",
      createdAt: "2026-07-18T10:00:00Z",
      clientName: "Taylor Client",
      btTherapistName: "Jordan BT",
      btTherapistTitle: "BT",
      correction: {
        id: "correction-1",
        round: 1,
        reason: "Clarify the client response and re-sign.",
        requestedAt: "2026-07-18T11:00:00Z",
        reviewerUserId: "bcba-1",
      },
      originalVersion: {
        versionNumber: 1,
        noteId: "note-1",
        source: "original",
        correctionRound: null,
        responses: {
          ...validBtResponses,
          supervisor_support: [BT_ABA_SUPERVISOR_SUPPORT_OPTIONS[4]],
        },
        templateSnapshot: { sections: [] },
        signatureMethod: "typed",
        signatureValue: "Jordan BT",
        signedAt: "2026-07-18T09:15:00Z",
      },
      latestVersion: {
        versionNumber: 1,
        noteId: "note-1",
        source: "original",
        correctionRound: null,
        responses: {
          ...validBtResponses,
          supervisor_support: [BT_ABA_SUPERVISOR_SUPPORT_OPTIONS[4]],
        },
        templateSnapshot: { sections: [] },
        signatureMethod: "typed",
        signatureValue: "Jordan BT",
        signedAt: "2026-07-18T09:15:00Z",
      },
      versions: [],
    };

    mockUseQuery.mockImplementation((config: Record<string, unknown>) => {
      capturedQueryConfigs.push(config);
      const serializedKey = JSON.stringify(config.queryKey);
      if (serializedKey === JSON.stringify(["supervision-session-note-requests", "bt-correction-tasks", "org-9", "bt-1", "profile-bt", "bt"])) {
        return {
          data: [task],
          isLoading: false,
          error: null,
          isSuccess: true,
        };
      }
      return {
        data: null,
        isLoading: false,
        error: null,
        isSuccess: false,
      };
    });
    mockResubmitBtSupervisionCorrection.mockRejectedValueOnce(new Error("Correction resubmission failed."));
    mockUseAuth.mockReturnValue(
      authStub({
        user: { id: "bt-1" },
        profile: { id: "profile-bt", organization_id: "org-9", role: "bt" },
        effectiveRole: "bt",
        session: { access_token: "valid-token" } as import("@supabase/supabase-js").Session,
        loading: false,
      }),
    );

    const { client } = renderDashboard();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    await userEvent.click(await screen.findByRole("button", { name: /amend bt note for taylor client/i }));
    const domainSupportOption = screen.getByLabelText("Discussed domains/progress/data collection");
    expect(domainSupportOption).toBeVisible();
    expect(domainSupportOption.closest('label')).toHaveClass('min-h-11');
    expect(screen.queryByLabelText("Discussed programs/progress/data collection")).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveClass('min-h-11');
    await userEvent.click(screen.getByRole("radio", { name: /type signature/i }));
    await userEvent.type(screen.getByLabelText(/type behavior technician signature/i), "Jordan BT");
    await userEvent.click(screen.getByRole("button", { name: /re-attest and resubmit/i }));

    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith("Correction resubmission failed.");
    });
    expect(mockResubmitBtSupervisionCorrection).toHaveBeenCalledWith(expect.objectContaining({
      responses: expect.objectContaining({
        supervisor_support: ['Discussed programs/progress/data collection'],
      }),
    }));
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ["dashboard"] });
  });

  it("invalidates the completed session note after a successful BT correction resubmission", async () => {
    const task = {
      id: "request-1",
      organizationId: "org-9",
      sessionId: "session-1",
      clientId: "client-1",
      btTherapistId: "bt-1",
      assignedAdminUserId: "bcba-1",
      status: "correction_required",
      statusLabel: "Correction Required",
      createdAt: "2026-07-18T10:00:00Z",
      clientName: "Taylor Client",
      btTherapistName: "Jordan BT",
      btTherapistTitle: "BT",
      correction: {
        id: "correction-1",
        round: 1,
        reason: "Clarify the client response and re-sign.",
        requestedAt: "2026-07-18T11:00:00Z",
        reviewerUserId: "bcba-1",
      },
      originalVersion: {
        versionNumber: 1,
        noteId: "note-1",
        source: "original",
        correctionRound: null,
        responses: validBtResponses,
        templateSnapshot: { sections: [] },
        signatureMethod: "typed",
        signatureValue: "Jordan BT",
        signedAt: "2026-07-18T09:15:00Z",
      },
      latestVersion: {
        versionNumber: 1,
        noteId: "note-1",
        source: "original",
        correctionRound: null,
        responses: validBtResponses,
        templateSnapshot: { sections: [] },
        signatureMethod: "typed",
        signatureValue: "Jordan BT",
        signedAt: "2026-07-18T09:15:00Z",
      },
      versions: [],
    };

    mockUseQuery.mockImplementation((config: Record<string, unknown>) => {
      const serializedKey = JSON.stringify(config.queryKey);
      if (serializedKey === JSON.stringify(["supervision-session-note-requests", "bt-correction-tasks", "org-9", "bt-1", "profile-bt", "bt"])) {
        return { data: [task], isLoading: false, error: null, isSuccess: true };
      }
      return { data: null, isLoading: false, error: null, isSuccess: false };
    });
    mockUseAuth.mockReturnValue(
      authStub({
        user: { id: "bt-1" },
        profile: { id: "profile-bt", organization_id: "org-9", role: "bt" },
        effectiveRole: "bt",
        session: { access_token: "valid-token" } as import("@supabase/supabase-js").Session,
        loading: false,
      }),
    );

    const { client } = renderDashboard();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    await userEvent.click(await screen.findByRole("button", { name: /amend bt note for taylor client/i }));
    await userEvent.click(screen.getByRole("radio", { name: /type signature/i }));
    await userEvent.type(screen.getByLabelText(/type behavior technician signature/i), "Jordan BT");
    await userEvent.click(screen.getByRole("button", { name: /re-attest and resubmit/i }));

    await waitFor(() => {
      expect(mockShowSuccess).toHaveBeenCalledWith("BT correction resubmitted.");
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["bt-aba-session-note", "session-1"] });
  });
});
