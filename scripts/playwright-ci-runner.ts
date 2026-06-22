import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

const DEFAULT_CHILD_TIMEOUT_MS = 12 * 60 * 1000;
const DEFAULT_HEARTBEAT_MS = 60 * 1000;

type RunResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
};

const parsePositiveInteger = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const childTimeoutMs = parsePositiveInteger(
  process.env.PW_CI_CHILD_TIMEOUT_MS,
  DEFAULT_CHILD_TIMEOUT_MS,
);
const heartbeatMs = parsePositiveInteger(
  process.env.PW_CI_HEARTBEAT_MS,
  DEFAULT_HEARTBEAT_MS,
);

const useShell = process.platform === "win32";
const npmCommand = "npm";
const scriptNames = process.argv.slice(2);

const formatDuration = (durationMs: number): string => {
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
};

const log = (message: string): void => {
  console.log(`[ci:playwright ${new Date().toISOString()}] ${message}`);
};

const terminateChild = (child: ChildProcess, signal: NodeJS.Signals = "SIGTERM"): void => {
  if (process.platform === "win32" && child.pid) {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    }).on("error", () => {
      child.kill(signal);
    });
    return;
  }

  child.kill(signal);
};

const runScript = (scriptName: string, index: number, total: number): Promise<RunResult> =>
  new Promise((resolve) => {
    const startedAt = Date.now();
    let timedOut = false;
    let settled = false;
    let resolved = false;

    log(
      `START ${index}/${total}: npm run ${scriptName} ` +
        `(timeout ${formatDuration(childTimeoutMs)})`,
    );

    const child = spawn(npmCommand, ["run", scriptName], {
      stdio: "inherit",
      shell: useShell,
      windowsHide: true,
    });

    const resolveOnce = (result: RunResult): void => {
      if (resolved) {
        return;
      }
      resolved = true;
      resolve(result);
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      clearInterval(heartbeat);
      log(
        `TIMEOUT ${index}/${total}: npm run ${scriptName} exceeded ` +
          `${formatDuration(childTimeoutMs)}; terminating child process.`,
      );
      terminateChild(child);

      setTimeout(() => {
        if (!settled) {
          terminateChild(child, "SIGKILL");
        }
      }, 5000).unref();
    }, childTimeoutMs);

    const heartbeat = setInterval(() => {
      log(
        `STILL RUNNING ${index}/${total}: npm run ${scriptName} ` +
          `after ${formatDuration(Date.now() - startedAt)}`,
      );
    }, heartbeatMs);

    const cleanup = () => {
      settled = true;
      clearTimeout(timeout);
      clearInterval(heartbeat);
    };

    child.on("error", (error) => {
      cleanup();
      log(`ERROR ${index}/${total}: failed to start npm run ${scriptName}: ${error.message}`);
      resolveOnce({ code: 1, signal: null, timedOut });
    });

    child.on("close", (code, signal) => {
      if (resolved) {
        return;
      }
      cleanup();
      const elapsed = formatDuration(Date.now() - startedAt);
      if (timedOut) {
        log(
          `FAILED ${index}/${total}: npm run ${scriptName} timed out after ${elapsed} ` +
            `(exit ${code ?? "null"}, signal ${signal ?? "null"}).`,
        );
      } else if (code === 0) {
        log(`PASS ${index}/${total}: npm run ${scriptName} completed in ${elapsed}.`);
      } else {
        log(
          `FAILED ${index}/${total}: npm run ${scriptName} exited with code ` +
            `${code ?? "null"} signal ${signal ?? "null"} after ${elapsed}.`,
        );
      }
      resolveOnce({ code, signal, timedOut });
    });
  });

const run = async (): Promise<void> => {
  if (scriptNames.length === 0) {
    throw new Error("ci:playwright runner requires at least one npm script name.");
  }

  log(`Running ${scriptNames.length} Playwright smoke scripts with child attribution.`);

  for (let index = 0; index < scriptNames.length; index += 1) {
    const scriptName = scriptNames[index];
    const result = await runScript(scriptName, index + 1, scriptNames.length);
    if (result.code !== 0 || result.signal !== null || result.timedOut) {
      process.exitCode = result.timedOut ? 124 : result.code ?? 1;
      log(`STOP after failed child: npm run ${scriptName}`);
      return;
    }
  }

  log("PASS all Playwright smoke scripts.");
};

run().catch((error) => {
  console.error(
    `[ci:playwright ${new Date().toISOString()}] FAILED runner setup: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
});
