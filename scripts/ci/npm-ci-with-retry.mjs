import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 10_000;
const defaultWait = (delayMs) =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

const defaultRunAttempt = () =>
  new Promise((resolve, reject) => {
    const child = spawn("npm", ["ci"], {
      stdio: "inherit",
      // Windows command shims require the system shell; the command and arguments are fixed.
      shell: process.platform === "win32",
    });

    child.once("error", reject);
    child.once("exit", (code) => {
      resolve(code ?? 1);
    });
  });

export async function runNpmCiWithRetry({
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  runAttempt = defaultRunAttempt,
  wait = defaultWait,
} = {}) {
  let lastExitCode = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    lastExitCode = await runAttempt();
    if (lastExitCode === 0) {
      return;
    }

    if (attempt < maxAttempts) {
      await wait(baseDelayMs * attempt);
    }
  }

  const error = new Error(`npm ci failed after ${maxAttempts} attempts (last exit code ${lastExitCode})`);
  error.exitCode = lastExitCode;
  throw error;
}

const isDirectExecution = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectExecution) {
  runNpmCiWithRetry().catch((error) => {
    if (error instanceof Error) {
      console.error(error.message);
      process.exitCode = Number.isInteger(error.exitCode) && error.exitCode > 0 ? error.exitCode : 1;
      return;
    }

    console.error(String(error));
    process.exitCode = 1;
  });
}
