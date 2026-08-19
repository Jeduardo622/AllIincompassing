import { describe, expect, it, vi } from "vitest";

import type { PreviewConfig } from "../../src/preview/config";

import {
  assessRouteDocumentState,
  ensureAuditPreviewReady,
  resolveExpectedSettledPath,
  type RouteDefinition,
  type RouteDocumentSnapshot,
} from "../../scripts/route-audit";

const previewConfig: PreviewConfig = {
  host: "127.0.0.1",
  port: 4173,
  protocol: "http",
  outDir: "dist",
  url: "http://127.0.0.1:4173",
};

const dashboardRoute: RouteDefinition = {
  path: "/",
  component: "Dashboard",
  roles: ["client", "bt", "therapist", "midtier", "admin_schedule", "admin", "bcba", "super_admin"],
  permissions: [],
  expectedPathByRole: {
    client: "/documentation",
    therapist: "/schedule",
    midtier: "/schedule",
    admin_schedule: "/schedule",
  },
};

const snapshot = (overrides: Partial<RouteDocumentSnapshot> = {}): RouteDocumentSnapshot => ({
  bodyText: "Schedule page loaded",
  errorBoundaryText: "",
  hasErrorBoundary: false,
  hasRouteContentContainer: true,
  mainText: "Today schedule",
  routeContentText: "Today schedule",
  settledPath: "/schedule",
  title: "Allincompassing",
  ...overrides,
});

describe("route audit preview preparation", () => {
  it("builds current preview output before serving the audit target", async () => {
    const buildPreviewArtifacts = vi.fn().mockResolvedValue(undefined);
    const ensureBuildArtifactsExist = vi.fn();
    const ensureSupabaseEnv = vi.fn();
    const startPreviewServer = vi.fn().mockResolvedValue({ close: vi.fn() });

    await ensureAuditPreviewReady(previewConfig, {
      buildPreviewArtifacts,
      ensureBuildArtifactsExist,
      ensureSupabaseEnv,
      startPreviewServer,
    });

    expect(buildPreviewArtifacts).toHaveBeenCalledOnce();
    expect(ensureBuildArtifactsExist).toHaveBeenCalledWith(previewConfig);
    expect(ensureSupabaseEnv).toHaveBeenCalledWith(previewConfig);
    expect(startPreviewServer).toHaveBeenCalledWith(previewConfig);
    expect(buildPreviewArtifacts.mock.invocationCallOrder[0]).toBeLessThan(ensureBuildArtifactsExist.mock.invocationCallOrder[0]);
  });
});

describe("route audit settled-path expectations", () => {
  it("routes admin_schedule dashboard landings to /schedule", () => {
    expect(resolveExpectedSettledPath(dashboardRoute, "admin_schedule")).toBe("/schedule");
  });

  it("keeps explicit public routes on their requested settled path", () => {
    expect(resolveExpectedSettledPath({
      path: "/accept-invite",
      component: "AcceptInvite",
      roles: ["public"],
      permissions: [],
    }, null)).toBe("/accept-invite");
  });

  it("keeps protected unknown routes on the requested path for the not-found state", () => {
    expect(resolveExpectedSettledPath({
      path: "/*",
      auditPath: "/route-audit-not-found",
      expectedPath: "/route-audit-not-found",
      component: "NotFound",
      roles: ["admin"],
      permissions: [],
    }, "admin")).toBe("/route-audit-not-found");
  });
});

describe("route audit document-state classification", () => {
  it("fails closed when the settled path does not match the expected route identity", () => {
    const result = assessRouteDocumentState(snapshot({ settledPath: "/" }), "/schedule");

    expect(result.status).toBe("error");
    expect(result.errors).toContain("Settled path mismatch: expected /schedule but reached /");
  });

  it("rejects sibling and child paths instead of accepting prefix matches", () => {
    const result = assessRouteDocumentState(snapshot({ settledPath: "/clients/new" }), "/clients");

    expect(result.status).toBe("error");
    expect(result.errors).toContain("Settled path mismatch: expected /clients but reached /clients/new");
  });

  it("fails closed when an error boundary rendered", () => {
    const result = assessRouteDocumentState(snapshot({
      hasErrorBoundary: true,
      errorBoundaryText: "Runtime exploded",
    }), "/schedule");

    expect(result.status).toBe("error");
    expect(result.errors).toContain("Error boundary rendered: Runtime exploded");
  });

  it("fails blank documents even when no explicit error boundary is present", () => {
    const result = assessRouteDocumentState(snapshot({
      bodyText: " ",
      hasRouteContentContainer: false,
      mainText: " ",
      routeContentText: " ",
      title: "Schedule | AllIncompassing",
    }), "/schedule");

    expect(result.status).toBe("error");
    expect(result.errors).toContain("Route rendered without meaningful main or body content");
  });

  it("fails protected routes when the shell renders without outlet content", () => {
    const result = assessRouteDocumentState(snapshot({
      bodyText: "Logged in as admin@example.test Role: admin",
      mainText: "Logged in as admin@example.test Role: admin",
      routeContentText: " ",
    }), "/schedule");

    expect(result.status).toBe("error");
    expect(result.errors).toContain("Protected route rendered without meaningful outlet content");
  });
});
