import { spawnSync } from "node:child_process";

import {
  buildLocalRuntimeEnv,
  parseSupabaseStatusEnv,
  validateLocalSupabaseEnv,
} from "../src/scripts/agentWorkLedgerLocal";

const runSupabaseStatus = () => {
  const result = spawnSync("supabase", ["status", "-o", "env"], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(detail || "supabase status -o env failed.");
  }

  return parseSupabaseStatusEnv(result.stdout);
};

const redact = ([key, value]: [string, string]): string => {
  if (/KEY|SECRET|JWT/.test(key)) {
    return `${key}=[redacted]`;
  }
  return `${key}=${value}`;
};

const printUsageAndExit = (): never => {
  console.error("Usage: tsx scripts/agent-work-ledger-local-env.ts <preflight|env|run -- <command...>>");
  process.exit(1);
};

const command = process.argv[2];
if (!command) {
  printUsageAndExit();
}

const statusEnv = runSupabaseStatus();
const errors = validateLocalSupabaseEnv(process.env, statusEnv);

if (command === "preflight") {
  if (errors.length > 0) {
    console.error("Local agent-work preflight failed:");
    for (const error of errors) {
      console.error(` - ${error}`);
    }
    process.exit(1);
  }

  console.log("Local agent-work preflight passed.");
  process.exit(0);
}

if (command === "env") {
  const runtimeEnv = buildLocalRuntimeEnv(statusEnv);
  const lines = Object.entries(runtimeEnv)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(redact);
  console.log(lines.join("\n"));
  process.exit(0);
}

if (command === "run") {
  const separatorIndex = process.argv.indexOf("--");
  if (separatorIndex === -1 || separatorIndex === process.argv.length - 1) {
    console.error("Usage: tsx scripts/agent-work-ledger-local-env.ts run -- <command...>");
    process.exit(1);
  }

  const runtimeEnv = buildLocalRuntimeEnv(statusEnv);
  const childEnv = { ...process.env };
  for (const key of [
    "SUPABASE_URL",
    "VITE_SUPABASE_URL",
    "SUPABASE_EDGE_URL",
    "VITE_SUPABASE_EDGE_URL",
    "SUPABASE_DB_URL",
    "SUPABASE_ANON_KEY",
    "VITE_SUPABASE_ANON_KEY",
    "SUPABASE_PUBLISHABLE_KEY",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_PROJECT_REF",
    "VITE_SUPABASE_PROJECT_REF",
  ]) {
    delete childEnv[key];
  }
  Object.assign(childEnv, runtimeEnv);

  const commandParts = process.argv.slice(separatorIndex + 1);
  const [executable, ...args] = commandParts;
  const result = spawnSync(executable, args, {
    cwd: process.cwd(),
    env: childEnv,
    stdio: "inherit",
    shell: true,
  });

  if (typeof result.status === "number") {
    process.exit(result.status);
  }
  if (result.error) {
    throw result.error;
  }
  process.exit(1);
}

printUsageAndExit();
