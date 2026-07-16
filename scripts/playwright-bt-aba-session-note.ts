/**
 * Synthetic browser proof for the exact-BT ABA session-note closeout lifecycle.
 *
 * Required: PW_BT_EMAIL, PW_BT_PASSWORD, PW_BASE_URL, VITE_SUPABASE_URL,
 * VITE_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY), and SUPABASE_SERVICE_ROLE_KEY.
 * The BT email must be visibly synthetic (playwright, smoke, test, or ci).
 */
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

import {
  bookSession,
  cancelSession,
  fetchAccessTokenForCredentials,
  resolveOrganizationIdFromAccessToken,
  startSession,
  type LifecycleIds,
} from "./lib/playwright-inprogress-session-setup";
import { loadPlaywrightEnv } from "./lib/load-playwright-env";
import { openScheduleSessionModalFromCalendar } from "./lib/playwright-schedule-session-modal";
import {
  assertRouteAccessible,
  captureFailureScreenshot,
  loginAndAssertSession,
} from "./lib/playwright-smoke";

const FLOW = "BT ABA session-note Playwright regression";
const SYNTHETIC_EMAIL = /(playwright|smoke|test|\bci\b)/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STEP_TIMEOUT_MS = Number(process.env.PW_BT_ABA_STEP_TIMEOUT_MS ?? "300000");

const requiredEnv = (key: string, fallback?: string): string => {
  const value = (process.env[key] ?? fallback)?.trim();
  if (!value || ["****", "<required>", "changeme"].includes(value.toLowerCase())) {
    throw new Error(`${FLOW} cannot run: ${key} is required and must not be a placeholder.`);
  }
  return value;
};

const withStep = async <T>(label: string, operation: () => Promise<T>): Promise<T> => {
  console.log(`[bt-aba-closeout] start ${label}`);
  let rejectTimeout: (error: Error) => void = () => undefined;
  const timeout = new Promise<never>((_, reject) => {
    rejectTimeout = reject;
  });
  const timer = setTimeout(
    () => rejectTimeout(new Error(`Step timed out: ${label} (${STEP_TIMEOUT_MS}ms)`)),
    STEP_TIMEOUT_MS,
  );
  timer.unref?.();
  try {
    const result = await Promise.race([operation(), timeout]);
    console.log(`[bt-aba-closeout] ok ${label}`);
    return result as T;
  } finally {
    clearTimeout(timer);
  }
};

const selectFirstOptionIfEmpty = async (
  locator: ReturnType<Page["locator"]>,
  label: string,
): Promise<void> => {
  const select = locator.first();
  if ((await select.count()) === 0 || (await select.inputValue()).trim()) return;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const values = await select.locator("option").evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value).filter((value) => value.trim()),
    );
    if (values[0]) {
      await select.selectOption(values[0]);
      return;
    }
    await select.page().waitForTimeout(250);
  }
  throw new Error(`No selectable ${label} was available for the synthetic session.`);
};

const resolveActorId = async (token: string): Promise<string> => {
  const response = await fetch(`${requiredEnv("VITE_SUPABASE_URL")}/auth/v1/user`, {
    headers: {
      apikey: requiredEnv("VITE_SUPABASE_ANON_KEY", process.env.SUPABASE_ANON_KEY),
      Authorization: `Bearer ${token}`,
    },
  });
  const body = (await response.json().catch(() => null)) as { id?: string } | null;
  if (!response.ok || !body?.id || !UUID_PATTERN.test(body.id)) {
    throw new Error(`Unable to resolve the authenticated BT identity (${response.status}).`);
  }
  return body.id;
};

