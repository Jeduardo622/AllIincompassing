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

const openEditSessionModalFromCalendar = async (
  page: Page,
  scheduleUrl: string,
  sessionId: string,
  sessionStartIso?: string,
): Promise<void> => {
  await page.goto(`${scheduleUrl}?_${Date.now()}`, {
    waitUntil: "networkidle",
    timeout: 60000,
  });

  let visitedPeriods = 0;
  for (let periodAttempt = 0; periodAttempt < 8; periodAttempt += 1) {
    visitedPeriods = periodAttempt + 1;
    let sessionCardVisible = false;

    for (let samePeriodAttempt = 0; samePeriodAttempt < 3; samePeriodAttempt += 1) {
      const sessionCard = page.locator(`[data-session-id="${sessionId}"]`).first();
      sessionCardVisible = await sessionCard
        .waitFor({ state: "visible", timeout: samePeriodAttempt === 0 ? 12_000 : 4_000 })
        .then(() => true)
        .catch(() => false);
      if (!sessionCardVisible) {
        break;
      }

      try {
        await sessionCard.scrollIntoViewIfNeeded();
        await sessionCard.click();
        const dialog = page.locator('[role="dialog"]').filter({ hasText: /Edit Session|Live session/i });
        await dialog.waitFor({ state: "visible", timeout: 12_000 });
        return;
      } catch {
        await page.waitForTimeout(500 + samePeriodAttempt * 250);
      }
    }

    if (sessionCardVisible) {
      continue;
    }

    const nextPeriodButton = page.getByRole("button", { name: /next period/i }).first();
    if ((await nextPeriodButton.count()) === 0) {
      break;
    }
    await nextPeriodButton.click();
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
    await page.waitForTimeout(500 + periodAttempt * 250);
  }
  throw new Error(
    `Session modal (Edit Session / Live session) did not open from the rendered schedule card after ${visitedPeriods} schedule period(s). sessionStartIso=${sessionStartIso ?? "unknown"}`,
  );
};

