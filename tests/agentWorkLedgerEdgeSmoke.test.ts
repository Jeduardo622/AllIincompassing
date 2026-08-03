import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const script = readFileSync(
  path.join(process.cwd(), "scripts", "agent-work-ledger-edge-smoke.mjs"),
  "utf8",
);

const deferredBlock =
  script.match(/const deferredPaths = \[([\s\S]*?)\];/)?.[1] ?? "";

describe("agent work ledger Edge smoke contract", () => {
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
});
