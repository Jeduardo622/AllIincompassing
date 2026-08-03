import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import pg from "pg";

import {
  assertLocalPostgresUrl,
  assertLocalSupabaseHttpUrl,
  isPhase2ContainerMode,
} from "./agent-work-ledger-harness/localRuntime.mjs";

const { Client } = pg;

export const FIXED_SECRET_NAMES = Object.freeze([
  "agent_work_local_service_role_key",
  "agent_work_local_runner_invocation_secret",
  "agent_work_local_sweeper_invocation_secret",
]);

const FIXED_JOB_NAMES = Object.freeze([
  "agent-work-runner-local",
  "agent-work-sweeper-local",
]);
const START_TIMEOUT_MS = 30_000;
const CRON_TIMEOUT_MS = 90_000;

export const assertLoopbackUrl = (value, name, env) =>
  value.startsWith("postgres")
    ? assertLocalPostgresUrl(value, name, env)
    : assertLocalSupabaseHttpUrl(value, name, env);

export const getSmokeInvocationTargets = (env = process.env) =>
  isPhase2ContainerMode(env)
    ? {
        runner: "http://agent-work-runner:8000/agent-work-runner",
        sweeper: "http://agent-work-sweeper:8000/agent-work-sweeper",
      }
    : {
        runner: "http://127.0.0.1:8000/agent-work-runner",
        sweeper: "http://127.0.0.1:8001/agent-work-sweeper",
      };

export const getCronInvocationTargets = (env = process.env) =>
  isPhase2ContainerMode(env)
    ? {
        runner: "http://agent-work-runner:8000/agent-work-runner",
        sweeper: "http://agent-work-sweeper:8000/agent-work-sweeper",
      }
    : {
        runner: "http://host.docker.internal:8000/agent-work-runner",
        sweeper: "http://host.docker.internal:8001/agent-work-sweeper",
      };

export const classifySchedulerResponse = (statusCode, body) => {
  if (statusCode !== 200 || body?.success !== true || !body.data) return null;
  if (["no_work", "completed", "blocked", "retry_scheduled", "waiting"].includes(body.data.outcome)) return "runner";
  if (body.data.processedActionCount === 4) return "sweeper";
  return null;
};

const requiredEnvFrom = (env, name) => {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
};

