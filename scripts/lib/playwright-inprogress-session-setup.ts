/**
 * Book a session via /api/book, start in-progress via edge/RPC, cancel via edge/service-role.
 * Extracted for Playwright regressions that must not import `playwright-session-lifecycle.ts` entrypoint.
 */
import { getTimezoneOffset } from "date-fns-tz";
import { createClient } from "@supabase/supabase-js";
import type { Page } from "playwright";

import { waitForSelectOptions } from "./playwright-smoke";

export interface LifecycleIds {
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

interface BrowserFetchResult<TBody> {
  ok: boolean;
  status: number;
  body: TBody | null;
}

const EDGE_FETCH_TIMEOUT_MS = Number(process.env.PW_EDGE_FETCH_TIMEOUT_MS ?? "20000");

const fetchWithTimeout = async (input: string | URL, init?: RequestInit): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EDGE_FETCH_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const getEnv = (key: string, fallback?: string): string => {
  const value = process.env[key] ?? fallback;
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
};

const buildEdgeAuthHeaders = (token: string): Record<string, string> => ({
  "Content-Type": "application/json",
  apikey: getEnv("VITE_SUPABASE_ANON_KEY", process.env.SUPABASE_ANON_KEY),
  Authorization: `Bearer ${token}`,
});

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
        notes: "Playwright in-progress setup fallback booking",
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

/**
 * Mirrors `resolveOrganizationId` in `src/lib/organization.ts` (minus runtime default) so booking
 * targets the same org the Schedule modal uses for `checkInProgressSessionCloseReadiness`.
 */
export async function resolveOrganizationIdFromAccessToken(token: string): Promise<string | null> {
  const supabaseUrl = getEnv("VITE_SUPABASE_URL");
  const anonKey = getEnv("VITE_SUPABASE_ANON_KEY", process.env.SUPABASE_ANON_KEY);
  const headers: Record<string, string> = { apikey: anonKey, Authorization: `Bearer ${token}` };
  const authRes = await fetch(`${supabaseUrl}/auth/v1/user`, { headers });
  if (!authRes.ok) {
    throw new Error(`auth/v1/user failed (${authRes.status})`);
  }
  const envelope = (await authRes.json()) as {
    user?: { id?: string; user_metadata?: Record<string, unknown> };
  };
  const user = envelope.user;
  const meta = user?.user_metadata ?? {};
  const metaSnake = typeof meta.organization_id === "string" ? meta.organization_id.trim() : "";
  if (metaSnake.length > 0) {
    return metaSnake;
  }
  const metaCamel = typeof meta.organizationId === "string" ? meta.organizationId.trim() : "";
  if (metaCamel.length > 0) {
    return metaCamel;
  }
  const sub = user?.id;
  if (!sub) {
    return null;
  }
  const profileRes = await fetch(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(sub)}&select=organization_id,preferences`,
    { headers },
  );
  const profiles = (await profileRes.json()) as Array<{
    organization_id?: string | null;
    preferences?: Record<string, unknown> | null;
  }>;
  const row = profiles?.[0];
  if (typeof row?.organization_id === "string" && row.organization_id.trim().length > 0) {
    return row.organization_id.trim();
  }
  const pref = row?.preferences;
  if (pref && typeof pref === "object") {
    const pSnake = pref.organization_id;
    const pCamel = pref.organizationId;
    if (typeof pSnake === "string" && pSnake.trim().length > 0) {
      return pSnake.trim();
    }
    if (typeof pCamel === "string" && pCamel.trim().length > 0) {
      return pCamel.trim();
    }
  }
  try {
    const parts = token.split(".");
    if (parts.length >= 2) {
      const segment = parts[1];
      const padded = segment.padEnd(segment.length + ((4 - (segment.length % 4)) % 4), "=");
      const json = Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
      const payload = JSON.parse(json) as Record<string, unknown>;
      const um = (payload.user_metadata ?? {}) as Record<string, unknown>;
      const am = (payload.app_metadata ?? {}) as Record<string, unknown>;
      const o =
        um.organization_id ??
        um.organizationId ??
        am.organization_id ??
        am.organizationId;
      if (typeof o === "string" && o.trim().length > 0) {
        return o.trim();
      }
    }
  } catch {
    // ignore JWT parse failures
  }
  return null;
}

/** Same default org the SPA uses when profile metadata does not pin `organization_id` (`getDefaultOrganizationId`). */
export async function resolveDefaultOrganizationIdFromRuntimeConfig(baseUrl: string): Promise<string | null> {
  const trimmed = baseUrl.replace(/\/$/, "");
  const res = await fetch(`${trimmed}/api/runtime-config`, { method: "GET" });
  if (!res.ok) {
    return null;
  }
  const json = (await res.json()) as { defaultOrganizationId?: string };
  const id = json.defaultOrganizationId;
  return typeof id === "string" && id.trim().length > 0 ? id.trim() : null;
}

export async function fetchTherapistIdsForOrganization(organizationId: string): Promise<Set<string>> {
  const supabaseUrl = getEnv("VITE_SUPABASE_URL");
  const serviceRole = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const adminClient = createClient(supabaseUrl, serviceRole, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  const { data, error } = await adminClient.from("therapists").select("id").eq("organization_id", organizationId);
  if (error) {
    throw new Error(`therapists lookup by organization failed: ${error.message}`);
  }
  return new Set(
    (data ?? [])
      .map((row) => row.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );
}

export const fetchAccessTokenForCredentials = async (email: string, password: string): Promise<string> => {
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
    throw new Error(`Unable to mint access token for credentials: ${error?.message ?? "missing session"}`);
  }
  return data.session.access_token;
};

export const getTokenFromBrowserStorage = async (page: Page): Promise<string | null> => {
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
            if (
              typeof record.access_token === "string" &&
              /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(record.access_token)
            ) {
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

async function chooseSessionTargets(
  page: Page,
  options?: { allowedTherapistIds?: Set<string> },
): Promise<{
  therapistId: string;
  clientId: string;
  programId: string;
  goalId: string;
}> {
  const therapistValues = await waitForSelectOptions(page, "#therapist-select");
  const clientValues = await waitForSelectOptions(page, "#client-select");
  const authorizedClientIds = await fetchAuthorizedClientIds();

  if (therapistValues.length === 0 || clientValues.length === 0) {
    throw new Error("No therapist/client options available for in-progress session setup.");
  }

  for (const therapistId of therapistValues) {
    if (
      options?.allowedTherapistIds &&
      options.allowedTherapistIds.size > 0 &&
      !options.allowedTherapistIds.has(therapistId)
    ) {
      continue;
    }
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

  throw new Error("Could not find therapist/client/program/goal combination for in-progress session setup.");
}

export type BookSessionOptions = {
  /** Restrict dropdown iteration to therapists in this org (matches Schedule active org / close-readiness queries). */
  restrictToOrganizationId?: string | null;
};

export async function bookSession(
  page: Page,
  token: string,
  strictMode: boolean,
  bookOptions?: BookSessionOptions,
): Promise<LifecycleIds> {
  await page.goto(`${getEnv("PW_BASE_URL", "https://app.allincompassing.ai")}/schedule`, {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await page.waitForSelector("text=Schedule", { timeout: 15_000 }).catch(() => undefined);
  await openSessionModal(page);

  let allowedTherapistIds: Set<string> | undefined;
  const orgId = bookOptions?.restrictToOrganizationId?.trim();
  if (orgId) {
    allowedTherapistIds = await fetchTherapistIdsForOrganization(orgId);
    if (allowedTherapistIds.size === 0) {
      throw new Error(`No therapists found for organization ${orgId}; cannot align booking with active org.`);
    }
  }

  const selected = await chooseSessionTargets(page, { allowedTherapistIds });

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

    payload = (await page.evaluate(
      async ({ apiToken, therapistId, clientId, programId, goalId, isoStart, isoEnd, startOffset, endOffset, tz }) => {
        const response = await fetch("/api/book", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiToken}`,
            "Idempotency-Key": `pw-inprogress-${Date.now()}`,
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
    )) as BrowserFetchResult<Record<string, unknown>>;

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
    const shouldFallbackToServiceRole =
      !strictMode &&
      finalStartIso.length > 0 &&
      finalEndIso.length > 0 &&
      (payload?.status === 401 || payload?.status === 409);
    if (shouldFallbackToServiceRole) {
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

export async function startSession(_page: Page, token: string, ids: LifecycleIds, strictMode: boolean): Promise<void> {
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
        headers: buildEdgeAuthHeaders(token),
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
      headers: buildEdgeAuthHeaders(token),
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
  const isEdgeInvalidJwt = edgeStatus === 401 && /invalid jwt/i.test(edgeBody);

  if (strictMode) {
    if (edgeStatus === 404) {
      throw new Error(`sessions-start failed (${edgeStatus}): ${edgeBody.slice(0, 400)}`);
    }
    if ([502, 503, 504].includes(edgeStatus)) {
      await runRpcFallback();
      return;
    }
    if (isEdgeInvalidJwt) {
      await runRpcFallback();
      return;
    }
    throw new Error(`sessions-start failed (${edgeStatus}): ${edgeBody.slice(0, 400)}`);
  }

  if (![401, 404, 502, 503, 504].includes(edgeStatus)) {
    throw new Error(`sessions-start failed (${edgeStatus}): ${edgeBody.slice(0, 400)}`);
  }

  await runRpcFallback();
}

export async function cancelSession(_page: Page, token: string, sessionId: string): Promise<void> {
  const supabaseUrl = getEnv("VITE_SUPABASE_URL");
  const response = await fetchWithTimeout(`${supabaseUrl}/functions/v1/sessions-cancel`, {
    method: "POST",
    headers: buildEdgeAuthHeaders(token),
    body: JSON.stringify({
      session_ids: [sessionId],
      reason: "Playwright blocked-close regression cleanup",
    }),
  });

  const payload = (await response.json().catch(() => null)) as { success?: boolean } | null;
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
