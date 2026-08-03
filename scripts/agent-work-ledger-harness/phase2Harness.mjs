import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

export const PHASE2_COMMAND = "test:agent-work:phase2";
export const PHASE2_IMAGE = "agent-work-ledger-phase2:local";
export const PHASE2_REPORT_ROOT = ".reports/agent-work-ledger-phase2";
export const PHASE2_NETWORK = "agent-work-phase2";
export const PHASE2_PROJECT_ID = "AllIincompassing";
export const PHASE2_COMPOSE_PROJECT = "agent-work-ledger-phase2";
export const PHASE2_COMPOSE_FILE = path.join(
  "docker",
  "agent-work-ledger",
  "docker-compose.phase2.yml",
);
export const PHASE2_DOCKERFILE = path.join(
  "docker",
  "agent-work-ledger",
  "Dockerfile",
);
export const PHASE2_HEAD_GUARD_PATHS = Object.freeze([
  "package.json",
  "package-lock.json",
  ".dockerignore",
  "docker/agent-work-ledger",
  "scripts/agent-work-ledger-harness",
  ":(glob)scripts/agent-work-ledger-*.mjs",
  "supabase/config.toml",
  "supabase/migrations",
  "supabase/functions/agent-work-items",
  "supabase/functions/agent-work-runner",
  "supabase/functions/agent-work-sweeper",
  ":(glob)tests/agentWorkLedger*.test.ts",
  ":(glob)tests/agentTrace*.test.ts",
]);

export const HARD_TIMEOUT_BUDGETS_MS = Object.freeze({
  preflight: 30_000,
  archive: 30_000,
  dockerBuild: 300_000,
  supabaseStart: 180_000,
  supabaseReset: 180_000,
  composeUp: 180_000,
  check: 180_000,
  cleanupAudit: 120_000,
  composeDown: 120_000,
  supabaseStop: 120_000,
  residueCheck: 30_000,
});

const customCheckCommand = (role) => [
  "node",
  "scripts/agent-work-ledger-harness/containerEntrypoint.mjs",
  role,
];

const PHASE2_CHECK_DEFINITIONS = Object.freeze([
  {
    id: "stack-health",
    destructive: false,
    command: customCheckCommand("stack-health"),
  },
  {
    id: "schema-seed",
    destructive: true,
    command: customCheckCommand("schema-seed"),
  },
  {
    id: "tenant-security",
    destructive: true,
    command: ["node", "scripts/agent-work-ledger-security-contract.mjs"],
    proves: ["step_item_org_client_parity", "queued_payload_org_parity"],
  },
  {
    id: "items-smoke",
    destructive: true,
    command: ["node", "scripts/agent-work-ledger-edge-smoke.mjs"],
  },
  {
    id: "queue-scheduler",
    destructive: true,
    command: ["node", "scripts/agent-work-ledger-local-scheduler.mjs", "smoke"],
    auth: {
      bearer: "service-role",
      invocationSecrets: [
        "x-agent-work-runner-secret",
        "x-agent-work-sweeper-secret",
      ],
    },
  },
  {
    id: "chaos",
    destructive: true,
    command: ["node", "scripts/agent-work-ledger-chaos.mjs"],
  },
  {
    id: "shadow-parity",
    destructive: true,
    command: ["node", "scripts/agent-work-ledger-shadow-parity.mjs"],
  },
  {
    id: "retention-trace",
    destructive: true,
    command: customCheckCommand("retention-trace"),
  },
  {
    id: "app-api-unit-build",
    destructive: false,
    command: customCheckCommand("app-api-unit-build"),
  },
  {
    id: "deno-cached-tests",
    destructive: false,
    command: [
      "deno",
      "test",
      "--cached-only",
      "--frozen",
      "--lock=/opt/agent-work-ledger-deno.lock",
      "supabase/functions/agent-work-items/index.test.ts",
      "supabase/functions/agent-work-runner/index.test.ts",
      "supabase/functions/agent-work-runner/chaos.test.ts",
      "supabase/functions/agent-work-sweeper/index.test.ts",
    ],
  },
  {
    id: "cleanup-audit",
    destructive: false,
    command: [
      "node",
      "scripts/agent-work-ledger-harness/cleanupAudit.mjs",
    ],
  },
]);

export const PHASE2_CHECKS = Object.freeze(
  PHASE2_CHECK_DEFINITIONS.map(({ auth, proves, ...check }) => check),
);

