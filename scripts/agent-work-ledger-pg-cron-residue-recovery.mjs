import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import { parseEdgeSecretListing } from "./agent-work-ledger-hosted-advisory-canary.mjs";

const execFileAsync = promisify(execFile);
const PROJECT_REF = "wnnjeqheqxxyrgsjmygy";
const MANAGEMENT_API_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;
const MANAGEMENT_SECRETS_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/secrets`;
const ACKNOWLEDGEMENT =
  "I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_WIN_275_PG_CRON_RESIDUE_RECOVERY";
const APPROVED_INCIDENT_OID = 457927;
const ONLY_MUTATION = "DROP EXTENSION pg_cron";
const EDGE_CANARY_NAMES = [
  "AGENT_WORK_RUNNER_SECRET",
  "AGENT_WORK_SWEEPER_SECRET",
  "AGENT_WORK_HOSTED_PROJECT_REF",
];
const publicDir = path.join(
  process.env.RUNNER_TEMP ?? os.tmpdir(),
  "agent-work-ledger-pg-cron-residue-recovery-public",
);
const artifactPath = path.join(publicDir, "summary.json");
const startedAt = Date.now();
let runtimeDisabledReasserted = false;

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const requiredEnv = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
};
const firstRow = (result) =>
  Array.isArray(result)
    ? (result[0] ?? {})
    : (result?.result?.[0] ?? result ?? {});
const sha256 = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");

export const parseExpectedPgCronOid = (value) => {
  if (!/^[1-9][0-9]*$/.test(String(value ?? ""))) {
    throw new Error("expected_pg_cron_oid must be a positive safe integer.");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("expected_pg_cron_oid must be a positive safe integer.");
  }
  if (parsed !== APPROVED_INCIDENT_OID) {
    throw new Error("expected_pg_cron_oid must match approved incident OID 457927.");
  }
  return parsed;
};

const runDatabaseQuery = async (query, readOnly) => {
  const response = await fetch(MANAGEMENT_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requiredEnv("SUPABASE_ACCESS_TOKEN")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, parameters: [], read_only: readOnly }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Management query failed with HTTP ${response.status}.`);
  }
  return response.json();
};
const managementRead = (query) => runDatabaseQuery(query, true);
const managementWrite = (query) => runDatabaseQuery(query, false);

