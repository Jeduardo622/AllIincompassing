/**
 * Disposable-project browser proof for the exact-BT ABA closeout lifecycle.
 * All fixture identities are explicit and marker-validated before the first write.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

import {
  fetchAccessTokenForCredentials,
  startSession,
  type LifecycleIds,
} from "./lib/playwright-inprogress-session-setup";
import { loadPlaywrightEnv } from "./lib/load-playwright-env";
import { openScheduleSessionModalFromCalendar } from "./lib/playwright-schedule-session-modal";
import { assertRouteAccessible, captureFailureScreenshot, loginAndAssertSession } from "./lib/playwright-smoke";

const FLOW = "BT ABA session-note Playwright regression";
const PRODUCTION_PROJECT_REF = "wnnjeqheqxxyrgsjmygy";
const DISPOSABLE_ACK = "I_ACKNOWLEDGE_DISPOSABLE_SUPABASE";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SYNTHETIC_EMAIL = /(playwright|smoke|test|\bci\b)/i;
const STEP_TIMEOUT_MS = Number(process.env.PW_BT_ABA_STEP_TIMEOUT_MS ?? "300000");

type SafetyConfig = {
  baseUrl: string;
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  projectRef: string;
  fixtureMarker: string;
  email: string;
  password: string;
  clientId: string;
  programId: string;
  goalId: string;
};

type FixtureGraph = {
  actorId: string;
  organizationId: string;
  therapistId: string;
  clientId: string;
  programId: string;
  goalId: string;
};

const normalizedEnv = (key: string, fallback?: string): string => (process.env[key] ?? fallback ?? "").trim();

const loadSafetyConfig = (): SafetyConfig => {
  const required: Array<[string, string]> = [
    ["PW_BASE_URL", normalizedEnv("PW_BASE_URL")],
    ["PW_BT_EMAIL", normalizedEnv("PW_BT_EMAIL")],
    ["PW_BT_PASSWORD", normalizedEnv("PW_BT_PASSWORD")],
    ["PW_BT_CLIENT_ID", normalizedEnv("PW_BT_CLIENT_ID")],
    ["PW_BT_PROGRAM_ID", normalizedEnv("PW_BT_PROGRAM_ID")],
    ["PW_BT_GOAL_ID", normalizedEnv("PW_BT_GOAL_ID")],
    ["PW_BT_FIXTURE_MARKER", normalizedEnv("PW_BT_FIXTURE_MARKER")],
    ["PW_BT_DISPOSABLE_PROJECT_REF", normalizedEnv("PW_BT_DISPOSABLE_PROJECT_REF")],
    ["PW_BT_DISPOSABLE_ACK", normalizedEnv("PW_BT_DISPOSABLE_ACK")],
    ["VITE_SUPABASE_URL", normalizedEnv("VITE_SUPABASE_URL")],
    ["VITE_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY)", normalizedEnv("VITE_SUPABASE_ANON_KEY", process.env.SUPABASE_ANON_KEY)],
    ["SUPABASE_SERVICE_ROLE_KEY", normalizedEnv("SUPABASE_SERVICE_ROLE_KEY")],
  ];
  const invalid = required.filter(([, value]) => !value || ["****", "<required>", "changeme"].includes(value.toLowerCase()));
  if (invalid.length) {
    throw new Error(`${FLOW} cannot run before any write: ${invalid.map(([key]) => key).join(", ")} must be explicitly configured.`);
  }

  const email = normalizedEnv("PW_BT_EMAIL").toLowerCase();
  const marker = normalizedEnv("PW_BT_FIXTURE_MARKER");
  const projectRef = normalizedEnv("PW_BT_DISPOSABLE_PROJECT_REF").toLowerCase();
  const supabaseUrl = normalizedEnv("VITE_SUPABASE_URL").replace(/\/$/, "");
  if (!SYNTHETIC_EMAIL.test(email)) throw new Error(`${FLOW} refuses a PW_BT_EMAIL that is not visibly synthetic.`);
  if (marker.length < 12 || !/^[a-z0-9-]+$/i.test(marker)) {
    throw new Error("PW_BT_FIXTURE_MARKER must be at least 12 characters and contain only letters, digits, or hyphens.");
  }
  if (!email.includes(marker.toLowerCase())) {
    throw new Error("PW_BT_EMAIL must contain the exact PW_BT_FIXTURE_MARKER.");
  }
  for (const [key, value] of [
    ["PW_BT_CLIENT_ID", normalizedEnv("PW_BT_CLIENT_ID")],
    ["PW_BT_PROGRAM_ID", normalizedEnv("PW_BT_PROGRAM_ID")],
    ["PW_BT_GOAL_ID", normalizedEnv("PW_BT_GOAL_ID")],
  ]) {
    if (!UUID_PATTERN.test(value)) throw new Error(`${key} must be an explicit UUID.`);
  }
  if (normalizedEnv("PW_BT_DISPOSABLE_ACK") !== DISPOSABLE_ACK) {
    throw new Error(`PW_BT_DISPOSABLE_ACK must equal ${DISPOSABLE_ACK}.`);
  }
  let runtimeRef = "";
  try {
    const hostname = new URL(supabaseUrl).hostname.toLowerCase();
    const match = hostname.match(/^([a-z0-9-]+)\.supabase\.co$/);
    runtimeRef = match?.[1] ?? "";
  } catch {
    throw new Error("VITE_SUPABASE_URL must be a valid hosted Supabase URL for this destructive disposable-fixture proof.");
  }
  if (!runtimeRef || runtimeRef !== projectRef) {
    throw new Error(`Disposable project acknowledgement mismatch: runtime ref ${runtimeRef || "unresolved"} != ${projectRef}.`);
  }
  if (runtimeRef === PRODUCTION_PROJECT_REF || projectRef === PRODUCTION_PROJECT_REF) {
    throw new Error(`Refusing production Supabase project ${PRODUCTION_PROJECT_REF}.`);
  }

  return {
    baseUrl: normalizedEnv("PW_BASE_URL").replace(/\/$/, ""),
    supabaseUrl,
    anonKey: normalizedEnv("VITE_SUPABASE_ANON_KEY", process.env.SUPABASE_ANON_KEY),
    serviceRoleKey: normalizedEnv("SUPABASE_SERVICE_ROLE_KEY"),
    projectRef,
    fixtureMarker: marker,
    email,
    password: normalizedEnv("PW_BT_PASSWORD"),
    clientId: normalizedEnv("PW_BT_CLIENT_ID"),
    programId: normalizedEnv("PW_BT_PROGRAM_ID"),
    goalId: normalizedEnv("PW_BT_GOAL_ID"),
  };
};

const withStep = async <T>(label: string, operation: () => Promise<T>): Promise<T> => {
  console.log(`[bt-aba-closeout] start ${label}`);
  let rejectTimeout: (error: Error) => void = () => undefined;
  const timeout = new Promise<never>((_, reject) => { rejectTimeout = reject; });
  const timer = setTimeout(() => rejectTimeout(new Error(`Step timed out: ${label} (${STEP_TIMEOUT_MS}ms)`)), STEP_TIMEOUT_MS);
  timer.unref?.();
  try {
    const result = await Promise.race([operation(), timeout]);
    console.log(`[bt-aba-closeout] ok ${label}`);
    return result as T;
  } finally {
    clearTimeout(timer);
  }
};

const requireMarker = (value: unknown, marker: string, label: string): void => {
  if (typeof value !== "string" || !value.includes(marker)) {
    throw new Error(`${label} must contain the exact disposable fixture marker before any write.`);
  }
};

const resolveActor = async (config: SafetyConfig, token: string): Promise<{ id: string; email: string; organizationId: string }> => {
  const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
    headers: { apikey: config.anonKey, Authorization: `Bearer ${token}` },
  });
  const user = (await response.json().catch(() => null)) as { id?: string; email?: string } | null;
  if (!response.ok || !user?.id || !UUID_PATTERN.test(user.id) || !user.email) {
    throw new Error(`Unable to resolve direct Supabase auth user response (${response.status}).`);
  }
  const organizationResponse = await fetch(`${config.supabaseUrl}/rest/v1/rpc/current_user_organization_id`, {
    method: "POST",
    headers: { apikey: config.anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{}",
  });
  const organizationId = (await organizationResponse.json().catch(() => null)) as string | null;
  if (!organizationResponse.ok || !organizationId || !UUID_PATTERN.test(organizationId)) {
    throw new Error(`Unable to resolve authoritative active organization (${organizationResponse.status}).`);
  }
  return { id: user.id, email: user.email.toLowerCase(), organizationId };
};

const validateFixtureGraphReadOnly = async (
  admin: SupabaseClient,
  config: SafetyConfig,
  actor: { id: string; email: string; organizationId: string },
): Promise<FixtureGraph> => {
  requireMarker(actor.email, config.fixtureMarker.toLowerCase(), "Authenticated actor email");
  const [profileResult, therapistResult, clientResult, programResult, goalResult, rolesResult] = await Promise.all([
    admin.from("profiles").select("organization_id").eq("id", actor.id).maybeSingle(),
    admin.from("therapists").select("id, organization_id, email, full_name, title, status, deleted_at").eq("id", actor.id).maybeSingle(),
    admin.from("clients").select("id, organization_id, full_name, email, notes, status, deleted_at").eq("id", config.clientId).maybeSingle(),
    admin.from("programs").select("id, organization_id, client_id, name, description, status").eq("id", config.programId).maybeSingle(),
    admin.from("goals").select("id, organization_id, client_id, program_id, title, description, original_text, status").eq("id", config.goalId).maybeSingle(),
    admin.from("user_roles").select("roles(name)").eq("user_id", actor.id),
  ]);
  for (const [label, result] of [
    ["profile", profileResult], ["therapist", therapistResult], ["client", clientResult],
    ["program", programResult], ["goal", goalResult], ["roles", rolesResult],
  ] as const) {
    if (result.error) throw new Error(`Unable to validate ${label} fixture read-only: ${result.error.message}`);
  }
  const profile = profileResult.data;
  const therapist = therapistResult.data;
  const client = clientResult.data;
  const program = programResult.data;
  const goal = goalResult.data;
  if (!profile?.organization_id || !therapist || !client || !program || !goal) {
    throw new Error("Explicit BT fixture graph is incomplete; no write was performed.");
  }
  const organizationId = actor.organizationId;
  assert.equal(profile.organization_id, organizationId, "Profile organization must match the authoritative active-organization RPC.");
  assert.equal(therapist.organization_id, organizationId);
  assert.equal(client.organization_id, organizationId);
  assert.equal(program.organization_id, organizationId);
  assert.equal(goal.organization_id, organizationId);
  assert.equal(program.client_id, client.id);
  assert.equal(goal.client_id, client.id);
  assert.equal(goal.program_id, program.id);
  assert.equal(therapist.status, "active");
  assert.equal(therapist.deleted_at, null);
  assert.match(String(therapist.title ?? "").trim().toUpperCase(), /^(BT|RBT)$/);
  assert.equal(client.status, "active");
  assert.equal(client.deleted_at, null);
  assert.equal(program.status, "active");
  assert.equal(goal.status, "active");
  requireMarker(therapist.email, config.fixtureMarker, "Therapist email");
  requireMarker(therapist.full_name, config.fixtureMarker, "Therapist full_name");
  requireMarker(client.full_name, config.fixtureMarker, "Client full_name");
  requireMarker(client.email, config.fixtureMarker, "Client email");
  requireMarker(client.notes, config.fixtureMarker, "Client notes");
  requireMarker(program.name, config.fixtureMarker, "Program name");
  requireMarker(program.description, config.fixtureMarker, "Program description");
  requireMarker(goal.title, config.fixtureMarker, "Goal title");
  requireMarker(goal.description, config.fixtureMarker, "Goal description");
  requireMarker(goal.original_text, config.fixtureMarker, "Goal original_text");

  const roleNames = (rolesResult.data ?? []).flatMap((row) => {
    const roles = row.roles as unknown as { name?: unknown } | Array<{ name?: unknown }> | null;
    return (Array.isArray(roles) ? roles : roles ? [roles] : []).map((role) => String(role.name ?? "").toLowerCase());
  });
  assert.equal(roleNames.includes("bt"), true, "Actor must have the authoritative bt role.");
  assert.equal(roleNames.some((role) => ["admin", "admin_schedule", "midtier", "bcba", "therapist"].includes(role)), false);

  const today = new Date().toISOString().slice(0, 10);
  const { data: authorizations, error: authorizationError } = await admin
    .from("authorizations")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("client_id", client.id)
    .eq("provider_id", therapist.id)
    .eq("status", "approved")
    .lte("start_date", today)
    .gte("end_date", today)
    .limit(1);
  if (authorizationError) throw new Error(`Unable to validate fixture authorization: ${authorizationError.message}`);
  assert.equal(authorizations?.length, 1, "Explicit fixture graph needs a current approved therapist-client authorization.");
  return { actorId: actor.id, organizationId, therapistId: therapist.id, clientId: client.id, programId: program.id, goalId: goal.id };
};

const createExactSession = async (admin: SupabaseClient, graph: FixtureGraph, marker: string): Promise<LifecycleIds> => {
  const base = new Date(Date.now() - 30 * 60_000);
  for (let attempt = 0; attempt < 48; attempt += 1) {
    const start = new Date(base.getTime() + attempt * 90 * 60_000);
    const end = new Date(start.getTime() + 60 * 60_000);
    const { data, error } = await admin.from("sessions").insert({
      organization_id: graph.organizationId,
      therapist_id: graph.therapistId,
      client_id: graph.clientId,
      program_id: graph.programId,
      goal_id: graph.goalId,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      status: "scheduled",
      notes: marker,
    }).select("id").single();
    if (!error && data?.id) {
      return { sessionId: data.id, therapistId: graph.therapistId, clientId: graph.clientId, programId: graph.programId, goalId: graph.goalId, startIso: start.toISOString(), endIso: end.toISOString() };
    }
    if (!error?.message.includes("sessions_no_overlap")) {
      throw new Error(`Exact disposable session insert failed: ${error?.message ?? "missing id"}`);
    }
  }
  throw new Error("Exact disposable session insert could not find a non-overlapping slot.");
};

const selectFirstOptionIfEmpty = async (locator: ReturnType<Page["locator"]>, label: string): Promise<void> => {
  const select = locator.first();
  if ((await select.count()) === 0 || (await select.inputValue()).trim()) return;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const values = await select.locator("option").evaluateAll((options) => options.map((node) => (node as HTMLOptionElement).value).filter(Boolean));
    if (values[0]) { await select.selectOption(values[0]); return; }
    await select.page().waitForTimeout(250);
  }
  throw new Error(`No selectable ${label} exists for the explicit disposable fixture.`);
};

const waitForSessionStatus = async (admin: SupabaseClient, sessionId: string, expected: string): Promise<void> => {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const { data, error } = await admin.from("sessions").select("status").eq("id", sessionId).maybeSingle();
    if (!error && data?.status === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Timed out waiting for session ${sessionId} status=${expected}.`);
};

const assertFinalizedArtifacts = async (admin: SupabaseClient, ids: LifecycleIds, actorId: string, marker: string): Promise<void> => {
  const { data: note, error } = await admin.from("client_session_notes")
    .select("id, is_locked, signed_at, bt_aba_responses").eq("session_id", ids.sessionId).maybeSingle();
  if (error || !note?.id) throw new Error(`Unable to read finalized disposable note: ${error?.message ?? "missing"}`);
  assert.equal(note.is_locked, true);
  assert.ok(note.signed_at);
  assert.equal((note.bt_aba_responses as { client_status?: string } | null)?.client_status, marker);
  const { data: attestations, error: attestationError } = await admin.from("session_note_attestations")
    .select("signer_user_id").eq("note_id", note.id).eq("attestation_role", "bt");
  if (attestationError) throw new Error(`Unable to read disposable attestation: ${attestationError.message}`);
  assert.equal(attestations?.length, 1);
  assert.equal(attestations?.[0]?.signer_user_id, actorId);
};

const cleanupExactSessionGraph = async (admin: SupabaseClient, sessionId: string, marker: string, projectRef: string): Promise<void> => {
  const { data: session, error: sessionReadError } = await admin.from("sessions").select("id, notes").eq("id", sessionId).maybeSingle();
  if (sessionReadError) throw new Error(`Disposable cleanup could not read exact session: ${sessionReadError.message}`);
  if (!session) return;
  assert.equal(session.notes, marker, "Refusing cleanup because the exact session marker does not match.");
  const { data: notes, error: notesError } = await admin.from("client_session_notes").select("id").eq("session_id", sessionId);
  if (notesError) throw new Error(`Disposable cleanup could not inventory notes: ${notesError.message}`);
  const noteIds = (notes ?? []).map((note) => note.id);
  const { error: deleteError } = await admin.from("sessions").delete().eq("id", sessionId).eq("notes", marker);
  if (deleteError) {
    throw new Error(`Exact fixture graph deletion failed: ${deleteError.message}. Tear down disposable Supabase branch ${projectRef}; never reuse it.`);
  }
  const sessionTables = [
    "sessions", "client_session_notes", "trial_events", "session_audit_logs", "supervision_session_note_requests",
    "session_goals", "session_cpt_entries", "goal_target_phase_evaluations", "goal_target_transitions",
  ];
  const residuals: string[] = [];
  for (const table of sessionTables) {
    const column = table === "sessions" ? "id" : "session_id";
    const { count, error } = await admin.from(table).select("*", { count: "exact", head: true }).eq(column, sessionId);
    if (error) throw new Error(`Cleanup verification failed for ${table}: ${error.message}. Tear down disposable branch ${projectRef}.`);
    if ((count ?? 0) > 0) residuals.push(`${table}:${count}`);
  }
  if (noteIds.length) {
    const { count, error } = await admin.from("session_note_attestations").select("*", { count: "exact", head: true }).in("note_id", noteIds);
    if (error) throw new Error(`Cleanup verification failed for attestations: ${error.message}. Tear down disposable branch ${projectRef}.`);
    if ((count ?? 0) > 0) residuals.push(`session_note_attestations:${count}`);
  }
  if (residuals.length) throw new Error(`Disposable cleanup left ${residuals.join(", ")}. Tear down disposable Supabase branch ${projectRef}; never reuse it.`);
};

async function run(): Promise<void> {
  loadPlaywrightEnv();
  const config = loadSafetyConfig();
  const admin = createClient(config.supabaseUrl, config.serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
  const token = await fetchAccessTokenForCredentials(config.email, config.password);
  const actor = await resolveActor(config, token);
  assert.equal(actor.email, config.email);
  const graph = await validateFixtureGraphReadOnly(admin, config, actor);

  const browser = await chromium.launch({ headless: process.env.HEADLESS !== "false" });
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let createdSessionId: string | null = null;
  let runError: unknown;
  try {
    context = await browser.newContext();
    page = await context.newPage();
    await withStep("login exact disposable BT", () => loginAndAssertSession(page!, config.baseUrl, config.email, config.password));
    await withStep("open Schedule", () => assertRouteAccessible(page!, config.baseUrl, "/schedule", { readySelector: 'button[aria-label="Day view"]' }));
    const booked = await withStep("create exact marked session", () => createExactSession(admin, graph, config.fixtureMarker));
    createdSessionId = booked.sessionId;
    await withStep("start exact assigned session", () => startSession(page!, token, booked, true));
    await waitForSessionStatus(admin, booked.sessionId, "in_progress");

    const scheduleUrl = `${config.baseUrl}/schedule`;
    await withStep("capture exact goal and open closeout", async () => {
      await openScheduleSessionModalFromCalendar(page!, scheduleUrl, booked, { allowLockedTherapist: true });
      const dialog = page!.locator('[role="dialog"]').first();
      await dialog.getByTestId("session-modal-capture-section").waitFor({ state: "visible" });
      await selectFirstOptionIfEmpty(dialog.locator('#session-note-auth-select, select[name="session_note_authorization_id"]'), "authorization");
      await selectFirstOptionIfEmpty(dialog.locator('#session-note-service-code-select, select[name="session_note_service_code"]'), "service code");
      await dialog.locator(`#goal-note-${booked.goalId}`).fill(`Synthetic goal note ${config.fixtureMarker}`);
      await dialog.getByRole("button", { name: "Close Session", exact: true }).click();
      await dialog.getByRole("heading", { name: "ABA Session Note", exact: true }).waitFor({ state: "visible" });
    });

    const closeout = page.locator('[role="dialog"]').first();
    await closeout.getByRole("button", { name: "Finalize Session", exact: true }).click();
    await closeout.getByText("Purpose of Session is required", { exact: true }).waitFor({ state: "visible" });
    await closeout.getByText("Behavior Technician signature is required", { exact: true }).waitFor({ state: "visible" });
    await closeout.getByLabel("RBT/BT worked on goals as stated in the treatment plan", { exact: true }).check();
    await closeout.getByLabel("Client Status", { exact: true }).fill(config.fixtureMarker);
    const draftResponse = page.waitForResponse((response) => response.url().includes("/api/session-notes/upsert") && response.request().postData()?.includes('"action":"draft_bt_aba"') === true);
    await closeout.getByRole("button", { name: "Save Draft", exact: true }).click();
    assert.equal((await draftResponse).ok(), true);

    await page.reload({ waitUntil: "networkidle" });
    await openScheduleSessionModalFromCalendar(page, scheduleUrl, booked, { allowLockedTherapist: true });
    const restored = page.locator('[role="dialog"]').first();
    await restored.getByRole("heading", { name: "ABA Session Note", exact: true }).waitFor({ state: "visible" });
    assert.equal(await restored.getByLabel("Client Status", { exact: true }).inputValue(), config.fixtureMarker);
    await restored.getByRole("group", { name: "Skill Strategies", exact: true }).getByLabel("N/A", { exact: true }).check();
    await restored.getByRole("group", { name: "Behavior Strategies", exact: true }).getByLabel("N/A", { exact: true }).check();
    await restored.getByLabel("Supervisor did not attend this session", { exact: true }).check();
    await restored.getByLabel("Summary of Progress Toward Treatment Goals", { exact: true }).fill(`Progress ${config.fixtureMarker}`);
    await restored.getByLabel("Client's Response to Treatment", { exact: true }).fill(`Response ${config.fixtureMarker}`);
    await restored.getByLabel("Draw signature", { exact: true }).check();
    const pad = restored.getByRole("application", { name: "Draw Behavior Technician signature" });
    const box = await pad.boundingBox();
    if (!box) throw new Error("Drawn signature pad has no bounds.");
    await page.mouse.move(box.x + 20, box.y + 40); await page.mouse.down();
    await page.mouse.move(box.x + 90, box.y + 75, { steps: 6 }); await page.mouse.up();
    await restored.getByTestId("signature-stroke").waitFor({ state: "visible" });
    await restored.getByRole("button", { name: "Clear signature", exact: true }).click();
    await restored.getByLabel("Type signature", { exact: true }).check();
    await restored.getByLabel("Type Behavior Technician signature", { exact: true }).fill(`BT ${config.fixtureMarker}`);

    const finalizeResponse = page.waitForResponse((response) => response.url().includes("/api/session-notes/upsert") && response.request().postData()?.includes('"action":"finalize_bt_aba"') === true);
    await restored.getByRole("button", { name: "Finalize Session", exact: true }).click();
    const response = await finalizeResponse;
    assert.equal(response.ok(), true, `Finalization failed: HTTP ${response.status()}`);
    assert.equal(((await response.json()) as { status?: string }).status, "completed");
    await restored.waitFor({ state: "hidden" });
    const completionSignal = page.getByText("Session marked as completed", { exact: true });
    await completionSignal.waitFor({ state: "visible" });
    assert.equal(await completionSignal.count(), 1, "Schedule must emit exactly one completion success signal.");
    const completedCard = page.locator(`[data-session-id="${booked.sessionId}"]`);
    await completedCard.waitFor({ state: "attached" });
    assert.equal(await completedCard.getAttribute("data-session-status"), "completed");
    await waitForSessionStatus(admin, booked.sessionId, "completed");
    await assertFinalizedArtifacts(admin, booked, actor.id, config.fixtureMarker);

    console.log(JSON.stringify({ ok: true, sessionId: booked.sessionId, projectRef: config.projectRef, reviewerVisibility: "blocked:no-safe-synthetic-reviewer-path" }));
  } catch (error) {
    const screenshot = page ? await captureFailureScreenshot(page, "playwright-bt-aba-session-note") : "N/A";
    console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error), screenshot, sessionId: createdSessionId }));
    runError = error;
  }

  let cleanupError: unknown;
  try {
    if (createdSessionId) await cleanupExactSessionGraph(admin, createdSessionId, config.fixtureMarker, config.projectRef);
  } catch (error) {
    cleanupError = error;
  } finally {
    await context?.close();
    await browser.close();
  }
  if (cleanupError) throw cleanupError;
  if (runError) throw runError;
}

const isMainModule = (): boolean => Boolean(process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href);
if (isMainModule()) run().catch((error) => { console.error(error); process.exit(1); });