const assertExactBtAssignment = async (input: {
  actorId: string;
  organizationId: string;
  therapistId: string;
}): Promise<void> => {
  const admin = createClient(requiredEnv("VITE_SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const [{ data: roleRows, error: roleError }, { data: therapist, error: therapistError }] = await Promise.all([
    admin.from("user_roles").select("roles(name)").eq("user_id", input.actorId),
    admin
      .from("therapists")
      .select("id, organization_id, status, deleted_at, title")
      .eq("id", input.therapistId)
      .maybeSingle(),
  ]);
  if (roleError) throw new Error(`Unable to verify synthetic BT roles: ${roleError.message}`);
  if (therapistError) throw new Error(`Unable to verify synthetic BT therapist: ${therapistError.message}`);

  const roleNames = (roleRows ?? []).flatMap((row) => {
    const related = row.roles as unknown as { name?: unknown } | Array<{ name?: unknown }> | null;
    const entries = Array.isArray(related) ? related : related ? [related] : [];
    return entries.map((entry) => String(entry.name ?? "").trim().toLowerCase()).filter(Boolean);
  });
  const elevated = new Set(["admin", "admin_schedule", "midtier", "bcba", "therapist"]);
  assert.equal(roleNames.includes("bt"), true, "Synthetic actor must have the authoritative bt role.");
  assert.equal(roleNames.some((role) => elevated.has(role)), false, "Synthetic actor must be an exact BT, not an elevated role.");
  assert.ok(therapist, "Booked therapist must exist.");
  assert.equal(therapist.organization_id, input.organizationId, "Booked therapist must be in the active organization.");
  assert.equal(therapist.status, "active", "Booked therapist must be active.");
  assert.equal(therapist.deleted_at, null, "Booked therapist must not be deleted.");
  assert.match(String(therapist.title ?? "").trim().toUpperCase(), /^(BT|RBT)$/);

  if (input.actorId !== input.therapistId) {
    const { data: link, error: linkError } = await admin
      .from("user_therapist_links")
      .select("user_id")
      .eq("user_id", input.actorId)
      .eq("therapist_id", input.therapistId)
      .maybeSingle();
    if (linkError) throw new Error(`Unable to verify BT therapist link: ${linkError.message}`);
    assert.ok(link, "Booked therapist must be the authenticated BT or their explicit therapist link.");
  }
};

