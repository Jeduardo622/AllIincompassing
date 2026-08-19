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
  await runSupabase([
    "secrets",
    "set",
    `AGENT_WORK_LEDGER_RUNTIME_MODE=${mode}`,
    "--project-ref",
    PROJECT_REF,
  ]);
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
  const parsed = JSON.parse(result.stdout || "[]");
  return new Set(parsed.map((entry) => entry.name));
};

const setEdgeSecrets = async (state) => {
  await runSupabase([
    "secrets",
    "set",
    `AGENT_WORK_LEDGER_RUNTIME_MODE=advisory`,
    `AGENT_WORK_RUNNER_SECRET=${state.runnerSecret}`,
    `AGENT_WORK_SWEEPER_SECRET=${state.sweeperSecret}`,
    `AGENT_WORK_HOSTED_PROJECT_REF=${PROJECT_REF}`,
    "--project-ref",
    PROJECT_REF,
  ]);
};

const unsetEdgeSecrets = async (names) => {
  if (names.length > 0)
    await runSupabase([
      "secrets",
      "unset",
      ...names,
      "--project-ref",
      PROJECT_REF,
    ]);
};

const preflightSql = `
select jsonb_build_object(
  'pg_cron', exists(select 1 from pg_extension where extname = 'pg_cron'),
  'pg_net', exists(select 1 from pg_extension where extname = 'pg_net'),
  'vault', exists(select 1 from pg_extension where extname = 'supabase_vault'),
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
  firstRow(await managementRead(preflightSql)).summary;
const assertPreflight = (summary) => {
  assert(
    summary.runtime_mode_secret_present === true,
    "Runtime mode secret is unavailable.",
  );
  assert(summary.pg_cron === false, "pg_cron baseline drifted.");
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
const createVaultSecrets = (state) =>
  managementWrite(
    `
  select vault.create_secret($1::text, 'agent_work_hosted_project_ref');
  select vault.create_secret($2::text, 'agent_work_hosted_publishable_key');
  select vault.create_secret($3::text, 'agent_work_hosted_runner_secret');
  select vault.create_secret($4::text, 'agent_work_hosted_sweeper_secret');
`,
    [
      PROJECT_REF,
      requiredEnv("SUPABASE_PUBLISHABLE_KEY"),
      state.runnerSecret,
      state.sweeperSecret,
    ],
  );
const enableHostedScheduler = () =>
  managementWrite(
    "select public.enable_hosted_agent_work_queue_scheduler($1::text, $2::integer, $3::integer) as scheduler",
    [CANARY_SCHEDULE, CANARY_HTTP_TIMEOUT_MS, CANARY_SWEEPER_BOUND],
  );
const disableHostedScheduler = () =>
  managementWrite(
    "select public.disable_hosted_agent_work_queue_scheduler() as scheduler",
  );
const deleteVaultSecrets = () =>
  managementWrite("delete from vault.secrets where name = any($1::text[])", [
    VAULT_NAMES,
  ]);
const dropCanaryPgCronExtension = (extensionOid) =>
  managementWrite(
    `
do $guard$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron' and oid = $1::oid) then
    raise exception 'canary_pg_cron_ownership_drifted';
  end if;
  if exists (select 1 from cron.job) then
    raise exception 'foreign_cron_job_detected';
  end if;
end
$guard$;
drop extension pg_cron;`,
    [extensionOid],
  );

const readMeasurements = async (baseline) =>
  firstRow(
    await managementRead(
      `
select jsonb_build_object(
  'cron_jobs', (select count(*)::integer from cron.job where jobname in ('agent-work-runner-hosted','agent-work-sweeper-hosted') and active),
  'cron_runs', (select count(*)::integer from cron.job_run_details where jobname in ('agent-work-runner-hosted','agent-work-sweeper-hosted') and start_time >= $1::timestamptz),
  'runner_runs', (select count(*)::integer from cron.job_run_details where jobname = 'agent-work-runner-hosted' and start_time >= $1::timestamptz),
  'sweeper_runs', (select count(*)::integer from cron.job_run_details where jobname = 'agent-work-sweeper-hosted' and start_time >= $1::timestamptz),
  'successful_cron_runs', (select count(*)::integer from cron.job_run_details where jobname in ('agent-work-runner-hosted','agent-work-sweeper-hosted') and start_time >= $1::timestamptz and status = 'succeeded'),
  'http_successes', (select count(*)::integer from net._http_response where id > $3::bigint and created >= $1::timestamptz and status_code = 200 and not timed_out and error_msg is null),
  'http_failures', (select count(*)::integer from net._http_response where id > $3::bigint and created >= $1::timestamptz and (status_code is distinct from 200 or timed_out or error_msg is not null)),
  'p50_ms', coalesce((select (percentile_cont(0.5) within group (order by extract(epoch from (end_time-start_time))*1000))::integer from cron.job_run_details where jobname in ('agent-work-runner-hosted','agent-work-sweeper-hosted') and start_time >= $1::timestamptz and end_time is not null), 0),
  'p95_ms', coalesce((select (percentile_cont(0.95) within group (order by extract(epoch from (end_time-start_time))*1000))::integer from cron.job_run_details where jobname in ('agent-work-runner-hosted','agent-work-sweeper-hosted') and start_time >= $1::timestamptz and end_time is not null), 0),
  'overlap_count', (select count(*)::integer from cron.job_run_details a join cron.job_run_details b on a.jobid=b.jobid and a.runid<b.runid and a.start_time < b.end_time and b.start_time < a.end_time where a.start_time >= $1::timestamptz),
  'queue_depth', (select count(*)::integer from pgmq.q_agent_work_steps),
  'archive_depth', (select count(*)::integer from pgmq.a_agent_work_steps),
  'database_lock_count', (select count(*)::integer from pg_locks where granted = false),
  'database_write_delta', greatest(0, (select sum(xact_commit+xact_rollback)::bigint from pg_stat_database where datname=current_database()) - $2::bigint)
) as measurements`,
      [
        new Date(baseline.startedAt).toISOString(),
        baseline.databaseWriteBaseline,
        baseline.httpResponseBaseline,
      ],
    ),
  ).then((row) => row.measurements);

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
const writePublicArtifact = async (fixedBooleans, counts, timingsMs) => {
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
  await mkdir(publicDir, { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(evidence, null, 2)}\n`, {
    mode: 0o600,
  });
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
  await attempt(() => cleanupOperations.unsetEdgeSecrets(EDGE_SECRET_NAMES));
  await attempt(() => cleanupOperations.deleteVaultSecrets());
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
  const state = {
    runnerSecret: randomBytes(32).toString("base64url"),
    sweeperSecret: randomBytes(32).toString("base64url"),
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
  state.pgCronExtensionOid = await installCanaryPgCronExtension();
  state.pgCronInstalledByCanary = true;
  await writeState(state);
  await createVaultSecrets(state);
  await setEdgeSecrets(state);
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

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  await executePhase(process.argv[2]);
