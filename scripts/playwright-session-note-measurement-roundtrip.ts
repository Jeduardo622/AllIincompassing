/**
 * Critical flow: therapist saves clinical session note (goal note + measurement) from Schedule
 * while session is in progress, verifies measurement on Client Details > Session Notes, edits via
 * AddSessionNoteModal, and confirms updated measurement renders.
 *
 * Reuses booking/start harness from `playwright-inprogress-session-setup.ts`.
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

/** Assert server upsert JSON includes per-goal metric_value (Session Data Collection 2.0 contract). */
const assertUpsertResponseMetric = (
  body: unknown,
  goalId: string,
  expectedMetric: number,
  label: string,
): void => {
  const note = body as {
    goal_measurements?: Record<string, { data?: { metric_value?: number | null } }> | null;
    id?: string;
  };
  const val = note.goal_measurements?.[goalId]?.data?.metric_value;
  assert.equal(
    val,
    expectedMetric,
    `${label}: expected goal_measurements[${goalId}].data.metric_value=${expectedMetric}, got ${String(val)}`,
  );
};

const withStepTimeout = async <T>(label: string, operation: () => Promise<T>): Promise<T> => {
  console.log(`[session-note-measurement] start ${label}`);
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
    console.log(`[session-note-measurement] ok ${label}`);
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
};

const ensureGoalCaptureFieldsVisible = async (dialog: ReturnType<Page["locator"]>, goalId: string): Promise<void> => {
  const noteField = dialog.locator(`#goal-note-${goalId}`);
  const captureRow = dialog.locator(`[data-testid="session-modal-goal-capture-${goalId}"]`);
  const expandCaptureRowIfCollapsed = async (): Promise<void> => {
    if ((await captureRow.count()) === 0) {
      return;
    }
    const isOpen = await captureRow
      .first()
      .evaluate((node) => (node instanceof HTMLDetailsElement ? node.open : true))
      .catch(() => true);
    if (isOpen) {
      return;
    }
    const summary = captureRow.first().locator("summary").first();
    if ((await summary.count()) > 0) {
      await summary.click();
      await dialog.page().waitForTimeout(250);
    }
  };
  const isReady = async (): Promise<boolean> => {
    if ((await noteField.count()) === 0) {
      return false;
    }
    return await noteField.first().isVisible();
  };

  await expandCaptureRowIfCollapsed();
  if (await isReady()) {
    return;
  }

  const tabNames = ["Skill", "BX"] as const;
  for (const tabName of tabNames) {
    const tab = dialog.getByRole("tab", { name: tabName });
    if ((await tab.count()) > 0) {
      await tab.first().click();
      await dialog.page().waitForTimeout(250);
      await expandCaptureRowIfCollapsed();
      if (await isReady()) {
        return;
      }
    }
  }

  throw new Error(`Goal capture inputs for ${goalId} were not visible in SessionModal.`);
};

const resolveEditableCaptureGoalId = async (dialog: ReturnType<Page["locator"]>): Promise<string> => {
  const readVisibleGoalId = async (): Promise<string | null> => {
    const visibleInputId = await dialog
      .locator('textarea[id^="goal-note-"]')
      .evaluateAll((nodes) => {
        const visible = nodes.find((node) => {
          const element = node as HTMLElement;
          return element.offsetParent !== null;
        }) as HTMLTextAreaElement | undefined;
        return visible?.id ?? null;
      });
    if (!visibleInputId) {
      return null;
    }
    return visibleInputId.replace("goal-note-", "");
  };

  const expandFirstCaptureRow = async (): Promise<void> => {
    const firstRow = dialog.locator('[data-testid^="session-modal-goal-capture-"]').first();
    if ((await firstRow.count()) === 0) {
      return;
    }
    const summary = firstRow.locator("summary").first();
    if ((await summary.count()) > 0) {
      await summary.click().catch(() => undefined);
      await dialog.page().waitForTimeout(200);
    }
  };

  const fromCurrentView = await readVisibleGoalId();
  if (fromCurrentView) {
    return fromCurrentView;
  }

  await expandFirstCaptureRow();
  const afterExpand = await readVisibleGoalId();
  if (afterExpand) {
    return afterExpand;
  }

  const tabNames = ["Skill", "BX"] as const;
  for (const tabName of tabNames) {
    const tab = dialog.getByRole("tab", { name: tabName });
    if ((await tab.count()) === 0) {
      continue;
    }
    await tab.first().click();
    await dialog.page().waitForTimeout(250);
    await expandFirstCaptureRow();
    const fromTab = await readVisibleGoalId();
    if (fromTab) {
      return fromTab;
    }
  }

  const addSkillButton = dialog.getByRole("button", { name: /Add skill/i });
  if ((await addSkillButton.count()) > 0) {
    await addSkillButton.first().click();
    await dialog.page().waitForTimeout(250);
    await expandFirstCaptureRow();
    const fromAdhoc = await readVisibleGoalId();
    if (fromAdhoc) {
      return fromAdhoc;
    }
  }

  throw new Error("No visible session capture inputs were available in SessionModal.");
};

