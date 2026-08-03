import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

import pg from "pg";

import {
  assertLocalPostgresUrl,
  assertLocalSupabaseHttpUrl,
} from "./localRuntime.mjs";

const { Client } = pg;
const REQUEST_TIMEOUT_MS = 10_000;
const EXPECTED_FUNCTION_URLS = Object.freeze([
  "http://agent-work-items:8000/agent-work-items",
  "http://agent-work-runner:8000/agent-work-runner",
  "http://agent-work-sweeper:8000/agent-work-sweeper",
]);

const CHILD_BASE_ENV_KEYS = Object.freeze([
  "PATH",
  "HOME",
  "TMPDIR",
  "CI",
  "AGENT_WORK_PHASE2_CONTAINER",
]);

const ROLE_CHILD_ENV_KEYS = Object.freeze({
  "retention-trace": ["SUPABASE_DB_URL"],
  "app-api-unit-build": [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_EDGE_URL",
    "VITE_SUPABASE_ANON_KEY",
  ],
});

const requiredEnv = (env, name) => {
  const value = env[name]?.trim();
  if (!value) throw new Error(`container_${name.toLowerCase()}_required`);
  return value;
};

export const buildContainerRoleChildEnv = (role, env = process.env) => {
  const roleKeys = ROLE_CHILD_ENV_KEYS[role];
  if (!roleKeys) throw new Error(`unknown_container_role_${role}`);
  const childEnv = {};
  for (const key of [...CHILD_BASE_ENV_KEYS, ...roleKeys]) {
    if (typeof env[key] === "string") childEnv[key] = env[key];
  }
  return childEnv;
};

export const runContainerChildCommand = (command, args, env) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: "inherit",
    });
    child.on("error", () => reject(new Error("container_child_spawn_failed")));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error("container_child_command_failed"));
    });
  });

const defaultRunCommand = runContainerChildCommand;

const expectStatus = async (
  fetchImpl,
  url,
  expected,
  init = {},
) => {
  let response;
  try {
    response = await fetchImpl(url, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error("container_health_request_failed");
  }
  if (!expected.has(response.status)) {
    throw new Error("container_health_status_failed");
  }
};

const runStackHealth = async ({ env, fetchImpl }) => {
  const supabaseUrl = assertLocalSupabaseHttpUrl(
    requiredEnv(env, "SUPABASE_URL"),
    "SUPABASE_URL",
    env,
  ).origin;
  const serviceRoleKey = requiredEnv(env, "SUPABASE_SERVICE_ROLE_KEY");

  await expectStatus(fetchImpl, "http://agent-work-app:4173/", new Set([200]));
  await expectStatus(
    fetchImpl,
    "http://agent-work-app:4173/api/runtime-config",
    new Set([200]),
  );
  await expectStatus(
    fetchImpl,
    `${supabaseUrl}/auth/v1/health`,
    new Set([200]),
  );
  await expectStatus(fetchImpl, `${supabaseUrl}/rest/v1/`, new Set([200]), {
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
    },
  });
  for (const url of EXPECTED_FUNCTION_URLS) {
    await expectStatus(fetchImpl, url, new Set([401, 403]), { method: "POST" });
  }
};

const runSchemaSeed = async ({ env, ClientImpl }) => {
  const connectionString = requiredEnv(env, "SUPABASE_DB_URL");
  assertLocalPostgresUrl(connectionString, "SUPABASE_DB_URL", env);

  const client = new ClientImpl({ connectionString });
  try {
    await client.connect();
    const { rows: ownerRows } = await client.query("select current_user");
    if (ownerRows[0]?.current_user !== "postgres") {
      throw new Error("container_schema_requires_postgres_owner");
    }
    const { rows } = await client.query(`
      select
        to_regclass('public.agent_work_items') is not null as work_items,
        to_regclass('public.agent_work_steps') is not null as work_steps,
        to_regclass('public.agent_work_events') is not null as work_events,
        to_regclass('pgmq.q_agent_work_steps') is not null as live_queue,
        to_regclass('pgmq.a_agent_work_steps') is not null as archive_queue,
        exists(select 1 from pg_extension where extname = 'pgmq') as pgmq_enabled,
        exists(select 1 from pg_extension where extname = 'pg_cron') as pg_cron_enabled,
        exists(select 1 from pg_extension where extname = 'pg_net') as pg_net_enabled,
        exists(select 1 from pg_extension where extname = 'supabase_vault') as vault_enabled,
        exists(select 1 from public.organizations where slug = 'seed-preview-org') as deterministic_seed,
        not exists (
          select 1
          from public.agent_work_steps step
          join public.agent_work_items item on item.id = step.work_item_id
          where step.organization_id is distinct from item.organization_id
             or step.client_id is distinct from item.client_id
        ) as step_item_org_client_parity,
        not exists (
          select 1
          from pgmq.q_agent_work_steps queued
          left join public.agent_work_steps step
            on step.id::text = queued.message ->> 'stepId'
          left join public.agent_work_items item on item.id = step.work_item_id
          where step.id is null
             or item.id is null
             or queued.message ->> 'organizationId'
                is distinct from step.organization_id::text
             or step.organization_id is distinct from item.organization_id
             or step.client_id is distinct from item.client_id
        ) as queued_payload_org_parity
    `);
    const result = rows[0] ?? {};
    if (Object.values(result).some((value) => value !== true)) {
      throw new Error("container_schema_seed_check_failed");
    }
  } finally {
    await client.end();
  }
};

export const runContainerRole = async (role, {
  env = process.env,
  fetchImpl = fetch,
  ClientImpl = Client,
  runCommand = defaultRunCommand,
} = {}) => {
  if (role === "stack-health") {
    await runStackHealth({ env, fetchImpl });
    return;
  }
  if (role === "schema-seed") {
    await runSchemaSeed({ env, ClientImpl });
    return;
  }
  if (role === "retention-trace") {
    const childEnv = buildContainerRoleChildEnv(role, env);
    await runCommand(
      "node",
      ["scripts/agent-work-ledger-retention-contract.mjs"],
      childEnv,
    );
    await runCommand(
      "node",
      ["scripts/agent-work-ledger-trace-index-contract.mjs"],
      childEnv,
    );
    return;
  }
  if (role === "app-api-unit-build") {
    const childEnv = buildContainerRoleChildEnv(role, env);
    await runCommand("npm", ["run", "test:agent-work:eval"], childEnv);
    await runCommand("node", [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/agentWorkLedgerEval.test.ts",
      "tests/agentWorkLedgerEvalCli.test.ts",
      "src/lib/__tests__/agent-work-ledger.test.ts",
      "src/components/agent-work/__tests__/AssessmentWorkLedgerPanel.test.tsx",
      "src/server/__tests__/runtimeConfigHandler.test.ts",
    ], childEnv);
    await runCommand("npm", ["run", "build"], childEnv);
    return;
  }
  throw new Error(`unknown_container_role_${role}`);
};

const safeFailureCode = (error) => {
  const message = error instanceof Error ? error.message : "";
  return /^(?:container|unknown_container_role)_[a-z0-9_]+$/.test(message)
    ? message
    : "container_check_failed";
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runContainerRole(process.argv[2] ?? "").then(() => {
    console.log(JSON.stringify({ success: true, role: process.argv[2] }));
  }).catch((error) => {
    console.error(safeFailureCode(error));
    process.exit(1);
  });
}
