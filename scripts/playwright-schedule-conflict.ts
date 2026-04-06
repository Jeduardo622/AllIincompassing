import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

import { loadPlaywrightEnv } from "./lib/load-playwright-env";
import {
  assertRouteAccessible,
  captureFailureScreenshot,
  hasSupabaseAuthToken,
  loginAndAssertSession,
  waitForSelectOptions,
} from "./lib/playwright-smoke";

type ConflictMode = "mock" | "real";

type ConflictTargets = {
  therapistId: string;
  clientId: string;
  programId: string;
  goalId: string;
};

type BookResponseSnapshot = {
  status: number;
  body: string;
};

type ConflictFixtureArtifact = {
  executedAt: string;
  mode: ConflictMode;
  baseUrl: string;
  authenticatedEmail?: string;
  targets: ConflictTargets;
  conflictSessionId?: string;
  observedBookStatus: number;
};

const getEnv = (key: string, fallback?: string): string => {
  const value = process.env[key] ?? fallback;
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
};

const getOptionalEnv = (key: string): string | undefined => {
  const value = process.env[key]?.trim();
  return value && value.length > 0 ? value : undefined;
};

const resolveConflictMode = (): ConflictMode => {
  const raw = (process.env.PW_CONFLICT_MODE ?? "mock").trim().toLowerCase();
  switch (raw) {
    case "mock":
      return "mock";
    case "real":
      return "real";
    default:
      throw new Error(`Invalid PW_CONFLICT_MODE "${raw}". Supported values: mock, real.`);
  }
};

const toDatetimeLocal = (date: Date): string => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

const toUtcIsoFromDatetimeLocal = (value: string): string => {
  const localDate = new Date(value);
  if (Number.isNaN(localDate.getTime())) {
    throw new Error(`Invalid datetime-local value: ${value}`);
  }
  return localDate.toISOString();
};

const createAdminClient = () => {
  const supabaseUrl = getEnv("VITE_SUPABASE_URL");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
};

