import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const PROJECT_REF = "wnnjeqheqxxyrgsjmygy";
const PROJECT_URL = `https://${PROJECT_REF}.supabase.co`;
const MANAGEMENT_API_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;
const MANAGEMENT_SECRETS_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/secrets`;
const AUTH_URL = `${PROJECT_URL}/auth/v1`;
const ITEMS_URL = `${PROJECT_URL}/functions/v1/agent-work-items`;
const CANARY_SCHEDULE = "* * * * *";
const CANARY_HTTP_TIMEOUT_MS = 5_000;
const CANARY_SWEEPER_BOUND = 25;
const CANARY_WINDOW_MS = 130_000;
const VAULT_NAMES = [
  "agent_work_hosted_project_ref",
  "agent_work_hosted_publishable_key",
  "agent_work_hosted_runner_secret",
  "agent_work_hosted_sweeper_secret",
];
const EDGE_SECRET_NAMES = [
  "AGENT_WORK_RUNNER_SECRET",
  "AGENT_WORK_SWEEPER_SECRET",
  "AGENT_WORK_HOSTED_PROJECT_REF",
];
const PHASES = ["preflight", "setup/measure", "cleanup/verify"];
const privateDir = path.join(
  process.env.RUNNER_TEMP ?? os.tmpdir(),
  "agent-work-ledger-hosted-advisory-canary-private",
);
const publicDir = path.join(
  process.env.RUNNER_TEMP ?? os.tmpdir(),
  "agent-work-ledger-hosted-advisory-canary-public",
);
const statePath = path.join(privateDir, "state.json");
const artifactPath = path.join(publicDir, "summary.json");
const shadowStatePath = path.join(
  process.env.RUNNER_TEMP ?? os.tmpdir(),
  "agent-work-ledger-hosted-shadow-proof-private",
  "state.json",
);
const startedAt = Date.now();

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const requiredEnv = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
};
const sha256 = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const firstRow = (result) =>
  Array.isArray(result)
    ? (result[0] ?? {})
    : (result?.result?.[0] ?? result ?? {});
export const extractMeasurementSummary = (result) =>
  firstRow(result)?.measurements ?? {};

const runDatabaseQuery = async (query, parameters = [], readOnly = false) => {
  const response = await fetch(MANAGEMENT_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requiredEnv("SUPABASE_ACCESS_TOKEN")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      readOnly
        ? { query, parameters, read_only: true }
        : { query, parameters, read_only: false },
    ),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(`Management query failed with HTTP ${response.status}.`);
  return response.json();
};
const managementRead = (query, parameters = []) =>
  runDatabaseQuery(query, parameters, true);
const managementWrite = (query, parameters = []) =>
  runDatabaseQuery(query, parameters, false);

const runManagementSecretsRequest = async (method, body) => {
  const response = await fetch(MANAGEMENT_SECRETS_URL, {
    method,
    headers: {
      Authorization: `Bearer ${requiredEnv("SUPABASE_ACCESS_TOKEN")}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(
      `Management secrets request failed with HTTP ${response.status}.`,
    );
  return undefined;
};

const runSupabase = async (args) =>
  execFileAsync("supabase", args, {
    env: {
      ...process.env,
      SUPABASE_ACCESS_TOKEN: requiredEnv("SUPABASE_ACCESS_TOKEN"),
    },
    windowsHide: true,
  });

const setRuntimeMode = async (mode) => {
  assert(
    mode === "advisory" || mode === "disabled",
    "Unsupported canary runtime mode.",
  );
  await runManagementSecretsRequest("POST", [
    { name: "AGENT_WORK_LEDGER_RUNTIME_MODE", value: mode },
  ]);
};

