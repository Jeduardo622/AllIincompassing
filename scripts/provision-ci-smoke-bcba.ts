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

export const getMissingBcbaProvisionSecrets = (
  env: NodeJS.ProcessEnv = process.env,
  requirePublishableKey = false,
): string[] => [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  ...(requirePublishableKey ? ["SUPABASE_PUBLISHABLE_KEY"] : []),
].filter((name) => !env[name]?.trim());

export const shouldSkipSecretlessPullRequest = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.GITHUB_EVENT_NAME === "pull_request" && getMissingBcbaProvisionSecrets(env).length > 0;

const createAdmin = (): SupabaseClient => createClient(
  getEnv("SUPABASE_URL"),
  getEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const createAuthenticatedProbeClient = (): SupabaseClient => createClient(
  getEnv("SUPABASE_URL"),
  getEnv("SUPABASE_PUBLISHABLE_KEY"),
  { auth: { autoRefreshToken: false, persistSession: false } },
);

export interface SmokeBcbaProfileInvariant {
  id?: string | null;
  role?: string | null;
  is_active?: boolean | null;
  organization_id?: string | null;
}

export interface SmokeBcbaAuthorizationInvariant {
  client_id?: string | null;
  provider_id?: string | null;
  organization_id?: string | null;
  status?: string | null;
}

export interface SmokeBcbaSessionInvariant {
  client_id?: string | null;
  therapist_id?: string | null;
  organization_id?: string | null;
}

export interface SmokeBcbaAppMetadata {
  smoke_actor: "bcba";
  smoke_email: string;
  smoke_run_id: string;
  smoke_run_attempt: string;
  smoke_job: string;
  smoke_expires_at: string;
}

export interface SmokeBcbaRoleInvariant {
  role_id?: string | null;
  is_active?: boolean | null;
  expires_at?: string | null;
}

export const buildSmokeBcbaAppMetadata = (
  email: string,
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): SmokeBcbaAppMetadata => ({
  smoke_actor: "bcba",
  smoke_email: email,
  smoke_run_id: env.GITHUB_RUN_ID?.trim() || "local",
  smoke_run_attempt: env.GITHUB_RUN_ATTEMPT?.trim() || "1",
  smoke_job: env.GITHUB_JOB?.trim() || "local",
  smoke_expires_at: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(),
});

export const assertSmokeBcbaOwnership = (
  user: { email?: string | null; app_metadata?: Record<string, unknown> | null },
  expectedEmail: string,
  expectedMetadata: SmokeBcbaAppMetadata,
  now: Date = new Date(),
): void => {
  const metadata = user.app_metadata;
  if (
    user.email?.toLowerCase() !== expectedEmail.toLowerCase()
    || metadata?.smoke_actor !== expectedMetadata.smoke_actor
    || metadata?.smoke_email !== expectedMetadata.smoke_email
    || metadata?.smoke_run_id !== expectedMetadata.smoke_run_id
    || metadata?.smoke_run_attempt !== expectedMetadata.smoke_run_attempt
    || metadata?.smoke_job !== expectedMetadata.smoke_job
    || Date.parse(String(metadata?.smoke_expires_at)) <= now.getTime()
  ) {
    throw new Error("Synthetic BCBA ownership metadata is missing, mismatched, or expired.");
  }
};

export const serializeSmokeBcbaError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const candidate = error as { code?: unknown; message?: unknown };
    const code = typeof candidate.code === "string" ? candidate.code.trim() : "";
    const message = typeof candidate.message === "string" ? candidate.message.trim() : "";
    if (code && message) return `${code}: ${message}`;
    if (message) return message;
    if (code) return code;
    return "Unknown structured Supabase error";
  }
  return String(error);
};

