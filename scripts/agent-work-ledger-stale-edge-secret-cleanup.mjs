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
const APPROVAL_ACKNOWLEDGEMENT =
  "I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_WIN_275_STALE_EDGE_SECRET_CLEANUP";
const RUNTIME_MODE_NAME = "AGENT_WORK_LEDGER_RUNTIME_MODE";
const TARGET_NAMES = [
  "AGENT_WORK_RUNNER_SECRET",
  "AGENT_WORK_SWEEPER_SECRET",
  "AGENT_WORK_HOSTED_PROJECT_REF",
];
const publicDir = path.join(
  process.env.RUNNER_TEMP ?? os.tmpdir(),
  "agent-work-ledger-stale-edge-secret-cleanup-public",
);
const artifactPath = path.join(publicDir, "summary.json");
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
const firstRow = (result) =>
  Array.isArray(result)
    ? (result[0] ?? {})
    : (result?.result?.[0] ?? result ?? {});

const runDatabaseRead = async (query) => {
  const response = await fetch(MANAGEMENT_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requiredEnv("SUPABASE_ACCESS_TOKEN")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, parameters: [], read_only: true }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Management read failed with HTTP ${response.status}.`);
  }
  return response.json();
};

const runManagementSecretsRequest = async (method, body) => {
  const response = await fetch(MANAGEMENT_SECRETS_URL, {
    method,
    headers: {
      Authorization: `Bearer ${requiredEnv("SUPABASE_ACCESS_TOKEN")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(
      `Management secrets request failed with HTTP ${response.status}.`,
    );
  }
};

const runSupabase = async (args) =>
  execFileAsync("supabase", args, {
    env: {
      ...process.env,
      SUPABASE_ACCESS_TOKEN: requiredEnv("SUPABASE_ACCESS_TOKEN"),
    },
    windowsHide: true,
  });

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

const setRuntimeMode = async (mode) => {
  assert(mode === "disabled", "Cleanup runtime mode must remain disabled.");
  await runManagementSecretsRequest("POST", [
    { name: RUNTIME_MODE_NAME, value: mode },
  ]);
};

const unsetEdgeSecrets = async (names) => {
  assert(
    names.every((name) => TARGET_NAMES.includes(name)),
    "Cleanup requested a non-target Edge-secret name.",
  );
  if (names.length > 0) await runManagementSecretsRequest("DELETE", names);
};

const hostedBaselineSql = `
select jsonb_build_object(
  'pg_cron', exists(select 1 from pg_extension where extname = 'pg_cron'),
  'vault_names', (select count(*)::integer from vault.secrets where name in
    ('agent_work_hosted_project_ref','agent_work_hosted_publishable_key','agent_work_hosted_runner_secret','agent_work_hosted_sweeper_secret')),
  'queue_depth', (select count(*)::integer from pgmq.q_agent_work_steps),
  'archive_depth', (select count(*)::integer from pgmq.a_agent_work_steps),
  'database_lock_count', (select count(*)::integer from pg_locks where granted = false),
  'active_retention_policies', (select count(*)::integer from public.agent_work_retention_policies where disabled_at is null),
  'ledger_rows', (select count(*)::integer from public.agent_work_items),
  'draft_packets', (select count(*)::integer from public.agent_work_caloptima_draft_packets)
) as summary`;

const readHostedBaseline = async () =>
  firstRow(await runDatabaseRead(hostedBaselineSql)).summary;

const assertHostedBaseline = (summary) => {
  assert(
    summary?.pg_cron === false &&
      summary.vault_names === 0 &&
      summary.queue_depth === 0 &&
      summary.archive_depth === 0 &&
      summary.database_lock_count === 0 &&
      summary.active_retention_policies === 0 &&
      summary.ledger_rows === 0 &&
      summary.draft_packets === 0,
    "Hosted cleanup baseline drifted.",
  );
};

const unrelatedMetadata = (listing) =>
  new Map(
    [...listing].filter(
      ([name]) => name !== RUNTIME_MODE_NAME && !TARGET_NAMES.includes(name),
    ),
  );

const assertSameMetadata = (before, after) => {
  assert(
    before.size === after.size &&
      [...before].every(([name, digest]) => after.get(name) === digest),
    "Unrelated Edge-secret metadata drifted during cleanup.",
  );
};

const assertTargetedMetadataStable = (names, before, after) => {
  assert(
    names.every(
      (name) =>
        typeof before.get(name) === "string" &&
        after.get(name) === before.get(name),
    ),
    "Approved stale Edge-secret metadata drifted before deletion.",
  );
};

