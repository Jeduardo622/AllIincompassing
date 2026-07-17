/** Always-run teardown for the exact marker-owned BT proof graph on a non-production preview. */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  assertBtFixtureMarker,
  assertBtFixtureGraph,
  assertBranchOwnershipContract,
  assertNonProductionProjectRef,
  cleanupPartialBtFixture,
  type PartialFixtureIds,
} from "./provision-ci-smoke-bt-aba";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const requiredEnv = (name: string, fallback?: string): string => {
  const value = process.env[name]?.trim() || fallback?.trim();
  if (!value) throw new Error(`${name} is required for exact fixture cleanup.`);
  return value;
};

const requiredUuid = (name: string): string => {
  const value = requiredEnv(name);
  if (!UUID.test(value)) throw new Error(`${name} must be an exact UUID.`);
  return value;
};

type CleanupState = { marker: string; projectRef: string; sessionId: string };

export const readCleanupState = (statePath: string, marker: string, projectRef: string): CleanupState | null => {
  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf8")) as Partial<CleanupState>;
    if (parsed.marker !== marker || parsed.projectRef !== projectRef || !parsed.sessionId || !UUID.test(parsed.sessionId)) {
      throw new Error("Cleanup state does not match the exact marker/project identity.");
    }
    return parsed as CleanupState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
};

const requireMarker = (value: unknown, marker: string, label: string): void => {
  if (typeof value !== "string" || !value.toLowerCase().includes(marker.toLowerCase())) {
    throw new Error(`${label} is not owned by the exact fixture marker.`);
  }
};

const deleteExact = async (client: SupabaseClient, table: string, column: string, value: string): Promise<void> => {
  const { error } = await client.from(table).delete().eq(column, value);
  if (error) throw new Error(`Cleanup failed for ${table}: ${error.message}`);
};

export const cleanupMarkerOwnedBtFixture = async (
  client: SupabaseClient,
  ids: PartialFixtureIds,
  marker: string,
  sessionId: string | null,
): Promise<void> => {
  if (!ids.actorId) throw new Error("Exact actor identity is required for retained-preview cleanup.");
  const [{ data: authData, error: authError }, organization, profile, therapist, fixtureClient, program, goal, authorization, service, roles] = await Promise.all([
    client.auth.admin.getUserById(ids.actorId),
    client.from("organizations").select("id,name,slug,metadata").eq("id", ids.organizationId).maybeSingle(),
    client.from("profiles").select("id,organization_id,role,is_active").eq("id", ids.actorId).maybeSingle(),
    client.from("therapists").select("id,organization_id,email,full_name,title,status,deleted_at").eq("id", ids.actorId).maybeSingle(),
    client.from("clients").select("id,organization_id,email,full_name,notes,status,deleted_at").eq("id", ids.clientId).maybeSingle(),
    client.from("programs").select("id,organization_id,client_id,name,description,status,created_by").eq("id", ids.programId).maybeSingle(),
    client.from("goals").select("id,organization_id,client_id,program_id,title,description,original_text,status,created_by").eq("id", ids.goalId).maybeSingle(),
    client.from("authorizations").select("id,authorization_number,diagnosis_description,organization_id,client_id,provider_id,status,start_date,end_date,created_by").eq("id", ids.authorizationId).maybeSingle(),
    client.from("authorization_services").select("id,service_description,unit_type,organization_id,authorization_id,service_code,decision_status,from_date,to_date,created_by").eq("id", ids.authorizationServiceId).maybeSingle(),
    client.from("user_roles").select("is_active,expires_at,roles(name)").eq("user_id", ids.actorId),
  ]);
  if (authError || !authData.user) throw new Error(`Exact marker-owned auth user is unavailable: ${authError?.message ?? "missing"}.`);
  if (authData.user.user_metadata?.fixture_marker !== marker || authData.user.app_metadata?.fixture_marker !== marker) {
    throw new Error("Auth user is not owned by the exact fixture marker.");
  }
  if (organization.error || !organization.data) throw new Error(`Exact marker-owned organization is unavailable: ${organization.error?.message ?? "missing"}.`);
  for (const [label, result] of [["profile", profile], ["therapist", therapist], ["client", fixtureClient], ["program", program], ["goal", goal], ["authorization", authorization], ["authorization service", service]] as const) {
    if (result.error || !result.data) throw new Error(`Exact marker-owned ${label} is unavailable: ${result.error?.message ?? "missing"}.`);
  }
  if (roles.error) throw new Error(`Exact marker-owned roles are unavailable: ${roles.error.message}.`);
  const roleMappings = (roles.data ?? []).flatMap((row) => {
    const nested = row.roles as unknown as { name?: unknown } | Array<{ name?: unknown }> | null;
    return (Array.isArray(nested) ? nested : nested ? [nested] : []).map(({ name }) => ({
      name: String(name ?? ""), isActive: row.is_active === true,
      expiresAt: typeof row.expires_at === "string" ? row.expires_at : null,
    }));
  });
  assertBtFixtureGraph({
    marker, actorId: ids.actorId, organization: organization.data, profile: profile.data!, therapist: therapist.data!,
    roleMappings, client: fixtureClient.data!, program: program.data!, goal: goal.data!, authorization: authorization.data!,
    service: service.data!, today: new Date().toISOString().slice(0, 10),
  });
  for (const [label, value] of [["Program creator", program.data!.created_by], ["Goal creator", goal.data!.created_by], ["Authorization creator", authorization.data!.created_by], ["Authorization service creator", service.data!.created_by]] as const) {
    if (value !== ids.actorId) throw new Error(`${label} does not match the exact fixture actor.`);
  }
  for (const [label, value] of [["Authorization number", authorization.data!.authorization_number], ["Authorization diagnosis", authorization.data!.diagnosis_description], ["Authorization service description", service.data!.service_description], ["Authorization service unit type", service.data!.unit_type]] as const) {
    requireMarker(value, marker, label);
  }

  let exactSessionId = sessionId;
  if (!exactSessionId) {
    const candidates = await client.from("sessions").select("id,notes,client_id,therapist_id").match({
      notes: marker, client_id: ids.clientId, therapist_id: ids.actorId,
    });
    if (candidates.error) throw new Error(`Unable to discover an exact marker-owned session: ${candidates.error.message}.`);
    if ((candidates.data ?? []).length > 1) throw new Error("Cleanup refuses multiple sessions for the exact fixture marker.");
    exactSessionId = candidates.data?.[0]?.id ?? null;
  }

  if (exactSessionId) {
    const session = await client.from("sessions").select("id,notes,client_id,therapist_id").eq("id", exactSessionId).maybeSingle();
    if (session.error || !session.data) throw new Error(`Exact marker-owned session is unavailable: ${session.error?.message ?? "missing"}.`);
    requireMarker(session.data.notes, marker, "Session notes");
    if (session.data.client_id !== ids.clientId || session.data.therapist_id !== ids.actorId) {
      throw new Error("Session does not belong to the exact fixture graph.");
    }
    for (const table of ["goal_target_transitions", "goal_target_phase_evaluations"]) {
      const audit = await client.from(table).select("id", { count: "exact", head: true }).eq("session_id", exactSessionId);
      if (audit.error || audit.count !== 0) throw new Error(`Cleanup refuses a session with ${table} audit rows.`);
    }
    for (const table of ["client_session_notes", "session_goals", "sessions"]) {
      await deleteExact(client, table, table === "sessions" ? "id" : "session_id", exactSessionId);
    }
  }

  await cleanupPartialBtFixture(client, ids);
  for (const [table, column, value] of [
    ["organizations", "id", ids.organizationId],
    ["clients", "id", ids.clientId],
    ["programs", "id", ids.programId],
    ["goals", "id", ids.goalId],
    ["authorizations", "id", ids.authorizationId],
    ["authorization_services", "id", ids.authorizationServiceId],
    ["profiles", "id", ids.actorId],
  ] as const) {
    const result = await client.from(table).select("id", { count: "exact", head: true }).eq(column, value);
    if (result.error || result.count !== 0) throw new Error(`Cleanup verification failed for ${table}.`);
  }
  const remainingAuth = await client.auth.admin.getUserById(ids.actorId);
  if (!remainingAuth.error || remainingAuth.data.user) throw new Error("Cleanup verification failed for auth.users.");
};

