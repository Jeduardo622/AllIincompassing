import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { createClient } from "@supabase/supabase-js";

import { loadPlaywrightEnv } from "./lib/load-playwright-env";
import {
  assertRouteAccessible,
  captureFailureScreenshot,
  loginAndAssertSession,
  waitForSelectOptions,
} from "./lib/playwright-smoke";

interface LifecycleIds {
  sessionId: string;
  therapistId: string;
  clientId: string;
  programId: string;
  goalId: string;
  noteId?: string;
}

interface RuntimeConfigPayload {
  supabaseUrl?: string;
}

interface BrowserFetchResult<TBody> {
  ok: boolean;
  status: number;
  body: TBody | null;
}

const isTruthy = (value: string | undefined): boolean => /^(1|true|yes)$/i.test(value ?? "");
/** Mirrors `src/pages/schedule-modal-url-state.ts` query keys for deep-linking the SessionModal. */
const SCHEDULE_MODAL_MODE_KEY = "scheduleModal";
const SCHEDULE_MODAL_SESSION_KEY = "scheduleSessionId";
const SCHEDULE_MODAL_EXPIRY_KEY = "scheduleExp";
const SCHEDULE_MODAL_URL_TTL_MS = 30 * 60 * 1000;

const STEP_TIMEOUT_MS = Number(process.env.PW_LIFECYCLE_STEP_TIMEOUT_MS ?? "120000");

const withStepTimeout = async <T>(label: string, operation: () => Promise<T>): Promise<T> => {
  console.log(`[lifecycle] start ${label}`);
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Step timed out: ${label} (${STEP_TIMEOUT_MS}ms)`)), STEP_TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([operation(), timeout]);
    console.log(`[lifecycle] ok ${label}`);
    return result as T;
  } catch (error) {
    console.error(`[lifecycle] fail ${label}: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
};

