// @vitest-environment node

import path from "node:path";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

import { build, preview, type PreviewServer } from "vite";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runResponsiveUiObserver } from "../scripts/playwright-responsive-ui-observer";

const repoRoot = process.cwd();
const fixtureRoot = path.join(repoRoot, "tests", "fixtures", "responsive-harness");
const configFile = path.join(repoRoot, "vite.responsive-harness.config.ts");
const outDir = path.join(repoRoot, "artifacts", "responsive-harness-dist");
const sentinelEnvFile = path.join(fixtureRoot, ".env");

declare global {
  interface Window {
    __RESPONSIVE_HARNESS__?: {
      envSentinel: string | null;
      apiCalls: Array<{ method: string; path: string }>;
      fetchCalls: Array<{ method: string; url: string }>;
      xhrCalls: Array<{ method: string; url: string }>;
      storageReads: number;
      storageWrites: number;
      cookieReads: number;
      cookieWrites: number;
    };
  }
}

let previewServer: PreviewServer | null = null;
let browser: Browser | null = null;

beforeAll(() => {
  rmSync(outDir, { recursive: true, force: true });
  writeFileSync(sentinelEnvFile, "VITE_RESPONSIVE_HARNESS_SENTINEL=from-dot-env\n", "utf8");
});

afterAll(async () => {
  if (browser) {
    await browser.close();
  }
  if (previewServer) {
    await previewServer.httpServer.close();
  }
  rmSync(sentinelEnvFile, { force: true });
  rmSync(outDir, { recursive: true, force: true });
});