const PHASE2_CHECK_ENVIRONMENT_NAMES = Object.freeze({
  "stack-health": ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
  "schema-seed": ["SUPABASE_DB_URL"],
  "tenant-security": ["SUPABASE_DB_URL"],
  "items-smoke": [
    "AGENT_WORK_ITEMS_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_DB_URL",
    "SUPABASE_URL",
  ],
  "queue-scheduler": [
    "AGENT_WORK_RUNNER_SECRET",
    "AGENT_WORK_SWEEPER_SECRET",
    "SUPABASE_DB_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_URL",
  ],
  chaos: [],
  "shadow-parity": [
    "AGENT_WORK_PHASE2_PROJECT_ID",
    "SUPABASE_DB_URL",
    "SUPABASE_URL",
  ],
  "retention-trace": ["SUPABASE_DB_URL"],
  "app-api-unit-build": [
    "SUPABASE_ANON_KEY",
    "SUPABASE_URL",
    "VITE_SUPABASE_ANON_KEY",
    "VITE_SUPABASE_EDGE_URL",
    "VITE_SUPABASE_URL",
  ],
  "deno-cached-tests": [],
  "cleanup-audit": ["SUPABASE_DB_URL"],
});

const assert = (condition, reasonCode) => {
  if (!condition) throw new Error(reasonCode);
};

export const getCheckDefinition = (id) => {
  const check = PHASE2_CHECK_DEFINITIONS.find((entry) => entry.id === id);
  assert(check, `unknown_phase2_check_${id}`);
  return check;
};

export const getCheckEnvironmentNames = (id) => {
  getCheckDefinition(id);
  return [...PHASE2_CHECK_ENVIRONMENT_NAMES[id]];
};

const LOCAL_ONLY_URL_KEYS = Object.freeze([
  "SUPABASE_URL",
  "SUPABASE_DB_URL",
  "SUPABASE_EDGE_URL",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_EDGE_URL",
  "AGENT_WORK_ITEMS_URL",
  "AGENT_WORK_RUNNER_URL",
  "AGENT_WORK_SWEEPER_URL",
]);

const FORBIDDEN_REF_KEYS = Object.freeze([
  "SUPABASE_PROJECT_REF",
  "VITE_SUPABASE_PROJECT_REF",
]);

const FORBIDDEN_CREDENTIAL_KEYS = Object.freeze([
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_ANON_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_DB_PASSWORD",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "NETLIFY_AUTH_TOKEN",
  "NETLIFY_SITE_ID",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "MISTRAL_API_KEY",
  "XAI_API_KEY",
  "PERPLEXITY_API_KEY",
  "DOCKER_HOST",
]);

const ALLOWLISTED_HOST_KEYS = Object.freeze([
  "PATH",
  "SystemRoot",
  "COMSPEC",
]);

const DEFAULT_CHILD_ENV = Object.freeze({
  AGENT_WORK_PHASE2_CONTAINER: "1",
  AGENT_WORK_PHASE2_IMAGE: PHASE2_IMAGE,
  COMPOSE_DISABLE_ENV_FILE: "1",
  COMPOSE_PROJECT_NAME: PHASE2_COMPOSE_PROJECT,
});

const CLEANUP_FALLBACK_RUNTIME_ENV = Object.freeze({
  PHASE2_CONTAINER_SUPABASE_URL:
    "http://supabase_kong_AllIincompassing:8000",
  PHASE2_CONTAINER_SUPABASE_DB_URL:
    "postgresql://postgres:postgres@supabase_db_AllIincompassing:5432/postgres",
  PHASE2_SUPABASE_ANON_KEY: "cleanup-unused",
  PHASE2_SUPABASE_SERVICE_ROLE_KEY: "cleanup-unused",
  PHASE2_RUNNER_SECRET: "cleanup-unused",
  PHASE2_SWEEPER_SECRET: "cleanup-unused",
});

const parseUrl = (value, reasonCode) => {
  try {
    return new URL(value);
  } catch {
    throw new Error(reasonCode);
  }
};

const isLoopback = (hostname) =>
  hostname === "127.0.0.1" || hostname === "localhost";

const assertHostLocalUrl = (value, key) => {
  const parsed = parseUrl(value, `${key}_must_remain_local_only`);
  if (!isLoopback(parsed.hostname)) {
    throw new Error(`${key} must remain local-only for the Phase 2 harness.`);
  }
};

