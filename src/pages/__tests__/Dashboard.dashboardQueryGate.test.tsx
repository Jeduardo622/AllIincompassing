import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

let capturedDashboardEnabled: boolean | undefined;

vi.mock("../../lib/optimizedQueries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/optimizedQueries")>();
  return {
    ...actual,
    useDashboardData: (options?: { enabled?: boolean }) => {
      capturedDashboardEnabled = options?.enabled;
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
    mockUseAuth.mockReset();
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
});
