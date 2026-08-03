import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  hasExitedRuntimeChild,
  startAgentWorkItemsRuntime,
} from "../scripts/agent-work-ledger-harness/edgeRuntime.mjs";

const script = readFileSync(
  path.join(process.cwd(), "scripts", "agent-work-ledger-edge-smoke.mjs"),
  "utf8",
);

const deferredBlock =
  script.match(/const deferredPaths = \[([\s\S]*?)\];/)?.[1] ?? "";

describe("agent work ledger Edge smoke contract", () => {
  it("does not treat container mode's null child as an exited process", () => {
    expect(hasExitedRuntimeChild(null)).toBe(false);
    expect(hasExitedRuntimeChild({ exitCode: null })).toBe(false);
    expect(hasExitedRuntimeChild({ exitCode: 1 })).toBe(true);
  });

  it("treats owner and approval decision as implemented shadow-mode mutations", () => {
    expect(script).toContain("shadowMutationProbes");
    expect(script).toContain("advisory_mode_required");
    expect(script).toMatch(/\/owner/);
    expect(script).toMatch(/\/approvals\/[^`]+\/decision/);
    expect(deferredBlock).not.toContain("/owner");
    expect(deferredBlock).not.toContain("/approvals/");
  });

  it("keeps cancel, resume, and reconcile explicitly deferred", () => {
    expect(deferredBlock).toContain("/cancel");
    expect(deferredBlock).toContain("/resume");
    expect(deferredBlock).toContain("/reconcile");
  });

  it("reuses the container items URL without spawning a JWT-bypassing local server", () => {
    const spawnCalls: unknown[][] = [];
    const runtime = startAgentWorkItemsRuntime({
      supabaseUrl: "http://127.0.0.1:54321",
      runtimeFile: "unused-in-container-mode",
      env: {
        AGENT_WORK_PHASE2_CONTAINER: "1",
        AGENT_WORK_ITEMS_URL: "http://agent-work-items:8000/agent-work-items/",
      },
      spawnImpl: (...args: unknown[]) => {
        spawnCalls.push(args);
        throw new Error("container mode must not spawn supabase functions serve");
      },
    });

    expect(runtime.functionUrl).toBe("http://agent-work-items:8000/agent-work-items");
    expect(runtime.child).toBeNull();
    expect(spawnCalls).toEqual([]);
  });

  it("rejects a non-Compose function service port in container mode", () => {
    expect(() => startAgentWorkItemsRuntime({
      supabaseUrl: "http://supabase_kong_alliincompassing:8000",
      runtimeFile: "unused-in-container-mode",
      env: {
        AGENT_WORK_PHASE2_CONTAINER: "1",
        AGENT_WORK_ITEMS_URL: "http://agent-work-items:8002/agent-work-items",
      },
      spawnImpl: () => {
        throw new Error("must not spawn");
      },
    })).toThrow(/function service/i);
  });
});