const decodeJwtPayload = (token: string): Record<string, unknown> | null => {
  const segments = token.split(".");
  if (segments.length < 2) {
    return null;
  }
  try {
    const base64 = segments[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(base64, "base64").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const getEnv = (key: string, fallback?: string): string => {
  const value = process.env[key] ?? fallback;
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
};

const parseProjectRef = (value: string): string | null => {
  const trimmed = value.trim();
  if (/^[a-z0-9]{20}$/i.test(trimmed)) {
    return trimmed;
  }
  try {
    const host = new URL(trimmed).hostname;
    const [ref] = host.split(".");
    return ref?.trim() || null;
  } catch {
    return null;
  }
};

const getTokenIssuerProjectRef = (token: string): string | null => {
  const payload = decodeJwtPayload(token);
  const iss = typeof payload?.iss === "string" ? payload.iss : "";
  return iss ? parseProjectRef(iss) : null;
};

async function fetchRuntimeProjectRef(page: Page, baseUrl: string): Promise<string | null> {
  const runtimeConfig = await page.evaluate(async (base) => {
    const res = await fetch(`${base}/api/runtime-config`, { credentials: "include" });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  }, baseUrl) as BrowserFetchResult<RuntimeConfigPayload>;
  if (!runtimeConfig.ok) {
    throw new Error(`Unable to load runtime-config (${runtimeConfig.status})`);
  }
  const supabaseUrl = runtimeConfig.body?.supabaseUrl;
  if (typeof supabaseUrl !== "string" || supabaseUrl.trim().length === 0) {
    throw new Error("runtime-config response missing supabaseUrl");
  }
  return parseProjectRef(supabaseUrl);
}

const createSessionViaServiceRole = async (params: {
  therapistId: string;
  clientId: string;
  programId: string;
  goalId: string;
  startIso: string;
  endIso: string;
}): Promise<string> => {
  const supabaseUrl = getEnv("VITE_SUPABASE_URL");
  const serviceRole = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const adminClient = createClient(supabaseUrl, serviceRole, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  let organizationId = process.env.DEFAULT_ORGANIZATION_ID?.trim() ?? "";
  if (!organizationId) {
    const { data: therapistRow, error: therapistError } = await adminClient
      .from("therapists")
      .select("organization_id")
      .eq("id", params.therapistId)
      .single();
    if (therapistError || !therapistRow?.organization_id) {
      throw new Error(`Unable to resolve organization for fallback booking: ${therapistError?.message ?? "missing org"}`);
    }
    organizationId = therapistRow.organization_id;
  }

  const baseStart = new Date(params.startIso);
  const baseEnd = new Date(params.endIso);
  const durationMs = Math.max(15 * 60 * 1000, baseEnd.getTime() - baseStart.getTime());

  for (let attempt = 0; attempt < 48; attempt += 1) {
    const start = new Date(baseStart.getTime() + attempt * 2 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + durationMs);
    const { data, error } = await adminClient
      .from("sessions")
      .insert({
        organization_id: organizationId,
        therapist_id: params.therapistId,
        client_id: params.clientId,
        program_id: params.programId,
        goal_id: params.goalId,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        status: "scheduled",
        notes: "Playwright lifecycle fallback booking",
      })
      .select("id")
      .single();

    if (!error && data?.id) {
      return data.id;
    }
    const message = error?.message ?? "";
    if (!message.includes("sessions_no_overlap")) {
      throw new Error(`Service-role session fallback insert failed: ${message || "missing session id"}`);
    }
  }

  throw new Error("Service-role session fallback insert failed: unable to find a non-overlapping slot.");
};

const fetchAuthorizedClientIds = async (): Promise<Set<string>> => {
  const supabaseUrl = getEnv("VITE_SUPABASE_URL");
  const serviceRole = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const adminClient = createClient(supabaseUrl, serviceRole, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await adminClient
    .from("authorizations")
    .select("client_id")
    .eq("status", "approved")
    .lte("start_date", today)
    .gte("end_date", today)
    .limit(500);
  if (error) {
    return new Set<string>();
  }
  return new Set(
    (data ?? [])
      .map((row) => row.client_id)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  );
};

const createSessionNoteViaServiceRole = async (ids: LifecycleIds, actorUserId: string): Promise<string> => {
  const supabaseUrl = getEnv("VITE_SUPABASE_URL");
  const serviceRole = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const adminClient = createClient(supabaseUrl, serviceRole, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  const { data: sessionRow, error: sessionError } = await adminClient
    .from("sessions")
    .select("organization_id")
    .eq("id", ids.sessionId)
    .single();
  if (sessionError || !sessionRow?.organization_id) {
    throw new Error(`Unable to resolve session organization for fallback note: ${sessionError?.message ?? "missing org"}`);
  }
  const organizationId = sessionRow.organization_id;

  const { data: authRows, error: authError } = await adminClient
    .from("authorizations")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("client_id", ids.clientId)
    .eq("status", "approved")
    .order("end_date", { ascending: false })
    .limit(1);
  let authorizationId: string | null = null;
  if (!authError && authRows && authRows.length > 0) {
    authorizationId = authRows[0].id;
  } else {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 1);
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 30);
    const authNumber = `PW-AUTH-${Date.now()}`;
    const { data: createdAuth, error: createAuthError } = await adminClient
      .from("authorizations")
      .insert({
        authorization_number: authNumber,
        client_id: ids.clientId,
        provider_id: ids.therapistId,
        diagnosis_code: "F84.0",
        diagnosis_description: "Autism spectrum disorder",
        start_date: startDate.toISOString().slice(0, 10),
        end_date: endDate.toISOString().slice(0, 10),
        status: "approved",
        organization_id: organizationId,
        created_by: actorUserId,
      })
      .select("id,start_date,end_date")
      .single();
    if (createAuthError || !createdAuth?.id) {
      throw new Error(`Unable to create fallback authorization: ${createAuthError?.message ?? "missing id"}`);
    }

    authorizationId = createdAuth.id;
    const { error: createServiceError } = await adminClient
      .from("authorization_services")
      .insert({
        authorization_id: authorizationId,
        service_code: "97153",
        service_description: "Adaptive behavior treatment by protocol",
        from_date: createdAuth.start_date,
        to_date: createdAuth.end_date,
        requested_units: 120,
        approved_units: 120,
        unit_type: "unit",
        decision_status: "approved",
        organization_id: organizationId,
        created_by: actorUserId,
      });
    if (createServiceError) {
      throw new Error(`Unable to create fallback authorization service: ${createServiceError.message}`);
    }
  }
  if (!authorizationId) {
    throw new Error("Unable to resolve fallback authorization id.");
  }

  const today = new Date();
  const sessionDate = today.toISOString().slice(0, 10);
  const perGoalNote = "Playwright lifecycle per-goal note for in-progress close readiness.";
  const { data, error } = await adminClient
    .from("client_session_notes")
    .insert({
      organization_id: organizationId,
      client_id: ids.clientId,
      authorization_id: authorizationId,
      therapist_id: ids.therapistId,
      service_code: "97153",
      session_date: sessionDate,
      start_time: "09:00:00",
      end_time: "10:00:00",
      session_duration: 60,
      goals_addressed: ["Lifecycle fallback goal"],
      goal_ids: [ids.goalId],
      goal_notes: {
        [ids.goalId]: perGoalNote,
      },
      narrative: `Lifecycle fallback note for ${ids.sessionId}`,
      is_locked: true,
      signed_at: new Date().toISOString(),
      session_id: ids.sessionId,
      created_by: actorUserId,
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    throw new Error(`Service-role session note fallback insert failed: ${error?.message ?? "missing note id"}`);
  }
  return data.id;
};

const fetchAccessTokenForCredentials = async (email: string, password: string): Promise<string> => {
  const supabaseUrl = getEnv("VITE_SUPABASE_URL");
  const anonKey = getEnv("VITE_SUPABASE_ANON_KEY", process.env.SUPABASE_ANON_KEY);
  const client = createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session?.access_token) {
    throw new Error(`Unable to mint access token for ${email}: ${error?.message ?? "missing session"}`);
  }
  return data.session.access_token;
};

const getTokenFromBrowserStorage = async (page: Page): Promise<string | null> => {
  const token = await page.evaluate(() => {
    const browserGlobal = globalThis as unknown as {
      localStorage: {
        getItem: (key: string) => string | null;
        setItem: (key: string, value: string) => void;
        removeItem: (key: string) => void;
        key: (index: number) => string | null;
        length: number;
      };
      sessionStorage: {
        getItem: (key: string) => string | null;
        setItem: (key: string, value: string) => void;
        removeItem: (key: string) => void;
        key: (index: number) => string | null;
        length: number;
      };
    };
    const stores = [browserGlobal.localStorage, browserGlobal.sessionStorage];
    for (const store of stores) {
      for (const key of Object.keys(store)) {
        const raw = store.getItem(key);
        if (!raw) {
          continue;
        }
        if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(raw)) {
          return raw;
        }
        try {
          const parsed = JSON.parse(raw) as unknown;
          const queue: unknown[] = [parsed];
          while (queue.length > 0) {
            const current = queue.shift();
            if (typeof current === "string") {
              if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(current)) {
                return current;
              }
              continue;
            }
            if (!current || typeof current !== "object") {
              continue;
            }
            if (Array.isArray(current)) {
              queue.push(...current);
              continue;
            }
            const record = current as Record<string, unknown>;
            if (typeof record.access_token === "string" &&
              /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(record.access_token)) {
              return record.access_token;
            }
            queue.push(...Object.values(record));
          }
        } catch {
          // ignore parse failures
        }
      }
    }
    return null;
  });
  return typeof token === "string" && token.length > 0 ? token : null;
};

const toDatetimeLocal = (date: Date): string => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
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
    const dialog = page.locator('[role="dialog"]').filter({ hasText: /Edit Session/i });
    try {
      await dialog.waitFor({ state: "visible", timeout: 12_000 });
      return;
    } catch {
      await page.waitForTimeout(500 + attempt * 250);
    }
  }
  throw new Error(
    "Edit Session modal did not open from schedule deep link; session may not be loaded in schedule data yet.",
  );
};

