import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  evaluateAgentWorkLedgerDataset,
  loadAgentWorkLedgerEvalFixture,
  sanitizeAgentWorkLedgerValue,
  stableStringifyAgentWorkLedgerEval,
} from "../scripts/lib/agent-work-ledger-eval";

const fixturePath = path.join(
  process.cwd(),
  "scripts",
  "fixtures",
  "agent-work-ledger-eval-fixture.v1.json",
);

describe("agent work ledger eval sidecar", () => {
  it("loads the versioned fixed-seed synthetic fixture and covers pass/block lifecycle cases", () => {
    const fixture = loadAgentWorkLedgerEvalFixture(fixturePath);

    expect(fixture.datasetVersion).toBe("2026-08-03.agent-work-ledger.eval.v1");
    expect(fixture.seed).toBe("agent-work-ledger-eval-v1-fixed-seed");
    expect(fixture.cases.length).toBeGreaterThanOrEqual(6);
    expect(fixture.cases.every((testCase) => testCase.phiFree === true)).toBe(true);
    expect(fixture.cases.some((testCase) => testCase.expectedOutcome === "pass")).toBe(true);
    expect(fixture.cases.some((testCase) => testCase.expectedOutcome === "block")).toBe(true);
  });

  it("fails closed on the exact release gates while preserving optional model-quality scores only for passing cases", () => {
    const fixture = loadAgentWorkLedgerEvalFixture(fixturePath);
    const evaluation = evaluateAgentWorkLedgerDataset(fixture);

    expect(evaluation.summary.caseCount).toBe(fixture.cases.length);
    expect(evaluation.summary.releaseGates).toEqual({
      crossTenantAccess: 0,
      falseCompletion: 0,
      unverifiedMutationEffects: 0,
      phiPayloadViolations: 0,
      approvalBypassOrStaleAcceptance: 0,
      unknownTransitions: 0,
      staleRunningBeyondSlo: 0,
      readinessEvidenceCoveragePercent: 100,
    });
    expect(evaluation.summary.exitCode).toBe(0);
    expect(evaluation.summary.status).toBe("pass");

    const passingCase = evaluation.cases.find((testCase) => testCase.expectedOutcome === "pass");
    const blockedCase = evaluation.cases.find((testCase) => testCase.expectedOutcome === "block");

    expect(passingCase?.optionalModelQuality).toBeDefined();
    expect(blockedCase?.optionalModelQuality).toBeNull();
  });

  it("rejects unsafe keys and strings before grading or output serialization", () => {
    expect(() =>
      sanitizeAgentWorkLedgerValue({
        safe: true,
        client_name: "Synthetic User",
      }),
    ).toThrow(/unsafe key/i);

    expect(() =>
      sanitizeAgentWorkLedgerValue({
        safe: true,
        note: "Patient name: Jane Doe",
      }),
    ).toThrow(/unsafe string/i);
  });

  it("produces deterministic sanitized json", () => {
    const fixture = loadAgentWorkLedgerEvalFixture(fixturePath);
    const evaluation = evaluateAgentWorkLedgerDataset(fixture);
    const first = stableStringifyAgentWorkLedgerEval(evaluation);
    const second = stableStringifyAgentWorkLedgerEval(evaluation);

    expect(first).toBe(second);
    expect(first).not.toContain("patient");
    expect(first).not.toContain("dob");
    expect(() => JSON.parse(first)).not.toThrow();
  });
});