const selectFirstOptionIfEmpty = async (selectLocator: ReturnType<Page["locator"]>): Promise<void> => {
  if ((await selectLocator.count()) === 0) {
    return;
  }
  const currentValue = await selectLocator.first().inputValue().catch(() => "");
  if (currentValue.trim().length > 0) {
    return;
  }
  const options = await selectLocator
    .first()
    .locator("option")
    .evaluateAll((nodes) =>
      nodes
        .map((node) => (node as HTMLOptionElement).value)
        .filter((value) => typeof value === "string" && value.trim().length > 0),
    );
  if (options.length > 0) {
    await selectLocator.first().selectOption(options[0]);
  }
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
  const marker = `PW-MEAS-RT-${Date.now()}`;
  const initialMetric = 7;
  const updatedMetric = 8;

  const credentialCandidates = assertNonAiSessionsEnvContract(
    "Session note measurement roundtrip Playwright regression",
  );

  const browser = await chromium.launch({ headless });
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let authenticatedCredential: { email: string; password: string } | null = null;
  let capturedAccessToken: string | null = null;
  const ids: Partial<LifecycleIds> = {};
  let savedNoteId: string | null = null;
  let workingGoalId: string | null = null;

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
      throw new Error("No provided credentials can access /schedule for measurement roundtrip test.");
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
    assert.ok(booked.goalId, "bookSession must return goalId for measurement roundtrip assertions");

    await withStepTimeout("start-session", () => startSession(activePage, token, booked, strictParityMode));
    await withStepTimeout("wait-in-progress", () => waitForSessionStatus(booked.sessionId, "in_progress"));

    const scheduleUrl = `${base}/schedule`;
    await withStepTimeout("refresh-schedule", async () => {
      const bust = Date.now();
      await activePage.goto(`${scheduleUrl}?_${bust}`, { waitUntil: "networkidle", timeout: 90_000 });
    });

    await withStepTimeout("open-session-modal-clinical", async () => {
      await openEditSessionModalFromUrl(activePage, scheduleUrl, booked.sessionId);
      const editDialog = activePage.locator('[role="dialog"]').filter({ hasText: /Edit Session|Live session/i });
      await selectFirstOptionIfEmpty(
        editDialog.first().locator('#session-note-auth-select, select[name="session_note_authorization_id"]'),
      );
      await selectFirstOptionIfEmpty(
        editDialog.first().locator('#session-note-service-code-select, select[name="session_note_service_code"]'),
      );
      const bookedGoalNoteField = editDialog.first().locator(`#goal-note-${booked.goalId}`);
      if ((await bookedGoalNoteField.count()) > 0) {
        await ensureGoalCaptureFieldsVisible(editDialog.first(), booked.goalId);
        workingGoalId = booked.goalId;
      } else {
        workingGoalId = await resolveEditableCaptureGoalId(editDialog.first());
      }
      await ensureGoalCaptureFieldsVisible(editDialog.first(), workingGoalId);
      await editDialog.first().locator(`#goal-note-${workingGoalId}`).fill(marker);
      await editDialog
        .first()
        .locator(`input[name="session_note_goal_measurements.${workingGoalId}.data.metric_value"]`)
        .first()
        .fill(String(initialMetric), { force: true });
    });

    await withStepTimeout("save-clinical-from-schedule", async () => {
      const goalId = workingGoalId ?? booked.goalId;
      const upsertPromise = activePage.waitForResponse(
        (res) => res.url().includes("/api/session-notes/upsert") && res.request().method() === "POST",
        { timeout: 120_000 },
      );
      activePage.once("dialog", (dialog) => {
        void dialog.accept();
      });
      await activePage.getByRole("button", { name: /Save progress/i }).click();
      const res = await upsertPromise;
      const body = (await res.json().catch(() => null)) as unknown;
      assert.equal(
        res.ok(),
        true,
        `session-notes upsert failed: HTTP ${res.status()} body=${JSON.stringify(body).slice(0, 2000)}`,
      );
      assert.ok(body && typeof body === "object", "session-notes upsert must return a JSON object");
      assertUpsertResponseMetric(body, goalId, initialMetric, "save-clinical-from-schedule");
      const noteId = (body as { id?: string }).id;
      if (noteId && typeof noteId === "string") {
        savedNoteId = noteId;
      }
    });

    await withStepTimeout("navigate-client-session-notes", async () => {
      await activePage.goto(`${base}/clients/${booked.clientId}?tab=session-notes`, {
        waitUntil: "networkidle",
        timeout: 90_000,
      });
      const cardWait = savedNoteId
        ? activePage.locator(`[data-testid="session-note-card"][data-note-id="${savedNoteId}"]`)
        : activePage.getByTestId("session-note-card").first();
      await cardWait.waitFor({ state: "visible", timeout: 60_000 });
    });

    const goalRowExpandButton = (card: ReturnType<Page["locator"]>) =>
      card.locator('.space-y-1 button[aria-expanded="false"]').first();

    await withStepTimeout("verify-measurement-on-client-tab", async () => {
      const card = savedNoteId
        ? activePage.locator(`[data-testid="session-note-card"][data-note-id="${savedNoteId}"]`)
        : activePage.getByTestId("session-note-card").first();
      await card.first().waitFor({ state: "visible", timeout: 30_000 });
      const expandBtn = goalRowExpandButton(card.first());
      await expandBtn.click();
      await activePage.getByText(marker, { exact: false }).first().waitFor({ state: "visible", timeout: 20_000 });
      await activePage.getByText(String(initialMetric), { exact: false }).first().waitFor({ state: "visible", timeout: 20_000 });
    });

    await withStepTimeout("edit-via-add-session-note-modal", async () => {
      const goalId = workingGoalId ?? booked.goalId;
      const card = savedNoteId
        ? activePage.locator(`[data-testid="session-note-card"][data-note-id="${savedNoteId}"]`)
        : activePage.getByTestId("session-note-card").first();
      await card.getByTestId("session-note-edit-button").click();
      await activePage.getByRole("dialog").filter({ hasText: /Add Session Note/i }).waitFor({ state: "visible", timeout: 30_000 });
      const valueInput = activePage.locator(`#goal-measurement-value-${goalId}`);
      await valueInput.waitFor({ state: "visible", timeout: 20_000 });
      await valueInput.fill("");
      await valueInput.fill(String(updatedMetric));
      const upsertPromise = activePage.waitForResponse(
        (res) => res.url().includes("/api/session-notes/upsert") && res.request().method() === "POST",
        { timeout: 120_000 },
      );
      await activePage.getByRole("button", { name: /Save Note/i }).click();
      const res = await upsertPromise;
      assert.equal(res.ok(), true, `edit upsert failed: HTTP ${res.status()}`);
      const editBody = (await res.json()) as unknown;
      assert.ok(editBody && typeof editBody === "object", "edit upsert must return a JSON object");
      assertUpsertResponseMetric(editBody, goalId, updatedMetric, "edit-via-add-session-note-modal");
      await activePage.getByLabel(/Close add session note modal/i).click().catch(() => undefined);
    });

    await withStepTimeout("verify-updated-measurement", async () => {
      await activePage.reload({ waitUntil: "networkidle", timeout: 90_000 }).catch(() => undefined);
      const card = savedNoteId
        ? activePage.locator(`[data-testid="session-note-card"][data-note-id="${savedNoteId}"]`)
        : activePage.getByTestId("session-note-card").first();
      await card.first().waitFor({ state: "visible", timeout: 60_000 });
      const expandBtn = goalRowExpandButton(card.first());
      await expandBtn.click();
      await activePage.getByText(String(updatedMetric), { exact: false }).first().waitFor({ state: "visible", timeout: 20_000 });
    });

    await withStepTimeout("cleanup-cancel-session", () => cancelSession(activePage, token, booked.sessionId));

    console.log(
      JSON.stringify({
        ok: true,
        message: "Session note measurement roundtrip validated",
        marker,
        ids,
        savedNoteId,
      }),
    );
  } catch (error) {
    const shotPath = page ? await captureFailureScreenshot(page, "playwright-session-note-measurement-roundtrip") : "N/A";
    console.error(
      JSON.stringify({
        ok: false,
        message: "Session note measurement roundtrip failed",
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