export const parseEdgeSecretListing = (output) => {
  const normalized = String(output).replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
  if (normalized.trimStart().startsWith("[")) {
    const parsed = JSON.parse(normalized);
    assert(Array.isArray(parsed), "Secret listing JSON must be an array.");
    const entries = parsed.map((entry) => [
      entry?.name,
      entry?.digest ?? entry?.value,
    ]);
    assert(
      entries.every(
        ([name, digest]) =>
          typeof name === "string" &&
          name.length > 0 &&
          typeof digest === "string" &&
          digest.length > 0,
      ),
      "Secret listing JSON contains invalid metadata.",
    );
    return new Map(entries);
  }

  const rows = normalized.split(/\r?\n/);
  const headerIndex = rows.findIndex((row) => {
    const cells = row.split(/[│|]/).map((cell) => cell.trim().toUpperCase());
    return cells[0] === "NAME" && cells[1] === "DIGEST";
  });
  assert(headerIndex >= 0, "Secret listing output is unsupported.");
  const entries = rows
    .slice(headerIndex + 1)
    .map((row) => row.split(/[│|]/).map((cell) => cell.trim()))
    .filter(
      (cells) =>
        cells.length >= 2 &&
        cells[0].length > 0 &&
        cells[1].length > 0 &&
        !/^[─-]+$/.test(cells[0]),
    )
    .map(([name, digest]) => [name, digest]);
  return new Map(entries);
};

const listEdgeSecrets = async () => {
  const result = await runSupabase([
    "secrets",
    "list",
    "--output",
    "json",
    "--project-ref",
    PROJECT_REF,
  ]);
  return parseEdgeSecretListing(result.stdout);
};

export const captureCanarySecretDigests = (listing) => {
  const digests = Object.fromEntries(
    EDGE_SECRET_NAMES.map((name) => [name, listing.get(name)]),
  );
  assert(
    EDGE_SECRET_NAMES.every(
      (name) => typeof digests[name] === "string" && digests[name].length > 0,
    ),
    "Created canary Edge secret digest is missing.",
  );
  return digests;
};

const setEdgeSecrets = async (state) => {
  await runManagementSecretsRequest("POST", [
    { name: "AGENT_WORK_LEDGER_RUNTIME_MODE", value: "advisory" },
    { name: "AGENT_WORK_RUNNER_SECRET", value: state.runnerSecret },
    { name: "AGENT_WORK_SWEEPER_SECRET", value: state.sweeperSecret },
    { name: "AGENT_WORK_HOSTED_PROJECT_REF", value: PROJECT_REF },
  ]);
};

const unsetEdgeSecrets = async (names) => {
  if (names.length > 0) await runManagementSecretsRequest("DELETE", names);
};

export const buildPreflightQuery = () => `
select jsonb_build_object(
  'pg_cron', exists(select 1 from pg_extension where extname = 'pg_cron'),
  'pg_net', exists(select 1 from pg_extension where extname = 'pg_net'),
  'vault', exists(select 1 from pg_extension where extname = 'supabase_vault'),
  'current_role_is_superuser', coalesce((select rolsuper from pg_roles where rolname = current_user), false),
  'current_role_is_supabase_admin', current_user = 'supabase_admin',
  'current_role_can_act_as_supabase_admin', pg_has_role(current_user, 'supabase_admin', 'USAGE'),
  'cleanup_authority_proven', (
    coalesce((select rolsuper from pg_roles where rolname = current_user), false)
    or current_user = 'supabase_admin'
    or pg_has_role(current_user, 'supabase_admin', 'USAGE')
  ),
  'cron_jobs', 0,
  'vault_names', (select count(*)::integer from vault.secrets where name in
    ('agent_work_hosted_project_ref','agent_work_hosted_publishable_key','agent_work_hosted_runner_secret','agent_work_hosted_sweeper_secret')),
  'queue_depth', (select count(*)::integer from pgmq.q_agent_work_steps),
  'archive_depth', (select count(*)::integer from pgmq.a_agent_work_steps),
  'oldest_message_age_seconds', coalesce((select extract(epoch from now() - min(enqueued_at))::integer from pgmq.q_agent_work_steps), 0),
  'database_lock_count', (select count(*)::integer from pg_locks where granted = false),
  'database_write_baseline', (select sum(xact_commit + xact_rollback)::bigint from pg_stat_database where datname = current_database()),
  'http_response_baseline', (select coalesce(max(id), 0)::bigint from net._http_response),
  'active_retention_policies', (select count(*)::integer from public.agent_work_retention_policies where disabled_at is null),
  'ledger_rows', (select count(*)::integer from public.agent_work_items),
  'draft_packets', (select count(*)::integer from public.agent_work_caloptima_draft_packets),
  'retention_decisions', (select count(*)::integer from public.agent_work_retention_policy_decisions where retention_days in (365,90,30))
) as summary`;