const withStepTimeout = async <T>(label: string, operation: () => Promise<T>, timeoutMs = 120000): Promise<T> => {
  console.log(`[schedule-conflict] start ${label}`);
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Step timed out: ${label} (${timeoutMs}ms)`)), timeoutMs);
  });
  const result = await Promise.race([operation(), timeout]);
  console.log(`[schedule-conflict] ok ${label}`);
  return result as T;
};

async function openSessionModal(page: Page) {
  await page.evaluate(() => {
    const now = new Date();
    now.setHours(now.getHours() + 2);
    const detail = { start_time: now.toISOString() };
    window.dispatchEvent(new CustomEvent('openScheduleModal', { detail }));
  });
  const modal = page.locator('[role="dialog"]:has-text("New Session"), [role="dialog"]:has-text("Edit Session")');
  await modal.waitFor({ state: 'visible', timeout: 5000 });
}

const resolvePreferredTargets = (): Partial<ConflictTargets> => ({
  therapistId: getOptionalEnv("PW_CONFLICT_THERAPIST_ID"),
  clientId: getOptionalEnv("PW_CONFLICT_CLIENT_ID"),
  programId: getOptionalEnv("PW_CONFLICT_PROGRAM_ID"),
  goalId: getOptionalEnv("PW_CONFLICT_GOAL_ID"),
});

const selectValueOrThrow = async (page: Page, selector: string, value: string, label: string): Promise<void> => {
  const options = await waitForSelectOptions(page, selector, { timeoutMs: 8_000 }).catch(() => []);
  if (!options.includes(value)) {
    throw new Error(`${label} "${value}" is not currently selectable in ${selector}.`);
  }
  await page.selectOption(selector, value);
};

async function chooseSessionTargets(page: Page): Promise<ConflictTargets> {
  const preferred = resolvePreferredTargets();
  if (preferred.therapistId && preferred.clientId && preferred.programId && preferred.goalId) {
    await selectValueOrThrow(page, "#therapist-select", preferred.therapistId, "Therapist");
    await selectValueOrThrow(page, "#client-select", preferred.clientId, "Client");
    await selectValueOrThrow(page, "#program-select", preferred.programId, "Program");
    await selectValueOrThrow(page, "#goal-select", preferred.goalId, "Goal");
    return {
      therapistId: preferred.therapistId,
      clientId: preferred.clientId,
      programId: preferred.programId,
      goalId: preferred.goalId,
    };
  }

  const therapistValues = await waitForSelectOptions(page, "#therapist-select");
  const clientValues = await waitForSelectOptions(page, "#client-select");
  if (therapistValues.length === 0 || clientValues.length === 0) {
    throw new Error("No therapist/client options available for schedule conflict flow.");
  }

  const therapistCandidates = therapistValues.slice(0, 6);
  const clientCandidates = clientValues.slice(0, 12);
  const maxPairs = 18;
  let checkedPairs = 0;
  for (const therapistId of therapistCandidates) {
    await page.selectOption("#therapist-select", therapistId);
    for (const clientId of clientCandidates) {
      checkedPairs += 1;
      if (checkedPairs > maxPairs) {
        break;
      }
      await page.selectOption("#client-select", clientId);
      const programValues = await waitForSelectOptions(page, "#program-select", { timeoutMs: 1_500 }).catch(() => []);
      if (programValues.length === 0) {
        continue;
      }
      await page.selectOption("#program-select", programValues[0]);
      const goalValues = await waitForSelectOptions(page, "#goal-select", { timeoutMs: 1_500 }).catch(() => []);
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
    if (checkedPairs > maxPairs) {
      break;
    }
  }

  const canAutoSeed = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.VITE_SUPABASE_URL);
  if (canAutoSeed && therapistCandidates.length > 0 && clientCandidates.length > 0) {
    const fallbackTherapistId = therapistCandidates[0];
    const fallbackClientId = clientCandidates[0];
    const seeded = await ensureProgramAndGoalForPair(fallbackTherapistId, fallbackClientId);

    await page.selectOption("#therapist-select", fallbackTherapistId);
    await page.selectOption("#client-select", fallbackClientId);
    await page.waitForTimeout(500);
    await selectValueOrThrow(page, "#program-select", seeded.programId, "Seeded program");
    const availableGoals = await waitForSelectOptions(page, "#goal-select", { timeoutMs: 12_000 }).catch(() => []);
    const selectedGoalId = availableGoals.includes(seeded.goalId)
      ? seeded.goalId
      : availableGoals[0];
    if (!selectedGoalId) {
      throw new Error("No goals available after auto-seeding program/goal fixture.");
    }
    await page.selectOption("#goal-select", selectedGoalId);
    return {
      therapistId: fallbackTherapistId,
      clientId: fallbackClientId,
      programId: seeded.programId,
      goalId: selectedGoalId,
    };
  }

  throw new Error(
    "Unable to resolve therapist/client/program/goal combination. Provide PW_CONFLICT_* IDs or seed deterministic fixtures.",
  );
}

async function resolveOrganizationIdForTherapist(therapistId: string): Promise<string> {
  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("therapists")
    .select("organization_id")
    .eq("id", therapistId)
    .single();
  if (error || !data?.organization_id) {
    throw new Error(`Unable to resolve therapist organization: ${error?.message ?? "missing organization_id"}`);
  }
  return data.organization_id;
}

async function createRealConflictSession(targets: ConflictTargets, startUtcIso: string, endUtcIso: string): Promise<string | null> {
  const adminClient = createAdminClient();
  const organizationId = await resolveOrganizationIdForTherapist(targets.therapistId);
  const { data, error } = await adminClient
    .from("sessions")
    .insert({
      organization_id: organizationId,
      therapist_id: targets.therapistId,
      client_id: targets.clientId,
      program_id: targets.programId,
      goal_id: targets.goalId,
      start_time: startUtcIso,
      end_time: endUtcIso,
      status: "scheduled",
      notes: "Playwright real conflict seed",
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    const message = error?.message ?? "";
    if (message.includes("sessions_no_overlap")) {
      return null;
    }
    throw new Error(`Unable to create real conflict session: ${message || "missing session id"}`);
  }
  return data.id;
}

async function ensureProgramAndGoalForPair(therapistId: string, clientId: string): Promise<{ programId: string; goalId: string }> {
  const adminClient = createAdminClient();
  const organizationId = await resolveOrganizationIdForTherapist(therapistId);

  const { data: existingProgramRows, error: existingProgramError } = await adminClient
    .from("programs")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .eq("status", "active")
    .limit(1);
  if (existingProgramError) {
    throw new Error(`Unable to query programs for seeded pair: ${existingProgramError.message}`);
  }

  let programId = existingProgramRows?.[0]?.id as string | undefined;
  if (!programId) {
    const { data: createdProgram, error: createProgramError } = await adminClient
      .from("programs")
      .insert({
        organization_id: organizationId,
        client_id: clientId,
        name: `Playwright Conflict Program ${Date.now()}`,
        description: "Auto-seeded by playwright-schedule-conflict",
        status: "active",
      })
      .select("id")
      .single();
    if (createProgramError || !createdProgram?.id) {
      throw new Error(`Unable to create seeded program: ${createProgramError?.message ?? "missing id"}`);
    }
    programId = createdProgram.id;
  }

  const { data: existingGoalRows, error: existingGoalError } = await adminClient
    .from("goals")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("program_id", programId)
    .eq("status", "active")
    .limit(1);
  if (existingGoalError) {
    throw new Error(`Unable to query goals for seeded pair: ${existingGoalError.message}`);
  }

  let goalId = existingGoalRows?.[0]?.id as string | undefined;
  if (!goalId) {
    const { data: createdGoal, error: createGoalError } = await adminClient
      .from("goals")
      .insert({
        organization_id: organizationId,
        client_id: clientId,
        program_id: programId,
        title: `Playwright Conflict Goal ${Date.now()}`,
        description: "Deterministic Playwright conflict fixture goal",
        original_text: "Deterministic Playwright conflict fixture goal",
        status: "active",
      })
      .select("id")
      .single();
    if (createGoalError || !createdGoal?.id) {
      throw new Error(`Unable to create seeded goal: ${createGoalError?.message ?? "missing id"}`);
    }
    goalId = createdGoal.id;
  }

  return { programId, goalId };
}

async function cleanupRealConflictSession(sessionId: string): Promise<void> {
  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from("sessions")
    .update({ status: "cancelled", notes: "Playwright real conflict cleanup" })
    .eq("id", sessionId);
  if (error) {
    throw new Error(`Unable to clean up real conflict session: ${error.message}`);
  }
}

const writeArtifact = (artifact: ConflictFixtureArtifact): string => {
  const latestDir = path.resolve(process.cwd(), "artifacts", "latest");
  if (!fs.existsSync(latestDir)) {
    fs.mkdirSync(latestDir, { recursive: true });
  }
  const artifactPath = path.join(latestDir, `playwright-schedule-conflict-${Date.now()}.json`);
  fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2), "utf8");
  return artifactPath;
};

const getSubmitButton = (page: Page) =>
  page.locator('form#session-form button[type="submit"], button[type="submit"][form="session-form"]').first();

async function run() {
  loadPlaywrightEnv();
  const mode = resolveConflictMode();
  const headless = process.env.HEADLESS !== "false";
  const base = getEnv("PW_BASE_URL", "https://app.allincompassing.ai");
  const credentialCandidates = [
    {
      email: process.env.PW_SCHEDULE_EMAIL,
      password: process.env.PW_SCHEDULE_PASSWORD,
      label: "PW_SCHEDULE_EMAIL + PW_SCHEDULE_PASSWORD",
    },
    {
      email: process.env.PW_ADMIN_EMAIL ?? process.env.PLAYWRIGHT_ADMIN_EMAIL,
      password: process.env.PW_ADMIN_PASSWORD ?? process.env.PLAYWRIGHT_ADMIN_PASSWORD,
      label: "PW_ADMIN_EMAIL + PW_ADMIN_PASSWORD",
    },
    {
      email: process.env.PW_SUPERADMIN_EMAIL,
      password: process.env.PW_SUPERADMIN_PASSWORD,
      label: "PW_SUPERADMIN_EMAIL + PW_SUPERADMIN_PASSWORD",
    },
    {
      email: process.env.PW_THERAPIST_EMAIL ?? process.env.PLAYWRIGHT_THERAPIST_EMAIL,
      password: process.env.PW_THERAPIST_PASSWORD ?? process.env.PLAYWRIGHT_THERAPIST_PASSWORD,
      label: "PW_THERAPIST_EMAIL + PW_THERAPIST_PASSWORD",
    },
  ].filter((entry) => Boolean(entry.email && entry.password));

  if (credentialCandidates.length === 0) {
    throw new Error(
      "Missing schedule credentials. Set PW_SCHEDULE_EMAIL/PW_SCHEDULE_PASSWORD or admin/therapist Playwright credentials.",
    );
  }

  const browser = await withStepTimeout("launch-browser", () => chromium.launch({ headless }), 30000);
  const attemptFailures: string[] = [];
  let authenticatedEmail: string | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let conflictSessionId: string | null = null;

  try {
    for (const candidate of credentialCandidates) {
      if (!candidate.email || !candidate.password) {
        continue;
      }
      if (/client/i.test(candidate.email)) {
        attemptFailures.push(`${candidate.label}: rejected because account appears to be a client persona.`);
        continue;
      }
      const attemptContext = await withStepTimeout(
        `new-context ${candidate.label}`,
        () => browser.newContext(),
        30000,
      );
      const attemptPage = await withStepTimeout(
        `new-page ${candidate.label}`,
        () => attemptContext.newPage(),
        30000,
      );
      try {
        await withStepTimeout(
          `login ${candidate.label}`,
          () => loginAndAssertSession(attemptPage, base, candidate.email, candidate.password),
        );
        await withStepTimeout(
          `route-check ${candidate.label}`,
          () =>
            assertRouteAccessible(attemptPage, base, "/schedule", {
              readySelector: 'button[aria-label="Day view"]',
            }),
        );
        const tokenDetected = await hasSupabaseAuthToken(attemptPage);
        if (!tokenDetected) {
          throw new Error("Supabase auth token missing after successful login.");
        }
        authenticatedEmail = candidate.email;
        context = attemptContext;
        page = attemptPage;
        break;
      } catch (error) {
        attemptFailures.push(
          `${candidate.label}: ${error instanceof Error ? error.message : String(error)}`,
        );
        await attemptContext.close();
      }
    }

    if (!authenticatedEmail || !context || !page) {
      throw new Error(
        `No provided credential set can access /schedule. Attempts: ${attemptFailures.join(' || ')}`,
      );
    }

    let interceptedBookingPosts = 0;
    if (mode === "mock") {
      await page.route("**/api/book*", async (route) => {
        if (route.request().method().toUpperCase() !== "POST") {
          await route.continue();
          return;
        }
        interceptedBookingPosts += 1;

        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            error: "Session slot conflict",
            hint: "Slot already taken. Try another time.",
          }),
        });
      });
    }

    await withStepTimeout(
      "goto-schedule",
      () => page.goto(`${base}/schedule`, { waitUntil: "domcontentloaded", timeout: 60000 }),
    );
    await withStepTimeout(
      "schedule-ready",
      () => page.waitForSelector('button[aria-label="Day view"]', { timeout: 15000 }),
    );
    await withStepTimeout("open-session-modal", () => openSessionModal(page), 30000);

    const targets = await withStepTimeout("choose-targets", () => chooseSessionTargets(page), 75000);

    const startTimeInput = page.locator("#start-time-input");
    const endTimeInput = page.locator("#end-time-input");

    const baseStart = new Date();
    baseStart.setHours(baseStart.getHours() + 3, 0, 0, 0);
    const retryableConflictStatuses = new Set([429, 500, 502, 503, 504]);
    let bookingResponse: BookResponseSnapshot = { status: 0, body: "" };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const attemptStart = new Date(baseStart.getTime() + attempt * 2 * 60 * 60 * 1000);
      const startValue = toDatetimeLocal(attemptStart);
      const endValue = toDatetimeLocal(new Date(attemptStart.getTime() + 60 * 60 * 1000));

      await withStepTimeout(`fill-times-attempt-${attempt + 1}`, async () => {
        await startTimeInput.fill(startValue);
        await endTimeInput.fill(endValue);
      }, 15000);

      let attemptConflictSessionId: string | null = null;
      try {
        if (mode === "real") {
          attemptConflictSessionId = await withStepTimeout(
            `setup-real-conflict-session-attempt-${attempt + 1}`,
            () =>
              createRealConflictSession(
                targets,
                toUtcIsoFromDatetimeLocal(startValue),
                toUtcIsoFromDatetimeLocal(endValue),
              ),
            45000,
          );
        }

        // SessionModal prompts window.confirm when client-side conflicts exist. Playwright
        // auto-dismisses unhandled confirms as "Cancel", which aborts submit and never POSTs
        // /api/book — accept so the booking request always runs for this smoke.
        page.once("dialog", (dialog) => dialog.accept());

        bookingResponse = await withStepTimeout(
          `observe-booking-response-attempt-${attempt + 1}`,
          async (): Promise<BookResponseSnapshot> => {
            const [response] = await Promise.all([
              page.waitForResponse(
                (response) =>
                  response.request().method().toUpperCase() === "POST"
                  && response.url().includes("/api/book"),
                { timeout: 30_000 },
              ),
              getSubmitButton(page).click(),
            ]);
            const body = await response.text().catch(() => "");
            return { status: response.status(), body };
          },
          35_000,
        );
        conflictSessionId = attemptConflictSessionId;
      } finally {
        if (attemptConflictSessionId) {
          try {
            await cleanupRealConflictSession(attemptConflictSessionId);
          } catch (cleanupError) {
            console.error(
              `[schedule-conflict] cleanup failed for ${attemptConflictSessionId}: ${
                cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
              }`,
            );
          }
        }
      }

      if (bookingResponse.status === 409) {
        break;
      }

      if (mode !== "real" || !retryableConflictStatuses.has(bookingResponse.status) || attempt === 2) {
        break;
      }
      console.warn(
        `[schedule-conflict] retrying conflict submit after status ${bookingResponse.status} (attempt ${attempt + 1})`,
      );
    }

    if (mode === "mock" && interceptedBookingPosts === 0) {
      throw new Error("Schedule conflict smoke did not observe intercepted POST /api/book request.");
    }
    if (bookingResponse.status !== 409) {
      throw new Error(
        `Expected conflict response 409 but received ${bookingResponse.status}. Body=${bookingResponse.body.slice(0, 500)}`,
      );
    }

    const therapistValue = await page.locator("#therapist-select").inputValue();
    const clientValue = await page.locator("#client-select").inputValue();
    const programValue = await page.locator("#program-select").inputValue();
    const goalValue = await page.locator("#goal-select").inputValue();
    const currentStartValue = await startTimeInput.inputValue();
    const currentEndValue = await endTimeInput.inputValue();

    if (!therapistValue) {
      throw new Error('Therapist selection cleared after conflict');
    }
    if (!clientValue) {
      throw new Error('Client selection cleared after conflict');
    }
    if (!programValue) {
      throw new Error('Program selection cleared after conflict');
    }
    if (!goalValue) {
      throw new Error('Goal selection cleared after conflict');
    }
    if (!currentStartValue) {
      throw new Error('Start time cleared after conflict');
    }
    if (!currentEndValue) {
      throw new Error('End time cleared after conflict');
    }

    const artifactPath = writeArtifact({
      executedAt: new Date().toISOString(),
      mode,
      baseUrl: base,
      authenticatedEmail,
      targets,
      conflictSessionId: conflictSessionId ?? undefined,
      observedBookStatus: bookingResponse.status,
    });

    console.log(
      JSON.stringify({
        ok: true,
        mode,
        message: "Playwright schedule conflict submit path verified",
        artifactPath,
      }),
    );
  } catch (error) {
    const shotPath = page
      ? await captureFailureScreenshot(page, "playwright-schedule-conflict-failure")
      : "N/A";
    console.error("Conflict retry hint regression failed. Screenshot:", shotPath);
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