describe("responsive harness contract", () => {
  it("fails closed for every write-capable Supabase shim path", async () => {
    const { supabase } = await import("./fixtures/responsive-harness/src/shims/supabase");
    const programs = supabase.from("programs");

    expect(() => programs.insert()).toThrow("responsive_harness_read_only");
    expect(() => programs.update()).toThrow("responsive_harness_read_only");
    expect(() => programs.delete()).toThrow("responsive_harness_read_only");
    expect(() => programs.upsert()).toThrow("responsive_harness_read_only");

    const storage = supabase.storage.from();
    await expect(storage.upload()).rejects.toThrow("responsive_harness_read_only");
    await expect(storage.remove()).rejects.toThrow("responsive_harness_read_only");
  });

  it("serves exact read-only payroll review contracts and rejects mutation attempts", async () => {
    (globalThis as { window?: Record<string, unknown> }).window = {
      __RESPONSIVE_HARNESS__: {
        envSentinel: null,
        apiCalls: [],
        fetchCalls: [],
        xhrCalls: [],
        storageReads: 0,
        storageWrites: 0,
        cookieReads: 0,
        cookieWrites: 0,
      },
    };
    const { callApi } = await import("./fixtures/responsive-harness/src/shims/api");

    const queueResponse = await callApi("/api/payroll-approvals", {
      method: "POST",
      body: JSON.stringify({
        action: "review_queue",
        selectedLocalDate: "2026-08-12",
      }),
    });
    expect(queueResponse.status).toBe(200);
    await expect(queueResponse.json()).resolves.toEqual({
      state: "ok",
      selectedLocalDate: "2026-08-12",
      capabilities: {
        canReviewAssigned: true,
        canApproveAssigned: true,
        canViewCompensation: false,
        hasOrgPayrollAccess: false,
      },
      queue: [{
        employeeLabel: "Employee 1001",
        employmentProfileId: "10000000-0000-4000-8000-000000000003",
        payPeriodId: "10000000-0000-4000-8000-000000000007",
        periodStart: "2026-08-01",
        periodEnd: "2026-08-14",
        state: "submitted",
        blockerCount: 1,
        submittedAt: "2026-08-12T18:00:00.000Z",
        snapshot: {
          id: "10000000-0000-4000-8000-000000000008",
          hash: "a".repeat(64),
        },
        classifiedSeconds: { regular: 28800, overtime: 3600, doubleTime: 0 },
      }],
    });

    const detailsResponse = await callApi("/api/payroll-approvals", {
      method: "POST",
      body: JSON.stringify({
        action: "review_details",
        snapshotId: "10000000-0000-4000-8000-000000000008",
        snapshotHash: "a".repeat(64),
      }),
    });
    expect(detailsResponse.status).toBe(200);
    await expect(detailsResponse.json()).resolves.toEqual({
      state: "ok",
      snapshotId: "10000000-0000-4000-8000-000000000008",
      snapshotHash: "a".repeat(64),
      periodStart: "2026-08-01",
      periodEnd: "2026-08-14",
      punches: [],
      classifiedSeconds: { regular: 28800, overtime: 3600, doubleTime: 0 },
      approvalHistory: [],
      blockers: [{
        blockerType: "timekeeping_exception",
        blockerId: "10000000-0000-4000-8000-000000000009",
        state: "open",
        createdAt: "2026-08-12T19:00:00.000Z",
      }],
      unresolvedBlockerCount: 1,
    });

    const mutationResponse = await callApi("/api/payroll-approvals", {
      method: "POST",
      body: JSON.stringify({
        action: "approve",
        snapshotId: "10000000-0000-4000-8000-000000000008",
        snapshotHash: "a".repeat(64),
        idempotencyKey: "responsive-harness-mutation-attempt",
      }),
    });
    expect(mutationResponse.status).toBe(405);
    await expect(mutationResponse.json()).resolves.toEqual({ error: "responsive_harness_read_only" });
  });

  it("builds separately, binds loopback-only, and renders the isolated pathname routes without env, storage, or network mutation drift", async () => {
    const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["responsive-harness:start"]).toContain("vite --config vite.responsive-harness.config.ts");
    expect(packageJson.scripts?.["responsive-harness:build"]).toContain("vite build --config vite.responsive-harness.config.ts");
    expect(packageJson.scripts?.build).not.toContain("responsive-harness");

    await build({ configFile });
    expect(existsSync(path.join(outDir, "index.html"))).toBe(true);

    previewServer = await preview({
      configFile,
      preview: {
        host: "127.0.0.1",
        port: 4176,
        strictPort: true,
      },
    });

    browser = await chromium.launch({ headless: true });

    const visit = async (route: "/clients/test-client" | "/schedule" | "/dashboard" | "/payroll" | "/time/review") => {
      const page = await browser!.newPage();
      const requests: Array<{ method: string; url: string }> = [];
      page.on("request", (request) => {
        requests.push({ method: request.method(), url: request.url() });
      });

      await page.goto(`http://127.0.0.1:4176${route}`, { waitUntil: "domcontentloaded" });

      if (route === "/clients/test-client") {
        await page.getByText("Add Target").waitFor();
        await page.getByText("Add Goal").waitFor();
        await page.getByText("Domain Notes").waitFor();
      } else if (route === "/schedule") {
        await page.getByRole("dialog", { name: /Auto Schedule Sessions/i }).waitFor();
        await page.getByRole("button", { name: /Generate Preview/i }).waitFor();
      } else if (route === "/dashboard") {
        await page.getByRole("dialog", { name: /Amend BT Note/i }).waitFor();
        await page.getByLabel("Discussed domains/progress/data collection").waitFor();
        expect(await page.getByLabel("Discussed programs/progress/data collection").count()).toBe(0);
      } else if (route === "/time/review") {
        await page.getByRole("heading", { name: "Time Review", exact: true }).waitFor();
        await page.getByRole("heading", { name: "Assigned queue" }).waitFor();
        await page.getByText("Employee 1001").waitFor();
        await page.getByRole("heading", { name: "Immutable snapshot details" }).waitFor();
        await page.getByRole("heading", { name: "Blockers" }).waitFor();
        expect(await page.getByRole("button", { name: "Approve", exact: true }).count()).toBe(1);
        expect(await page.getByRole("button", { name: "Return", exact: true }).count()).toBe(1);
      } else {
        await page.getByRole("heading", { name: "Payroll", exact: true }).waitFor();
        const tabs = ["Employment", "Pay Groups", "Periods", "Exceptions", "Approvals"] as const;
        for (const tab of tabs) {
          await page.getByRole("button", { name: tab, exact: true }).click();
          if (tab === "Employment") {
            await page.getByLabel("External payroll org ID").waitFor();
            await page.getByRole("button", { name: "Add rate version" }).waitFor();
          } else if (tab === "Pay Groups") {
            await page.getByRole("button", { name: "Create pay group assignment" }).waitFor();
          } else if (tab === "Periods") {
            await page.getByRole("button", { name: "Generate periods" }).waitFor();
          } else if (tab === "Exceptions") {
            await page.getByRole("heading", { name: "Blocking exceptions" }).waitFor();
          } else {
            await page.getByLabel("Reopen reason").waitFor();
            await page.getByRole("button", { name: "Lock period" }).waitFor();
          }

          expect(await page.getByRole("button", { name: /grant capability|revoke capability|mutate policy|export/i }).count()).toBe(0);
        }
      }

      const runtimeState = await page.evaluate(() => ({
        location: window.location.pathname + window.location.search + window.location.hash,
        harness: window.__RESPONSIVE_HARNESS__,
      }));

      expect(runtimeState.location).toBe(route);
      expect(await page.context().cookies()).toEqual([]);
      expect(runtimeState.harness?.envSentinel ?? null).toBeNull();
      expect(runtimeState.harness?.storageReads).toBe(0);
      expect(runtimeState.harness?.storageWrites).toBe(0);
      expect(runtimeState.harness?.cookieReads).toBe(0);
      expect(runtimeState.harness?.cookieWrites).toBe(0);
      expect(runtimeState.harness?.fetchCalls ?? []).toEqual([]);
      expect(runtimeState.harness?.xhrCalls ?? []).toEqual([]);
      const apiCalls = runtimeState.harness?.apiCalls ?? [];
      if (route === "/payroll") {
        expect(apiCalls.length).toBeGreaterThan(0);
        expect(apiCalls.every((call) => (
          call.method === "POST"
          && (call.path === "/api/payroll-administration" || call.path === "/api/payroll-approvals")
        ))).toBe(true);
      } else if (route === "/time/review") {
        expect(apiCalls).toEqual([
          { method: "POST", path: "/api/payroll-approvals" },
          { method: "POST", path: "/api/payroll-approvals" },
        ]);
      } else {
        expect(apiCalls.every((call) => call.method === "GET")).toBe(true);
      }

      expect(requests.every((request) => request.method === "GET")).toBe(true);
      expect(
        requests.every((request) => new URL(request.url).hostname === "127.0.0.1"),
      ).toBe(true);

      await page.close();
    };

    await visit("/clients/test-client");
    await visit("/schedule");
    await visit("/dashboard");
    await visit("/payroll");
    await visit("/time/review");

    const observerSummary = await runResponsiveUiObserver([
      "node",
      "scripts/playwright-responsive-ui-observer.ts",
      "--base-url=http://127.0.0.1:4176",
      "--route=/time/review",
      "--scenario=payroll-time-review",
      "--artifact-run-id=responsive-harness-contract",
    ]);
    expect(observerSummary.ok).toBe(true);
    expect(observerSummary.results).toHaveLength(2);
    for (const result of observerSummary.results) {
      expect(result.result).toBe("pass");
      expect(result.failureCodes).toEqual([]);
      const evidence = JSON.parse(readFileSync(result.evidencePath, "utf8")) as Record<string, unknown>;
      expect(evidence.scenarioId).toBe("payroll-time-review");
      expect(evidence.screenshotPath).toBe(result.screenshotPath);
      expect(evidence.evidencePath).toBe(result.evidencePath);
      rmSync(result.screenshotPath, { force: true });
      rmSync(result.evidencePath, { force: true });
    }
  }, 120_000);
});