const readPreflight = async () =>
  firstRow(await managementRead(buildPreflightQuery())).summary;
const assertCleanupAuthorityProof = (summary) => {
  assert(
    summary.cleanup_authority_proven === true,
    "Management API cleanup authority over pg_cron is unavailable.",
  );
};
export const assertPreflight = (summary) => {
  assert(
    summary.runtime_mode_secret_present === true,
    "Runtime mode secret is unavailable.",
  );
  assert(summary.pg_cron === false, "pg_cron baseline drifted.");
  assertCleanupAuthorityProof(summary);
  assert(
    summary.pg_net === true && summary.vault === true,
    "Required preexisting extensions are unavailable.",
  );
  assert(
    summary.cron_jobs === 0 && summary.vault_names === 0,
    "Hosted scheduler residue exists.",
  );
  assert(
    summary.queue_depth === 0 &&
      summary.archive_depth === 0 &&
      summary.ledger_rows === 0 &&
      summary.draft_packets === 0,
    "Ledger baseline is not empty.",
  );
  assert(
    summary.active_retention_policies === 0 &&
      summary.retention_decisions === 3,
    "Retention baseline drifted.",
  );
};

const installCanaryPgCronExtension = async () => {
  const result = await managementWrite(`
begin;
select pg_advisory_xact_lock(2750818);
do $guard$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'pg_cron_baseline_drifted';
  end if;
end
$guard$;
create extension pg_cron with schema pg_catalog;
commit;
select oid::bigint as extension_oid from pg_extension where extname = 'pg_cron';`);
  const row = firstRow(result);
  assert(
    Number.isSafeInteger(Number(row.extension_oid)),
    "Canary pg_cron ownership proof is missing.",
  );
  return Number(row.extension_oid);
};
const assertVaultSecretOwnershipProof = (ids) => {
  assert(
    ids &&
      typeof ids === "object" &&
      Object.keys(ids).length === VAULT_NAMES.length &&
      VAULT_NAMES.every((name) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          ids[name],
        ),
      ),
    "Created Vault secret ownership proof is missing.",
  );
};

const createVaultSecrets = async (state) => {
  const row = firstRow(
    await managementWrite(
      `
select jsonb_build_object(
  'agent_work_hosted_project_ref', vault.create_secret($1::text, 'agent_work_hosted_project_ref'),
  'agent_work_hosted_publishable_key', vault.create_secret($2::text, 'agent_work_hosted_publishable_key'),
  'agent_work_hosted_runner_secret', vault.create_secret($3::text, 'agent_work_hosted_runner_secret'),
  'agent_work_hosted_sweeper_secret', vault.create_secret($4::text, 'agent_work_hosted_sweeper_secret')
) as vault_secret_ids`,
      [
        PROJECT_REF,
        requiredEnv("SUPABASE_PUBLISHABLE_KEY"),
        state.runnerSecret,
        state.sweeperSecret,
      ],
    ),
  );
  const ids = row.vault_secret_ids;
  assertVaultSecretOwnershipProof(ids);
  return ids;
};
const enableHostedScheduler = () =>
  managementWrite(
    "select public.enable_hosted_agent_work_queue_scheduler($1::text, $2::integer, $3::integer) as scheduler",
    [CANARY_SCHEDULE, CANARY_HTTP_TIMEOUT_MS, CANARY_SWEEPER_BOUND],
  );
const disableHostedScheduler = () =>
  managementWrite(
    "select public.disable_hosted_agent_work_queue_scheduler() as scheduler",
  );
const deleteVaultSecrets = (ownedIds) => {
  assertVaultSecretOwnershipProof(ownedIds);
  return managementWrite(
    `delete from vault.secrets as secret
using jsonb_each_text($1::jsonb) as owned(name, id)
where secret.name = owned.name and secret.id = owned.id::uuid`,
    [JSON.stringify(ownedIds)],
  );
};
export const buildDropCanaryPgCronExtensionQuery = (extensionOid) => {
  const validatedOid = Number(extensionOid);
  assert(
    Number.isSafeInteger(validatedOid) && validatedOid > 0,
    "Canary pg_cron ownership proof is missing.",
  );
  return `
begin;
select pg_advisory_xact_lock(2750818);
select pg_advisory_xact_lock(27104214731);
lock table cron.job in access exclusive mode;
do $guard$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron' and oid = ${validatedOid}::oid) then
    raise exception 'canary_pg_cron_ownership_drifted';
  end if;
  if exists (select 1 from cron.job) then
    raise exception 'foreign_cron_job_detected';
  end if;
end
$guard$;
drop extension pg_cron;
commit;`;
};
const dropCanaryPgCronExtension = (extensionOid) =>
  managementWrite(buildDropCanaryPgCronExtensionQuery(extensionOid));