export const validatePhase2HostEnv = (env = process.env) => {
  for (const key of LOCAL_ONLY_URL_KEYS) {
    const value = env[key]?.trim();
    if (value) assertHostLocalUrl(value, key);
  }
  for (const key of FORBIDDEN_REF_KEYS) {
    if (env[key]?.trim()) {
      throw new Error(`${key} must be empty; hosted project ref is not allowed.`);
    }
  }
  for (const key of FORBIDDEN_CREDENTIAL_KEYS) {
    if (env[key]?.trim()) {
      throw new Error(`${key} must be empty; remote-capable credential is not allowed.`);
    }
  }
};

export const buildPhase2ChildEnv = (env = process.env) => {
  validatePhase2HostEnv(env);
  const childEnv = {};
  for (const key of ALLOWLISTED_HOST_KEYS) {
    if (env[key]) childEnv[key] = env[key];
  }
  return { ...childEnv, ...DEFAULT_CHILD_ENV };
};

export const parseSupabaseStatusEnv = (output) => {
  const values = {};
  for (const rawLine of String(output).split(/\r?\n/)) {
    const line = rawLine.trim();
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    values[key] = rawValue.replace(/^(["'])(.*)\1$/, "$2");
  }
  return values;
};

export const derivePhase2RuntimeEnv = (status, {
  runnerSecret,
  sweeperSecret,
}) => {
  const apiUrl = parseUrl(status.API_URL ?? "", "status_api_url_invalid");
  if (apiUrl.protocol !== "http:" || !isLoopback(apiUrl.hostname)) {
    throw new Error("status_api_url_not_loopback");
  }
  const databaseUrl = parseUrl(status.DB_URL ?? "", "status_db_url_invalid");
  if (
    !new Set(["postgres:", "postgresql:"]).has(databaseUrl.protocol) ||
    !isLoopback(databaseUrl.hostname) ||
    databaseUrl.username !== "postgres"
  ) {
    throw new Error("status_db_url_not_loopback");
  }
  if (!status.ANON_KEY?.trim() || !status.SERVICE_ROLE_KEY?.trim()) {
    throw new Error("status_local_keys_missing");
  }
  if (!runnerSecret || !sweeperSecret) {
    throw new Error("phase2_invocation_secrets_missing");
  }

  return {
    PHASE2_CONTAINER_SUPABASE_URL:
      "http://supabase_kong_AllIincompassing:8000",
    PHASE2_CONTAINER_SUPABASE_DB_URL:
      "postgresql://postgres:postgres@supabase_db_AllIincompassing:5432/postgres",
    PHASE2_SUPABASE_ANON_KEY: status.ANON_KEY,
    PHASE2_SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
    PHASE2_RUNNER_SECRET: runnerSecret,
    PHASE2_SWEEPER_SECRET: sweeperSecret,
  };
};

const buildCheckExecutionEnv = (id, composeEnv, runtimeEnv) => {
  const values = {
    AGENT_WORK_ITEMS_URL:
      "http://agent-work-items:8000/agent-work-items",
    AGENT_WORK_PHASE2_PROJECT_ID: PHASE2_PROJECT_ID,
    AGENT_WORK_RUNNER_SECRET: runtimeEnv.PHASE2_RUNNER_SECRET,
    AGENT_WORK_SWEEPER_SECRET: runtimeEnv.PHASE2_SWEEPER_SECRET,
    SUPABASE_ANON_KEY: runtimeEnv.PHASE2_SUPABASE_ANON_KEY,
    SUPABASE_DB_URL: runtimeEnv.PHASE2_CONTAINER_SUPABASE_DB_URL,
    SUPABASE_SERVICE_ROLE_KEY: runtimeEnv.PHASE2_SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_URL: runtimeEnv.PHASE2_CONTAINER_SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: runtimeEnv.PHASE2_SUPABASE_ANON_KEY,
    VITE_SUPABASE_EDGE_URL: runtimeEnv.PHASE2_CONTAINER_SUPABASE_URL,
    VITE_SUPABASE_URL: runtimeEnv.PHASE2_CONTAINER_SUPABASE_URL,
  };
  const checkEnv = { ...composeEnv };
  for (const name of getCheckEnvironmentNames(id)) {
    assert(typeof values[name] === "string" && values[name].length > 0,
      `check_${id}_environment_missing`);
    checkEnv[name] = values[name];
  }
  return checkEnv;
};

const checkEnvironmentArgs = (id) =>
  getCheckEnvironmentNames(id).flatMap((name) => ["-e", name]);

export const createArchivePlan = () => ({
  strategy: "git-archive-head",
  ref: "HEAD",
  archiveFileName: "repo.tar",
});

export const createRunArtifacts = ({ projectRoot, runId }) => {
  const reportDir = path.join(projectRoot, PHASE2_REPORT_ROOT, runId);
  const normalize = (value) => value.replaceAll("\\", "/");
  return {
    reportDir: normalize(reportDir),
    manifestPath: normalize(path.join(reportDir, "manifest.json")),
    summaryLogPath: normalize(path.join(reportDir, "summary.log")),
  };
};

const timestampRunId = (now) => {
  const iso = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${iso}-${randomBytes(3).toString("hex")}`;
};

const sha256 = (value) =>
  createHash("sha256").update(value, "utf8").digest("hex");

export const sanitizeCommandEvidence = ({ code, stdout, stderr }) =>
  [
    `exit_code=${Number.isInteger(code) ? code : 1}`,
    `stdout=${String(stdout ?? "").length > 0 ? "present" : "empty"}`,
    `stderr=${String(stderr ?? "").length > 0 ? "present" : "empty"}`,
  ].join(";");

class HarnessCommandError extends Error {
  constructor(reasonCode, result = { code: 1, stdout: "", stderr: "" }) {
    super(reasonCode);
    this.reasonCode = reasonCode;
    this.result = result;
  }
}

const boundedAppend = (current, chunk) =>
  `${current}${chunk.toString("utf8")}`.slice(-65_536);

const spawnWithTimeout = (command, args, { cwd, env, timeoutMs, signal }) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error
        ? signal.reason
        : new Error("phase2_signal_aborted"));
      return;
    }
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (operation, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      operation(value);
    };
    const onAbort = () => {
      child.kill("SIGTERM");
      finish(
        reject,
        signal.reason instanceof Error
          ? signal.reason
          : new Error("phase2_signal_aborted"),
      );
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(reject, new Error("phase2_command_timeout"));
    }, timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk) => {
      stdout = boundedAppend(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = boundedAppend(stderr, chunk);
    });
    child.on("error", () => {
      finish(reject, new Error("phase2_command_spawn_failed"));
    });
    child.on("close", (code) => {
      finish(resolve, { code: code ?? 1, stdout, stderr });
    });
  });

const executeChecked = async (
  execute,
  command,
  args,
  options,
  reasonCode,
) => {
  let result;
  try {
    result = await execute(command, args, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const timedOut = message === "phase2_command_timeout";
    const interrupted = /^phase2_signal_(?:sigint|sigterm|aborted)$/.test(message);
    throw new HarnessCommandError(
      interrupted ? message : timedOut ? `${reasonCode}_timeout` : reasonCode,
    );
  }
  if (result.code !== 0) throw new HarnessCommandError(reasonCode, result);
  return result;
};

const defaultPrepareArchiveContext = async ({ cwd, env, execute }) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "agent-work-phase2-"));
  const archivePlan = createArchivePlan();
  const archivePath = path.join(tempRoot, archivePlan.archiveFileName);
  const contextDir = path.join(tempRoot, "context");
  await mkdir(contextDir, { recursive: true });
  await executeChecked(
    execute,
    "git",
    ["archive", "--format=tar", archivePlan.ref, "-o", archivePath],
    { cwd, env, timeoutMs: HARD_TIMEOUT_BUDGETS_MS.archive },
    "git_archive_failed",
  );
  await executeChecked(
    execute,
    "tar",
    ["-xf", archivePath, "-C", contextDir],
    { cwd, env, timeoutMs: HARD_TIMEOUT_BUDGETS_MS.archive },
    "git_archive_extract_failed",
  );
  return { tempRoot, contextDir };
};

const composePrefix = () => [
  "-p",
  PHASE2_COMPOSE_PROJECT,
  "-f",
  PHASE2_COMPOSE_FILE,
];

const assertRelevantFilesMatchHead = async ({ cwd, env, execute }) => {
  const status = await executeChecked(
    execute,
    "git",
    [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--",
      ...PHASE2_HEAD_GUARD_PATHS,
    ],
    { cwd, env, timeoutMs: HARD_TIMEOUT_BUDGETS_MS.preflight },
    "git_relevant_status_failed",
  );
  assert(!status.stdout.trim(), "relevant_files_differ_from_head");
};

const assertNoComposeResidue = async ({
  cwd,
  env,
  execute,
  reasonPrefix = "compose",
}) => {
  const containers = await executeChecked(
    execute,
    "docker",
    [
      "ps",
      "-aq",
      "--filter",
      `label=com.docker.compose.project=${PHASE2_COMPOSE_PROJECT}`,
    ],
    { cwd, env, timeoutMs: HARD_TIMEOUT_BUDGETS_MS.residueCheck },
    `${reasonPrefix}_container_residue_check_failed`,
  );
  if (containers.stdout.trim()) {
    throw new Error(`${reasonPrefix}_container_residue_found`);
  }
  const volumes = await executeChecked(
    execute,
    "docker",
    [
      "volume",
      "ls",
      "-q",
      "--filter",
      `label=com.docker.compose.project=${PHASE2_COMPOSE_PROJECT}`,
    ],
    { cwd, env, timeoutMs: HARD_TIMEOUT_BUDGETS_MS.residueCheck },
    `${reasonPrefix}_volume_residue_check_failed`,
  );
  if (volumes.stdout.trim()) {
    throw new Error(`${reasonPrefix}_volume_residue_found`);
  }
};

const stopSupabaseAndAssertNoResidue = async ({
  cwd,
  env,
  execute,
  reasonPrefix,
}) => {
  const stopArgs = [
    "stop",
    "--project-id",
    PHASE2_PROJECT_ID,
    "--no-backup",
    "--yes",
  ];
  const projectLabel = `label=com.supabase.cli.project=${PHASE2_PROJECT_ID}`;

  const inspectResidue = async () => {
    const containers = await executeChecked(
      execute,
      "docker",
      ["ps", "-aq", "--filter", projectLabel],
      { cwd, env, timeoutMs: HARD_TIMEOUT_BUDGETS_MS.residueCheck },
      `${reasonPrefix}_container_residue_check_failed`,
    );
    const volumes = await executeChecked(
      execute,
      "docker",
      ["volume", "ls", "-q", "--filter", projectLabel],
      { cwd, env, timeoutMs: HARD_TIMEOUT_BUDGETS_MS.residueCheck },
      `${reasonPrefix}_volume_residue_check_failed`,
    );
    return {
      containers: containers.stdout.trim(),
      volumes: volumes.stdout.trim(),
    };
  };

  // The CLI can return before restart-policy containers have fully exited.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await executeChecked(
      execute,
      "supabase",
      stopArgs,
      { cwd, env, timeoutMs: HARD_TIMEOUT_BUDGETS_MS.supabaseStop },
      `${reasonPrefix}_stop_failed`,
    );
    const residue = await inspectResidue();
    if (!residue.containers && !residue.volumes) return;
    if (attempt === 1) {
      if (residue.containers) {
        throw new Error(`${reasonPrefix}_container_residue_found`);
      }
      throw new Error(`${reasonPrefix}_volume_residue_found`);
    }
  }
};

const checkDuration = (startedAt, endedAt) =>
  Math.max(0, endedAt.getTime() - startedAt.getTime());

const resultHash = (result) => sha256(sanitizeCommandEvidence(result));

const reasonFrom = (error, fallback) =>
  error instanceof HarnessCommandError
    ? error.reasonCode
    : error instanceof Error && /^[a-z0-9_]+$/.test(error.message)
    ? error.message
    : fallback;

const writeArtifacts = async ({ artifacts, manifest, summaryLines }) => {
  await mkdir(artifacts.reportDir, { recursive: true });
  const summaryText = `${summaryLines.join("\n")}\n`;
  manifest.artifacts = {
    summaryLogSha256: sha256(summaryText),
    checkEvidenceSha256: sha256(JSON.stringify(
      manifest.checks.map(({ id, status, sanitizedOutputSha256 }) => ({
        id,
        status,
        sanitizedOutputSha256,
      })),
    )),
  };
  await writeFile(artifacts.summaryLogPath, summaryText, "utf8");
  await writeFile(
    artifacts.manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
};

export const runPhase2Harness = async ({
  cwd = process.cwd(),
  env = process.env,
  signal,
  runId: requestedRunId,
  dependencies = {},
} = {}) => {
  validatePhase2HostEnv(env);
  const childEnv = buildPhase2ChildEnv(env);
  const baseExecute = dependencies.execute ?? spawnWithTimeout;
  let cleanupStarted = false;
  const execute = (command, args, options) => baseExecute(command, args, {
    ...options,
    ...(!cleanupStarted && signal ? { signal } : {}),
  });
  const now = dependencies.now ?? (() => new Date());
  const prepareArchiveContext = dependencies.prepareArchiveContext ??
    defaultPrepareArchiveContext;
  const startedAt = now();
  const runId = requestedRunId ?? timestampRunId(startedAt);
  const artifacts = createRunArtifacts({ projectRoot: cwd, runId });
  const summaryLines = [
    `phase2 run started ${startedAt.toISOString()}`,
  ];
  const manifest = {
    schemaVersion: 1,
    commitSha: null,
    imageId: null,
    command: "npm run test:agent-work:phase2",
    startedAtUtc: startedAt.toISOString(),
    checks: [],
    cleanup: { status: "pending" },
    exitStatus: "failed",
    exitCode: 1,
  };

  let archiveContext = null;
  let runtimeEnv = null;
  let composeAttempted = false;
  let cleanupAuditPassed = false;
  let mainFailure = null;

  try {
    await executeChecked(
      execute,
      "docker",
      ["version", "--format", "{{.Server.Version}}"],
      { cwd, env: childEnv, timeoutMs: HARD_TIMEOUT_BUDGETS_MS.preflight },
      "docker_preflight_failed",
    );
    await executeChecked(
      execute,
      "supabase",
      ["--version"],
      { cwd, env: childEnv, timeoutMs: HARD_TIMEOUT_BUDGETS_MS.preflight },
      "supabase_preflight_failed",
    );
    const headResult = await executeChecked(
      execute,
      "git",
      ["rev-parse", "HEAD"],
      { cwd, env: childEnv, timeoutMs: HARD_TIMEOUT_BUDGETS_MS.preflight },
      "git_head_failed",
    );
    const commitSha = headResult.stdout.trim();
    assert(/^[a-f0-9]{40}$/i.test(commitSha), "git_head_invalid");
    manifest.commitSha = commitSha;
    await assertRelevantFilesMatchHead({ cwd, env: childEnv, execute });

    archiveContext = await prepareArchiveContext({ cwd, env: childEnv, execute });
    await executeChecked(
      execute,
      "docker",
      [
        "build",
        "-f",
        path.join(archiveContext.contextDir, PHASE2_DOCKERFILE),
        "-t",
        PHASE2_IMAGE,
        archiveContext.contextDir,
      ],
      { cwd, env: childEnv, timeoutMs: HARD_TIMEOUT_BUDGETS_MS.dockerBuild },
      "docker_build_failed",
    );
    const imageResult = await executeChecked(
      execute,
      "docker",
      ["image", "inspect", "--format", "{{.Id}}", PHASE2_IMAGE],
      { cwd, env: childEnv, timeoutMs: HARD_TIMEOUT_BUDGETS_MS.preflight },
      "docker_image_inspect_failed",
    );
    const imageId = imageResult.stdout.trim();
    assert(/^sha256:[a-f0-9]{64}$/i.test(imageId), "docker_image_id_invalid");
    manifest.imageId = imageId;

    const preflightComposeEnv = {
      ...childEnv,
      ...CLEANUP_FALLBACK_RUNTIME_ENV,
    };
    composeAttempted = true;
    await executeChecked(
      execute,
      "docker-compose",
      [
        ...composePrefix(),
        "down",
        "--volumes",
        "--remove-orphans",
      ],
      {
        cwd,
        env: preflightComposeEnv,
        timeoutMs: HARD_TIMEOUT_BUDGETS_MS.composeDown,
      },
      "compose_preflight_down_failed",
    );
    await assertNoComposeResidue({
      cwd,
      env: childEnv,
      execute,
      reasonPrefix: "compose_preflight",
    });

    await stopSupabaseAndAssertNoResidue({
      cwd,
      env: childEnv,
      execute,
      reasonPrefix: "supabase_initial",
    });
    await executeChecked(
      execute,
      "docker",
      ["network", "create", PHASE2_NETWORK],
      { cwd, env: childEnv, timeoutMs: HARD_TIMEOUT_BUDGETS_MS.preflight },
      "network_create_failed",
    );
    await executeChecked(
      execute,
      "supabase",
      ["start", "--network-id", PHASE2_NETWORK, "--yes"],
      { cwd, env: childEnv, timeoutMs: HARD_TIMEOUT_BUDGETS_MS.supabaseStart },
      "supabase_start_failed",
    );
    const statusResult = await executeChecked(
      execute,
      "supabase",
      ["status", "-o", "env"],
      { cwd, env: childEnv, timeoutMs: HARD_TIMEOUT_BUDGETS_MS.preflight },
      "supabase_status_failed",
    );
    runtimeEnv = derivePhase2RuntimeEnv(
      parseSupabaseStatusEnv(statusResult.stdout),
      {
        runnerSecret: randomBytes(32).toString("hex"),
        sweeperSecret: randomBytes(32).toString("hex"),
      },
    );
    const composeEnv = { ...childEnv, ...runtimeEnv };
    await executeChecked(
      execute,
      "docker-compose",
      [
        ...composePrefix(),
        "up",
        "-d",
        "--wait",
        "--wait-timeout",
        String(Math.floor(HARD_TIMEOUT_BUDGETS_MS.composeUp / 1000)),
        "agent-work-app",
        "agent-work-items",
        "agent-work-runner",
        "agent-work-sweeper",
      ],
      { cwd, env: composeEnv, timeoutMs: HARD_TIMEOUT_BUDGETS_MS.composeUp },
      "compose_up_failed",
    );

    for (const check of PHASE2_CHECKS) {
      const definition = getCheckDefinition(check.id);
      const checkStarted = now();
      let result = { code: 1, stdout: "", stderr: "" };
      try {
        if (check.destructive) {
          await executeChecked(
            execute,
            "supabase",
            [
              "db",
              "reset",
              "--local",
              "--network-id",
              PHASE2_NETWORK,
              "--yes",
            ],
            {
              cwd,
              env: childEnv,
              timeoutMs: HARD_TIMEOUT_BUDGETS_MS.supabaseReset,
            },
            `reset_${check.id}_failed`,
          );
        }
        const reasonCode = check.id === "cleanup-audit"
          ? "cleanup_audit_failed"
          : `check_${check.id}_failed`;
        result = await executeChecked(
          execute,
          "docker-compose",
          [
            ...composePrefix(),
            "run",
            "--rm",
            ...checkEnvironmentArgs(check.id),
            "agent-work-harness",
            ...definition.command,
          ],
          {
            cwd,
            env: buildCheckExecutionEnv(check.id, composeEnv, runtimeEnv),
            timeoutMs: check.id === "cleanup-audit"
              ? HARD_TIMEOUT_BUDGETS_MS.cleanupAudit
              : HARD_TIMEOUT_BUDGETS_MS.check,
          },
          reasonCode,
        );
        const checkEnded = now();
        manifest.checks.push({
          id: check.id,
          status: "passed",
          startedAtUtc: checkStarted.toISOString(),
          endedAtUtc: checkEnded.toISOString(),
          durationMs: checkDuration(checkStarted, checkEnded),
          sanitizedOutputSha256: resultHash(result),
        });
        summaryLines.push(`${check.id}: passed`);
        if (check.id === "cleanup-audit") cleanupAuditPassed = true;
      } catch (error) {
        if (error instanceof HarnessCommandError) result = error.result;
        const checkEnded = now();
        manifest.checks.push({
          id: check.id,
          status: "failed",
          startedAtUtc: checkStarted.toISOString(),
          endedAtUtc: checkEnded.toISOString(),
          durationMs: checkDuration(checkStarted, checkEnded),
          sanitizedOutputSha256: resultHash(result),
        });
        summaryLines.push(`${check.id}: failed`);
        throw error;
      }
    }
  } catch (error) {
    mainFailure = reasonFrom(error, "phase2_harness_failed");
    summaryLines.push(`failure: ${mainFailure}`);
  } finally {
    cleanupStarted = true;
    const cleanupFailures = [];
    const cleanup = {
      status: "pending",
      databaseAudit: cleanupAuditPassed ? "passed" : "pending",
      composeDown: "pending",
      supabaseStop: "pending",
      composeResidue: "pending",
      networkResidue: "pending",
      archiveContext: "pending",
    };
    const attempt = async (field, reasonCode, operation) => {
      try {
        await operation();
        cleanup[field] = "passed";
      } catch (error) {
        const reason = reasonFrom(error, reasonCode);
        cleanup[field] = "failed";
        cleanupFailures.push(reason);
      }
    };

    if (!cleanupAuditPassed) {
      await attempt("databaseAudit", "cleanup_audit_failed", async () => {
        const cleanupRuntimeEnv = runtimeEnv ?? CLEANUP_FALLBACK_RUNTIME_ENV;
        const cleanupComposeEnv = { ...childEnv, ...cleanupRuntimeEnv };
        await executeChecked(
          execute,
          "docker-compose",
          [
            ...composePrefix(),
            "run",
            "--rm",
            ...checkEnvironmentArgs("cleanup-audit"),
            "agent-work-harness",
            "node",
            "scripts/agent-work-ledger-harness/cleanupAudit.mjs",
          ],
          {
            cwd,
            env: buildCheckExecutionEnv(
              "cleanup-audit",
              cleanupComposeEnv,
              cleanupRuntimeEnv,
            ),
            timeoutMs: HARD_TIMEOUT_BUDGETS_MS.cleanupAudit,
          },
          "cleanup_audit_failed",
        );
      });
    }

    if (composeAttempted) {
      await attempt("composeDown", "compose_down_failed", async () => {
        await executeChecked(
          execute,
          "docker-compose",
          [
            ...composePrefix(),
            "down",
            "--volumes",
            "--remove-orphans",
          ],
          {
            cwd,
            env: {
              ...childEnv,
              ...(runtimeEnv ?? CLEANUP_FALLBACK_RUNTIME_ENV),
            },
            timeoutMs: HARD_TIMEOUT_BUDGETS_MS.composeDown,
          },
          "compose_down_failed",
        );
      });
    } else {
      cleanup.composeDown = "skipped";
    }

    await attempt("supabaseStop", "supabase_stop_failed", async () => {
      await stopSupabaseAndAssertNoResidue({
        cwd,
        env: childEnv,
        execute,
        reasonPrefix: "supabase",
      });
    });

    await attempt("composeResidue", "compose_residue_failed", async () => {
      await assertNoComposeResidue({ cwd, env: childEnv, execute });
    });

    await attempt("networkResidue", "network_residue_failed", async () => {
      const networkBefore = await executeChecked(
        execute,
        "docker",
        ["network", "ls", "-q", "--filter", `name=^${PHASE2_NETWORK}$`],
        { cwd, env: childEnv, timeoutMs: HARD_TIMEOUT_BUDGETS_MS.residueCheck },
        "network_list_failed",
      );
      if (networkBefore.stdout.trim()) {
        const attached = await executeChecked(
          execute,
          "docker",
          [
            "network",
            "inspect",
            PHASE2_NETWORK,
            "--format",
            "{{json .Containers}}",
          ],
          { cwd, env: childEnv, timeoutMs: HARD_TIMEOUT_BUDGETS_MS.residueCheck },
          "network_inspect_failed",
        );
        const attachedOutput = attached.stdout.trim();
        if (
          attachedOutput &&
          attachedOutput !== "{}" &&
          attachedOutput !== "null"
        ) {
          throw new Error("network_container_residue_found");
        }
        await executeChecked(
          execute,
          "docker",
          ["network", "rm", PHASE2_NETWORK],
          { cwd, env: childEnv, timeoutMs: HARD_TIMEOUT_BUDGETS_MS.residueCheck },
          "network_remove_failed",
        );
      }
      const networkAfter = await executeChecked(
        execute,
        "docker",
        ["network", "ls", "-q", "--filter", `name=^${PHASE2_NETWORK}$`],
        { cwd, env: childEnv, timeoutMs: HARD_TIMEOUT_BUDGETS_MS.residueCheck },
        "network_final_check_failed",
      );
      if (networkAfter.stdout.trim()) throw new Error("network_residue_found");
    });

    if (archiveContext?.tempRoot) {
      await attempt("archiveContext", "archive_cleanup_failed", async () => {
        await rm(archiveContext.tempRoot, { recursive: true, force: true });
      });
    } else {
      cleanup.archiveContext = "skipped";
    }

    cleanup.status = cleanupFailures.length === 0 ? "passed" : "failed";
    if (cleanupFailures.length > 0) cleanup.reasonCode = cleanupFailures[0];
    manifest.cleanup = cleanup;

    const signalFailure = signal?.aborted
      ? reasonFrom(signal.reason, "phase2_signal_aborted")
      : null;
    if (signalFailure && !mainFailure) {
      summaryLines.push(`failure: ${signalFailure}`);
    }
    const finalFailure = mainFailure ?? signalFailure ?? cleanupFailures[0] ?? null;
    manifest.exitStatus = finalFailure ? "failed" : "passed";
    manifest.exitCode = finalFailure ? 1 : 0;
    if (finalFailure) manifest.failure = { reasonCode: finalFailure };
    const endedAt = now();
    manifest.endedAtUtc = endedAt.toISOString();
    manifest.durationMs = checkDuration(startedAt, endedAt);
    summaryLines.push(`cleanup: ${cleanup.status}`);
    summaryLines.push(`exit: ${manifest.exitStatus}`);
    await writeArtifacts({ artifacts, manifest, summaryLines });
  }

  if (manifest.exitStatus !== "passed") {
    throw new Error(manifest.failure?.reasonCode ?? "phase2_harness_failed");
  }
  return { runId, artifacts, manifest };
};
