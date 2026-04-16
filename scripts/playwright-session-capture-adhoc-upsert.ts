/**
 * Proves Schedule > Live session (in progress) can save ad-hoc session capture rows:
 * POST /api/session-notes/upsert succeeds and returns goal_notes keys matching adhoc-skill-*.
 *
 * Requires the same Playwright env contract as other non-AI session scripts (see playwright-preflight).
 */
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

import { loadPlaywrightEnv } from "./lib/load-playwright-env";
import {
  assertRouteAccessible,
  captureFailureScreenshot,
  loginAndAssertSession,
} from "./lib/playwright-smoke";
import { assertNonAiSessionsEnvContract } from "./lib/playwright-nonai-sessions-contract";
import {
  bookSession,
  cancelSession,
  fetchAccessTokenForCredentials,
  getTokenFromBrowserStorage,
  resolveDefaultOrganizationIdFromRuntimeConfig,
  resolveOrganizationIdFromAccessToken,
  startSession,
  type LifecycleIds,
} from "./lib/playwright-inprogress-session-setup";

const SCHEDULE_MODAL_MODE_KEY = "scheduleModal";
const SCHEDULE_MODAL_SESSION_KEY = "scheduleSessionId";
const SCHEDULE_MODAL_EXPIRY_KEY = "scheduleExp";
const SCHEDULE_MODAL_URL_TTL_MS = 30 * 60 * 1000;

const getEnv = (key: string, fallback?: string): string => {
  const value = process.env[key] ?? fallback;
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
};

const isTruthy = (value: string | undefined): boolean => /^(1|true|yes)$/i.test(value ?? "");

const STEP_TIMEOUT_MS = Number(process.env.PW_LIFECYCLE_STEP_TIMEOUT_MS ?? "300000");

const withStepTimeout = async <T>(label: string, operation: () => Promise<T>): Promise<T> => {
  console.log(`[session-capture-adhoc] start ${label}`);
  let rejectTimeout: (error: Error) => void = () => {};
  const timeoutHandle = setTimeout(() => {
    rejectTimeout(new Error(`Step timed out: ${label} (${STEP_TIMEOUT_MS}ms)`));
  }, STEP_TIMEOUT_MS);
  timeoutHandle.unref?.();
  const timeout = new Promise<never>((_, reject) => {
    rejectTimeout = reject;
  });
  try {
    const result = await Promise.race([operation(), timeout]);
    console.log(`[session-capture-adhoc] ok ${label}`);
    return result as T;
  } finally {
    clearTimeout(timeoutHandle);
  }
};

const buildScheduleEditSessionUrl = (scheduleUrl: string, sessionId: string): string => {
  const url = new URL(scheduleUrl);
  const expiresAtMs = Date.now() + SCHEDULE_MODAL_URL_TTL_MS;
  url.searchParams.set(SCHEDULE_MODAL_MODE_KEY, "edit");
  url.searchParams.set(SCHEDULE_MODAL_SESSION_KEY, sessionId);
  url.searchParams.set(SCHEDULE_MODAL_EXPIRY_KEY, String(expiresAtMs));
  return url.toString();
};

