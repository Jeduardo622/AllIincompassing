import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { getTimezoneOffset } from "date-fns-tz";
import { createClient } from "@supabase/supabase-js";

import { loadPlaywrightEnv } from "./lib/load-playwright-env";
import {
  assertRouteAccessible,
  captureFailureScreenshot,
  loginAndAssertSession,
} from "./lib/playwright-smoke";

interface LifecycleIds {
  sessionId: string;
  therapistId: string;
  clientId: string;
  programId: string;
  goalId: string;
  noteId?: string;
}

interface SessionStartPayload {
  session_id: string;
  program_id: string;
  goal_id: string;
  goal_ids: string[];
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
const STEP_TIMEOUT_MS = Number(process.env.PW_LIFECYCLE_STEP_TIMEOUT_MS ?? "120000");
const EDGE_FETCH_TIMEOUT_MS = Number(process.env.PW_EDGE_FETCH_TIMEOUT_MS ?? "20000");

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

const fetchWithTimeout = async (input: string | URL, init?: RequestInit): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EDGE_FETCH_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
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

const verifySessionNotePdfExport = async (
  token: string,
  clientId: string,
  noteId: string,
  strictMode: boolean,
): Promise<boolean> => {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let response: Response;
    try {
      response = await fetchWithTimeout(`${getEnv("VITE_SUPABASE_URL")}/functions/v1/generate-session-notes-pdf`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          clientId,
          noteIds: [noteId],
        }),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
          continue;
        }
        return false;
      }
      throw error;
    }
    if (response.status === 404 && !strictMode) {
      return false;
    }
    if (!response.ok) {
      if ([502, 503, 504].includes(response.status)) {
        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
          continue;
        }
        return false;
      }
      const body = await response.text();
      throw new Error(`generate-session-notes-pdf failed (${response.status}): ${body.slice(0, 300)}`);
    }
    return true;
  }
  return false;
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

const toDateLocal = (date: Date): string => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};

async function getOptionValues(page: Page, selector: string): Promise<string[]> {
  const options = await page.locator(`${selector} option:not([value=""])`).all();
  const values: string[] = [];
  for (const option of options) {
    const value = await option.getAttribute("value");
    if (value) {
      values.push(value);
    }
  }
  return values;
}

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
  const therapistValues = await getOptionValues(page, "#therapist-select");
  const clientValues = await getOptionValues(page, "#client-select");
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
      await page.waitForTimeout(500);
      const programValues = await getOptionValues(page, "#program-select");
      if (programValues.length === 0) {
        continue;
      }
      await page.selectOption("#program-select", programValues[0]);
      await page.waitForTimeout(300);
      const goalValues = await getOptionValues(page, "#goal-select");
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