export const buildMeasurementQuery = () => `
with target_runs as materialized (
  select runs.*, jobs.jobname
  from cron.job_run_details as runs
  join cron.job as jobs on jobs.jobid = runs.jobid
  where jobs.jobname in ('agent-work-runner-hosted','agent-work-sweeper-hosted')
    and runs.start_time >= $1::timestamptz
)
select jsonb_build_object(
  'cron_jobs', (select count(*)::integer from cron.job where jobname in ('agent-work-runner-hosted','agent-work-sweeper-hosted') and active),
  'cron_runs', (select count(*)::integer from target_runs),
  'runner_runs', (select count(*)::integer from target_runs where jobname = 'agent-work-runner-hosted'),
  'sweeper_runs', (select count(*)::integer from target_runs where jobname = 'agent-work-sweeper-hosted'),
  'successful_cron_runs', (select count(*)::integer from target_runs where status = 'succeeded'),
  'http_successes', (select count(*)::integer from net._http_response where id > $3::bigint and created >= $1::timestamptz and status_code = 200 and not timed_out and error_msg is null),
  'http_failures', (select count(*)::integer from net._http_response where id > $3::bigint and created >= $1::timestamptz and (status_code is distinct from 200 or timed_out or error_msg is not null)),
  'p50_ms', coalesce((select (percentile_cont(0.5) within group (order by extract(epoch from (end_time-start_time))*1000))::integer from target_runs where end_time is not null), 0),
  'p95_ms', coalesce((select (percentile_cont(0.95) within group (order by extract(epoch from (end_time-start_time))*1000))::integer from target_runs where end_time is not null), 0),
  'overlap_count', (select count(*)::integer from target_runs a join target_runs b on a.runid<b.runid and a.start_time < b.end_time and b.start_time < a.end_time),
  'queue_depth', (select count(*)::integer from pgmq.q_agent_work_steps),
  'archive_depth', (select count(*)::integer from pgmq.a_agent_work_steps),
  'database_lock_count', (select count(*)::integer from pg_locks where granted = false),
  'database_write_delta', greatest(0, (select sum(xact_commit+xact_rollback)::bigint from pg_stat_database where datname=current_database()) - $2::bigint)
) as measurements`;

const readMeasurements = async (baseline) =>
  extractMeasurementSummary(
    await managementRead(
      buildMeasurementQuery(),
      [
        new Date(baseline.startedAt).toISOString(),
        baseline.databaseWriteBaseline,
        baseline.httpResponseBaseline,
      ],
    ),
  );

const assertMutationAuthorityPreflight = async () =>
  assertCleanupAuthorityProof(
    firstRow(await managementRead(buildPreflightQuery())).summary,
  );