export const runApprovedStaleEdgeSecretCleanup = async (
  acknowledgement,
  cleanupOperations,
) => {
  assert(
    acknowledgement === APPROVAL_ACKNOWLEDGEMENT,
    "Exact stale Edge-secret cleanup acknowledgement is required.",
  );

  const baselineBefore = await cleanupOperations.readHostedBaseline();
  assertHostedBaseline(baselineBefore);
  const before = await cleanupOperations.listEdgeSecrets();
  const unrelatedBefore = unrelatedMetadata(before);
  const targetedNames = TARGET_NAMES.filter((name) => before.has(name));

  await cleanupOperations.setRuntimeMode("disabled");
  const confirmed = await cleanupOperations.listEdgeSecrets();
  assertTargetedMetadataStable(targetedNames, before, confirmed);
  assertSameMetadata(unrelatedBefore, unrelatedMetadata(confirmed));
  if (targetedNames.length > 0) {
    await cleanupOperations.unsetEdgeSecrets(targetedNames);
  }

  const after = await cleanupOperations.listEdgeSecrets();
  assert(
    TARGET_NAMES.every((name) => !after.has(name)),
    "Approved stale Edge-secret cleanup is incomplete.",
  );
  assert(
    after.has(RUNTIME_MODE_NAME),
    "Disabled runtime mode secret is unavailable after cleanup.",
  );
  const unrelatedAfter = unrelatedMetadata(after);
  assertSameMetadata(unrelatedBefore, unrelatedAfter);
  const baselineAfter = await cleanupOperations.readHostedBaseline();
  assertHostedBaseline(baselineAfter);

  return {
    targetedNamesRemoved: targetedNames.length,
    targetedNamesAbsentAfter: TARGET_NAMES.length,
    unrelatedNamesPreserved: unrelatedBefore.size,
  };
};

const writePublicArtifact = async (
  fixedBooleans,
  counts,
  destination = artifactPath,
) => {
  const evidence = {
    artifact: "agent-work-ledger-stale-edge-name-cleanup",
    fixed_booleans: fixedBooleans,
    counts,
    timings_ms: { elapsed: Date.now() - startedAt },
    summary_sha256: sha256({ fixedBooleans, counts }),
  };
  const serialized = JSON.stringify(evidence).toLowerCase();
  if (
    [
      "password",
      "access_token",
      "bearer ",
      "authorization:",
      "digest",
      "exception",
    ].some((term) => serialized.includes(term))
  ) {
    throw new Error("Refusing sensitive cleanup evidence output.");
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(evidence, null, 2)}\n`, {
    mode: 0o600,
  });
  return destination;
};

export const writeCleanupFailureArtifact = async (
  destinationDirectory = publicDir,
) =>
  writePublicArtifact(
    {
      execution_failed: true,
      stale_edge_cleanup_failed: true,
      runtime_advisory_enabled: false,
      vault_deletion_performed: false,
      database_row_deletion_performed: false,
      retention_deletion_performed: false,
    },
    {},
    path.join(destinationDirectory, "failure.json"),
  );

export const runDisabledFallback = async (cleanupOperations) => {
  await cleanupOperations.setRuntimeMode("disabled");
};

const executeCleanup = async () => {
  const counts = await runApprovedStaleEdgeSecretCleanup(
    requiredEnv("STALE_EDGE_SECRET_CLEANUP_ACKNOWLEDGEMENT"),
    {
      readHostedBaseline,
      listEdgeSecrets,
      setRuntimeMode,
      unsetEdgeSecrets,
    },
  );
  await writePublicArtifact(
    {
      cleanup_completed: true,
      runtime_disabled_reasserted: true,
      runtime_advisory_enabled: false,
      deletion_scope_limited: true,
      unrelated_metadata_preserved: true,
      vault_deletion_performed: false,
      database_row_deletion_performed: false,
      retention_deletion_performed: false,
    },
    counts,
  );
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const command = process.argv[2];
  try {
    if (command === "cleanup") {
      await executeCleanup();
    } else if (command === "disabled-fallback") {
      await runDisabledFallback({ setRuntimeMode });
    } else {
      throw new Error("Unsupported stale Edge-secret cleanup command.");
    }
  } catch (error) {
    if (command === "cleanup") {
      await writeCleanupFailureArtifact().catch(() => undefined);
    }
    throw error;
  }
}