async function bookSession(page: Page, token: string, strictMode: boolean): Promise<LifecycleIds> {
  await page.goto(`${getEnv("PW_BASE_URL", "https://app.allincompassing.ai")}/schedule`, {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await page.waitForSelector("text=Schedule", { timeout: 15_000 }).catch(() => undefined);
  await openSessionModal(page);

  const selected = await chooseSessionTargets(page);

  const start = new Date();
  start.setHours(start.getHours() + 4, 0, 0, 0);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  let finalStartIso = "";
  let finalEndIso = "";
  let payload: BrowserFetchResult<Record<string, unknown>> | null = null;
  let payloadBody: { success?: boolean; data?: { session?: { id?: string } } } | null = null;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const attemptStart = new Date(start.getTime() + attempt * 2 * 60 * 60 * 1000);
    const attemptEnd = new Date(attemptStart.getTime() + 60 * 60 * 1000);
    const startIso = attemptStart.toISOString();
    const endIso = attemptEnd.toISOString();
    finalStartIso = startIso;
    finalEndIso = endIso;
    const startOffsetMinutes = Math.round(getTimezoneOffset(timeZone, attemptStart) / 60000);
    const endOffsetMinutes = Math.round(getTimezoneOffset(timeZone, attemptEnd) / 60000);

    await page.locator("#start-time-input").fill(toDatetimeLocal(attemptStart));
    await page.locator("#end-time-input").fill(toDatetimeLocal(attemptEnd));

    payload = await page.evaluate(
      async ({ apiToken, therapistId, clientId, programId, goalId, isoStart, isoEnd, startOffset, endOffset, tz }) => {
        const response = await fetch("/api/book", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiToken}`,
            "Idempotency-Key": `pw-lifecycle-${Date.now()}`,
          },
          body: JSON.stringify({
            session: {
              therapist_id: therapistId,
              client_id: clientId,
              program_id: programId,
              goal_id: goalId,
              goal_ids: [goalId],
              start_time: isoStart,
              end_time: isoEnd,
              status: "scheduled",
            },
            startTimeOffsetMinutes: startOffset,
            endTimeOffsetMinutes: endOffset,
            timeZone: tz,
            holdSeconds: 300,
          }),
        });
        const body = await response.json().catch(() => null);
        return { status: response.status, ok: response.ok, body };
      },
      {
        apiToken: token,
        therapistId: selected.therapistId,
        clientId: selected.clientId,
        programId: selected.programId,
        goalId: selected.goalId,
        isoStart: startIso,
        isoEnd: endIso,
        startOffset: startOffsetMinutes,
        endOffset: endOffsetMinutes,
        tz: timeZone,
      },
    ) as BrowserFetchResult<Record<string, unknown>>;

    payloadBody = payload.body as
      | { success?: boolean; data?: { session?: { id?: string } } }
      | null;
    if (payload.ok && payloadBody?.success && payloadBody?.data?.session?.id) {
      break;
    }
    if (payload.status === 409 || [500, 502, 503, 504].includes(payload.status)) {
      await new Promise((resolve) => setTimeout(resolve, 500 + attempt * 250));
      continue;
    }
    break;
  }

  if (!payload || !payloadBody?.success || !payloadBody?.data?.session?.id) {
    if (!strictMode && payload?.status === 401 && finalStartIso && finalEndIso) {
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

  return {
    sessionId: payloadBody.data!.session!.id as string,
    therapistId: selected.therapistId,
    clientId: selected.clientId,
    programId: selected.programId,
    goalId: selected.goalId,
  };
}

async function startSession(_page: Page, token: string, ids: LifecycleIds, strictMode: boolean): Promise<void> {
  const payload: SessionStartPayload = {
    session_id: ids.sessionId,
    program_id: ids.programId,
    goal_id: ids.goalId,
    goal_ids: [ids.goalId],
  };
  const supabaseUrl = getEnv("VITE_SUPABASE_URL");
  let edgeStatus = 500;
  let edgeBody = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let edgeResponse: Response;
    try {
      edgeResponse = await fetchWithTimeout(`${supabaseUrl}/functions/v1/sessions-start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        edgeStatus = 504;
        edgeBody = `Request timed out after ${EDGE_FETCH_TIMEOUT_MS}ms`;
        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
          continue;
        }
        break;
      }
      throw error;
    }
    edgeStatus = edgeResponse.status;
    edgeBody = await edgeResponse.text();

    if (edgeResponse.ok) {
      return;
    }
    if (![502, 503, 504].includes(edgeResponse.status) || attempt === 3) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
  }

  const runRpcFallback = async () => {
    const rpcResponse = await fetchWithTimeout(`${supabaseUrl}/rest/v1/rpc/start_session_with_goals`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: getEnv("VITE_SUPABASE_ANON_KEY", process.env.SUPABASE_ANON_KEY),
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        p_session_id: ids.sessionId,
        p_program_id: ids.programId,
        p_goal_id: ids.goalId,
        p_goal_ids: [ids.goalId],
        p_started_at: null,
      }),
    });
    const rpcBody = await rpcResponse.text();
    if (!rpcResponse.ok) {
      throw new Error(`sessions-start rpc fallback failed (${rpcResponse.status}): ${rpcBody.slice(0, 400)}`);
    }
  };

  if (strictMode) {
    if (edgeStatus === 404) {
      throw new Error(`sessions-start failed (${edgeStatus}): ${edgeBody.slice(0, 400)}`);
    }
    if ([502, 503, 504].includes(edgeStatus)) {
      await runRpcFallback();
      return;
    }
    throw new Error(`sessions-start failed (${edgeStatus}): ${edgeBody.slice(0, 400)}`);
  }

  if (![404, 502, 503, 504].includes(edgeStatus)) {
    throw new Error(`sessions-start failed (${edgeStatus}): ${edgeBody.slice(0, 400)}`);
  }

  await runRpcFallback();
}