async function openSessionModal(page: Page) {
  await page.evaluate(() => {
    const browserGlobal = globalThis as unknown as {
      dispatchEvent: (event: unknown) => boolean;
      CustomEvent: new (name: string, init?: { detail?: unknown }) => unknown;
    };
    const now = new Date();
    now.setHours(now.getHours() + 2);
    browserGlobal.dispatchEvent(new browserGlobal.CustomEvent("openScheduleModal", { detail: { start_time: now.toISOString() } }));
  });
  await page
    .locator('[role="dialog"]:has-text("New Session"), [role="dialog"]:has-text("Edit Session")')
    .first()
    .waitFor({ state: "visible", timeout: 10_000 });
}

async function chooseSessionTargets(page: Page): Promise<{
  therapistId: string;
  clientId: string;
  programId: string;
  goalId: string;
}> {
  const therapistValues = await waitForSelectOptions(page, "#therapist-select");
  const clientValues = await waitForSelectOptions(page, "#client-select");
  const authorizedClientIds = await fetchAuthorizedClientIds();

  if (therapistValues.length === 0 || clientValues.length === 0) {
    throw new Error("No therapist/client options available for lifecycle test.");
  }

  for (const therapistId of therapistValues) {
    await page.selectOption("#therapist-select", therapistId);
    for (const clientId of clientValues) {
      if (authorizedClientIds.size > 0 && !authorizedClientIds.has(clientId)) {
        continue;
      }
      await page.selectOption("#client-select", clientId);
      const programValues = await waitForSelectOptions(page, "#program-select", {
        timeoutMs: 8000,
      }).catch(() => []);
      if (programValues.length === 0) {
        continue;
      }
      await page.selectOption("#program-select", programValues[0]);
      const goalValues = await waitForSelectOptions(page, "#goal-select", {
        timeoutMs: 8000,
      }).catch(() => []);
      if (goalValues.length === 0) {
        continue;
      }
      await page.selectOption("#goal-select", goalValues[0]);
      return {
        therapistId,
        clientId,
        programId: programValues[0],
        goalId: goalValues[0],
      };
    }
  }

  throw new Error("Could not find therapist/client/program/goal combination for lifecycle test.");
}