const runManagementSecretsRequest = async (body) => {
  const response = await fetch(MANAGEMENT_SECRETS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requiredEnv("SUPABASE_ACCESS_TOKEN")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Runtime mode reassertion failed with HTTP ${response.status}.`);
  }
};

export const reassertRuntimeDisabledWith = async (request) => {
  await request([
    { name: "AGENT_WORK_LEDGER_RUNTIME_MODE", value: "disabled" },
  ]);
  return true;
};

const reassertRuntimeDisabled = async () => {
  runtimeDisabledReasserted = await reassertRuntimeDisabledWith(
    runManagementSecretsRequest,
  );
};

const runSupabase = (args) =>
  execFileAsync("supabase", args, {
    env: {
      ...process.env,
      SUPABASE_ACCESS_TOKEN: requiredEnv("SUPABASE_ACCESS_TOKEN"),
    },
    windowsHide: true,
  });

const countEdgeCanaryNames = async () => {
  const result = await runSupabase([
    "secrets",
    "list",
    "--output",
    "json",
    "--project-ref",
    PROJECT_REF,
  ]);
  const listing = parseEdgeSecretListing(result.stdout);
  return EDGE_CANARY_NAMES.filter((name) => listing.has(name)).length;
};

const preflightSql = `
select jsonb_build_object(
  'pg_cron_oid', (select oid::bigint from pg_extension where extname = 'pg_cron'),
  'cron_job_count', (select count(*)::integer from cron.job),
  'ledger_rows', (
    (select count(*) from public.agent_work_items) +
    (select count(*) from public.agent_work_item_dependencies) +
    (select count(*) from public.agent_work_assessment_links) +
    (select count(*) from public.agent_work_steps) +
    (select count(*) from public.agent_work_step_dependencies) +
    (select count(*) from public.agent_work_evidence) +
    (select count(*) from public.agent_work_approvals) +
    (select count(*) from public.agent_work_attempts) +
    (select count(*) from public.agent_work_effects) +
    (select count(*) from public.agent_work_events)
  )::integer,
  'queue_depth', (select count(*)::integer from pgmq.q_agent_work_steps),
  'archive_depth', (select count(*)::integer from pgmq.a_agent_work_steps),
  'draft_rows', (select count(*)::integer from public.agent_work_caloptima_draft_packets),
  'vault_canary_names', (select count(*)::integer from vault.secrets where name in
    ('agent_work_hosted_project_ref','agent_work_hosted_publishable_key','agent_work_hosted_runner_secret','agent_work_hosted_sweeper_secret')),
  'active_retention_policies', (select count(*)::integer from public.agent_work_retention_policies where disabled_at is null),
  'ungranted_lock_count', (select count(*)::integer from pg_locks where granted = false),
  'synthetic_fixture_residue', (
    (select count(*) from public.organizations where slug like 'agent-work-shadow-%') +
    (select count(*) from public.clients where full_name like 'Synthetic Shadow Client %') +
    (select count(*) from public.assessment_documents where object_path like 'synthetic/agent-work-shadow/%') +
    (select count(*) from auth.users where raw_user_meta_data->>'fixture_kind' = 'agent-work-shadow-proof')
  )::integer
) as summary`;

const postRecoverySql = `
select jsonb_build_object(
  'pg_cron_oid', (select oid::bigint from pg_extension where extname = 'pg_cron'),
  'cron_job_count', case when to_regclass('cron.job') is null then 0 else -1 end,
  'ledger_rows', (
    (select count(*) from public.agent_work_items) +
    (select count(*) from public.agent_work_item_dependencies) +
    (select count(*) from public.agent_work_assessment_links) +
    (select count(*) from public.agent_work_steps) +
    (select count(*) from public.agent_work_step_dependencies) +
    (select count(*) from public.agent_work_evidence) +
    (select count(*) from public.agent_work_approvals) +
    (select count(*) from public.agent_work_attempts) +
    (select count(*) from public.agent_work_effects) +
    (select count(*) from public.agent_work_events)
  )::integer,
  'queue_depth', (select count(*)::integer from pgmq.q_agent_work_steps),
  'archive_depth', (select count(*)::integer from pgmq.a_agent_work_steps),
  'draft_rows', (select count(*)::integer from public.agent_work_caloptima_draft_packets),
  'vault_canary_names', (select count(*)::integer from vault.secrets where name in
    ('agent_work_hosted_project_ref','agent_work_hosted_publishable_key','agent_work_hosted_runner_secret','agent_work_hosted_sweeper_secret')),
  'active_retention_policies', (select count(*)::integer from public.agent_work_retention_policies where disabled_at is null),
  'ungranted_lock_count', (select count(*)::integer from pg_locks where granted = false),
  'synthetic_fixture_residue', (
    (select count(*) from public.organizations where slug like 'agent-work-shadow-%') +
    (select count(*) from public.clients where full_name like 'Synthetic Shadow Client %') +
    (select count(*) from public.assessment_documents where object_path like 'synthetic/agent-work-shadow/%') +
    (select count(*) from auth.users where raw_user_meta_data->>'fixture_kind' = 'agent-work-shadow-proof')
  )::integer
) as summary`;

const zeroFields = [
  "cron_job_count",
  "ledger_rows",
  "queue_depth",
  "archive_depth",
  "draft_rows",
  "vault_canary_names",
  "active_retention_policies",
  "ungranted_lock_count",
  "synthetic_fixture_residue",
];

const assertZeroResidue = (summary, message) => {
  assert(summary && zeroFields.every((field) => summary[field] === 0), message);
  if (Object.hasOwn(summary, "edge_canary_names")) {
    assert(summary.edge_canary_names === 0, message);
  }
};

const assertPreflight = (summary, expectedOid) => {
  assert(
    summary?.pg_cron_oid === expectedOid,
    "Hosted pg_cron residue recovery baseline drifted.",
  );
  assertZeroResidue(
    summary,
    "Hosted pg_cron residue recovery baseline drifted.",
  );
};

const assertPostRecovery = (summary) => {
  assert(
    summary?.pg_cron_oid === null,
    "Hosted pg_cron residue recovery post-state drifted.",
  );
  assertZeroResidue(
    summary,
    "Hosted pg_cron residue recovery post-state drifted.",
  );
};

export const buildPgCronResidueRecoveryMutationQuery = (extensionOid) => {
  const oid = parseExpectedPgCronOid(String(extensionOid));
  return `
begin;
set local lock_timeout = '5s';
set local statement_timeout = '20s';
select pg_advisory_xact_lock(2750818);
select pg_advisory_xact_lock(27104214731);
lock table cron.job in access exclusive mode;
do $guard$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron' and oid = ${oid}::oid) then
    raise exception 'pg_cron_oid_drifted';
  end if;
  if exists (select 1 from cron.job) then
    raise exception 'foreign_cron_job_detected';
  end if;
  if exists (select 1 from pgmq.q_agent_work_steps)
    or exists (select 1 from pgmq.a_agent_work_steps)
    or exists (select 1 from public.agent_work_items)
    or exists (select 1 from public.agent_work_item_dependencies)
    or exists (select 1 from public.agent_work_assessment_links)
    or exists (select 1 from public.agent_work_steps)
    or exists (select 1 from public.agent_work_step_dependencies)
    or exists (select 1 from public.agent_work_evidence)
    or exists (select 1 from public.agent_work_approvals)
    or exists (select 1 from public.agent_work_attempts)
    or exists (select 1 from public.agent_work_effects)
    or exists (select 1 from public.agent_work_events)
    or exists (select 1 from public.agent_work_caloptima_draft_packets)
    or exists (select 1 from public.agent_work_retention_policies where disabled_at is null)
    or exists (select 1 from vault.secrets where name in
      ('agent_work_hosted_project_ref','agent_work_hosted_publishable_key','agent_work_hosted_runner_secret','agent_work_hosted_sweeper_secret'))
    or exists (select 1 from public.organizations where slug like 'agent-work-shadow-%')
    or exists (select 1 from public.clients where full_name like 'Synthetic Shadow Client %')
    or exists (select 1 from public.assessment_documents where object_path like 'synthetic/agent-work-shadow/%')
    or exists (select 1 from auth.users where raw_user_meta_data->>'fixture_kind' = 'agent-work-shadow-proof') then
    raise exception 'cron_job_residue_detected';
  end if;
  execute '${ONLY_MUTATION.toLowerCase()}';
end
$guard$;
commit;
select true as dropped_extension, ${oid}::bigint as dropped_oid, 0::integer as cron_job_count;`;
};

const readHostedBaseline = async () => {
  const summary = firstRow(await managementRead(preflightSql)).summary;
  summary.edge_canary_names = await countEdgeCanaryNames();
  return summary;
};
const readHostedPostRecovery = async () => {
  const summary = firstRow(await managementRead(postRecoverySql)).summary;
  summary.edge_canary_names = await countEdgeCanaryNames();
  return summary;
};
const readHostedReconciliation = async () => {
  const extension = firstRow(
    await managementRead(
      "select (select oid::bigint from pg_extension where extname = 'pg_cron') as pg_cron_oid",
    ),
  );
  if (extension.pg_cron_oid === null) return readHostedPostRecovery();
  if (extension.pg_cron_oid === APPROVED_INCIDENT_OID) return readHostedBaseline();
  return { pg_cron_oid: extension.pg_cron_oid };
};
const executeRecoveryMutation = async (oid) =>
  firstRow(await managementWrite(buildPgCronResidueRecoveryMutationQuery(oid)));

export const reconcilePgCronResidueRecovery = async (
  expectedOid,
  readReconciliationState,
) => {
  const oid = parseExpectedPgCronOid(String(expectedOid));
  const summary = await readReconciliationState();
  if (summary?.pg_cron_oid === null) {
    assertPostRecovery(summary);
    return { recoveryCompleted: true, remainingExtensionCount: 0 };
  }
  if (summary?.pg_cron_oid === oid) {
    assertPreflight(summary, oid);
    return { recoveryCompleted: false, remainingExtensionCount: 1 };
  }
  throw new Error("Hosted pg_cron residue recovery reconciliation drifted.");
};

export const runPgCronResidueRecovery = async (
  acknowledgement,
  expectedOid,
  operations,
) => {
  assert(
    acknowledgement === ACKNOWLEDGEMENT,
    "Exact pg_cron residue recovery acknowledgement is required.",
  );
  const oid = parseExpectedPgCronOid(String(expectedOid));
  await operations.reassertRuntimeDisabled();
  const before = await operations.readHostedBaseline();
  assertPreflight(before, oid);
  const mutation = await operations.executeRecoveryMutation(oid);
  assert(
    mutation?.dropped_extension === true &&
      mutation.dropped_oid === oid &&
      mutation.cron_job_count === 0,
    "pg_cron recovery mutation did not prove exact OID removal.",
  );
  const after = await operations.readHostedPostRecovery();
  assertPostRecovery(after);
  return {
    droppedExtension: true,
    droppedOid: oid,
    cronJobCount: 0,
    postExtensionPresent: false,
  };
};

const writePublicArtifact = async (fixedBooleans, counts, destination) => {
  const evidence = {
    artifact: "agent-work-ledger-pg-cron-residue-recovery",
    fixed_booleans: fixedBooleans,
    counts,
    timings_ms: { elapsed: Date.now() - startedAt },
    summary_sha256: sha256({ fixedBooleans, counts }),
  };
  const serialized = JSON.stringify(evidence).toLowerCase();
  if (
    ["password", "access_token", "bearer ", "authorization:", "exception", "drop extension pg_cron"].some(
      (term) => serialized.includes(term),
    )
  ) {
    throw new Error("Refusing sensitive recovery evidence output.");
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(evidence, null, 2)}\n`, {
    mode: 0o600,
  });
  return destination;
};

