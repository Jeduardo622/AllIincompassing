import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import {
  runPhase2HarnessCli,
} from "../scripts/agent-work-ledger-harness/runPhase2Harness.mjs";

class FakeProcess extends EventEmitter {
  exitCode: number | undefined;
  messages: string[] = [];
  stderr = {
    write: (message: string) => {
      this.messages.push(message);
      return true;
    },
  };
}

describe("agent work ledger phase2 signal handling", () => {
  it.each(["SIGINT", "SIGTERM"] as const)(
    "waits for fail-closed harness cleanup after %s",
    async (signalName) => {
      const processImpl = new FakeProcess();
      const steps: string[] = [];
      const runHarness = ({ signal }: { signal: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            steps.push("cleanup-started");
            queueMicrotask(() => {
              steps.push("cleanup-finished");
              reject(signal.reason);
            });
          }, { once: true });
        });

      const resultPromise = runPhase2HarnessCli({ processImpl, runHarness });
      processImpl.emit(signalName);
      expect(await resultPromise).toBe(1);

      expect(steps).toEqual(["cleanup-started", "cleanup-finished"]);
      expect(processImpl.exitCode).toBe(1);
      expect(processImpl.messages.join("\n")).toContain(
        `phase2_signal_${signalName.toLowerCase()}`,
      );
      expect(processImpl.listenerCount("SIGINT")).toBe(0);
      expect(processImpl.listenerCount("SIGTERM")).toBe(0);
    },
  );
});