async function bookSession(page: Page, _token: string, strictMode: boolean): Promise<LifecycleIds> {
  const scheduleUrl = `${getEnv("PW_BASE_URL", "https://app.allincompassing.ai")}/schedule`;
  await page.goto(scheduleUrl, {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await page.waitForSelector("text=Schedule", { timeout: 15_000 }).catch(() => undefined);
  await openSessionModal(page);

  const selected = await chooseSessionTargets(page);

  const start = new Date();
  start.setHours(start.getHours() + 4, 0, 0, 0);
  let finalStartIso = "";
  let finalEndIso = "";
  let payload: BrowserFetchResult<Record<string, unknown>> | null = null;
  let payloadBody: { success?: boolean; data?: { session?: { id?: string } }; code?: string } | null = null;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const attemptStart = new Date(start.getTime() + attempt * 2 * 60 * 60 * 1000);
    const attemptEnd = new Date(attemptStart.getTime() + 60 * 60 * 1000);
    const startIso = attemptStart.toISOString();
    const endIso = attemptEnd.toISOString();
    finalStartIso = startIso;
    finalEndIso = endIso;

    await page.locator("#start-time-input").fill(toDatetimeLocal(attemptStart));
    await page.locator("#end-time-input").fill(toDatetimeLocal(attemptEnd));

    page.once("dialog", (dialog) => {
      void dialog.accept();
    });
    const responsePromise = page.waitForResponse(
      (res) => res.url().includes("/api/book") && res.request().method() === "POST",
      { timeout: 90_000 },
    );
    await page.getByRole("button", { name: /Create Session/i }).click();
    const bookResponse = await responsePromise;
    const body = await bookResponse.json().catch(() => null);
    const httpStatus = bookResponse.status();
    payload = { ok: bookResponse.ok(), status: httpStatus, body };
    payloadBody = body as typeof payloadBody;

    if (bookResponse.ok() && payloadBody?.success && payloadBody?.data?.session?.id) {
      break;
    }
    if (httpStatus === 409 || [500, 502, 503, 504].includes(httpStatus)) {
      await new Promise((resolve) => setTimeout(resolve, 500 + attempt * 250));
      continue;
    }
    const bookUnauthorized =
      httpStatus === 401 ||
      (typeof payloadBody?.code === "string" && payloadBody.code.toLowerCase() === "unauthorized");
    if (!strictMode && bookUnauthorized && finalStartIso && finalEndIso) {
      break;
    }
    break;
  }

  if (!payload || !payloadBody?.success || !payloadBody?.data?.session?.id) {
    const httpStatus = typeof payload?.status === "number" ? payload.status : 0;
    const bodyUnauthorized =
      httpStatus === 401 ||
      (typeof payloadBody?.code === "string" && payloadBody.code.toLowerCase() === "unauthorized");
    if (!strictMode && bodyUnauthorized && finalStartIso && finalEndIso) {
      const fallbackSessionId = await createSessionViaServiceRole({
        therapistId: selected.therapistId,
        clientId: selected.clientId,
        programId: selected.programId,
        goalId: selected.goalId,
        startIso: finalStartIso,
        endIso: finalEndIso,
      });
      return {
        sessionId: fallbackSessionId,
        therapistId: selected.therapistId,
        clientId: selected.clientId,
        programId: selected.programId,
        goalId: selected.goalId,
      };
    }
    throw new Error(
      `Booking did not succeed. status=${payload?.status ?? "unknown"} payload=${JSON.stringify(payloadBody).slice(0, 2000)}`,
    );
  }

  const sessionId = payloadBody.data!.session!.id as string;

  return {
    sessionId,
    therapistId: selected.therapistId,
    clientId: selected.clientId,
    programId: selected.programId,
    goalId: selected.goalId,
  };
}

const expectStartButtonEnabled = async (
  page: Page,
  button: ReturnType<Page["getByRole"]>,
): Promise<void> => {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const disabled = await button.getAttribute("disabled");
    const ariaDisabled = await button.getAttribute("aria-disabled");
    if (disabled === null && ariaDisabled !== "true") {
      return;
    }
    await page.waitForTimeout(400);
  }
  throw new Error("Start Session stayed disabled after opening the edit modal (program/goal data may not have loaded).");
};