const writeState = async (state) => {
  await mkdir(privateDir, { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
};
const readState = async () => JSON.parse(await readFile(statePath, "utf8"));
const pollForSyntheticAdvisoryReadback = async () => {
  const shadowState = JSON.parse(await readFile(shadowStatePath, "utf8"));
  const publicKey = requiredEnv("SUPABASE_PUBLISHABLE_KEY");
  const tokenResponse = await fetch(`${AUTH_URL}/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: publicKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: shadowState.users[0].email,
      password: shadowState.users[0].password,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!tokenResponse.ok) {
    throw new Error(
      `Synthetic sign-in failed with HTTP ${tokenResponse.status}.`,
    );
  }
  const accessToken = (await tokenResponse.json()).access_token;
  assert(
    typeof accessToken === "string" && accessToken.length > 0,
    "Synthetic access token is missing.",
  );
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const response = await fetch(
      `${ITEMS_URL}?assessment_document_id=${shadowState.fixture.assessmentAId}`,
      {
        headers: { apikey: publicKey, Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15_000),
      },
    );
    const body = await response.json().catch(() => ({}));
    if (response.ok && body?.meta?.runtimeMode === "advisory") return;
    await sleep(1_000);
  }
  throw new Error(
    "Timed out waiting for authenticated synthetic advisory readback.",
  );
};
const writePublicArtifact = async (
  fixedBooleans,
  counts,
  timingsMs,
  destination = artifactPath,
) => {
  const evidence = {
    artifact: "agent-work-ledger-hosted-advisory-canary",
    fixed_booleans: fixedBooleans,
    counts,
    timings_ms: timingsMs,
    summary_sha256: sha256({ fixedBooleans, counts, timingsMs }),
  };
  const serialized = JSON.stringify(evidence).toLowerCase();
  if (
    [
      "@example.com",
      "password",
      "access_token",
      "bearer ",
      "authorization:",
    ].some((term) => serialized.includes(term))
  ) {
    throw new Error("Refusing sensitive or identifying evidence output.");
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(evidence, null, 2)}\n`, {
    mode: 0o600,
  });
  return destination;
};

export const writePhaseFailureArtifact = async (
  phase,
  destinationDirectory = publicDir,
) => {
  assert(PHASES.includes(phase), "Unsupported hosted advisory canary phase.");
  const phaseKey = phase.replace("/", "_");
  return writePublicArtifact(
    {
      execution_failed: true,
      preflight_failed: phase === "preflight",
      setup_measure_failed: phase === "setup/measure",
      cleanup_verify_failed: phase === "cleanup/verify",
      retention_activation_performed: false,
      retention_deletion_performed: false,
    },
    {},
    { elapsed: Date.now() - startedAt },
    path.join(
      destinationDirectory,
      `failure-${phaseKey.replace("_", "-")}.json`,
    ),
  );
};

const deleteSyntheticFixtures = async () => {
  await execFileAsync(
    process.execPath,
    ["scripts/agent-work-ledger-hosted-shadow-proof.mjs", "cleanup/verify"],
    { env: process.env, windowsHide: true },
  );
};

const operations = {
  setRuntimeMode,
  disableHostedScheduler,
  listEdgeSecrets,
  unsetEdgeSecrets,
  dropCanaryPgCronExtension,
  deleteSyntheticFixtures,
  deleteVaultSecrets,
};

export const runCleanupSequence = async (state, cleanupOperations) => {
  const errors = [];
  const attempt = async (operation) => {
    try {
      await operation();
    } catch (error) {
      errors.push(error);
    }
  };
  await attempt(() => cleanupOperations.setRuntimeMode("disabled"));
  await attempt(() => cleanupOperations.disableHostedScheduler());
  await attempt(async () => {
    const currentSecrets = await cleanupOperations.listEdgeSecrets();
    const expectedDigests = state.edgeSecretDigests ?? {};
    const foreignCanarySecrets = EDGE_SECRET_NAMES.filter(
      (name) =>
        currentSecrets.has(name) &&
        currentSecrets.get(name) !== expectedDigests[name],
    );
    assert(
      foreignCanarySecrets.length === 0,
      "Canary Edge secret ownership drifted.",
    );
    const ownedCanarySecrets = EDGE_SECRET_NAMES.filter(
      (name) =>
        typeof expectedDigests[name] === "string" &&
        currentSecrets.get(name) === expectedDigests[name],
    );
    if (ownedCanarySecrets.length > 0) {
      await cleanupOperations.unsetEdgeSecrets(ownedCanarySecrets);
    }
  });
  if (state.vaultSecretIds !== undefined) {
    await attempt(() =>
      cleanupOperations.deleteVaultSecrets(state.vaultSecretIds),
    );
  }
  if (state.pgCronInstalledByCanary) {
    await attempt(() =>
      cleanupOperations.dropCanaryPgCronExtension(state.pgCronExtensionOid),
    );
  }
  await attempt(() => cleanupOperations.deleteSyntheticFixtures());
  if (errors.length > 0) {
    throw new AggregateError(errors, "Canary cleanup completed with failures.");
  }
};

const preflightPhase = async () => {
  assert(
    requiredEnv("SUPABASE_URL").replace(/\/$/, "") === PROJECT_URL,
    "Hosted project mismatch.",
  );
  const edgeSecrets = await listEdgeSecrets();
  assert(
    EDGE_SECRET_NAMES.every((name) => !edgeSecrets.has(name)),
    "Generated canary Edge secret residue exists.",
  );
  const summary = await readPreflight();
  summary.runtime_mode_secret_present = edgeSecrets.has(
    "AGENT_WORK_LEDGER_RUNTIME_MODE",
  );
  assertPreflight(summary);
  const runnerSecret = randomBytes(32).toString("base64url");
  const sweeperSecret = randomBytes(32).toString("base64url");
  const state = {
    runnerSecret,
    sweeperSecret,
    startedAt: Date.now(),
    databaseWriteBaseline: Number(summary.database_write_baseline),
    httpResponseBaseline: Number(summary.http_response_baseline),
    pgCronInstalledByCanary: false,
    pgCronExtensionOid: null,
  };
  await writeState(state);
  await writePublicArtifact(
    {
      preflight_passed: true,
      temporary_advisory_only: true,
      policy_unapproved_verified: true,
      retention_activation_performed: false,
      retention_deletion_performed: false,
    },
    { queue_depth: 0, fixture_rows: 0 },
    { preflight: Date.now() - startedAt },
  );
};

const setupMeasurePhase = async () => {
  const state = await readState();
  await assertMutationAuthorityPreflight();
  state.pgCronExtensionOid = await installCanaryPgCronExtension();
  state.pgCronInstalledByCanary = true;
  await writeState(state);
  state.vaultSecretIds = await createVaultSecrets(state);
  await writeState(state);
  await setEdgeSecrets(state);
  state.edgeSecretDigests = captureCanarySecretDigests(await listEdgeSecrets());
  await writeState(state);
  await pollForSyntheticAdvisoryReadback();
  await enableHostedScheduler();
  await sleep(CANARY_WINDOW_MS);
  const measurements = await readMeasurements(state);
  assert(
    measurements.cron_jobs === 2 &&
      measurements.runner_runs >= 1 &&
      measurements.sweeper_runs >= 1 &&
      measurements.http_successes >= 2 &&
      measurements.http_failures === 0,
    "The finite canary did not observe both scheduled jobs.",
  );
  assert(
    measurements.overlap_count === 0,
    "Canary scheduler overlap was observed.",
  );
  state.measurements = measurements;
  await writeState(state);
  await writePublicArtifact(
    {
      canary_measured: true,
      temporary_advisory_only: true,
      policy_unapproved_verified: true,
      retention_activation_performed: false,
      retention_deletion_performed: false,
    },
    measurements,
    { canary_window: CANARY_WINDOW_MS },
  );
};

const cleanupVerifyPhase = async () => {
  const state = await readState().catch(() => ({
    pgCronInstalledByCanary: false,
  }));
  await runCleanupSequence(state, operations);
  const final = await readPreflight();
  const edgeSecrets = await listEdgeSecrets();
  final.runtime_mode_secret_present = edgeSecrets.has(
    "AGENT_WORK_LEDGER_RUNTIME_MODE",
  );
  assertPreflight(final);
  assert(
    EDGE_SECRET_NAMES.every((name) => !edgeSecrets.has(name)),
    "Canary Edge secrets remain.",
  );
  await writePublicArtifact(
    {
      disabled_restored: true,
      cleanup_completed: true,
      policy_unapproved_verified: true,
      retention_activation_performed: false,
      retention_deletion_performed: false,
    },
    {
      ...(state.measurements ?? {}),
      final_cron_jobs: 0,
      final_vault_names: 0,
      final_edge_secrets: 0,
      final_fixture_rows: 0,
      final_pg_cron_extensions: 0,
      final_archive_depth: 0,
    },
    { cleanup_verify: Date.now() - startedAt },
  );
};

export const executePhase = async (phase) => {
  assert(PHASES.includes(phase), "Unsupported hosted advisory canary phase.");
  if (phase === "preflight") return preflightPhase();
  if (phase === "setup/measure") return setupMeasurePhase();
  return cleanupVerifyPhase();
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const phase = process.argv[2];
  try {
    await executePhase(phase);
  } catch (error) {
    if (PHASES.includes(phase)) {
      await writePhaseFailureArtifact(phase).catch(() => undefined);
    }
    throw error;
  }
}