export const assertSmokeBcbaCleanupOwnership = (
  user: { email?: string | null; app_metadata?: Record<string, unknown> | null },
  expectedEmail: string,
): void => {
  const metadata = user.app_metadata;
  const markerEmail = String(metadata?.smoke_email ?? "").toLowerCase();
  if (
    user.email?.toLowerCase() !== expectedEmail.toLowerCase()
    || metadata?.smoke_actor !== "bcba"
    || (markerEmail && markerEmail !== expectedEmail.toLowerCase())
  ) {
    throw new Error("Synthetic BCBA cleanup ownership metadata is missing or mismatched.");
  }
};

export const buildSmokeBcbaProfileSeed = (userId: string, email: string) => ({
  id: userId,
  email,
  first_name: "Playwright",
  last_name: "BCBA",
});

export const buildSmokeBcbaRoleAssignment = (
  userId: string,
  roleId: string,
  expiresAt: string,
) => ({
  user_id: userId,
  role_id: roleId,
  is_active: true,
  expires_at: expiresAt,
});

export const assertSmokeBcbaRoleInvariant = (
  rows: SmokeBcbaRoleInvariant[],
  expected: { roleId: string; expiresAt: string },
  now: Date = new Date(),
): void => {
  const row = rows[0];
  if (
    rows.length !== 1
    || row?.role_id !== expected.roleId
    || row.is_active !== true
    || Date.parse(String(row.expires_at)) !== Date.parse(expected.expiresAt)
    || Date.parse(String(row.expires_at)) <= now.getTime()
  ) {
    throw new Error("Synthetic BCBA active role singleton is missing, mismatched, or expired.");
  }
};

export const resolveSmokeBcbaClientId = (
  sessions: SmokeBcbaSessionInvariant[],
  authorizations: SmokeBcbaAuthorizationInvariant[],
  expected: { therapistId: string; organizationId: string },
): string => {
  const sessionClientIds = new Set<string>();
  for (const session of sessions) {
    if (
      !session.client_id
      || session.therapist_id !== expected.therapistId
      || session.organization_id !== expected.organizationId
    ) {
      throw new Error("Synthetic BCBA therapist fixture must resolve exactly one active tenant-bound client through sessions and authorizations.");
    }
    sessionClientIds.add(session.client_id);
  }

  const authorizationClientIds = new Set<string>();
  for (const authorization of authorizations) {
    if (
      !authorization.client_id
      || authorization.provider_id !== expected.therapistId
      || authorization.organization_id !== expected.organizationId
      || authorization.status !== "approved"
    ) {
      throw new Error("Synthetic BCBA therapist fixture must resolve exactly one active tenant-bound client through sessions and authorizations.");
    }
    authorizationClientIds.add(authorization.client_id);
  }

  const commonClientIds = [...sessionClientIds]
    .filter((clientId) => authorizationClientIds.has(clientId))
    .sort();
  if (commonClientIds.length !== 1) {
    throw new Error("Synthetic BCBA therapist fixture must resolve exactly one active tenant-bound client through sessions and authorizations.");
  }
  return commonClientIds[0];
};

export const assertSmokeBcbaAuthorizationInvariant = (
  authorization: SmokeBcbaAuthorizationInvariant | null,
  expected: { clientId: string; therapistId: string; organizationId: string },
): void => {
  if (
    !authorization
    || authorization.client_id !== expected.clientId
    || authorization.provider_id !== expected.therapistId
    || authorization.organization_id !== expected.organizationId
    || authorization.status !== "approved"
  ) {
    throw new Error("Synthetic BCBA authorization did not persist the required client, provider, organization, and approved state.");
  }
};

export const assertSmokeBcbaProfileInvariant = (
  profile: SmokeBcbaProfileInvariant | null,
  expected: { userId: string; organizationId: string },
): void => {
  if (
    !profile
    || profile.id !== expected.userId
    || profile.role !== "bcba"
    || profile.is_active !== true
    || profile.organization_id !== expected.organizationId
  ) {
    throw new Error("Synthetic BCBA profile did not persist the required identity, role, active state, and organization context.");
  }
};