const requiredEnv = (name) => requiredEnvFrom(process.env, name);

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const withContext = async (label, operation) => {
  try {
    return await operation();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}: ${detail}`);
  }
};

const connectLocalDatabase = async () => {
  const databaseUrl = requiredEnv("SUPABASE_DB_URL");
  assertLocalPostgresUrl(databaseUrl, "SUPABASE_DB_URL");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const { rows } = await client.query("select current_user");
  if (rows[0]?.current_user !== "postgres") {
    await client.end();
    throw new Error(`SUPABASE_DB_URL must connect as the local postgres owner (found ${rows[0]?.current_user ?? "unknown"}).`);
  }
  return client;
};

const upsertVaultSecret = async (client, name, value) => {
  const { rows } = await client.query(
    "select id from vault.secrets where name = $1::text",
    [name],
  );
  if (rows[0]?.id) {
    await client.query(
      "select vault.update_secret($1::uuid, $2::text, $3::text, $4::text)",
      [rows[0].id, value, name, "Local-only Agent Work Ledger scheduler secret"],
    );
    return;
  }
  await client.query(
    "select vault.create_secret($1::text, $2::text, $3::text)",
    [value, name, "Local-only Agent Work Ledger scheduler secret"],
  );
};

const replaceSchedulerTarget = async (client, jobName, expectedUrl, nextUrl) => {
  const { rowCount } = await client.query(
    `
      update cron.job
      set command = replace(command, $2::text, $3::text)
      where jobname = $1::text
        and position($2::text in command) > 0
    `,
    [jobName, expectedUrl, nextUrl],
  );
  assert(rowCount === 1, `Container scheduler target rewrite failed for ${jobName}.`);
};

export const rewriteSchedulerTargetsForContainer = async (client, env = process.env) => {
  if (!isPhase2ContainerMode(env)) return;
  const cronTargets = getCronInvocationTargets(env);
  await replaceSchedulerTarget(
    client,
    FIXED_JOB_NAMES[0],
    "http://host.docker.internal:8000/agent-work-runner",
    cronTargets.runner,
  );
  await replaceSchedulerTarget(
    client,
    FIXED_JOB_NAMES[1],
    "http://host.docker.internal:8001/agent-work-sweeper",
    cronTargets.sweeper,
  );
};

export const setupScheduler = async (client, secrets, env = process.env) => {
  await withContext("enable local scheduler extensions", async () => {
    await client.query("create extension if not exists pg_cron");
    await client.query("create extension if not exists pg_net with schema extensions");
    await client.query("create extension if not exists supabase_vault with schema vault");
  });

  await client.query("begin");
  try {
    await withContext("store fixed local scheduler secrets", async () => {
      await upsertVaultSecret(client, FIXED_SECRET_NAMES[0], secrets.serviceRoleKey);
      await upsertVaultSecret(client, FIXED_SECRET_NAMES[1], secrets.runnerSecret);
      await upsertVaultSecret(client, FIXED_SECRET_NAMES[2], secrets.sweeperSecret);
    });
    const { rows } = await withContext("create fixed local scheduler jobs", () =>
      client.query(
        "select public.enable_local_agent_work_queue_scheduler('* * * * *', 5000, 25) as result",
      ));
    await withContext("rewrite fixed local scheduler targets for phase2 containers", () =>
      rewriteSchedulerTargetsForContainer(client, env),
    );
    await client.query("commit");
    return rows[0]?.result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
};

const verifyScheduler = async (client, secrets) => {
  const cronTargets = getCronInvocationTargets();
  const { rows: jobs } = await client.query(
    `
      select jobname, schedule, command, active
      from cron.job
      where jobname = any($1::text[])
      order by jobname
    `,
    [FIXED_JOB_NAMES],
  );
  assert(jobs.length === 2, "Expected exactly two fixed local scheduler jobs.");
  const combinedCommands = jobs.map((job) => job.command).join("\n");
  assert(jobs.every((job) => job.schedule === "* * * * *" && job.active === true), "Local scheduler jobs are not active on the fixed schedule.");
  assert(combinedCommands.includes(cronTargets.runner), "Runner scheduler target drifted.");
  assert(combinedCommands.includes(cronTargets.sweeper), "Sweeper scheduler target drifted.");
  assert(combinedCommands.includes("x-agent-work-runner-secret"), "Runner invocation header is missing.");
  assert(combinedCommands.includes("x-agent-work-sweeper-secret"), "Sweeper invocation header is missing.");
  assert(!combinedCommands.includes(secrets.serviceRoleKey), "Scheduler command contains a plaintext service-role key.");
  assert(!combinedCommands.includes(secrets.runnerSecret), "Scheduler command contains a plaintext runner secret.");
  assert(!combinedCommands.includes(secrets.sweeperSecret), "Scheduler command contains a plaintext sweeper secret.");

  const { rows: secretRows } = await client.query(
    "select count(*)::integer as count from vault.secrets where name = any($1::text[])",
    [FIXED_SECRET_NAMES],
  );
  assert(secretRows[0]?.count === 3, "Fixed local scheduler secrets are incomplete.");
  return jobs.map(({ jobname, schedule, active }) => ({ jobname, schedule, active }));
};

export const teardownScheduler = async (client) => {
  const { rows } = await client.query(
    "select exists(select 1 from pg_extension where extname = 'pg_cron') as enabled",
  );
  if (rows[0]?.enabled) {
    await client.query("select public.disable_local_agent_work_queue_scheduler()");
  }
  await client.query(
    "delete from vault.secrets where name = any($1::text[])",
    [FIXED_SECRET_NAMES],
  );
};

const stopProcessTree = (child) => {
  if (!child || child.exitCode !== null || !child.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    return;
  }
  child.kill("SIGTERM");
};

const spawnFunction = (denoBin, entrypoint, port, secrets) => {
  const moduleUrl = pathToFileURL(resolve(entrypoint)).href;
  const wrapper = `import handler from ${JSON.stringify(moduleUrl)}; Deno.serve({ hostname: "127.0.0.1", port: ${port} }, handler);`;
  const child = spawn(
    denoBin,
    ["eval", wrapper],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        AGENT_WORK_LEDGER_RUNTIME_MODE: "advisory",
        AGENT_WORK_RUNNER_SECRET: secrets.runnerSecret,
        AGENT_WORK_SWEEPER_SECRET: secrets.sweeperSecret,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  const collect = (chunk) => {
    output = `${output}${chunk.toString("utf8")}`.slice(-4_000);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  return { child, getOutput: () => output };
};

export const waitForFunction = async (
  url,
  processState = null,
  {
    now = Date.now,
    fetchImpl = fetch,
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  } = {},
) => {
  const deadline = now() + START_TIMEOUT_MS;
  while (now() < deadline) {
    if (processState && processState.child.exitCode !== null) {
      throw new Error(`Local function exited before startup: ${processState.getOutput()}`);
    }
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(1_000),
      });
      if (response.status === 401) return;
    } catch {
      // Host Deno may briefly reset connections while loading npm modules.
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}.`);
};

