import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_ORGANIZATION_ID = "5238e88b-6198-4862-80a2-dbe15bbeabdd";
const DEFAULT_THERAPIST_ID = "5238e88b-6198-4862-80a2-100000000001";

const getEnv = (name: string, fallback?: string): string => {
  const value = process.env[name]?.trim() || fallback;
  if (!value) throw new Error(`${name} is required.`);
  return value;
};

export const buildDefaultSmokeBcbaEmail = (): string => {
  const runId = process.env.GITHUB_RUN_ID?.trim() || String(Date.now());
  const attempt = process.env.GITHUB_RUN_ATTEMPT?.trim() || "1";
  return `playwright.ci.bcba.${runId}.${attempt}@example.com`.toLowerCase();
};

export const assertDedicatedSmokeBcbaEmail = (email: string): void => {
  if (!/^playwright\.ci\.bcba\.[a-z0-9_.-]+@example\.com$/i.test(email)) {
    throw new Error("Refusing to mutate non-dedicated CI BCBA account email.");
  }
};

export const getMissingBcbaProvisionSecrets = (env: NodeJS.ProcessEnv = process.env): string[] =>
  ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter((name) => !env[name]?.trim());

export const shouldSkipSecretlessPullRequest = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.GITHUB_EVENT_NAME === "pull_request" && getMissingBcbaProvisionSecrets(env).length > 0;

const createAdmin = (): SupabaseClient => createClient(
  getEnv("SUPABASE_URL"),
  getEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const listUsers = async (client: SupabaseClient) => {
  const users = [];
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 200) return users;
  }
  throw new Error("Refusing incomplete Auth user scan after 100 pages.");
};

const findUser = async (client: SupabaseClient, email: string) =>
  (await listUsers(client)).find((user) => user.email?.toLowerCase() === email) ?? null;

const writeCredentials = (email: string, password: string): void => {
  process.stdout.write(`::add-mask::${password}\n`);
  const githubEnv = process.env.GITHUB_ENV?.trim();
  if (githubEnv) {
    appendFileSync(githubEnv, `PW_SCHEDULE_EMAIL=${email}\nPW_SCHEDULE_PASSWORD=${password}\n`);
  }
};

const cleanupMappings = async (client: SupabaseClient, userId: string): Promise<void> => {
  for (const table of ["user_therapist_links", "user_roles"] as const) {
    const { error } = await client.from(table).delete().eq("user_id", userId);
    if (error) throw error;
  }
  const { error: profileError } = await client.from("profiles").delete().eq("id", userId);
  if (profileError) throw profileError;
};

const sweepExpiredActors = async (client: SupabaseClient): Promise<void> => {
  const now = Date.now();
  for (const user of await listUsers(client)) {
    const email = user.email?.toLowerCase() ?? "";
    if (!/^playwright\.ci\.bcba\.[a-z0-9_.-]+@example\.com$/i.test(email)) continue;
    const expiresAt = Date.parse(String(user.app_metadata?.smoke_expires_at ?? ""));
    const createdAt = Date.parse(user.created_at);
    if ((Number.isFinite(expiresAt) && expiresAt > now) || (!Number.isFinite(expiresAt) && createdAt > now - 6 * 60 * 60 * 1000)) continue;
    await cleanupMappings(client, user.id);
    const { error } = await client.auth.admin.deleteUser(user.id);
    if (error) throw error;
    console.log(JSON.stringify({ ok: true, action: "swept_expired", email, userId: user.id }));
  }
};

