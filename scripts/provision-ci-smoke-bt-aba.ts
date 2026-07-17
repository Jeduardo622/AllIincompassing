/**
 * Provisions a fully isolated, marker-owned BT graph on a disposable Supabase branch.
 * The provisioner refuses production and exports credentials only through GITHUB_ENV.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const PRODUCTION_PROJECT_REF = "wnnjeqheqxxyrgsjmygy";
export const BT_SERVICE_CODE = "97153";
export const DISPOSABLE_ACK = "I_ACKNOWLEDGE_DISPOSABLE_SUPABASE";
export const BRANCH_TEARDOWN_ACK = "delete-branch-after-run";

type FixtureRow = Record<string, unknown>;

export type BtFixtureGraph = {
  marker: string;
  actorId: string;
  organization: FixtureRow;
  profile: FixtureRow;
  therapist: FixtureRow;
  roleMappings: Array<{ name: string; isActive: boolean }>;
  client: FixtureRow;
  program: FixtureRow;
  goal: FixtureRow;
  authorization: FixtureRow;
  service: FixtureRow;
  today: string;
};

type BtGithubEnvInput = {
  supabaseUrl: string;
  publishableKey: string;
  projectRef: string;
  marker: string;
  email: string;
  password: string;
  clientId: string;
  programId: string;
  goalId: string;
  authorizationId: string;
};

const requiredEnv = (name: string, fallback?: string): string => {
  const value = process.env[name]?.trim() || fallback?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
};

export const assertBtFixtureMarker = (marker: string): void => {
  if (marker.length < 12 || !/^[a-z0-9-]+$/i.test(marker)) {
    throw new Error("PW_BT_FIXTURE_MARKER must be at least 12 characters and contain only letters, digits, or hyphens.");
  }
};

export const assertNonProductionProjectRef = (expectedRef: string, runtimeRef: string): void => {
  const expected = expectedRef.trim().toLowerCase();
  const runtime = runtimeRef.trim().toLowerCase();
  if (expected === PRODUCTION_PROJECT_REF || runtime === PRODUCTION_PROJECT_REF) {
    throw new Error(`Refusing production Supabase project ${PRODUCTION_PROJECT_REF}.`);
  }
  if (!expected || !runtime || expected !== runtime) {
    throw new Error(`Disposable Supabase project-ref mismatch: expected ${expected || "missing"}, runtime ${runtime || "missing"}.`);
  }
};

const projectRefFromUrl = (supabaseUrl: string): string => {
  let hostname: string;
  try {
    hostname = new URL(supabaseUrl).hostname.toLowerCase();
  } catch {
    throw new Error("SUPABASE_URL must be a valid hosted Supabase URL.");
  }
  return hostname.match(/^([a-z0-9-]+)\.supabase\.co$/)?.[1] ?? "";
};

export const buildBtSmokeEmail = (marker: string): string => {
  assertBtFixtureMarker(marker);
  return `playwright.ci.bt.${marker}@example.com`.toLowerCase();
};

export const buildBtAuthMetadata = (marker: string, organizationId?: string): Record<string, string> => ({
  fixture_marker: marker,
  ...(organizationId ? { organization_id: organizationId, organizationId } : {}),
});

export const buildBtSmokeGithubEnv = (input: BtGithubEnvInput): Record<string, string> => ({
  VITE_SUPABASE_URL: input.supabaseUrl,
  VITE_SUPABASE_ANON_KEY: input.publishableKey,
  PW_BT_EMAIL: input.email,
  PW_BT_PASSWORD: input.password,
  PW_BT_CLIENT_ID: input.clientId,
  PW_BT_PROGRAM_ID: input.programId,
  PW_BT_GOAL_ID: input.goalId,
  PW_BT_AUTHORIZATION_ID: input.authorizationId,
  PW_BT_SERVICE_CODE: BT_SERVICE_CODE,
  PW_BT_FIXTURE_MARKER: input.marker,
  PW_BT_DISPOSABLE_PROJECT_REF: input.projectRef,
  PW_BT_DISPOSABLE_ACK: DISPOSABLE_ACK,
  PW_BT_DISPOSABLE_BRANCH_TEARDOWN_ACK: BRANCH_TEARDOWN_ACK,
});

const requireMarker = (value: unknown, marker: string, label: string): void => {
  if (typeof value !== "string" || !value.toLowerCase().includes(marker.toLowerCase())) {
    throw new Error(`${label} must contain the exact fixture marker.`);
  }
};

const requireEqual = (actual: unknown, expected: unknown, label: string): void => {
  if (actual !== expected) throw new Error(`${label} did not persist the exact fixture chain.`);
};

export const assertBtFixtureGraph = (graph: BtFixtureGraph): void => {
  assertBtFixtureMarker(graph.marker);
  const organizationId = graph.organization.id;
  requireEqual(graph.profile.id, graph.actorId, "Profile identity");
  requireEqual(graph.therapist.id, graph.actorId, "Therapist identity");
  for (const [label, row] of [
    ["profile", graph.profile],
    ["therapist", graph.therapist],
    ["client", graph.client],
    ["program", graph.program],
    ["goal", graph.goal],
    ["authorization", graph.authorization],
    ["authorization service", graph.service],
  ] as const) {
    requireEqual(row.organization_id, organizationId, `${label} organization`);
  }
  requireEqual(graph.profile.role, "bt", "Profile role");
  requireEqual(graph.profile.is_active, true, "Profile active state");
  requireEqual(graph.therapist.status, "active", "Therapist state");
  requireEqual(graph.therapist.deleted_at, null, "Therapist deletion state");
  if (!/^(BT|RBT)$/i.test(String(graph.therapist.title ?? ""))) {
    throw new Error("Therapist title must be BT or RBT.");
  }
  if (
    graph.roleMappings.length !== 1
    || graph.roleMappings[0]?.name.toLowerCase() !== "bt"
    || graph.roleMappings[0]?.isActive !== true
  ) {
    throw new Error("Authoritative user_roles mapping must contain exactly one active bt role.");
  }
  requireEqual(graph.client.status, "active", "Client state");
  requireEqual(graph.client.deleted_at, null, "Client deletion state");
  requireEqual(graph.program.client_id, graph.client.id, "Program client");
  requireEqual(graph.program.status, "active", "Program state");
  requireEqual(graph.goal.client_id, graph.client.id, "Goal client");
  requireEqual(graph.goal.program_id, graph.program.id, "Goal program");
  requireEqual(graph.goal.status, "active", "Goal state");
  requireEqual(graph.authorization.client_id, graph.client.id, "Authorization client");
  requireEqual(graph.authorization.provider_id, graph.actorId, "Authorization provider");
  requireEqual(graph.authorization.status, "approved", "Authorization state");
  requireEqual(graph.service.authorization_id, graph.authorization.id, "Authorization service parent");
  requireEqual(graph.service.service_code, BT_SERVICE_CODE, "Authorization service code");
  requireEqual(graph.service.decision_status, "approved", "Authorization service state");
  for (const [label, start, end] of [
    ["Authorization", graph.authorization.start_date, graph.authorization.end_date],
    ["Authorization service", graph.service.from_date, graph.service.to_date],
  ] as const) {
    if (typeof start !== "string" || typeof end !== "string" || start > graph.today || end < graph.today) {
      throw new Error(`${label} must be current.`);
    }
  }
  for (const [label, value] of [
    ["Organization name", graph.organization.name],
    ["Organization slug", graph.organization.slug],
    ["Therapist email", graph.therapist.email],
    ["Therapist full_name", graph.therapist.full_name],
    ["Client email", graph.client.email],
    ["Client full_name", graph.client.full_name],
    ["Client notes", graph.client.notes],
    ["Program name", graph.program.name],
    ["Program description", graph.program.description],
    ["Goal title", graph.goal.title],
    ["Goal description", graph.goal.description],
    ["Goal original_text", graph.goal.original_text],
  ] as const) requireMarker(value, graph.marker, label);
};

const one = async (query: PromiseLike<{ data: unknown; error: { message: string } | null }>, label: string): Promise<FixtureRow> => {
  const { data, error } = await query;
  if (error || !data || Array.isArray(data)) throw new Error(`Unable to read back ${label}: ${error?.message ?? "missing row"}.`);
  return data as FixtureRow;
};

const insertOne = async (
  client: SupabaseClient,
  table: string,
  value: FixtureRow,
  columns: string,
): Promise<FixtureRow> => one(client.from(table).insert(value).select(columns).single(), table);

const writeGithubEnv = (path: string, values: Record<string, string>): void => {
  for (const [key, value] of Object.entries(values)) {
    if (/\r|\n/.test(key) || /\r|\n/.test(value)) throw new Error(`Refusing unsafe multiline GITHUB_ENV value for ${key}.`);
  }
  appendFileSync(path, `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n")}\n`);
};

const provision = async (): Promise<void> => {
  const supabaseUrl = requiredEnv("SUPABASE_URL").replace(/\/$/, "");
  const publishableKey = requiredEnv("SUPABASE_PUBLISHABLE_KEY", process.env.SUPABASE_ANON_KEY);
  const secretKey = requiredEnv("SUPABASE_SECRET_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);
  const projectRef = requiredEnv("SUPABASE_BRANCH_PROJECT_REF").toLowerCase();
  const marker = requiredEnv("PW_BT_FIXTURE_MARKER").toLowerCase();
  const githubEnv = requiredEnv("GITHUB_ENV");
  assertBtFixtureMarker(marker);
  assertNonProductionProjectRef(projectRef, projectRefFromUrl(supabaseUrl));

  const organizationId = randomUUID();
  const clientId = randomUUID();
  const programId = randomUUID();
  const goalId = randomUUID();
  const authorizationId = randomUUID();
  const authorizationServiceId = randomUUID();
  const email = buildBtSmokeEmail(marker);
  const password = `C1-${randomBytes(24).toString("base64url")}!Aa`;
  const client = createClient(supabaseUrl, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: authData, error: authError } = await client.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { ...buildBtAuthMetadata(marker), first_name: `BT-${marker}`, last_name: `Actor-${marker}` },
    app_metadata: { fixture_marker: marker, disposable_project_ref: projectRef },
  });
  if (authError || !authData.user) throw new Error(`Unable to create marker-owned BT auth user: ${authError?.message ?? "missing user"}.`);
  const actorId = authData.user.id;

  const organization = await insertOne(client, "organizations", {
    id: organizationId, name: `BT proof ${marker}`, slug: `bt-proof-${marker}`, metadata: { fixture_marker: marker }, created_by: actorId,
  }, "id,name,slug");

  const { error: metadataError } = await client.auth.admin.updateUserById(actorId, {
    user_metadata: {
      ...buildBtAuthMetadata(marker, organizationId),
      first_name: `BT-${marker}`,
      last_name: `Actor-${marker}`,
    },
  });
  if (metadataError) throw new Error(`Unable to attach marker-owned organization metadata: ${metadataError.message}.`);

  const { error: profileError } = await client.from("profiles").upsert({
    id: actorId, email, role: "bt", first_name: `BT-${marker}`, last_name: `Actor-${marker}`, is_active: true, organization_id: organizationId,
  }, { onConflict: "id" });
  if (profileError) throw new Error(`Unable to provision marker-owned BT profile: ${profileError.message}.`);

  await insertOne(client, "therapists", {
    id: actorId, organization_id: organizationId, email, full_name: `BT ${marker}`, first_name: `BT-${marker}`,
    last_name: `Actor-${marker}`, title: "BT", status: "active", specialties: [marker], service_type: ["aba"],
  }, "id,organization_id,email,full_name,title,status,deleted_at");

  const { data: role, error: roleError } = await client.from("roles").select("id,name").eq("name", "bt").maybeSingle();
  if (roleError || !role?.id) throw new Error(`Unable to resolve authoritative bt role: ${roleError?.message ?? "missing role"}.`);
  const { error: staleRolesError } = await client.from("user_roles").delete().eq("user_id", actorId);
  if (staleRolesError) throw new Error(`Unable to clear non-authoritative role mappings: ${staleRolesError.message}.`);
  const { error: userRoleError } = await client.from("user_roles").insert({ user_id: actorId, role_id: role.id, is_active: true });
  if (userRoleError) throw new Error(`Unable to assign authoritative bt role: ${userRoleError.message}.`);

  const fixtureClient = await insertOne(client, "clients", {
    id: clientId, organization_id: organizationId, email: `client.${marker}@example.com`, full_name: `Client ${marker}`,
    first_name: `Client-${marker}`, last_name: `Fixture-${marker}`, date_of_birth: "2015-01-01", status: "active", notes: `Synthetic ${marker}`,
  }, "id,organization_id,email,full_name,notes,status,deleted_at");
  const program = await insertOne(client, "programs", {
    id: programId, organization_id: organizationId, client_id: clientId, name: `Program ${marker}`,
    description: `Synthetic program ${marker}`, status: "active", created_by: actorId,
  }, "id,organization_id,client_id,name,description,status");
  const goal = await insertOne(client, "goals", {
    id: goalId, organization_id: organizationId, client_id: clientId, program_id: programId, title: `Goal ${marker}`,
    description: `Synthetic goal ${marker}`, original_text: `Synthetic original goal ${marker}`, status: "active", created_by: actorId,
  }, "id,organization_id,client_id,program_id,title,description,original_text,status");
  const startDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const authorization = await insertOne(client, "authorizations", {
    id: authorizationId, authorization_number: `AUTH-${marker}`, client_id: clientId, provider_id: actorId,
    diagnosis_code: "F84.0", diagnosis_description: `Synthetic diagnosis ${marker}`, start_date: startDate, end_date: endDate,
    status: "approved", organization_id: organizationId, created_by: actorId,
  }, "id,organization_id,client_id,provider_id,status,start_date,end_date");
  const service = await insertOne(client, "authorization_services", {
    id: authorizationServiceId, authorization_id: authorizationId, service_code: BT_SERVICE_CODE,
    service_description: `Adaptive behavior treatment ${marker}`, from_date: startDate, to_date: endDate,
    requested_units: 160, approved_units: 160, unit_type: `15-minute units ${marker}`, decision_status: "approved",
    organization_id: organizationId, created_by: actorId,
  }, "authorization_id,organization_id,service_code,decision_status,from_date,to_date");

  const [profile, therapist, roles] = await Promise.all([
    one(client.from("profiles").select("id,organization_id,role,is_active").eq("id", actorId).maybeSingle(), "profile"),
    one(client.from("therapists").select("id,organization_id,email,full_name,title,status,deleted_at").eq("id", actorId).maybeSingle(), "therapist"),
    client.from("user_roles").select("is_active,roles(name)").eq("user_id", actorId),
  ]);
  if (roles.error) throw new Error(`Unable to read back authoritative roles: ${roles.error.message}.`);
  const roleMappings = (roles.data ?? []).flatMap((row) => {
    const nested = row.roles as unknown as { name?: unknown } | Array<{ name?: unknown }> | null;
    return (Array.isArray(nested) ? nested : nested ? [nested] : []).map(({ name }) => ({
      name: String(name ?? ""),
      isActive: row.is_active === true,
    }));
  });
  assertBtFixtureGraph({
    marker, actorId, organization, profile, therapist, roleMappings, client: fixtureClient, program, goal, authorization, service,
    today: new Date().toISOString().slice(0, 10),
  });

  writeGithubEnv(githubEnv, buildBtSmokeGithubEnv({
    supabaseUrl, publishableKey, projectRef, marker, email, password, clientId, programId, goalId, authorizationId,
  }));
  console.log(JSON.stringify({ ok: true, action: "provisioned", marker, projectRef, actorId, organizationId, clientId, programId, goalId, authorizationId }));
};

const isDirectRun = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(process.argv[1]).href
  && process.env.VITEST !== "true";
if (isDirectRun) {
  provision().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    process.exit(1);
  });
}
