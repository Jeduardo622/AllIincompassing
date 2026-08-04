import { pathToFileURL } from "node:url";

import { runPhase2Harness } from "./phase2Harness.mjs";

const safeFailureCode = (error) => {
  const message = error instanceof Error ? error.message : "";
  return /^[a-z0-9_]+$/.test(message) ? message : "phase2_harness_failed";
};

export const runPhase2HarnessCli = async ({
  processImpl = process,
  runHarness = runPhase2Harness,
} = {}) => {
  const controller = new AbortController();
  const handlers = new Map();
  for (const signalName of ["SIGINT", "SIGTERM"]) {
    const handler = () => {
      if (!controller.signal.aborted) {
        controller.abort(new Error(`phase2_signal_${signalName.toLowerCase()}`));
      }
    };
    handlers.set(signalName, handler);
    processImpl.on(signalName, handler);
  }

  try {
    await runHarness({ signal: controller.signal });
    processImpl.exitCode = 0;
    return 0;
  } catch (error) {
    processImpl.stderr.write(`${safeFailureCode(error)}\n`);
    processImpl.exitCode = 1;
    return 1;
  } finally {
    for (const [signalName, handler] of handlers) {
      processImpl.off(signalName, handler);
    }
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runPhase2HarnessCli();
}
