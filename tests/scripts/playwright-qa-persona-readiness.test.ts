/** @vitest-environment node */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertApprovedBaseUrl,
  buildManifestEntry,
  classifyProtectedRequest,
  DEFAULT_PLAYWRIGHT_BASE_URL,
  isRenderedRouteReady,
  PERSONA_READINESS_TIMEOUT_MS,
  QA_PERSONA_READINESS_MANIFEST_ENV,
  QA_PERSONA_ROUTE_ASSERTIONS,
  resolvePlaywrightBaseUrl,
  resolveSupabaseAuthOrigin,
  sanitizeSettledPath,
  sanitizeTitle,
  syntheticReadResponseFor,
} from "../../scripts/playwright-qa-persona-readiness";

describe("playwright QA persona readiness safeguards", () => {
  it("covers the canonical landing contract and a denied route for all eight roles", () => {
    expect(QA_PERSONA_ROUTE_ASSERTIONS).toEqual([
      { role: "bt", allowedRoute: "/account", deniedRoute: "/payroll" },
      { role: "therapist", allowedRoute: "/schedule", deniedRoute: "/monitoring" },
      { role: "bcba", allowedRoute: "/account", deniedRoute: "/payroll" },
      { role: "midtier", allowedRoute: "/schedule", deniedRoute: "/payroll" },
      { role: "admin_schedule", allowedRoute: "/schedule", deniedRoute: "/payroll" },
      { role: "client", allowedRoute: "/documentation", deniedRoute: "/payroll" },
      { role: "admin", allowedRoute: "/account", deniedRoute: "/super-admin/feature-flags" },
      { role: "super_admin", allowedRoute: "/account", deniedRoute: "/family" },
    ]);
  });

  it("normalizes the base url from process.env only", () => {
    expect(resolvePlaywrightBaseUrl({})).toBe(DEFAULT_PLAYWRIGHT_BASE_URL);
    expect(resolvePlaywrightBaseUrl({ PW_BASE_URL: "https://app.allincompassing.ai/" })).toBe(
      "https://app.allincompassing.ai",
    );
    expect(() => assertApprovedBaseUrl("https://preview.example.test/")).toThrow(
      "PW_BASE_URL must be the approved production origin.",
    );
    expect(PERSONA_READINESS_TIMEOUT_MS).toBe(120_000);
    expect(resolveSupabaseAuthOrigin({ SUPABASE_URL: "https://project.supabase.co" })).toBe(
      "https://project.supabase.co",
    );
  });

  it("redacts unexpected paths and limits manifest fields to sanitized triage data", () => {
    expect(sanitizeSettledPath("/clients/private-id")).toBe("redacted");
    expect(sanitizeSettledPath("/UNAUTHORIZED/")).toBe("/unauthorized");
    expect(sanitizeTitle("  Schedule | AllIncompassing  ")).toBe("Schedule | AllIncompassing");
    expect(sanitizeTitle("Client Name | AllIncompassing")).toBe("");
    const entry = buildManifestEntry({
      role: "bt",
      route: "/account",
      settledPath: "/clients/private-id",
      title: "  My Account | AllIncompassing \n ",
      timingMs: 12.7,
      status: "failed",
      stage: "allowed_route",
    });
    expect(entry).toEqual({
      role: "bt",
      route: "/account",
      settledPath: "redacted",
      title: "My Account | AllIncompassing",
      timingMs: 13,
      status: "failed",
      stage: "allowed_route",
    });
    expect(Object.keys(entry).sort()).toEqual(
      ["role", "route", "settledPath", "status", "timingMs", "title", "stage"].sort(),
    );
  });

  it("blocks non-auth mutation requests during authenticated route checks", () => {
    const request = (method: string, url: string, action?: string) => ({
      method: () => method,
      url: () => url,
      postData: () => action ? JSON.stringify({ action }) : null,
    });
    const authOrigin = "https://project.supabase.co";
    const appOrigin = "https://app.allincompassing.ai";
    expect(classifyProtectedRequest(
      request("GET", "https://data.example/rest/v1/profiles"), authOrigin, appOrigin,
    )).toBe("block");
    expect(classifyProtectedRequest(
      request("GET", `${authOrigin}/rest/v1/profiles`), authOrigin, appOrigin,
    )).toBe("continue");
    expect(classifyProtectedRequest(
      request("GET", `${appOrigin}/assets/app.js`), authOrigin, appOrigin,
    )).toBe("continue");
    expect(classifyProtectedRequest(
      request("POST", `${authOrigin}/auth/v1/token`), authOrigin, appOrigin,
    )).toBe("continue");
    expect(classifyProtectedRequest(
      request("POST", `${authOrigin}/auth/v1/logout`), authOrigin, appOrigin,
    )).toBe("continue");
    expect(classifyProtectedRequest(
      request("POST", "https://data.example/auth/v1/token"), authOrigin, appOrigin,
    )).toBe("block");
    expect(classifyProtectedRequest(
      request("POST", `${authOrigin}/rest/v1/rpc/get_schedule_data_batch`), authOrigin, appOrigin,
    )).toBe("fulfill_synthetic_read");
    expect(classifyProtectedRequest(
      request("POST", `${authOrigin}/rest/v1/rpc/get_sessions_optimized`), authOrigin, appOrigin,
    )).toBe("fulfill_synthetic_read");
    expect(classifyProtectedRequest(
      request("POST", `${authOrigin}/rest/v1/rpc/get_dropdown_data`), authOrigin, appOrigin,
    )).toBe("fulfill_synthetic_read");
    expect(classifyProtectedRequest(
      request("POST", `${authOrigin}/rest/v1/rpc/get_supervision_session_note_action_count`),
      authOrigin,
      appOrigin,
    )).toBe("fulfill_synthetic_read");
    expect(classifyProtectedRequest(
      request("POST", `${authOrigin}/rest/v1/rpc/get_schedule_session_by_id`), authOrigin, appOrigin,
    )).toBe("block");
    expect(classifyProtectedRequest(
      request("PATCH", `${authOrigin}/rest/v1/profiles`), authOrigin, appOrigin,
    )).toBe("block");
    for (const [pathname, action] of [
      ["payroll-time-events", "get_day"],
      ["payroll-approvals", "review_queue"],
      ["payroll-administration", "get_administration"],
    ]) {
      expect(classifyProtectedRequest(
        request("POST", `${appOrigin}/api/${pathname}`, action), authOrigin, appOrigin,
      )).toBe("fulfill_synthetic_read");
    }
    expect(classifyProtectedRequest(
      request("POST", `${appOrigin}/api/payroll-time-events`, "record_employee_time_event"),
      authOrigin,
      appOrigin,
    )).toBe("block");
    expect(classifyProtectedRequest(
      request("POST", `${appOrigin}/api/payroll-approvals`, "manager_approve"),
      authOrigin,
      appOrigin,
    )).toBe("block");
    expect(classifyProtectedRequest(
      request("POST", `${appOrigin}/api/payroll-administration`, "configure_employment"),
      authOrigin,
      appOrigin,
    )).toBe("block");
    expect(syntheticReadResponseFor(`${appOrigin}/api/payroll-time-events`).body).toContain(
      '"state":"feature_disabled"',
    );
    expect(syntheticReadResponseFor(`${appOrigin}/api/payroll-approvals`).body).toContain('"queue":[]');
    expect(syntheticReadResponseFor(`${appOrigin}/api/payroll-administration`).status).toBe(503);
    expect(syntheticReadResponseFor(
      `${authOrigin}/rest/v1/rpc/get_supervision_session_note_action_count`,
    ).body).toBe("0");
    expect(JSON.parse(syntheticReadResponseFor(
      `${authOrigin}/rest/v1/rpc/get_schedule_data_batch`,
    ).body)).toEqual({ sessions: [], therapists: [], clients: [] });
    expect(JSON.parse(syntheticReadResponseFor(
      `${authOrigin}/rest/v1/rpc/get_dropdown_data`,
    ).body)).toEqual({ therapists: [], clients: [], locations: [] });
  });

  it("fails closed for pending, blank, and error-boundary route documents", () => {
    const rendered = {
      hasErrorBoundary: false,
      hasPendingGuard: false,
      hasRouteContentContainer: true,
      hasMeaningfulRouteContent: true,
      hasMeaningfulMain: true,
      hasMeaningfulBody: true,
    };

    expect(isRenderedRouteReady(rendered, true)).toBe(true);
    expect(isRenderedRouteReady({ ...rendered, hasPendingGuard: true }, true)).toBe(false);
    expect(isRenderedRouteReady({ ...rendered, hasErrorBoundary: true }, true)).toBe(false);
    expect(isRenderedRouteReady({ ...rendered, hasMeaningfulRouteContent: false }, true)).toBe(false);
    expect(isRenderedRouteReady({
      ...rendered,
      hasRouteContentContainer: false,
      hasMeaningfulRouteContent: false,
      hasMeaningfulMain: false,
      hasMeaningfulBody: false,
    }, false)).toBe(false);
  });

  it("uses process env only and blocks raw browser artifacts or raw error output", () => {
    const source = readFileSync(
      path.resolve(process.cwd(), "scripts/playwright-qa-persona-readiness.ts"),
      "utf8",
    );
    expect(source).not.toContain("loadPlaywrightEnv");
    expect(source).not.toMatch(/from ["']dotenv["']/);
    expect(source).not.toContain("captureFailureScreenshot");
    expect(source).not.toContain(".screenshot(");
    expect(source).not.toContain("storageState");
    expect(source).not.toContain("serializeError");
    expect(source).not.toContain("console.error(error)");
    expect(source).toContain('pathname.endsWith("/auth/v1/logout")');
    expect(source).toContain("await signOutAndAssertRevoked(page, baseUrl, config.allowedRoute)");
    expect(source).toContain("if (await hasSupabaseAuthToken(page))");
    expect(source).toContain("await withTimeout((async () =>");
    expect(source).toContain("writeManifest(buildManifest(results), env)");
    expect(source).toContain("await installApplicationMutationGuard(");
    expect(source).toContain("assertNoApplicationMutation()");
    expect(source).toContain('action === "fulfill_synthetic_read"');
    expect(source).toContain("syntheticReadResponseFor(route.request().url())");
    expect(source).toContain('browser.newContext({ serviceWorkers: "block" })');
    expect(source).toContain("currentUrl.origin === expectedOrigin");
    expect(source).toContain(QA_PERSONA_READINESS_MANIFEST_ENV);
    expect(source).toContain("writeManifest(manifest, env)");
  });
});
