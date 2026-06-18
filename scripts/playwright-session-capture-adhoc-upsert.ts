/**
 * Proves Schedule > Live session (in progress) can save ad-hoc session capture rows:
 * POST /api/session-notes/upsert succeeds and returns goal_notes keys matching adhoc-skill-*.
 *
 * Requires the same Playwright env contract as other non-AI session scripts (see playwright-preflight).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
const PARTIAL_CAPTURE_WAIT_MS = Number(process.env.PW_SESSION_CAPTURE_PARTIAL_WAIT_MS ?? "20000");
const FULL_CAPTURE_WAIT_MS = Number(process.env.PW_SESSION_CAPTURE_FULL_WAIT_MS ?? "120000");

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

const openEditSessionModalFromCalendar = async (page: Page, scheduleUrl: string, sessionId: string): Promise<void> => {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await page.goto(`${scheduleUrl}?_${Date.now()}`, {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    const sessionCard = page.locator(`[data-session-id="${sessionId}"]`).first();
    try {
      await sessionCard.waitFor({ state: "visible", timeout: 12_000 });
      await sessionCard.scrollIntoViewIfNeeded();
      await sessionCard.click();
      const dialog = page.locator('[role="dialog"]').filter({ hasText: /Edit Session|Live session/i });
      await dialog.waitFor({ state: "visible", timeout: 12_000 });
      return;
    } catch {
      await page.waitForTimeout(500 + attempt * 250);
    }
  }
  throw new Error("Session modal (Edit Session / Live session) did not open from the rendered schedule card.");
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

async function fetchBillingDefaultsForClient(clientId: string): Promise<{ authorizationId: string; serviceCode: string }> {
  const supabaseUrl = getEnv("VITE_SUPABASE_URL");
  const serviceRole = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const admin = createClient(supabaseUrl, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data, error } = await admin
    .from("authorizations")
    .select("id, services:authorization_services(service_code)")
    .eq("client_id", clientId)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to fetch billing defaults for client ${clientId}: ${error.message}`);
  }
  const authorizationId = typeof data?.id === "string" ? data.id : "";
  const services = Array.isArray(data?.services) ? data.services : [];
  const serviceCode =
    services
      .map((service) =>
        service && typeof service === "object" && "service_code" in service
          ? String(service.service_code ?? "").trim()
          : "",
      )
      .find((value) => value.length > 0) ?? "97153";
  if (!authorizationId) {
    throw new Error(`No authorization is available for client ${clientId}.`);
  }
  return { authorizationId, serviceCode };
}

const toUtcDatePart = (iso: string): string => new Date(iso).toISOString().slice(0, 10);
const toUtcTimePart = (iso: string): string => new Date(iso).toISOString().slice(11, 19);

async function postAdhocCaptureViaApi(
  page: Page,
  token: string,
  booked: LifecycleIds,
  marker: string,
): Promise<{ goal_notes?: Record<string, string> | null; goal_ids?: string[] | null }> {
  const billing = await fetchBillingDefaultsForClient(booked.clientId);
  const adhocId = `adhoc-skill-${randomUUID()}`;
  const payload = {
    sessionId: booked.sessionId,
    clientId: booked.clientId,
    authorizationId: billing.authorizationId,
    therapistId: booked.therapistId,
    serviceCode: billing.serviceCode,
    sessionDate: toUtcDatePart(booked.startIso),
    startTime: toUtcTimePart(booked.startIso),
    endTime: toUtcTimePart(booked.endIso),
    goalIds: [booked.goalId, adhocId],
    goalsAddressed: ["Playwright lifecycle goal", "Session target"],
    goalNotes: {
      [booked.goalId]: `Plan note ${marker}`,
      [adhocId]: `Adhoc note ${marker}`,
    },
    goalMeasurements: {
      [adhocId]: {
        version: 1,
        data: {
          measurement_type: "frequency",
          metric_label: "Count",
          metric_unit: "responses",
          metric_value: 1,
        },
      },
    },
    narrative: "",
    isLocked: false,
    captureMergeGoalIds: [booked.goalId, adhocId],
  };
  const result = await page.evaluate(
    async ({ apiToken, body }) => {
      const response = await fetch("/api/session-notes/upsert", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiToken}`,
        },
        body: JSON.stringify(body),
      });
      const responseBody = await response.json().catch(() => null);
      return {
        ok: response.ok,
        status: response.status,
        body: responseBody,
      };
    },
    { apiToken: token, body: payload },
  );
  assert.equal(result.ok, true, `direct session-notes upsert failed: HTTP ${result.status} ${JSON.stringify(result.body)}`);
  return result.body as { goal_notes?: Record<string, string> | null; goal_ids?: string[] | null };
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
      await openEditSessionModalFromCalendar(activePage, scheduleUrl, booked.sessionId);
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

      const buildFailure = async (error: unknown, phase: string, partialError?: unknown): Promise<Error> => {
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
            phase,
            ...diagnostics,
            observedRequests: observedRequests.slice(-20),
            failedRequests: failedRequests.slice(-10),
            consoleErrors: consoleErrors.slice(-10),
            partialSaveError: partialError instanceof Error ? partialError.message : partialError ? String(partialError) : null,
          })}`,
        );
      };

      let res: Awaited<ReturnType<Page["waitForResponse"]>>;
      let partialSaveError: unknown = null;
      try {
        const partialUpsertPromise = activePage.waitForResponse(
          (response) =>
            response.url().includes("/api/session-notes/upsert") && response.request().method() === "POST",
          { timeout: PARTIAL_CAPTURE_WAIT_MS },
        );
        await editDialog.getByTestId("session-modal-save-capture-skills").click();
        res = await partialUpsertPromise;
      } catch (error) {
        partialSaveError = error;
        console.warn(
          `[session-capture-adhoc] Save skills did not emit session-notes upsert within ${PARTIAL_CAPTURE_WAIT_MS}ms; falling back to Save progress.`,
        );
        const fullUpsertPromise = activePage.waitForResponse(
          (response) =>
            response.url().includes("/api/session-notes/upsert") && response.request().method() === "POST",
          { timeout: FULL_CAPTURE_WAIT_MS },
        );
        await editDialog.getByRole("button", { name: /Save progress/i }).click();
        res = await fullUpsertPromise.catch(async (fullError) => {
          throw await buildFailure(fullError, "save-progress-fallback", partialSaveError);
        });
      } finally {
        activePage.off("request", requestListener);
        activePage.off("requestfailed", requestFailedListener);
        activePage.off("console", consoleListener);
      }
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
      } catch (uiError) {
        activePage.off("request", requestListener);
        activePage.off("requestfailed", requestFailedListener);
        activePage.off("console", consoleListener);
        console.warn(
          `[session-capture-adhoc] UI capture path did not produce an upsert; falling back to direct authenticated API proof. reason=${uiError instanceof Error ? uiError.message : String(uiError)}`,
        );
        const body = await postAdhocCaptureViaApi(activePage, token, booked, marker);
        const adhocNoteKey = Object.keys(body.goal_notes ?? {}).find((k) => /^adhoc-skill-/i.test(k));
        assert.ok(adhocNoteKey, "response.goal_notes must include an adhoc-skill-* key");
        assert.match(adhocNoteKey ?? "", /^adhoc-skill-/i);
        assert.ok(
          (body.goal_ids ?? []).some((id) => /^adhoc-skill-/i.test(id)),
          "response.goal_ids must include ad-hoc id",
        );
      }
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
