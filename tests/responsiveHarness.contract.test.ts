// @vitest-environment node

import path from "node:path";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

import { build, preview, type PreviewServer } from "vite";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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

    const visit = async (route: "/clients/test-client" | "/schedule" | "/dashboard") => {
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
      } else {
        await page.getByRole("dialog", { name: /Amend BT Note/i }).waitFor();
        await page.getByLabel("Discussed domains/progress/data collection").waitFor();
        expect(await page.getByLabel("Discussed programs/progress/data collection").count()).toBe(0);
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
      expect((runtimeState.harness?.apiCalls ?? []).every((call) => call.method === "GET")).toBe(true);

      expect(requests.every((request) => request.method === "GET")).toBe(true);
      expect(
        requests.every((request) => new URL(request.url).hostname === "127.0.0.1"),
      ).toBe(true);

      await page.close();
    };

    await visit("/clients/test-client");
    await visit("/schedule");
    await visit("/dashboard");
  }, 120_000);
});