export const writePgCronResidueRecoveryFailureArtifact = async (
  destinationDirectory = publicDir,
  disabledModeConfirmed = false,
) =>
  writePublicArtifact(
    {
      execution_failed: true,
      residue_recovery_failed: true,
      runtime_disabled_reasserted: disabledModeConfirmed === true,
      advisory_mode_enabled: false,
      schedule_created: false,
      retention_deletion_performed: false,
      customer_record_contents_returned: false,
    },
    {},
    path.join(destinationDirectory, "failure.json"),
  );

const operations = {
  reassertRuntimeDisabled,
  readHostedBaseline,
  executeRecoveryMutation,
  readHostedPostRecovery,
};

const preflight = async () => {
  await reassertRuntimeDisabled();
  const oid = parseExpectedPgCronOid(requiredEnv("EXPECTED_PG_CRON_OID"));
  assertPreflight(await readHostedBaseline(), oid);
  await writePublicArtifact(
    {
      read_only: true,
      preflight_passed: true,
      runtime_disabled_reasserted: true,
      advisory_mode_enabled: false,
    },
    { expected_pg_cron_oid: oid, residue_count: 0 },
    artifactPath,
  );
};

const recover = async () => {
  const oid = parseExpectedPgCronOid(requiredEnv("EXPECTED_PG_CRON_OID"));
  const result = await runPgCronResidueRecovery(
    requiredEnv("PG_CRON_RESIDUE_RECOVERY_ACKNOWLEDGEMENT"),
    oid,
    operations,
  );
  await writePublicArtifact(
    {
      recovery_completed: true,
      runtime_disabled_reasserted: true,
      advisory_mode_enabled: false,
      schedule_created: false,
      unrelated_deletion_performed: false,
    },
    { dropped_extension_count: 1, dropped_oid: result.droppedOid },
    artifactPath,
  );
};

const reconcile = async () => {
  const result = await reconcilePgCronResidueRecovery(
    requiredEnv("EXPECTED_PG_CRON_OID"),
    readHostedReconciliation,
  );
  await writePublicArtifact(
    {
      reconciliation_passed: true,
      recovery_completed: result.recoveryCompleted,
      runtime_mode_expected_disabled: true,
      advisory_mode_enabled: false,
      zero_residue_verified: true,
    },
    { remaining_pg_cron_extensions: result.remainingExtensionCount, residue_count: 0 },
    artifactPath,
  );
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const command = process.argv[2];
  try {
    if (command === "preflight") await preflight();
    else if (command === "recover") await recover();
    else if (command === "reconcile") await reconcile();
    else if (command === "disabled-fallback") await reassertRuntimeDisabled();
    else throw new Error("Unsupported pg_cron residue recovery command.");
  } catch (error) {
    await writePgCronResidueRecoveryFailureArtifact(
      publicDir,
      runtimeDisabledReasserted,
    ).catch(() => undefined);
    throw error;
  }
}