const openEditSessionModalFromUrl = async (page: Page, scheduleUrl: string, sessionId: string): Promise<void> => {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await page.goto(buildScheduleEditSessionUrl(scheduleUrl, sessionId), {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    const dialog = page.locator('[role="dialog"]').filter({ hasText: /Edit Session|Live session/i });
    try {
      await dialog.waitFor({ state: "visible", timeout: 12_000 });
      return;
    } catch {
      await page.waitForTimeout(500 + attempt * 250);
    }
  }
  throw new Error("Session modal (Edit Session / Live session) did not open from schedule deep link.");
}

async function waitForSessionStatus(sessionId: string, status: string, timeoutMs = 120_000): Promise<void> {
  const supabaseUrl = getEnv("VITE_SUPABASE_URL");
  const serviceRole = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const admin = createClient(supabaseUrl, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { data, error } = await admin.from("sessions").select("status").eq("id", sessionId).maybeSingle();
    if (!error && data?.status === status) {
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Timed out waiting for session ${sessionId} status=${status}`);
}

async function run(): Promise<void> {
  loadPlaywrightEnv();
  const base = getEnv("PW_BASE_URL", "https://app.allincompassing.ai");
  const headless = process.env.HEADLESS !== "false";
  const strictParityMode = isTruthy(process.env.CI_SESSION_PARITY_REQUIRED) || isTruthy(process.env.PW_STRICT_SESSION_PARITY);
  const marker = `PW-ADHOC-${Date.now()}`;

  const credentialCandidates = assertNonAiSessionsEnvContract(
    "Session capture ad-hoc upsert Playwright regression",
  );

  const browser = await chromium.launch({ headless });
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let authenticatedCredential: { email: string; password: string } | null = null;
  let capturedAccessToken: string | null = null;
  const ids: Partial<LifecycleIds> = {};

  try {
    for (const candidate of credentialCandidates) {
      const attemptContext = await browser.newContext();
      const attemptPage = await attemptContext.newPage();
      let candidateToken: string | null = null;
      attemptPage.on("response", async (response) => {
        if (candidateToken || response.request().method().toUpperCase() !== "POST") {
          return;
        }
        if (!response.url().includes("/auth/v1/token")) {
          return;
        }
        if (!response.ok()) {
          return;
        }
        const payload = (await response.json().catch(() => null)) as { access_token?: string } | null;
        if (payload?.access_token) {
          candidateToken = payload.access_token;
        }
      });
      try {
        await withStepTimeout(`login ${candidate.label}`, () =>
          loginAndAssertSession(attemptPage, base, candidate.email!, candidate.password!));
        await withStepTimeout(`route-check ${candidate.label}`, () =>
          assertRouteAccessible(attemptPage, base, "/schedule", {
            readySelector: 'button[aria-label="Day view"]',
          }));
        context = attemptContext;
        page = attemptPage;
        authenticatedCredential = { email: candidate.email!, password: candidate.password! };
        capturedAccessToken = candidateToken;
        break;
      } catch {
        await attemptContext.close();
      }
    }

    if (!context || !page || !authenticatedCredential) {
      throw new Error("No provided credentials can access /schedule for ad-hoc upsert test.");
    }

    const activePage = page;
    const browserToken = capturedAccessToken ?? (await getTokenFromBrowserStorage(activePage));
    if (!browserToken && strictParityMode) {
      throw new Error("Could not capture browser session token in strict parity mode.");
    }
    let token =
      browserToken ??
      (await fetchAccessTokenForCredentials(authenticatedCredential.email, authenticatedCredential.password));

    const userOrgId =
      (await resolveOrganizationIdFromAccessToken(token)) ??
      process.env.PW_ACTIVE_ORGANIZATION_ID?.trim() ??
      process.env.DEFAULT_ORGANIZATION_ID?.trim() ??
      (await resolveDefaultOrganizationIdFromRuntimeConfig(base)) ??
      null;
    if (!userOrgId) {
      throw new Error("Could not resolve active organization for aligned booking.");
    }

    const bookOpts = { restrictToOrganizationId: userOrgId } as const;
    let booked: LifecycleIds;
    try {
      booked = await withStepTimeout("book-session", () =>
        bookSession(activePage, token, strictParityMode, bookOpts));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (strictParityMode && message.includes("Organization context required") && authenticatedCredential) {
        token = await fetchAccessTokenForCredentials(authenticatedCredential.email, authenticatedCredential.password);
        booked = await withStepTimeout("book-session retry", () =>
          bookSession(activePage, token, strictParityMode, bookOpts));
      } else {
        throw error;
      }
    }
    Object.assign(ids, booked);
    assert.ok(booked.goalId, "bookSession must return goalId");

    await withStepTimeout("start-session", () => startSession(activePage, token, booked, strictParityMode));
    await withStepTimeout("wait-in-progress", () => waitForSessionStatus(booked.sessionId, "in_progress"));

    const scheduleUrl = `${base}/schedule`;
    await withStepTimeout("refresh-schedule", async () => {
      const bust = Date.now();
      await activePage.goto(`${scheduleUrl}?_${bust}`, { waitUntil: "networkidle", timeout: 90_000 });
    });

    await withStepTimeout("open-modal-and-save-adhoc-capture", async () => {
      await openEditSessionModalFromUrl(activePage, scheduleUrl, booked.sessionId);
      const editDialog = activePage.locator('[role="dialog"]').filter({ hasText: /Edit Session|Live session/i });
      const capture = editDialog.getByTestId("session-modal-capture-section");
      await capture.waitFor({ state: "visible", timeout: 30_000 });

      await editDialog.locator(`#goal-note-${booked.goalId}`).fill(`Plan note ${marker}`);

      await capture.getByRole("button", { name: /Add skill/i }).click();
      const adhocCard = capture.locator(".rounded-lg.border").last();
      await adhocCard.getByPlaceholder("Name this target").fill(`Adhoc title ${marker}`);
      await adhocCard.getByLabel(/^Per-goal note$/i).fill(`Adhoc note ${marker}`);
      await adhocCard.getByRole("button", { name: /Increase correct trials/i }).click();

      const upsertPromise = activePage.waitForResponse(
        (res) => res.url().includes("/api/session-notes/upsert") && res.request().method() === "POST",
        { timeout: 120_000 },
      );
      await activePage.getByRole("button", { name: /Save progress/i }).click();
      const res = await upsertPromise;
      assert.equal(res.ok(), true, `session-notes upsert failed: HTTP ${res.status()}`);
      const body = (await res.json()) as {
        goal_notes?: Record<string, string> | null;
        goal_ids?: string[] | null;
      };
      const adhocNoteKey = Object.keys(body.goal_notes ?? {}).find((k) => /^adhoc-skill-/i.test(k));
      assert.ok(adhocNoteKey, "response.goal_notes must include an adhoc-skill-* key");
      assert.match(adhocNoteKey ?? "", /^adhoc-skill-/i);
      assert.ok(
        (body.goal_ids ?? []).some((id) => /^adhoc-skill-/i.test(id)),
        "response.goal_ids must include ad-hoc id",
      );
    });

    await withStepTimeout("cleanup-cancel-session", () => cancelSession(activePage, token, booked.sessionId));

    console.log(
      JSON.stringify({
        ok: true,
        message: "Session capture ad-hoc upsert validated",
        marker,
        ids,
      }),
    );
  } catch (error) {
    const shotPath = page ? await captureFailureScreenshot(page, "playwright-session-capture-adhoc-upsert") : "N/A";
    console.error(
      JSON.stringify({
        ok: false,
        message: "Session capture ad-hoc upsert failed",
        error: error instanceof Error ? error.message : String(error),
        screenshot: shotPath,
        ids,
      }),
    );
    throw error;
  } finally {
    if (context) {
      await context.close();
    }
    await browser.close();
  }
}

const isMainModule = (): boolean => {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return import.meta.url === pathToFileURL(path.resolve(entry)).href;
  } catch {
    return false;
  }
};

if (isMainModule()) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