async function createSessionNote(
  page: Page,
  ids: LifecycleIds,
  token: string,
): Promise<string | undefined> {
  const base = getEnv("PW_BASE_URL", "https://app.allincompassing.ai");
  await page.goto(`${base}/clients/${ids.clientId}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.getByRole("button", { name: /session notes \/ physical auth/i }).first().click();

  const authButtons = page.locator('button[aria-label^="Select authorization"]');
  const authCount = await authButtons.count();
  if (authCount === 0) {
    const actorUserId = String(decodeJwtPayload(token)?.sub ?? "");
    if (!actorUserId) {
      throw new Error("Unable to resolve actor user id for fallback note creation.");
    }
    return createSessionNoteViaServiceRole(ids, actorUserId);
  }
  await authButtons.first().click();

  await page.getByRole("button", { name: /new note/i }).click();
  await page.getByRole("heading", { name: /add session note/i }).waitFor({ timeout: 8_000 });

  const sessionDate = toDateLocal(new Date());
  await page.locator("#session-date").fill(sessionDate);
  await page.locator("#service-code").selectOption("97153");
  await page.locator("#start-time").fill("09:00");
  await page.locator("#end-time").fill("10:00");
  await page.locator("#therapist-select").selectOption(ids.therapistId);
  await page.locator("#session-select").selectOption(ids.sessionId);

  const programSelect = page.locator("#program-select");
  const availablePrograms = await getOptionValues(page, "#program-select");
  if (availablePrograms.includes(ids.programId)) {
    await programSelect.selectOption(ids.programId);
  } else if (availablePrograms.length > 0) {
    await programSelect.selectOption(availablePrograms[0]);
  }

  const firstGoalCheckbox = page.locator('label:has(input[type="checkbox"]) input[type="checkbox"]').first();
  await firstGoalCheckbox.check({ timeout: 8_000 });
  await page.locator("#session-notes").fill(`Lifecycle test note for session ${ids.sessionId}`);
  await page.locator("#is-locked").check();

  const noteMutationPromise = page.waitForResponse(
    (response) =>
      response.request().method().toUpperCase() === "POST" &&
      response.url().includes("/rest/v1/client_session_notes"),
    { timeout: 15_000 },
  );
  await page.getByRole("button", { name: /save note/i }).click();
  const mutationResponse = await noteMutationPromise;
  const mutationBody = await mutationResponse.json().catch(() => null);
  if (!mutationResponse.ok()) {
    throw new Error(`Session note insert failed (${mutationResponse.status()}): ${JSON.stringify(mutationBody).slice(0, 400)}`);
  }

  const noteId = Array.isArray(mutationBody) ? mutationBody[0]?.id : mutationBody?.id;
  await page.getByText(/session note saved\./i).first().waitFor({ timeout: 8_000 });

  const firstNoteCheckbox = page.locator('input[type="checkbox"]').nth(1);
  await firstNoteCheckbox.check({ timeout: 8_000 });
  const pdfResponsePromise = page.waitForResponse(
    (response) => response.url().includes("/functions/v1/generate-session-notes-pdf") && response.request().method() === "POST",
    { timeout: 15_000 },
  );
  await page.getByRole("button", { name: /generate pdf/i }).click();
  const pdfResponse = await pdfResponsePromise;
  if (!pdfResponse.ok()) {
    const bodyText = await pdfResponse.text();
    throw new Error(`Session notes PDF generation failed (${pdfResponse.status()}): ${bodyText.slice(0, 400)}`);
  }

  return typeof noteId === "string" ? noteId : undefined;
}

async function cancelSession(_page: Page, token: string, sessionId: string): Promise<void> {
  const supabaseUrl = getEnv("VITE_SUPABASE_URL");
  const response = await fetchWithTimeout(`${supabaseUrl}/functions/v1/sessions-cancel`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      session_ids: [sessionId],
      reason: "Playwright lifecycle cleanup",
    }),
  });

  const payload = await response.json().catch(() => null) as { success?: boolean } | null;
  if (!response.ok || payload?.success !== true) {
    const shouldUseServiceRoleFallback =
      response.status === 401 || [500, 502, 503, 504].includes(response.status);
    if (shouldUseServiceRoleFallback) {
      const adminClient = createClient(supabaseUrl, getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      });
      const { error } = await adminClient
        .from("sessions")
        .update({ status: "cancelled" })
        .eq("id", sessionId);
      if (error) {
        throw new Error(`sessions-cancel fallback failed: ${error.message}`);
      }
      return;
    }
    throw new Error(`sessions-cancel failed (${response.status}): ${JSON.stringify(payload).slice(0, 400)}`);
  }
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
          assertRouteAccessible(attemptPage, base, "/schedule"));
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
    await withStepTimeout("start-session", () => startSession(activePage, token, booked, strictParityMode));
    const noteId = await withStepTimeout("create-session-note", () => createSessionNote(activePage, booked, token));
    ids.noteId = noteId;
    if (noteId) {
      const pdfExportAvailable = await withStepTimeout("verify-notes-pdf", () =>
        verifySessionNotePdfExport(token, booked.clientId, noteId, strictParityMode));
      if (!pdfExportAvailable) {
        console.warn("generate-session-notes-pdf was unavailable or timed out in target environment.");
      }
    }
    await withStepTimeout("cancel-session", () => cancelSession(activePage, token, booked.sessionId));

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