const provision = async (): Promise<void> => {
  const email = (process.env.CI_SMOKE_BCBA_EMAIL?.trim() || buildDefaultSmokeBcbaEmail()).toLowerCase();
  assertDedicatedSmokeBcbaEmail(email);
  const organizationId = DEFAULT_ORGANIZATION_ID;
  const therapistId = DEFAULT_THERAPIST_ID;
  const client = createAdmin();
  await sweepExpiredActors(client);

  const { data: therapist, error: therapistError } = await client
    .from("therapists").select("id,organization_id,deleted_at").eq("id", therapistId).maybeSingle();
  if (therapistError) throw therapistError;
  if (!therapist || therapist.organization_id !== organizationId || therapist.deleted_at) {
    throw new Error("Synthetic BCBA therapist fixture is missing, deleted, or outside the expected organization.");
  }
  const { data: role, error: roleError } = await client.from("roles").select("id").eq("name", "bcba").maybeSingle();
  if (roleError) throw roleError;
  if (!role?.id) throw new Error("Role bcba is not provisioned.");

  const password = `C1-${randomBytes(18).toString("base64url")}!Aa`;
  const metadata = { role: "bcba", signup_role: "bcba", organization_id: organizationId, organizationId };
  const appMetadata = { smoke_actor: "bcba", smoke_expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString() };
  let user = await findUser(client, email);
  if (user) {
    const { error } = await client.auth.admin.updateUserById(user.id, { password, email_confirm: true, user_metadata: metadata, app_metadata: appMetadata });
    if (error) throw error;
    await cleanupMappings(client, user.id);
  } else {
    const { data, error } = await client.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: metadata, app_metadata: appMetadata });
    if (error) throw error;
    if (!data.user) throw new Error("Supabase did not return the created BCBA smoke user.");
    user = data.user;
  }

  const { error: profileError } = await client.from("profiles").upsert({
    id: user.id, email, role: "bcba", is_active: true, first_name: "Playwright", last_name: "BCBA",
    organization_id: organizationId,
  }, { onConflict: "id" });
  if (profileError) throw profileError;
  const { error: roleMapError } = await client.from("user_roles").insert({ user_id: user.id, role_id: role.id, is_active: true });
  if (roleMapError) throw roleMapError;
  const { error: linkError } = await client.from("user_therapist_links").insert({ user_id: user.id, therapist_id: therapistId });
  if (linkError) throw linkError;

  writeCredentials(email, password);
  console.log(JSON.stringify({ ok: true, action: "provisioned", email, userId: user.id, organizationId, therapistId }));
};

const cleanup = async (): Promise<void> => {
  const email = (process.env.CI_SMOKE_BCBA_EMAIL?.trim() || process.env.PW_SCHEDULE_EMAIL?.trim() || buildDefaultSmokeBcbaEmail()).toLowerCase();
  assertDedicatedSmokeBcbaEmail(email);
  const client = createAdmin();
  const user = await findUser(client, email);
  if (!user) {
    console.log(JSON.stringify({ ok: true, action: "cleanup_skipped", email, reason: "not_found" }));
    return;
  }
  await cleanupMappings(client, user.id);
  const { error } = await client.auth.admin.deleteUser(user.id);
  if (error) throw error;
  const remaining = await findUser(client, email);
  if (remaining) throw new Error("BCBA smoke Auth user remains after cleanup.");
  const residualCounts: Record<string, number> = {};
  for (const [table, column] of [["profiles", "id"], ["user_roles", "user_id"], ["user_therapist_links", "user_id"]] as const) {
    const { count, error: countError } = await client.from(table).select("*", { count: "exact", head: true }).eq(column, user.id);
    if (countError) throw countError;
    residualCounts[table] = count ?? -1;
  }
  if (Object.values(residualCounts).some((count) => count !== 0)) {
    throw new Error(`BCBA smoke mappings remain after cleanup: ${JSON.stringify(residualCounts)}`);
  }
  console.log(JSON.stringify({ ok: true, action: "deleted", email, userId: user.id, residualIdentityRows: residualCounts }));
};

const sweepOnly = async (): Promise<void> => {
  const client = createAdmin();
  await sweepExpiredActors(client);
  console.log(JSON.stringify({ ok: true, action: "sweep_complete" }));
};

const main = async (): Promise<void> => {
  const missing = getMissingBcbaProvisionSecrets();
  if (missing.length) {
    if (shouldSkipSecretlessPullRequest()) {
      console.log(JSON.stringify({ ok: true, action: "skipped", reason: "missing_pull_request_secrets", missing }));
      return;
    }
    throw new Error(`Missing required Supabase admin secrets: ${missing.join(", ")}.`);
  }
  if (process.argv.includes("--sweep-only")) {
    await sweepOnly();
  } else {
    await (process.argv.includes("--cleanup") ? cleanup() : provision());
  }
};

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.env.VITEST !== "true";
if (isDirectRun) main().catch((error) => { console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })); process.exit(1); });