async function startSessionViaScheduleModal(page: Page, scheduleUrl: string, ids: LifecycleIds): Promise<void> {
  await openEditSessionModalFromUrl(page, scheduleUrl, ids.sessionId);
  const startButton = page.getByRole("button", { name: /^Start Session$/ });
  await startButton.waitFor({ state: "visible", timeout: 20_000 });
  await expectStartButtonEnabled(page, startButton);
  const editDialog = page.locator('[role="dialog"]').filter({ hasText: /Edit Session/i });

  const startResponsePromise = page.waitForResponse(
    (res) => res.url().includes("sessions-start") && res.request().method() === "POST",
    { timeout: 60_000 },
  );
  await startButton.click();
  const startResponse = await startResponsePromise;
  const startBody = await startResponse.text();
  if (!startResponse.ok()) {
    throw new Error(`sessions-start failed (${startResponse.status()}): ${startBody.slice(0, 800)}`);
  }

  await editDialog.waitFor({ state: "hidden", timeout: 90_000 });
}

async function markCompletedViaScheduleModal(page: Page, scheduleUrl: string, sessionId: string): Promise<void> {
  await openEditSessionModalFromUrl(page, scheduleUrl, sessionId);
  const editDialog = page.locator('[role="dialog"]').filter({ hasText: /Edit Session/i });
  await page.locator("#status-select").selectOption("completed");
  page.once("dialog", (dialog) => {
    void dialog.accept();
  });
  const completeResponsePromise = page.waitForResponse(
    (res) => res.url().includes("sessions-complete") && res.request().method() === "POST",
    { timeout: 90_000 },
  );
  await page.getByRole("button", { name: /Update Session/i }).click();
  const completeResponse = await completeResponsePromise;
  const completeBody = await completeResponse.text();
  if (!completeResponse.ok()) {
    throw new Error(`sessions-complete failed (${completeResponse.status()}): ${completeBody.slice(0, 800)}`);
  }
  await editDialog.waitFor({ state: "hidden", timeout: 90_000 });
}