const selectFirstOptionIfEmpty = async (
  selectLocator: ReturnType<Page["locator"]>,
  label: string,
): Promise<string | null> => {
  const select = selectLocator.first();
  const count = await select.count();
  if (count === 0) {
    return null;
  }
  const currentValue = await select.inputValue().catch(() => "");
  if (currentValue.trim().length > 0) {
    return currentValue.trim();
  }
  const started = Date.now();
  let selectedValue = "";
  while (Date.now() - started < 30_000 && !selectedValue) {
    const values = await select.locator("option").evaluateAll((nodes) =>
      nodes
        .map((node) => (node as HTMLOptionElement).value)
        .filter((value) => typeof value === "string" && value.trim().length > 0),
    );
    selectedValue = values[0] ?? "";
    if (!selectedValue) {
      await select.page().waitForTimeout(250);
    }
  }
  if (!selectedValue) {
    throw new Error(`No selectable ${label} option was available for session capture.`);
  }
  await select.selectOption(selectedValue);
  return selectedValue;
};

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
      const observedRequests: string[] = [];
      const failedRequests: string[] = [];
      const consoleErrors: string[] = [];
      const requestListener = (request: import("playwright").Request) => {
        const method = request.method().toUpperCase();
        const url = request.url();
        if (method === "POST" || method === "PUT" || url.includes("/api/session-notes/upsert")) {
          observedRequests.push(`${method} ${url}`);
        }
      };
      const requestFailedListener = (request: import("playwright").Request) => {
        failedRequests.push(`${request.method().toUpperCase()} ${request.url()} ${request.failure()?.errorText ?? ""}`);
      };
      const consoleListener = (message: import("playwright").ConsoleMessage) => {
        if (message.type() === "error") {
          consoleErrors.push(message.text());
        }
      };
      activePage.on("request", requestListener);
      activePage.on("requestfailed", requestFailedListener);
      activePage.on("console", consoleListener);
      try {
        await openEditSessionModalFromCalendar(activePage, scheduleUrl, booked.sessionId, booked.startIso);
        const editDialog = activePage.locator('[role="dialog"]').filter({ hasText: /Edit Session|Live session/i });
        const capture = editDialog.getByTestId("session-modal-capture-section");
        await capture.waitFor({ state: "visible", timeout: 30_000 });
        await selectFirstOptionIfEmpty(
          editDialog.first().locator('#session-note-auth-select, select[name="session_note_authorization_id"]'),
          "authorization",
        );
        await selectFirstOptionIfEmpty(
          editDialog.first().locator('#session-note-service-code-select, select[name="session_note_service_code"]'),
          "service code",
        );

        await editDialog.locator(`#goal-note-${booked.goalId}`).fill(`Plan note ${marker}`);

        await capture.getByRole("button", { name: /Add skill/i }).click();
        const adhocCard = capture.locator('[data-testid^="session-modal-goal-capture-adhoc-skill-"]').last();
        await adhocCard.waitFor({ state: "visible", timeout: 30_000 });
        await adhocCard.scrollIntoViewIfNeeded();
        await adhocCard.locator('input[placeholder="Name this target"]:visible').first().fill(`Adhoc title ${marker}`);
        await adhocCard.getByLabel(/^Per-goal note$/i).fill(`Adhoc note ${marker}`);
        await adhocCard.getByRole("button", { name: /Increase correct trials/i }).first().click();

        const buildFailure = async (error: unknown): Promise<Error> => {
          const diagnostics = await activePage.evaluate(() => {
            const form = document.querySelector("#session-form") as HTMLFormElement | null;
            const invalidFields = form
              ? Array.from(form.elements)
                  .filter((element): element is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
                    "validity" in element && !element.validity.valid)
                  .map((element) => ({
                    id: element.id,
                    name: element.name,
                    value: element.value,
                    validationMessage: element.validationMessage,
                  }))
              : [];
            const saveSkillsButton = Array.from(document.querySelectorAll("button")).find((button) =>
              /Save skills/i.test(button.textContent ?? ""));
            return {
              formValid: form?.checkValidity() ?? null,
              invalidFields,
              saveSkillsDisabled: saveSkillsButton instanceof HTMLButtonElement ? saveSkillsButton.disabled : null,
              visibleAdhocTitleCount: document.querySelectorAll('input[placeholder="Name this target"]').length,
              saveStateText: document.body.textContent?.match(/Saved|Unable to save|Saving/i)?.[0] ?? null,
              sessionNoteAuthSelectCount: document.querySelectorAll(
                '#session-note-auth-select, select[name="session_note_authorization_id"]',
              ).length,
              sessionNoteServiceCodeSelectCount: document.querySelectorAll(
                '#session-note-service-code-select, select[name="session_note_service_code"]',
              ).length,
            };
          });
          return new Error(
            `${error instanceof Error ? error.message : String(error)} diagnostics=${JSON.stringify({
              ...diagnostics,
              observedRequests: observedRequests.slice(-20),
              failedRequests: failedRequests.slice(-10),
              consoleErrors: consoleErrors.slice(-10),
            })}`,
          );
        };

        const upsertPromise = activePage.waitForResponse(
          (response) =>
            response.url().includes("/api/session-notes/upsert") && response.request().method() === "POST",
          { timeout: 120_000 },
        );
        activePage.once("dialog", (dialog) => {
          void dialog.accept();
        });
        await editDialog.getByRole("button", { name: /^Save progress$/i }).click();
        const res = await upsertPromise.catch(async (error) => {
          throw await buildFailure(error);
        });
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
      } finally {
        activePage.off("request", requestListener);
        activePage.off("requestfailed", requestFailedListener);
        activePage.off("console", consoleListener);
      }
    });

    await withStepTimeout("cleanup-cancel-session", () => cancelSession(activePage, token, booked.sessionId, booked));

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
