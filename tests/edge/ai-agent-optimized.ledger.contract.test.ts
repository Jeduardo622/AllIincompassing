import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(
    process.cwd(),
    "supabase",
    "functions",
    "ai-agent-optimized",
    "index.ts",
  ),
  "utf8",
);

describe("ai-agent-optimized ledger-bound contract", () => {
  it("snapshots authoritative ledger scope before the provider call", () => {
    const snapshotIndex = source.indexOf("snapshot_agent_work_model_attempt");
    const providerIndex = source.indexOf("openai.chat.completions.create");

    expect(snapshotIndex).toBeGreaterThan(0);
    expect(providerIndex).toBeGreaterThan(snapshotIndex);
    expect(source).toContain("modelRequestSchemaVersion");
    expect(source).toContain("pricingVersion");
    expect(source).toContain("workflowVersion");
    expect(source).toContain("attemptId");
  });

  it("keeps ledger traces PHI-free and does not persist replay prompts or tool arguments", () => {
    expect(source).not.toMatch(/replayPayload:\s*\{[\s\S]*?message:/);
    expect(source).not.toMatch(/replayPayload:\s*\{[\s\S]*?toolArguments:/);
    expect(source).toContain("guardrailResult");
    expect(source).toContain("outcome");
    expect(source).toContain("attemptId");
  });

  it("loads conversation history through caller-scoped RLS instead of the unsafe definer RPC", () => {
    expect(source).not.toContain("get_recent_chat_history");
    expect(source).toMatch(/from\(['"]chat_history['"]\)/);
    expect(source).toMatch(/\.eq\(['"]user_id['"]/);
  });
});