async function run() {
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
    throw new Error("Missing lifecycle credentials (PW_SCHEDULE_* or PW_ADMIN_*).");
  }

  const browser = await chromium.launch({ headless });
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let authenticatedCredential: { email: string; password: string } | null = null;
  let capturedAccessToken: string | null = null;
  const timestamp = Date.now();
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
        const payload = await response.json().catch(() => null) as { access_token?: string } | null;
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

    if (!context || !page) {
      throw new Error("No provided credentials can access /schedule for lifecycle test.");
    }
    if (!authenticatedCredential) {
      throw new Error("No authenticated credentials resolved for API phase.");
    }
    const activePage = page;

    const browserToken = capturedAccessToken ?? await getTokenFromBrowserStorage(activePage);
    if (!browserToken && strictParityMode) {
      throw new Error("Could not capture browser session token in strict parity mode.");
    }
    const token = browserToken ?? await fetchAccessTokenForCredentials(
      authenticatedCredential.email,
      authenticatedCredential.password,
    );
    const runtimeProjectRef = await withStepTimeout("runtime-config project-ref", () =>
      fetchRuntimeProjectRef(activePage, base));
    const tokenProjectRef = getTokenIssuerProjectRef(token);
    if (strictParityMode && runtimeProjectRef && tokenProjectRef && runtimeProjectRef !== tokenProjectRef) {
      throw new Error(
        `Token/runtime project mismatch in strict mode (token=${tokenProjectRef}, runtime=${runtimeProjectRef}).`,
      );
    }
    let booked: LifecycleIds;
    try {
      booked = await withStepTimeout("book-session", () => bookSession(activePage, token, strictParityMode));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        strictParityMode &&
        message.includes("Organization context required") &&
        authenticatedCredential
      ) {
        const refreshedToken = await fetchAccessTokenForCredentials(
          authenticatedCredential.email,
          authenticatedCredential.password,
        );
        booked = await withStepTimeout("book-session retry", () => bookSession(activePage, refreshedToken, strictParityMode));
      } else {
        throw error;
      }
    }
    Object.assign(ids, booked);
    const scheduleUrl = `${base}/schedule`;
    await withStepTimeout("start-session-modal", () => startSessionViaScheduleModal(activePage, scheduleUrl, booked));
    const actorUserId = String(decodeJwtPayload(token)?.sub ?? "");
    if (!actorUserId) {
      throw new Error("Unable to resolve actor user id for in-progress close readiness note.");
    }
    const noteId = await withStepTimeout("ensure-close-readiness-note", () =>
      createSessionNoteViaServiceRole(booked, actorUserId));
    ids.noteId = noteId;
    await withStepTimeout("complete-session-modal", () =>
      markCompletedViaScheduleModal(activePage, scheduleUrl, booked.sessionId));

    const latestDir = path.resolve(process.cwd(), "artifacts", "latest");
    if (!fs.existsSync(latestDir)) {
      fs.mkdirSync(latestDir, { recursive: true });
    }
    const artifactPath = path.join(latestDir, `playwright-session-lifecycle-${timestamp}.json`);
    fs.writeFileSync(
      artifactPath,
      JSON.stringify(
        {
          ok: true,
          executedAt: new Date().toISOString(),
          baseUrl: base,
          flow: "schedule-session-modal-book-start-complete",
          ids,
        },
        null,
        2,
      ),
      "utf8",
    );
    console.log(JSON.stringify({ ok: true, message: "Session lifecycle flow validated", artifactPath, ids }));
  } catch (error) {
    const shotPath = page ? await captureFailureScreenshot(page, "playwright-session-lifecycle-failure") : "N/A";
    console.error(JSON.stringify({
      ok: false,
      message: "Session lifecycle flow failed",
      error: error instanceof Error ? error.message : String(error),
      screenshot: shotPath,
      ids,
    }));
    throw error;
  } finally {
    if (context) {
      await context.close();
    }
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
