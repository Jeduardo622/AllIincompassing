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
const generator = readFileSync(
  path.join(process.cwd(), "supabase", "functions", "generate-program-goals", "index.ts"),
  "utf8",
);
const itemsFunction = readFileSync(
  path.join(process.cwd(), "supabase", "functions", "agent-work-items", "index.ts"),
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

  it("keeps CalOptima provider invocation tenant-bound across ledger and legacy requests", () => {
    const ledgerParseOffset = generator.indexOf("ledgerGenerationSchema.safeParse(body)");
    const legacyParseOffset = generator.indexOf("requestSchema.safeParse(body)");
    const legacyScopeOffset = generator.indexOf("dependencies.lookupLegacyAssessment(db");
    const completionOffset = generator.indexOf("dependencies.invokeCompletion(");

    expect(ledgerParseOffset).toBeGreaterThan(-1);
    expect(legacyParseOffset).toBeGreaterThan(ledgerParseOffset);
    expect(generator).toContain("deriveStableLedgerRequestId");
    expect(generator).toContain('return { kind: "error", status: 403, code: "generation_scope_denied", binding: "legacy" }');
    expect(legacyScopeOffset).toBeGreaterThan(legacyParseOffset);
    expect(completionOffset).toBeGreaterThan(legacyScopeOffset);
    expect(generator).toContain("assessmentDocumentId: resolved.payload.assessment_document_id");
    expect(generator).toContain("organizationId: resolved.payload.organization_id");
    expect(generator).toContain("clientId: resolved.payload.client_id");
  });

  it("resolves assessment scope through the actor-checked service RPC", () => {
    const loader = itemsFunction.match(
      /loadAssessmentDocumentScope:\s*async[\s\S]*?currentUserCanManage:/,
    )?.[0] ?? "";

    expect(loader).toContain("resolve_agent_work_assessment_scope");
    expect(loader).toContain("p_actor_user_id");
    expect(loader).toContain("p_assessment_document_id");
    expect(loader).toContain("p_workflow_key");
    expect(loader).toContain("p_workflow_version");
    expect(loader).not.toMatch(/\.from\(["']assessment_documents["']\)/);
  });

  it("allows only the current sanitized approval confirmation fields", () => {
    const approvalKeys = script.match(
      /const APPROVAL_KEYS = \[([\s\S]*?)\];/,
    )?.[1] ?? "";

    expect(approvalKeys).toContain('"requestedAt"');
    expect(approvalKeys).toContain('"evidenceCount"');
    expect(approvalKeys).toContain('"evidenceHashSuffix"');
    expect(approvalKeys).toContain('"canDecide"');
    expect(approvalKeys).not.toMatch(/assignedTo|actorUserId|approvalHash|evidenceHash(?!Suffix)/);
  });

  it("waits for an authenticated function response instead of Kong's pre-runtime 401", () => {
    expect(script).toMatch(/const waitForFunction = async \(url, headers, child = null\)/);
    expect(script).toContain("request(url, { headers })");
    expect(script).toContain("response.status === 200");

    const signInOffset = script.indexOf("const [adminToken, btToken, crossTenantToken]");
    const readinessOffset = script.indexOf(
      "await waitForFunction(`${functionUrl}?assessment_document_id=${documentId}`, headersFor(adminToken), child)",
    );
    expect(signInOffset).toBeGreaterThan(-1);
    expect(readinessOffset).toBeGreaterThan(signInOffset);
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
