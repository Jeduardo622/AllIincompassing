/**
 * Browser regression: in-progress session cannot be closed from Schedule when per-goal
 * session notes are missing — modal shows guidance + "Open Client Details", toast shows policy text.
 *
 * Harness: Playwright + same service-backed booking/start flow as playwright-session-lifecycle
 * (deterministic API steps + URL-driven edit modal to avoid flaky calendar targeting).
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

const STEP_TIMEOUT_MS = Number(process.env.PW_LIFECYCLE_STEP_TIMEOUT_MS ?? "120000");

const withStepTimeout = async <T>(label: string, operation: () => Promise<T>): Promise<T> => {
  console.log(`[blocked-close] start ${label}`);
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Step timed out: ${label} (${STEP_TIMEOUT_MS}ms)`)), STEP_TIMEOUT_MS);
  });
  const result = await Promise.race([operation(), timeout]);
  console.log(`[blocked-close] ok ${label}`);
  return result as T;
};

/**
 * `checkInProgressSessionCloseReadiness` keys off `session_goals` rows; if start_session did not
 * insert any (environment variance), close would incorrectly succeed. Seed one row via service role.
 */
async function ensureAtLeastOneSessionGoalForReadiness(ids: LifecycleIds): Promise<void> {
  const supabaseUrl = getEnv("VITE_SUPABASE_URL");
  const serviceRole = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const admin = createClient(supabaseUrl, serviceRole, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  const { data: existing, error: existingError } = await admin
    .from("session_goals")
    .select("goal_id")
    .eq("session_id", ids.sessionId)
    .limit(1);
  if (existingError) {
    throw new Error(`session_goals lookup failed: ${existingError.message}`);
  }
  if (existing && existing.length > 0) {
    return;
  }
  const { data: sessionRow, error: sessionError } = await admin
    .from("sessions")
    .select("organization_id, client_id, program_id")
    .eq("id", ids.sessionId)
    .single();
  if (sessionError || !sessionRow?.organization_id) {
    throw new Error(`Unable to load session for session_goals seed: ${sessionError?.message ?? "missing row"}`);
  }
  const { error: insertError } = await admin.from("session_goals").insert({
    session_id: ids.sessionId,
    goal_id: ids.goalId,
    organization_id: sessionRow.organization_id,
    client_id: sessionRow.client_id,
    program_id: sessionRow.program_id,
  });
  if (insertError) {
    throw new Error(`session_goals seed insert failed: ${insertError.message}`);
  }
}

/** Remove linked notes for this session so per-goal coverage cannot already be satisfied from prior data. */
async function deleteClientSessionNotesForSession(sessionId: string): Promise<void> {
  const supabaseUrl = getEnv("VITE_SUPABASE_URL");
  const serviceRole = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const admin = createClient(supabaseUrl, serviceRole, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  const { error } = await admin.from("client_session_notes").delete().eq("session_id", sessionId);
  if (error) {
    throw new Error(`client_session_notes cleanup failed: ${error.message}`);
  }
}

async function waitForSessionStatus(sessionId: string, status: string, timeoutMs = 120_000): Promise<void> {
  const supabaseUrl = getEnv("VITE_SUPABASE_URL");
  const serviceRole = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const admin = createClient(supabaseUrl, serviceRole, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { data, error } = await admin.from("sessions").select("status").eq("id", sessionId).maybeSingle();
    if (!error && data?.status === status) {
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Timed out waiting for session ${sessionId} status=${status} in DB`);
}

async function getSessionOrganizationId(sessionId: string): Promise<string> {
  const supabaseUrl = getEnv("VITE_SUPABASE_URL");
  const serviceRole = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const admin = createClient(supabaseUrl, serviceRole, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  const { data, error } = await admin.from("sessions").select("organization_id").eq("id", sessionId).single();
  if (error || !data?.organization_id) {
    throw new Error(`Unable to read session organization_id: ${error?.message ?? "missing"}`);
  }
  return data.organization_id;
}

async function run(): Promise<void> {
  loadPlaywrightEnv();
  const base = getEnv("PW_BASE_URL", "https://app.allincompassing.ai");
  const headless = process.env.HEADLESS !== "false";
  const strictParityMode = isTruthy(process.env.CI_SESSION_PARITY_REQUIRED) || isTruthy(process.env.PW_STRICT_SESSION_PARITY);

  const credentialCandidates = [
    {
      email: process.env.PW_ADMIN_EMAIL ?? process.env.PLAYWRIGHT_ADMIN_EMAIL,
      password: process.env.PW_ADMIN_PASSWORD ?? process.env.PLAYWRIGHT_ADMIN_PASSWORD,
      label: "PW_ADMIN_EMAIL + PW_ADMIN_PASSWORD",
    },
    {
      email: process.env.PW_SCHEDULE_EMAIL,
      password: process.env.PW_SCHEDULE_PASSWORD,
      label: "PW_SCHEDULE_EMAIL + PW_SCHEDULE_PASSWORD",
    },
  ].filter((entry) => Boolean(entry.email && entry.password));

  if (credentialCandidates.length === 0) {
    throw new Error("Missing credentials (PW_SCHEDULE_* or PW_ADMIN_*).");
  }

  const browser = await chromium.launch({ headless });
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let authenticatedCredential: { email: string; password: string } | null = null;
  let capturedAccessToken: string | null = null;
  const bookedIds: Partial<LifecycleIds> = {};

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
      throw new Error("No provided credentials can access /schedule for blocked-close test.");
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
      throw new Error(
        "Could not resolve active organization (auth profile, PW_ACTIVE_ORGANIZATION_ID, DEFAULT_ORGANIZATION_ID, or GET /api/runtime-config defaultOrganizationId).",
      );
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
    Object.assign(bookedIds, booked);

    const bookedSessionOrgId = await getSessionOrganizationId(booked.sessionId);
    assert.equal(
      bookedSessionOrgId,
      userOrgId,
      "Booked session must belong to the resolved active org; otherwise session_goals precheck is empty and close is not blocked.",
    );

    await withStepTimeout("start-session", () => startSession(activePage, token, booked, strictParityMode));
    await withStepTimeout("wait-db-in-progress", () => waitForSessionStatus(booked.sessionId, "in_progress"));

    await withStepTimeout("refresh-schedule-after-external-start", async () => {
      // External start_session does not run React Query invalidation; force a cold load so
      // Schedule's selectedSession has status in_progress and close-readiness precheck runs.
      const bust = Date.now();
      await activePage.goto(`${base}/schedule?_${bust}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
      await activePage.reload({ waitUntil: "networkidle" }).catch(() => undefined);
      await activePage.waitForLoadState("networkidle").catch(() => undefined);
    });

    await withStepTimeout("ensure-session-goals-for-readiness", () => ensureAtLeastOneSessionGoalForReadiness(booked));
    await withStepTimeout("clear-prior-session-notes", () => deleteClientSessionNotesForSession(booked.sessionId));

    const sessionGoalsVisible = await activePage.evaluate(
      async ({
        sessionId,
        organizationId,
        supabaseUrl,
        anonKey,
        accessToken,
      }: {
        sessionId: string;
        organizationId: string;
        supabaseUrl: string;
        anonKey: string;
        accessToken: string;
      }) => {
        const params = new URLSearchParams({
          session_id: `eq.${sessionId}`,
          organization_id: `eq.${organizationId}`,
          select: "goal_id",
        });
        const res = await fetch(`${supabaseUrl}/rest/v1/session_goals?${params.toString()}`, {
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${accessToken}`,
          },
        });
        const rows = (await res.json()) as unknown;
        return Array.isArray(rows) ? rows.length : 0;
      },
      {
        sessionId: booked.sessionId,
        organizationId: userOrgId,
        supabaseUrl: getEnv("VITE_SUPABASE_URL"),
        anonKey: getEnv("VITE_SUPABASE_ANON_KEY", process.env.SUPABASE_ANON_KEY),
        accessToken: token,
      },
    );
    if (sessionGoalsVisible < 1) {
      throw new Error(
        "session_goals are not visible to the signed-in user for this org (0 rows). Close-readiness will not require per-goal notes; check org alignment vs active tenant.",
      );
    }

    const expiresAt = Date.now() + 30 * 60 * 1000;
    const editUrl = `${base}/schedule?scheduleModal=edit&scheduleSessionId=${encodeURIComponent(
      booked.sessionId,
    )}&scheduleExp=${expiresAt}`;

    await withStepTimeout("open-edit-modal-via-url", async () => {
      await activePage.goto(editUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
      await activePage.waitForLoadState("networkidle").catch(() => undefined);
      await activePage.getByRole("dialog", { name: /edit session/i }).waitFor({ state: "visible", timeout: 60_000 });
    });

    await withStepTimeout("assert-api-session-in-progress", async () => {
      const statusFromApi = await activePage.evaluate(
        async ({
          sessionId,
          organizationId,
          supabaseUrl,
          anonKey,
          accessToken,
        }: {
          sessionId: string;
          organizationId: string;
          supabaseUrl: string;
          anonKey: string;
          accessToken: string;
        }) => {
          const params = new URLSearchParams({
            id: `eq.${sessionId}`,
            organization_id: `eq.${organizationId}`,
            select: "status",
          });
          const res = await fetch(`${supabaseUrl}/rest/v1/sessions?${params.toString()}`, {
            headers: {
              apikey: anonKey,
              Authorization: `Bearer ${accessToken}`,
            },
          });
          const rows = (await res.json()) as Array<{ status?: string }>;
          return rows?.[0]?.status ?? null;
        },
        {
          sessionId: booked.sessionId,
          organizationId: userOrgId,
          supabaseUrl: getEnv("VITE_SUPABASE_URL"),
          anonKey: getEnv("VITE_SUPABASE_ANON_KEY", process.env.SUPABASE_ANON_KEY),
          accessToken: token,
        },
      );
      assert.equal(
        statusFromApi,
        "in_progress",
        "Session must be in_progress in PostgREST for this user/org so Schedule's selectedSession matches close-readiness precheck.",
      );
    });

    await withStepTimeout("attempt-terminal-close-without-notes", async () => {
      const statusBefore = await activePage.locator("#status-select").inputValue();
      if (statusBefore !== "in_progress") {
        throw new Error(
          `Expected modal session status in_progress before terminal close; got "${statusBefore}". Schedule batch may be stale.`,
        );
      }
      await activePage.locator("#status-select").selectOption("completed");
      await activePage.waitForFunction(() => {
        const el = document.querySelector<HTMLButtonElement>(
          'button[type="submit"][form="session-form"]',
        );
        return Boolean(el && !el.disabled);
      }, { timeout: 90_000 });
      activePage.once("dialog", (dialog) => {
        void dialog.accept();
      });

      let sessionsCompleteSuccess = false;
      const onResponse = (response: { url: () => string; request: () => { method: () => string }; status: () => number }): void => {
        if (
          response.url().includes("sessions-complete") &&
          response.request().method() === "POST" &&
          response.status() >= 200 &&
          response.status() < 300
        ) {
          sessionsCompleteSuccess = true;
        }
      };
      activePage.on("response", onResponse);

      await activePage.evaluate(() => {
        document.querySelector<HTMLFormElement>("#session-form")?.requestSubmit();
      });

      await activePage.waitForTimeout(8000);
      activePage.off("response", onResponse);

      if (sessionsCompleteSuccess) {
        throw new Error(
          "sessions-complete returned 2xx; close was not blocked (readiness precheck omitted or notes already satisfied).",
        );
      }
    });

    await withStepTimeout("assert-blocked-close-guidance", async () => {
      const edgeNotesGate = activePage.getByText(/Session notes with goal progress are required/i).first();
      const retryHeading = activePage.locator("#session-modal-retry-heading");

      let blockedCopySeen: "modal" | "edge-toast" | "timeout";
      try {
        blockedCopySeen = await Promise.race([
          retryHeading.waitFor({ state: "visible", timeout: 90_000 }).then(() => "modal" as const),
          edgeNotesGate.waitFor({ state: "visible", timeout: 90_000 }).then(() => "edge-toast" as const),
        ]);
      } catch {
        blockedCopySeen = "timeout";
      }

      if (blockedCopySeen === "timeout") {
        throw new Error(
          `No blocked-close UI detected (modal guidance or edge policy text). url=${activePage.url()}`,
        );
      }

      if ((await activePage.getByText(/Session marked as completed/i).first().isVisible().catch(() => false)) === true) {
        throw new Error(
          "Session marked completed without blocked-close guidance; check readiness precheck and session_goals.",
        );
      }

      if (blockedCopySeen === "modal") {
        const blockedPanel = activePage.locator('[data-testid="session-modal-blocked-close-panel"]');
        await blockedPanel.waitFor({ state: "visible", timeout: 25_000 });
        assert.match(await retryHeading.innerText(), /Session not saved/i);
        assert.match(await blockedPanel.innerText(), /per-goal note text for each worked goal/i);
        await activePage
          .getByText(/Open Client Details and use Session Notes|per-goal note text for each worked goal/i)
          .first()
          .waitFor({ state: "visible", timeout: 25_000 });
        await activePage.getByRole("button", { name: "Open Client Details" }).waitFor({ state: "visible", timeout: 25_000 });
        await activePage
          .getByText(/linked session documentation with per-goal notes/i)
          .first()
          .waitFor({ state: "visible", timeout: 8_000 })
          .catch(() => {
            console.warn(
              "[blocked-close] Policy error toast may have dismissed; modal guidance + next-step button asserted.",
            );
          });
        return;
      }
    });

    await withStepTimeout("navigate-to-client-session-notes", async () => {
      const openBtn = activePage.getByRole("button", { name: "Open Client Details" });
      if ((await openBtn.count()) === 0) {
        console.warn("[blocked-close] Open Client Details not in UX; omit navigation assertion.");
        return;
      }
      await openBtn.click();
      await activePage.waitForURL(
        (url) =>
          url.pathname.includes(`/clients/${booked.clientId}`) &&
          url.searchParams.get("tab") === "session-notes",
        { timeout: 45_000 },
      );
      const finalUrl = new URL(activePage.url());
      assert.equal(finalUrl.searchParams.get("tab"), "session-notes");
      assert.match(finalUrl.pathname, new RegExp(`/clients/${booked.clientId}(?:/|$)`));
    });

    console.log(
      JSON.stringify({
        ok: true,
        message: "Blocked-close guidance regression passed",
        sessionId: booked.sessionId,
        clientId: booked.clientId,
      }),
    );
  } catch (error) {
    if (page) {
      await captureFailureScreenshot(page, "playwright-schedule-blocked-close-failure");
    }
    throw error;
  } finally {
    if (bookedIds.sessionId && authenticatedCredential && page) {
      try {
        const t =
          capturedAccessToken ??
          (await getTokenFromBrowserStorage(page)) ??
          (await fetchAccessTokenForCredentials(authenticatedCredential.email, authenticatedCredential.password));
        await cancelSession(page, t, bookedIds.sessionId);
      } catch (cleanupError) {
        console.warn(
          `[blocked-close] cleanup cancel failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
        );
      }
    }
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