const run = async (): Promise<void> => {
  const supabaseUrl = requiredEnv("SUPABASE_URL").replace(/\/$/, "");
  const projectRef = requiredEnv("SUPABASE_BRANCH_PROJECT_REF").toLowerCase();
  const runtimeRef = new URL(supabaseUrl).hostname.match(/^([a-z0-9-]+)\.supabase\.co$/)?.[1] ?? "";
  const marker = requiredEnv("PW_BT_FIXTURE_MARKER").toLowerCase();
  assertBtFixtureMarker(marker);
  assertNonProductionProjectRef(projectRef, runtimeRef);
  assertBranchOwnershipContract(requiredEnv("PW_BT_BRANCH_OWNERSHIP"), requiredEnv("PW_BT_DISPOSABLE_BRANCH_TEARDOWN_ACK"));
  const ids: PartialFixtureIds = {
    actorId: requiredUuid("PW_BT_ACTOR_ID"),
    organizationId: requiredUuid("PW_BT_ORGANIZATION_ID"),
    clientId: requiredUuid("PW_BT_CLIENT_ID"),
    programId: requiredUuid("PW_BT_PROGRAM_ID"),
    goalId: requiredUuid("PW_BT_GOAL_ID"),
    authorizationId: requiredUuid("PW_BT_AUTHORIZATION_ID"),
    authorizationServiceId: requiredUuid("PW_BT_AUTHORIZATION_SERVICE_ID"),
  };
  const state = readCleanupState(requiredEnv("PW_BT_CLEANUP_STATE_PATH"), marker, projectRef);
  const client = createClient(supabaseUrl, requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { autoRefreshToken: false, persistSession: false } });
  await cleanupMarkerOwnedBtFixture(client, ids, marker, state?.sessionId ?? null);
  console.log(JSON.stringify({ ok: true, action: "fixture-cleaned", marker, projectRef, sessionId: state?.sessionId ?? "not-created" }));
};

const isDirectRun = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) run().catch((error) => { console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })); process.exit(1); });