export const waitForSchedulerFunctions = (
  targets,
  processStates,
  waitForFunctionImpl = waitForFunction,
) => Promise.all([
  waitForFunctionImpl(targets.runner, processStates.runner),
  waitForFunctionImpl(targets.sweeper, processStates.sweeper),
]);

export const buildSchedulerInvocationHeaders = (secrets, role) => {
  const runner = role === "runner";
  const sweeper = role === "sweeper";
  if (!runner && !sweeper) throw new Error("Unknown scheduler invocation role.");
  return {
    apikey: secrets.serviceRoleKey,
    authorization: `Bearer ${secrets.serviceRoleKey}`,
    "content-type": "application/json",
    [runner ? "x-agent-work-runner-secret" : "x-agent-work-sweeper-secret"]:
      runner ? secrets.runnerSecret : secrets.sweeperSecret,
  };
};

const invokeHostFunction = async (url, secrets, role, body) => {
  const response = await fetch(url, {
    method: "POST",
    headers: buildSchedulerInvocationHeaders(secrets, role),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // A non-JSON response is always a failed local function contract.
  }
  if (response.status !== 200 || payload?.success !== true) {
    throw new Error(`Direct local function invocation failed (${response.status}/${payload?.code ?? payload?.error ?? "invalid_response"}).`);
  }
  return {
    statusCode: response.status,
    outcome: payload.data?.outcome ?? null,
    processedActionCount: payload.data?.processedActionCount ?? null,
  };
};

const waitForCronEvidence = async (client, baselineResponseId, startedAt) => {
  const deadline = Date.now() + CRON_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { rows } = await client.query(
      `
        select id::text, status_code, content, timed_out, error_msg
        from net._http_response
        where id > $1::bigint and created >= $2::timestamptz
        order by id
      `,
      [baselineResponseId, startedAt],
    );
    const parsed = rows.map((row) => {
      try {
        return { ...row, body: JSON.parse(row.content ?? "null") };
      } catch {
        return { ...row, body: null };
      }
    });
    const runner = parsed.find((row) => classifySchedulerResponse(row.status_code, row.body) === "runner");
    const sweeper = parsed.find((row) => classifySchedulerResponse(row.status_code, row.body) === "sweeper");
    if (runner && sweeper) {
      return { responseIds: [runner.id, sweeper.id], statusCodes: [runner.status_code, sweeper.status_code] };
    }
    const failure = parsed.find((row) => row.timed_out || row.error_msg || (row.status_code && row.status_code >= 400));
    if (failure) {
      throw new Error(`Local scheduler HTTP invocation failed (${failure.status_code ?? "no-status"}/${failure.error_msg ?? "no-error"}).`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Timed out waiting for both local cron invocation responses.");
};

export const resolveSchedulerSmokeSecrets = ({
  env = process.env,
  randomBytesImpl = randomBytes,
} = {}) => {
  const containerMode = isPhase2ContainerMode(env);
  return {
    serviceRoleKey: requiredEnvFrom(env, "SUPABASE_SERVICE_ROLE_KEY"),
    runnerSecret: containerMode
      ? requiredEnvFrom(env, "AGENT_WORK_RUNNER_SECRET")
      : randomBytesImpl(32).toString("hex"),
    sweeperSecret: containerMode
      ? requiredEnvFrom(env, "AGENT_WORK_SWEEPER_SECRET")
      : randomBytesImpl(32).toString("hex"),
  };
};

const loadCommandSecrets = () => ({
  serviceRoleKey: requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  runnerSecret: requiredEnv("AGENT_WORK_RUNNER_SECRET"),
  sweeperSecret: requiredEnv("AGENT_WORK_SWEEPER_SECRET"),
});

const runSmoke = async () => {
  const supabaseUrl = requiredEnv("SUPABASE_URL");
  assertLocalSupabaseHttpUrl(supabaseUrl, "SUPABASE_URL");
  const denoBin = process.env.DENO_BIN?.trim() || "deno";
  const secrets = resolveSchedulerSmokeSecrets();
  const smokeTargets = getSmokeInvocationTargets();
  const client = await connectLocalDatabase();
  const runner = isPhase2ContainerMode()
    ? null
    : spawnFunction(denoBin, "supabase/functions/agent-work-runner/index.ts", 8000, secrets);
  const sweeper = isPhase2ContainerMode()
    ? null
    : spawnFunction(denoBin, "supabase/functions/agent-work-sweeper/index.ts", 8001, secrets);
  let failure;
  try {
    await waitForSchedulerFunctions(smokeTargets, { runner, sweeper });
    const runnerDirectEvidence = [];
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const result = await invokeHostFunction(
        smokeTargets.runner,
        secrets,
        "runner",
        { source: "local_scheduler_smoke" },
      );
      runnerDirectEvidence.push(result);
      if (result.outcome === "completed" || result.outcome === "no_work") break;
    }
    assert(
      runnerDirectEvidence.some((result) => result.outcome === "completed" || result.outcome === "no_work"),
      "Runner did not reach a completed effect or empty queue within the local smoke bound.",
    );
    const sweeperDirectEvidence = await invokeHostFunction(
      smokeTargets.sweeper,
      secrets,
      "sweeper",
      { source: "local_scheduler_smoke", maxItemsPerPass: 25 },
    );
    const directEvidence = { runner: runnerDirectEvidence, sweeper: sweeperDirectEvidence };
    const { rows: baselineRows } = await client.query(
      "select coalesce(max(id), 0)::text as id from net._http_response",
    );
    const startedAt = new Date().toISOString();
    const setup = await setupScheduler(client, secrets);
    const jobs = await verifyScheduler(client, secrets);
    const evidence = await waitForCronEvidence(client, baselineRows[0]?.id ?? "0", startedAt);
    console.log(JSON.stringify({ success: true, directEvidence, setup, jobs, evidence }));
  } catch (error) {
    failure = error;
  }
  try {
    await teardownScheduler(client);
  } catch (error) {
    if (!failure) failure = error;
  } finally {
    await client.end();
    if (runner) stopProcessTree(runner.child);
    if (sweeper) stopProcessTree(sweeper.child);
  }
  if (failure) throw failure;
};

const runCommand = async () => {
  const command = process.argv[2];
  if (command === "smoke") {
    await runSmoke();
    return;
  }
  if (!["setup", "verify", "teardown"].includes(command)) {
    throw new Error("Usage: node scripts/agent-work-ledger-local-scheduler.mjs <setup|verify|teardown|smoke>");
  }
  assertLocalSupabaseHttpUrl(requiredEnv("SUPABASE_URL"), "SUPABASE_URL");
  const client = await connectLocalDatabase();
  try {
    if (command === "teardown") {
      await teardownScheduler(client);
      console.log(JSON.stringify({ success: true, jobsRemoved: FIXED_JOB_NAMES.length, secretsRemoved: FIXED_SECRET_NAMES.length }));
      return;
    }
    const secrets = loadCommandSecrets();
    if (command === "setup") {
      const setup = await setupScheduler(client, secrets);
      console.log(JSON.stringify({ success: true, setup, jobs: await verifyScheduler(client, secrets) }));
      return;
    }
    console.log(JSON.stringify({ success: true, jobs: await verifyScheduler(client, secrets) }));
  } finally {
    await client.end();
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCommand().catch((error) => {
    console.error("Local Agent Work Ledger scheduler command failed.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
