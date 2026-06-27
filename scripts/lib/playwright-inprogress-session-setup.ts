/**
 * Book a session via /api/book, start in-progress via edge/RPC, cancel via edge/service-role.
 * Extracted for Playwright regressions that must not import `playwright-session-lifecycle.ts` entrypoint.
 */
import {
  formatInTimeZone,
  fromZonedTime as zonedTimeToUtc,
  getTimezoneOffset,
} from "date-fns-tz";
import { createClient } from "@supabase/supabase-js";
import type { Page } from "playwright";

import {
  buildLifecycleTargetPairs,
  type LifecycleTargetPair,
} from "../../src/scripts/playwrightSessionLifecycleTargets";
import { waitForSelectOptions } from "./playwright-smoke";

export interface LifecycleIds {
  sessionId: string;
  therapistId: string;
  clientId: string;
  programId: string;
  goalId: string;
  startIso?: string;
  endIso?: string;
  noteId?: string;
  createdProgramId?: string;
  createdGoalId?: string;
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
const BOOKING_RETRY_DELAY_MS = Number(process.env.PW_BOOKING_RETRY_DELAY_MS ?? "250");

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
  timeZone: string;
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
    const start = buildVisibleScheduleBookingAttemptStart(baseStart, attempt, params.timeZone);
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

const fetchAuthorizedTherapistClientPairs = async (): Promise<LifecycleTargetPair[]> => {
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
    .select("client_id,provider_id")
    .eq("status", "approved")
    .lte("start_date", today)
    .gte("end_date", today)
    .limit(500);
  if (error) {
    return [];
  }
  return (
    (data ?? [])
      .map((row) => ({ therapistId: row.provider_id, clientId: row.client_id }))
      .filter(
        (row): row is LifecycleTargetPair =>
          typeof row.therapistId === "string" &&
          row.therapistId.length > 0 &&
          typeof row.clientId === "string" &&
          row.clientId.length > 0,
      )
  );
};

const resolveOrganizationIdForTherapist = async (
  adminClient: ReturnType<typeof createClient>,
  therapistId: string,
): Promise<string> => {
  const { data, error } = await adminClient
    .from("therapists")
    .select("organization_id")
    .eq("id", therapistId)
    .single();
  if (error || !data?.organization_id) {
    throw new Error(`Unable to resolve organization for in-progress target therapist: ${error?.message ?? "missing organization_id"}`);
  }
  return data.organization_id;
};

const ensureProgramAndGoalForPair = async (
  therapistId: string,
  clientId: string,
): Promise<{ programId: string; goalId: string; createdProgramId?: string; createdGoalId?: string }> => {
  const supabaseUrl = getEnv("VITE_SUPABASE_URL");
  const serviceRole = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const adminClient = createClient(supabaseUrl, serviceRole, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  const organizationId = await resolveOrganizationIdForTherapist(adminClient, therapistId);

  const { data: existingProgramRows, error: existingProgramError } = await adminClient
    .from("programs")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .eq("status", "active")
    .limit(1);
  if (existingProgramError) {
    throw new Error(`Unable to query programs for in-progress target: ${existingProgramError.message}`);
  }

  let programId = existingProgramRows?.[0]?.id as string | undefined;
  let createdProgramId: string | undefined;
  if (!programId) {
    const { data: createdProgram, error: createProgramError } = await adminClient
      .from("programs")
      .insert({
        organization_id: organizationId,
        client_id: clientId,
        name: `Playwright In-Progress Program ${Date.now()}`,
        description: "Auto-seeded by playwright-inprogress-session-setup",
        status: "active",
      })
      .select("id")
      .single();
    if (createProgramError || !createdProgram?.id) {
      throw new Error(`Unable to create in-progress target program: ${createProgramError?.message ?? "missing id"}`);
    }
    programId = createdProgram.id;
    createdProgramId = createdProgram.id;
  }

  const { data: existingGoalRows, error: existingGoalError } = await adminClient
    .from("goals")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("program_id", programId)
    .eq("status", "active")
    .limit(1);
  if (existingGoalError) {
    throw new Error(`Unable to query goals for in-progress target: ${existingGoalError.message}`);
  }

  let goalId = existingGoalRows?.[0]?.id as string | undefined;
  let createdGoalId: string | undefined;
  if (!goalId) {
    const { data: createdGoal, error: createGoalError } = await adminClient
      .from("goals")
      .insert({
        organization_id: organizationId,
        client_id: clientId,
        program_id: programId,
        title: `Playwright In-Progress Goal ${Date.now()}`,
        description: "Deterministic Playwright in-progress fixture goal",
        original_text: "Deterministic Playwright in-progress fixture goal",
        status: "active",
      })
      .select("id")
      .single();
    if (createGoalError || !createdGoal?.id) {
      throw new Error(`Unable to create in-progress target goal: ${createGoalError?.message ?? "missing id"}`);
    }
    goalId = createdGoal.id;
    createdGoalId = createdGoal.id;
  }

  return { programId, goalId, createdProgramId, createdGoalId };
};

const archiveCreatedProgramGoalFixtures = async (
  ids: Pick<LifecycleIds, "createdProgramId" | "createdGoalId">,
): Promise<void> => {
  if (!ids.createdProgramId && !ids.createdGoalId) {
    return;
  }
  const supabaseUrl = getEnv("VITE_SUPABASE_URL");
  const serviceRole = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const adminClient = createClient(supabaseUrl, serviceRole, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  if (ids.createdGoalId) {
    const { error } = await adminClient
      .from("goals")
      .update({ status: "archived" })
      .eq("id", ids.createdGoalId);
    if (error) {
      throw new Error(`Unable to archive in-progress fixture goal ${ids.createdGoalId}: ${error.message}`);
    }
  }
  if (ids.createdProgramId) {
    const { error } = await adminClient
      .from("programs")
      .update({ status: "archived" })
      .eq("id", ids.createdProgramId);
    if (error) {
      throw new Error(`Unable to archive in-progress fixture program ${ids.createdProgramId}: ${error.message}`);
    }
  }
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

const VISIBLE_SCHEDULE_START_HOURS = [8, 10, 12, 14, 16] as const;

const addCalendarDays = (localDate: string, days: number): string => {
  const [year, month, day] = localDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
};

const toZonedGridStart = (localDate: string, hour: number, timeZone: string): Date =>
  zonedTimeToUtc(`${localDate}T${String(hour).padStart(2, "0")}:00:00`, timeZone);

const isRenderedScheduleLocalDate = (localDate: string, timeZone: string): boolean => {
  const isoWeekday = Number(formatInTimeZone(toZonedGridStart(localDate, 12, timeZone), timeZone, "i"));
  return isoWeekday >= 1 && isoWeekday <= 6;
};

const addRenderedScheduleDays = (localDate: string, days: number, timeZone: string): string => {
  let nextDate = localDate;
  let renderedDaysRemaining = Math.max(0, Math.trunc(days));

  do {
    if (isRenderedScheduleLocalDate(nextDate, timeZone)) {
      if (renderedDaysRemaining === 0) {
        return nextDate;
      }
      renderedDaysRemaining -= 1;
    }
    nextDate = addCalendarDays(nextDate, 1);
  } while (true);
};

export const buildVisibleScheduleBookingBaseStart = (
  now = new Date(),
  seed = Number(process.env.GITHUB_RUN_ID ?? Date.now()),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
): Date => {
  const seedNumber = Number.isFinite(seed) ? Math.abs(Math.trunc(seed)) : 0;
  const visibleHour = VISIBLE_SCHEDULE_START_HOURS[seedNumber % VISIBLE_SCHEDULE_START_HOURS.length];
  const localDate = addRenderedScheduleDays(formatInTimeZone(now, timeZone, "yyyy-MM-dd"), 0, timeZone);
  let start = toZonedGridStart(localDate, visibleHour, timeZone);
  if (start.getTime() <= now.getTime()) {
    start = toZonedGridStart(addRenderedScheduleDays(localDate, 1, timeZone), visibleHour, timeZone);
  }
  return start;
};

export const buildVisibleScheduleBookingAttemptStart = (
  baseStart: Date,
  attempt: number,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
): Date => {
  const localDate = formatInTimeZone(baseStart, timeZone, "yyyy-MM-dd");
  const localHour = Number(formatInTimeZone(baseStart, timeZone, "H"));
  const baseIndex = VISIBLE_SCHEDULE_START_HOURS.findIndex((hour) => hour === localHour);
  const safeBaseIndex = baseIndex >= 0 ? baseIndex : 0;
  const sequenceIndex = safeBaseIndex + Math.max(0, Math.trunc(attempt));
  const dayOffset = Math.floor(sequenceIndex / VISIBLE_SCHEDULE_START_HOURS.length);
  const visibleHour = VISIBLE_SCHEDULE_START_HOURS[sequenceIndex % VISIBLE_SCHEDULE_START_HOURS.length];
  return toZonedGridStart(addRenderedScheduleDays(localDate, dayOffset, timeZone), visibleHour, timeZone);
};

export const resolveBrowserScheduleTimeZone = async (page: Pick<Page, "evaluate">): Promise<string> => {
  const timeZone = await page.evaluate(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return null;
    }
  });
  return typeof timeZone === "string" && timeZone.trim().length > 0 ? timeZone : "UTC";
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
    .locator(
      '[role="dialog"]:has-text("New Session"), [role="dialog"]:has-text("Edit Session"), [role="dialog"]:has-text("Live session")',
    )
    .first()
    .waitFor({ state: "visible", timeout: 10_000 });
}

const selectOptionWhenAvailable = async (
  page: Page,
  selector: string,
  value: string,
  timeoutMs = 8000,
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hasOption = await page.evaluate(
      ({ targetSelector, targetValue }) => {
        const select = document.querySelector(targetSelector) as HTMLSelectElement | null;
        if (!select) {
          return false;
        }
        return Array.from(select.options).some((option) => option.value === targetValue);
      },
      { targetSelector: selector, targetValue: value },
    );
    if (hasOption) {
      await page.selectOption(selector, value);
      return true;
    }
    await page.waitForTimeout(250);
  }
  return false;
};

async function chooseSessionTargets(
  page: Page,
  options?: { allowedTherapistIds?: Set<string> },
): Promise<{
  therapistId: string;
  clientId: string;
  programId: string;
  goalId: string;
  createdProgramId?: string;
  createdGoalId?: string;
}> {
  const therapistValues = await waitForSelectOptions(page, "#therapist-select");
  const clientValues = await waitForSelectOptions(page, "#client-select");
  const authorizedPairs = await fetchAuthorizedTherapistClientPairs();
  const candidatePairs = buildLifecycleTargetPairs({
    therapistIds: therapistValues,
    clientIds: clientValues,
    authorizedPairs,
  });

  if (therapistValues.length === 0 || clientValues.length === 0) {
    throw new Error("No therapist/client options available for in-progress session setup.");
  }

  console.log("[in-progress-setup] target candidates", {
    therapistOptionCount: therapistValues.length,
    clientOptionCount: clientValues.length,
    authorizedPairCount: authorizedPairs.length,
    candidatePairCount: candidatePairs.length,
  });

  for (const { therapistId, clientId } of candidatePairs) {
    if (
      options?.allowedTherapistIds &&
      options.allowedTherapistIds.size > 0 &&
      !options.allowedTherapistIds.has(therapistId)
    ) {
      continue;
    }
    await page.selectOption("#therapist-select", therapistId);
    await page.selectOption("#client-select", "");
    const seeded = await ensureProgramAndGoalForPair(therapistId, clientId);
    await page.selectOption("#client-select", clientId);
    const selectedProgram = await selectOptionWhenAvailable(page, "#program-select", seeded.programId);
    if (!selectedProgram) {
      await archiveCreatedProgramGoalFixtures(seeded);
      continue;
    }
    const selectedGoal = await selectOptionWhenAvailable(page, "#goal-select", seeded.goalId);
    if (selectedGoal) {
      return {
        therapistId,
        clientId,
        programId: seeded.programId,
        goalId: seeded.goalId,
        createdProgramId: seeded.createdProgramId,
        createdGoalId: seeded.createdGoalId,
      };
    }
    await archiveCreatedProgramGoalFixtures(seeded);
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
  console.log("[in-progress-setup] book-session goto-schedule");
  await page.goto(`${getEnv("PW_BASE_URL", "https://app.allincompassing.ai")}/schedule`, {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await page.waitForSelector("text=Schedule", { timeout: 15_000 }).catch(() => undefined);
  console.log("[in-progress-setup] book-session open-modal");
  await openSessionModal(page);

  let allowedTherapistIds: Set<string> | undefined;
  const orgId = bookOptions?.restrictToOrganizationId?.trim();
  if (orgId) {
    console.log("[in-progress-setup] book-session fetch-org-therapists");
    allowedTherapistIds = await fetchTherapistIdsForOrganization(orgId);
    if (allowedTherapistIds.size === 0) {
      throw new Error(`No therapists found for organization ${orgId}; cannot align booking with active org.`);
    }
  }

  console.log("[in-progress-setup] book-session choose-targets");
  const selected = await chooseSessionTargets(page, { allowedTherapistIds });
  console.log("[in-progress-setup] book-session selected-target");

  const timeZone = await resolveBrowserScheduleTimeZone(page);
  const start = buildVisibleScheduleBookingBaseStart(new Date(), undefined, timeZone);
  let finalStartIso = "";
  let finalEndIso = "";
  let payload: BrowserFetchResult<Record<string, unknown>> | null = null;
  let payloadBody: { success?: boolean; data?: { session?: { id?: string } } } | null = null;

  for (let attempt = 0; attempt < 48; attempt += 1) {
    const attemptStart = buildVisibleScheduleBookingAttemptStart(start, attempt, timeZone);
    const attemptEnd = new Date(attemptStart.getTime() + 60 * 60 * 1000);
    const startIso = attemptStart.toISOString();
    const endIso = attemptEnd.toISOString();
    finalStartIso = startIso;
    finalEndIso = endIso;
    const startOffsetMinutes = Math.round(getTimezoneOffset(timeZone, attemptStart) / 60000);
    const endOffsetMinutes = Math.round(getTimezoneOffset(timeZone, attemptEnd) / 60000);

    await page.locator("#start-time-input").fill(toDatetimeLocal(attemptStart));
    await page.locator("#end-time-input").fill(toDatetimeLocal(attemptEnd));
    console.log("[in-progress-setup] book-session attempt", {
      attempt: attempt + 1,
      startIso,
    });

    try {
      const bookResponse = await fetchWithTimeout(`${getEnv("PW_BASE_URL", "https://app.allincompassing.ai").replace(/\/$/, "")}/api/book`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "Idempotency-Key": `pw-inprogress-${Date.now()}`,
        },
        body: JSON.stringify({
          session: {
            therapist_id: selected.therapistId,
            client_id: selected.clientId,
            program_id: selected.programId,
            goal_id: selected.goalId,
            goal_ids: [selected.goalId],
            start_time: startIso,
            end_time: endIso,
            status: "scheduled",
          },
          startTimeOffsetMinutes: startOffsetMinutes,
          endTimeOffsetMinutes: endOffsetMinutes,
          timeZone,
          holdSeconds: 300,
        }),
      });
      payload = {
        status: bookResponse.status,
        ok: bookResponse.ok,
        body: (await bookResponse.json().catch(() => null)) as Record<string, unknown> | null,
      };
    } catch (error) {
      payload = {
        status: 0,
        ok: false,
        body: { error: error instanceof Error ? error.message : String(error) },
      };
    }

    payloadBody = payload.body as
      | { success?: boolean; data?: { session?: { id?: string } } }
      | null;
    if (payload.ok && payloadBody?.success && payloadBody?.data?.session?.id) {
      break;
    }
    if (payload.status === 0 || payload.status === 409 || [500, 502, 503, 504].includes(payload.status)) {
      console.log("[in-progress-setup] book-session retryable-response", {
        attempt: attempt + 1,
        status: payload.status,
      });
      await new Promise((resolve) => setTimeout(resolve, BOOKING_RETRY_DELAY_MS));
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
      let fallbackSessionId = "";
      try {
        fallbackSessionId = await createSessionViaServiceRole({
          therapistId: selected.therapistId,
          clientId: selected.clientId,
          programId: selected.programId,
          goalId: selected.goalId,
          startIso: finalStartIso,
          endIso: finalEndIso,
          timeZone,
        });
      } catch (error) {
        await archiveCreatedProgramGoalFixtures(selected);
        throw error;
      }
      return {
        sessionId: fallbackSessionId,
        therapistId: selected.therapistId,
        clientId: selected.clientId,
        programId: selected.programId,
        goalId: selected.goalId,
        startIso: finalStartIso,
        endIso: finalEndIso,
        createdProgramId: selected.createdProgramId,
        createdGoalId: selected.createdGoalId,
      };
    }
    await archiveCreatedProgramGoalFixtures(selected);
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
    startIso: finalStartIso,
    endIso: finalEndIso,
    createdProgramId: selected.createdProgramId,
    createdGoalId: selected.createdGoalId,
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

export async function cancelSession(
  _page: Page,
  token: string,
  sessionId: string,
  createdFixtures?: Pick<LifecycleIds, "createdProgramId" | "createdGoalId">,
): Promise<void> {
  const supabaseUrl = getEnv("VITE_SUPABASE_URL");
  let cancelError: unknown;

  try {
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
  } catch (error) {
    cancelError = error;
  } finally {
    try {
      await archiveCreatedProgramGoalFixtures(createdFixtures ?? {});
    } catch (archiveError) {
      if (!cancelError) {
        throw archiveError;
      }
      console.warn(
        `[in-progress-setup] fixture archive failed after cancel failure: ${
          archiveError instanceof Error ? archiveError.message : String(archiveError)
        }`,
      );
    }
  }

  if (cancelError) {
    throw cancelError;
  }
}