const waitForSessionStatus = async (sessionId: string, expected: string): Promise<void> => {
  const admin = createClient(requiredEnv("VITE_SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const { data, error } = await admin.from("sessions").select("status").eq("id", sessionId).maybeSingle();
    if (!error && data?.status === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Timed out waiting for session ${sessionId} status=${expected}.`);
};

const assertFinalizedArtifacts = async (ids: LifecycleIds, actorId: string, marker: string): Promise<void> => {
  const admin = createClient(requiredEnv("VITE_SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data: note, error: noteError } = await admin
    .from("client_session_notes")
    .select("id, is_locked, signed_at, bt_aba_responses")
    .eq("session_id", ids.sessionId)
    .maybeSingle();
  if (noteError) throw new Error(`Unable to read finalized synthetic note: ${noteError.message}`);
  assert.ok(note?.id, "Finalization must persist a session note.");
  assert.equal(note.is_locked, true);
  assert.ok(note.signed_at);
  assert.equal((note.bt_aba_responses as { client_status?: string } | null)?.client_status, marker);

  const { data: attestations, error: attestationError } = await admin
    .from("session_note_attestations")
    .select("signer_user_id, attestation_role")
    .eq("note_id", note.id)
    .eq("attestation_role", "bt");
  if (attestationError) throw new Error(`Unable to read synthetic BT attestation: ${attestationError.message}`);
  assert.equal(attestations?.length, 1, "Finalization must create one BT attestation.");
  assert.equal(attestations?.[0]?.signer_user_id, actorId);
};

async function run(): Promise<void> {
  loadPlaywrightEnv();
  const baseUrl = requiredEnv("PW_BASE_URL").replace(/\/$/, "");
  const email = requiredEnv("PW_BT_EMAIL").toLowerCase();
  const password = requiredEnv("PW_BT_PASSWORD");
  requiredEnv("VITE_SUPABASE_URL");
  requiredEnv("VITE_SUPABASE_ANON_KEY", process.env.SUPABASE_ANON_KEY);
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!SYNTHETIC_EMAIL.test(email)) {
    throw new Error(`${FLOW} refuses PW_BT_EMAIL because it is not visibly synthetic.`);
  }

  const browser = await chromium.launch({ headless: process.env.HEADLESS !== "false" });
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  const ids: Partial<LifecycleIds> = {};
  let token = "";
  let completed = false;
  const marker = `PW BT ABA ${Date.now()}`;

  try {
    context = await browser.newContext();
    page = await context.newPage();
    await withStep("login exact synthetic BT", () => loginAndAssertSession(page!, baseUrl, email, password));
    await withStep("open Schedule", () => assertRouteAccessible(page!, baseUrl, "/schedule", {
      readySelector: 'button[aria-label="Day view"]',
    }));
    token = await fetchAccessTokenForCredentials(email, password);
    const actorId = await resolveActorId(token);
    const organizationId = await resolveOrganizationIdFromAccessToken(token);
    if (!organizationId) throw new Error("Unable to resolve the exact BT active organization.");

    const booked = await withStep("book assigned synthetic session", () =>
      bookSession(page!, token, true, { restrictToOrganizationId: organizationId }));
    Object.assign(ids, booked);
    await assertExactBtAssignment({ actorId, organizationId, therapistId: booked.therapistId });
    await withStep("start assigned session", () => startSession(page!, token, booked, true));
    await withStep("confirm in-progress session", () => waitForSessionStatus(booked.sessionId, "in_progress"));

    const scheduleUrl = `${baseUrl}/schedule`;
    await withStep("capture goal data and open closeout", async () => {
      await openScheduleSessionModalFromCalendar(page!, scheduleUrl, booked, { allowLockedTherapist: true });
      const dialog = page!.locator('[role="dialog"]').filter({ hasText: /Live session|Edit Session/i }).first();
      const capture = dialog.getByTestId("session-modal-capture-section");
      await capture.waitFor({ state: "visible" });
      await selectFirstOptionIfEmpty(
        dialog.locator('#session-note-auth-select, select[name="session_note_authorization_id"]'),
        "authorization",
      );
      await selectFirstOptionIfEmpty(
        dialog.locator('#session-note-service-code-select, select[name="session_note_service_code"]'),
        "service code",
      );
      await dialog.locator(`#goal-note-${booked.goalId}`).fill(`Synthetic goal note ${marker}`);
      const correctTrial = dialog.getByRole("button", { name: /Increase correct trials for target 1/i }).first();
      if (await correctTrial.count()) await correctTrial.click();
      await dialog.getByRole("button", { name: "Close Session", exact: true }).click();
      await dialog.getByRole("heading", { name: "ABA Session Note", exact: true }).waitFor({ state: "visible" });
    });

    const closeoutDialog = page.locator('[role="dialog"]').first();
    await withStep("prove incomplete validation", async () => {
      await closeoutDialog.getByRole("button", { name: "Finalize Session", exact: true }).click();
      await closeoutDialog.getByText("Purpose of Session is required", { exact: true }).waitFor({ state: "visible" });
      await closeoutDialog.getByText("Behavior Technician signature is required", { exact: true }).waitFor({ state: "visible" });
    });

    await withStep("save durable draft", async () => {
      await closeoutDialog.getByLabel("RBT/BT worked on goals as stated in the treatment plan", { exact: true }).check();
      await closeoutDialog.getByLabel("Client Status", { exact: true }).fill(marker);
      const responsePromise = page!.waitForResponse((response) => {
        if (!response.url().includes("/api/session-notes/upsert") || response.request().method() !== "POST") return false;
        return response.request().postData()?.includes('"action":"draft_bt_aba"') === true;
      });
      await closeoutDialog.getByRole("button", { name: "Save Draft", exact: true }).click();
      const response = await responsePromise;
      assert.equal(response.ok(), true, `Draft save failed: HTTP ${response.status()}`);
    });

    await withStep("reload and restore draft", async () => {
      await page!.reload({ waitUntil: "networkidle" });
      await openScheduleSessionModalFromCalendar(page!, scheduleUrl, booked, { allowLockedTherapist: true });
      const restored = page!.locator('[role="dialog"]').first();
      await restored.getByRole("heading", { name: "ABA Session Note", exact: true }).waitFor({ state: "visible" });
      assert.equal(await restored.getByLabel("Client Status", { exact: true }).inputValue(), marker);
    });

    await withStep("complete note and exercise both signature modes", async () => {
      const restored = page!.locator('[role="dialog"]').first();
      await restored.getByRole("group", { name: "Skill Strategies", exact: true }).getByLabel("N/A", { exact: true }).check();
      await restored.getByRole("group", { name: "Behavior Strategies", exact: true }).getByLabel("N/A", { exact: true }).check();
      await restored.getByLabel("Supervisor did not attend this session", { exact: true }).check();
      await restored.getByLabel("Summary of Progress Toward Treatment Goals", { exact: true }).fill(`Synthetic progress ${marker}`);
      await restored.getByLabel("Client's Response to Treatment", { exact: true }).fill(`Synthetic response ${marker}`);

      await restored.getByLabel("Draw signature", { exact: true }).check();
      const pad = restored.getByRole("application", { name: "Draw Behavior Technician signature" });
      const box = await pad.boundingBox();
      if (!box) throw new Error("Drawn signature pad has no browser bounds.");
      await page!.mouse.move(box.x + 20, box.y + 40);
      await page!.mouse.down();
      await page!.mouse.move(box.x + 90, box.y + 75, { steps: 6 });
      await page!.mouse.up();
      await restored.getByTestId("signature-stroke").waitFor({ state: "visible" });
      await restored.getByRole("button", { name: "Clear signature", exact: true }).click();
      await restored.getByLabel("Type signature", { exact: true }).check();
      await restored.getByLabel("Type Behavior Technician signature", { exact: true }).fill(`Synthetic BT ${actorId.slice(0, 8)}`);
    });

    await withStep("atomically finalize session", async () => {
      const restored = page!.locator('[role="dialog"]').first();
      const responsePromise = page!.waitForResponse((response) => {
        if (!response.url().includes("/api/session-notes/upsert") || response.request().method() !== "POST") return false;
        return response.request().postData()?.includes('"action":"finalize_bt_aba"') === true;
      });
      await restored.getByRole("button", { name: "Finalize Session", exact: true }).click();
      const response = await responsePromise;
      const body = (await response.json().catch(() => null)) as { status?: string } | null;
      assert.equal(response.ok(), true, `Finalization failed: HTTP ${response.status()}`);
      assert.equal(body?.status, "completed");
      await waitForSessionStatus(booked.sessionId, "completed");
      await assertFinalizedArtifacts(booked, actorId, marker);
      completed = true;
    });

    console.log(JSON.stringify({
      ok: true,
      message: "BT ABA session-note closeout lifecycle validated",
      marker,
      sessionId: booked.sessionId,
      reviewerVisibility: "blocked:no-established-safe-synthetic-reviewer-browser-path",
    }));
  } catch (error) {
    const screenshot = page ? await captureFailureScreenshot(page, "playwright-bt-aba-session-note") : "N/A";
    console.error(JSON.stringify({
      ok: false,
      message: `${FLOW} failed`,
      error: error instanceof Error ? error.message : String(error),
      screenshot,
      ids,
    }));
    throw error;
  } finally {
    if (page && token && ids.sessionId) {
      await cancelSession(page, token, ids.sessionId, ids).catch((error) => {
        console.warn(`[bt-aba-closeout] exact fixture cleanup failed after completed=${completed}: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    await context?.close();
    await browser.close();
  }
}

const isMainModule = (): boolean => {
  const entry = process.argv[1];
  return Boolean(entry && import.meta.url === pathToFileURL(path.resolve(entry)).href);
};

if (isMainModule()) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