export const verifySmokeBcbaAuthenticatedReadiness = async (
  client: SupabaseClient,
  credentials: { email: string; password: string; userId: string; organizationId: string },
): Promise<void> => {
  const { data: signInData, error: signInError } = await client.auth.signInWithPassword({
    email: credentials.email,
    password: credentials.password,
  });
  if (signInError) throw new Error("Synthetic BCBA authenticated readiness login failed.");

  let readinessError: unknown = null;
  try {
    if (signInData.user?.id !== credentials.userId) {
      throw new Error("Synthetic BCBA authenticated readiness resolved an unexpected identity.");
    }
    const { data: profile, error: profileError } = await client
      .from("profiles")
      .select("id,role,is_active,organization_id")
      .eq("id", credentials.userId)
      .maybeSingle();
    if (profileError) {
      throw new Error("Synthetic BCBA authenticated readiness could not read its profile.");
    }
    try {
      assertSmokeBcbaProfileInvariant(profile, {
        userId: credentials.userId,
        organizationId: credentials.organizationId,
      });
    } catch {
      throw new Error("Synthetic BCBA authenticated readiness did not resolve the expected organization.");
    }

    const now = Date.now();
    const { error: sessionsError } = await client.rpc("get_sessions_optimized", {
      p_start_date: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
      p_end_date: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
      p_therapist_id: null,
      p_client_id: null,
    });
    if (sessionsError) {
      throw new Error("Synthetic BCBA authenticated readiness could not load org-scoped sessions.");
    }
  } catch (error) {
    readinessError = error;
  }

  const { error: signOutError } = await client.auth.signOut();
  if (readinessError && signOutError) {
    const message = readinessError instanceof Error
      ? readinessError.message
      : "Synthetic BCBA authenticated readiness failed.";
    throw new Error(`${message} Authenticated readiness logout also failed.`);
  }
  if (readinessError) throw readinessError;
  if (signOutError) {
    throw new Error("Synthetic BCBA authenticated readiness logout failed.");
  }
};

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
  const { data: authorizationRows, error: authorizationLookupError } = await client
    .from("authorizations")
    .select("id")
    .eq("created_by", userId);
  if (authorizationLookupError) throw authorizationLookupError;

  const { error: noteCleanupError } = await client
    .from("client_session_notes")
    .delete()
    .eq("created_by", userId);
  if (noteCleanupError) throw noteCleanupError;

  const authorizationIds = (authorizationRows ?? []).map(({ id }) => id);
  if (authorizationIds.length > 0) {
    const { error: serviceCleanupError } = await client
      .from("authorization_services")
      .delete()
      .in("authorization_id", authorizationIds);
    if (serviceCleanupError) throw serviceCleanupError;

    const { error: authorizationCleanupError } = await client
      .from("authorizations")
      .delete()
      .in("id", authorizationIds);
    if (authorizationCleanupError) throw authorizationCleanupError;
  }

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
    if (user.app_metadata?.smoke_actor !== "bcba") continue;
    const markerEmail = String(user.app_metadata?.smoke_email ?? "").toLowerCase();
    if (markerEmail && markerEmail !== email) continue;
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
  const { data: sessionRows, error: sessionError } = await client
    .from("sessions")
    .select("client_id,therapist_id,organization_id")
    .eq("therapist_id", therapistId)
    .eq("organization_id", organizationId)
    .order("client_id", { ascending: true });
  if (sessionError) throw sessionError;

  const { data: authorizationRows, error: authorizationLookupError } = await client
    .from("authorizations")
    .select("client_id,provider_id,organization_id,status")
    .eq("provider_id", therapistId)
    .eq("organization_id", organizationId)
    .eq("status", "approved")
    .order("client_id", { ascending: true });
  if (authorizationLookupError) throw authorizationLookupError;

  const clientId = resolveSmokeBcbaClientId(
    sessionRows ?? [],
    authorizationRows ?? [],
    { therapistId, organizationId },
  );

  const { data: clientRow, error: clientError } = await client
    .from("clients").select("id,organization_id,deleted_at").eq("id", clientId).maybeSingle();
  if (clientError) throw clientError;
  if (!clientRow || clientRow.organization_id !== organizationId || clientRow.deleted_at) {
    throw new Error("Synthetic BCBA client fixture is missing, deleted, or outside the expected organization.");
  }
  const { data: role, error: roleError } = await client.from("roles").select("id").eq("name", "bcba").maybeSingle();
  if (roleError) throw roleError;
  if (!role?.id) throw new Error("Role bcba is not provisioned.");

  const password = `C1-${randomBytes(18).toString("base64url")}!Aa`;
  const metadata = { role: "bcba", signup_role: "bcba", organization_id: organizationId, organizationId };
  const appMetadata = buildSmokeBcbaAppMetadata(email);
  let user = await findUser(client, email);
  if (user) assertSmokeBcbaCleanupOwnership(user, email);

  try {
    if (user) {
      await cleanupMappings(client, user.id);
      const { error: existingAuthCleanupError } = await client.auth.admin.deleteUser(user.id);
      if (existingAuthCleanupError) throw existingAuthCleanupError;
      user = null;
    }

    const { data, error } = await client.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: metadata, app_metadata: appMetadata });
    if (error) throw error;
    if (!data.user) throw new Error("Supabase did not return the created BCBA smoke user.");
    user = data.user;
    const userId = user.id;

    const { data: ownershipReadback, error: ownershipReadbackError } = await client.auth.admin.getUserById(userId);
    if (ownershipReadbackError || !ownershipReadback.user) {
      throw new Error(
        `Synthetic BCBA ownership readback failed: ${ownershipReadbackError ? serializeSmokeBcbaError(ownershipReadbackError) : "missing user"}`,
      );
    }
    assertSmokeBcbaOwnership(ownershipReadback.user, email, appMetadata);

    const { error: profileError } = await client.from("profiles").upsert(
      buildSmokeBcbaProfileSeed(userId, email),
      { onConflict: "id" },
    );
    if (profileError) throw profileError;

    const { error: staleRoleError } = await client.from("user_roles").delete().eq("user_id", userId);
    if (staleRoleError) {
      throw new Error(`Synthetic BCBA stale role cleanup failed: ${serializeSmokeBcbaError(staleRoleError)}`);
    }
    const { error: roleMapError } = await client.from("user_roles").insert(
      buildSmokeBcbaRoleAssignment(userId, role.id, appMetadata.smoke_expires_at),
    );
    if (roleMapError) throw roleMapError;

    const { data: activeRoleRows, error: activeRoleError } = await client
      .from("user_roles")
      .select("role_id,is_active,expires_at")
      .eq("user_id", userId)
      .eq("is_active", true);
    if (activeRoleError) throw activeRoleError;
    assertSmokeBcbaRoleInvariant(activeRoleRows ?? [], {
      roleId: role.id,
      expiresAt: appMetadata.smoke_expires_at,
    });

    const { error: linkError } = await client.from("user_therapist_links").insert({
      user_id: userId,
      therapist_id: therapistId,
    });
    if (linkError) throw linkError;

    const { data: provisionedOrganizationId, error: provisionProfileError } = await client
      .rpc("provision_ci_smoke_bcba_profile", { p_user_id: userId });
    if (provisionProfileError || provisionedOrganizationId !== organizationId) {
      throw new Error(
        `Synthetic BCBA authoritative profile provisioning failed: ${provisionProfileError ? serializeSmokeBcbaError(provisionProfileError) : `organization mismatch (${String(provisionedOrganizationId)})`}`,
      );
    }

    const startDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const endDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data: authorization, error: authorizationError } = await client
      .from("authorizations")
      .insert({
        authorization_number: `CI-BCBA-${userId}`,
        client_id: clientId,
        provider_id: therapistId,
        diagnosis_code: "F84.0",
        diagnosis_description: "Synthetic CI lifecycle fixture",
        start_date: startDate,
        end_date: endDate,
        status: "approved",
        organization_id: organizationId,
        created_by: userId,
      })
      .select("id,client_id,provider_id,organization_id,status")
      .single();
    if (authorizationError || !authorization) {
      throw authorizationError ?? new Error("Synthetic BCBA authorization provisioning failed.");
    }
    assertSmokeBcbaAuthorizationInvariant(authorization, { clientId, therapistId, organizationId });

    const { error: authorizationServiceError } = await client
      .from("authorization_services")
      .insert({
        authorization_id: authorization.id,
        service_code: "97153",
        service_description: "Adaptive behavior treatment by protocol",
        from_date: startDate,
        to_date: endDate,
        requested_units: 160,
        approved_units: 160,
        unit_type: "15-minute units",
        decision_status: "approved",
        organization_id: organizationId,
        created_by: userId,
      });
    if (authorizationServiceError) throw authorizationServiceError;

    const { data: persistedProfile, error: persistedProfileError } = await client
      .from("profiles")
      .select("id,role,is_active,organization_id")
      .eq("id", userId)
      .maybeSingle();
    if (persistedProfileError) throw persistedProfileError;
    assertSmokeBcbaProfileInvariant(persistedProfile, { userId, organizationId });
    await verifySmokeBcbaAuthenticatedReadiness(createAuthenticatedProbeClient(), {
      email,
      password,
      userId,
      organizationId,
    });

    writeCredentials(email, password);
    console.log(JSON.stringify({ ok: true, action: "provisioned", email, userId, organizationId, therapistId, clientId, authorizationId: authorization.id }));
  } catch (provisionError) {
    if (user) {
      try {
        await cleanupMappings(client, user.id);
        const { error: authCleanupError } = await client.auth.admin.deleteUser(user.id);
        if (authCleanupError) throw authCleanupError;
      } catch (cleanupError) {
        throw new Error(
          `${serializeSmokeBcbaError(provisionError)} Synthetic BCBA rollback also failed: ${serializeSmokeBcbaError(cleanupError)}`,
        );
      }
    }
    throw provisionError;
  }
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
  assertSmokeBcbaCleanupOwnership(user, email);
  await cleanupMappings(client, user.id);
  const { error } = await client.auth.admin.deleteUser(user.id);
  if (error) throw error;
  const remaining = await findUser(client, email);
  if (remaining) throw new Error("BCBA smoke Auth user remains after cleanup.");
  const residualCounts: Record<string, number> = {};
  for (const [table, column] of [
    ["profiles", "id"],
    ["user_roles", "user_id"],
    ["user_therapist_links", "user_id"],
    ["client_session_notes", "created_by"],
    ["authorization_services", "created_by"],
    ["authorizations", "created_by"],
  ] as const) {
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
  const cleanupRequested = process.argv.includes("--cleanup");
  const sweepRequested = process.argv.includes("--sweep-only");
  const missing = getMissingBcbaProvisionSecrets(process.env, !cleanupRequested && !sweepRequested);
  if (missing.length) {
    if (shouldSkipSecretlessPullRequest()) {
      console.log(JSON.stringify({ ok: true, action: "skipped", reason: "missing_pull_request_secrets", missing }));
      return;
    }
    throw new Error(`Missing required Supabase admin secrets: ${missing.join(", ")}.`);
  }
  if (sweepRequested) {
    await sweepOnly();
  } else {
    await (cleanupRequested ? cleanup() : provision());
  }
};

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.env.VITEST !== "true";
if (isDirectRun) main().catch((error) => { console.error(JSON.stringify({ ok: false, error: serializeSmokeBcbaError(error) })); process.exit(1); });
