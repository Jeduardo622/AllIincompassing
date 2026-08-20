import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const workflowPath = path.resolve(
  ".github/workflows/agent-work-ledger-hosted-advisory-canary.yml",
);
const attestationPath = path.resolve(
  "docs/ai/reviews/WIN-275-hosted-advisory-canary-solo-maintainer-attestation.json",
);

const workflow = readFileSync(workflowPath, "utf8");
const attestation = JSON.parse(readFileSync(attestationPath, "utf8"));

const requiredChecks = [
  "policy",
  "lint-typecheck",
  "unit-tests",
  "build",
  "tier0-browser",
  "auth-browser-smoke",
  "ci-gate",
] as const;

const requiredSpecialists = [
  "code-review-engineer",
  "security-engineer",
  "test-engineer",
  "software-architect",
  "supabase-reviewer",
] as const;

const expectedInvariants = {
  temporaryAdvisoryOnly: true,
  disabledRestoreRequired: true,
  sanitizedEvidenceOnly: true,
  zeroExternalModelCalls: true,
  retentionPolicyUnapproved: true,
  zeroResidueRequired: true,
} as const;

const protectedSurfaces = [
  ".github/workflows/agent-work-ledger-hosted-advisory-canary.yml",
  "scripts/agent-work-ledger-hosted-advisory-canary.mjs",
  "tests/agentWorkLedgerHostedAdvisoryCanary.test.ts",
  "docs/ai/handoffs/WIN-275-hosted-advisory-canary.md",
  "docs/ai/reviews/WIN-275-hosted-advisory-canary-attestation.md",
  ".github/workflows/agent-work-ledger-hosted-shadow-proof.yml",
  "scripts/agent-work-ledger-hosted-shadow-proof.mjs",
  "tests/agentWorkLedgerHostedShadowProof.test.ts",
] as const;

describe("WIN-275 hosted advisory canary dispatch anchor", () => {
  it("anchors the exact owner acknowledgement and immutable current-main approval gates", () => {
    expect(workflow).toContain(
      "const soloAcknowledgement = 'I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_AGENT_WORK_LEDGER_HOSTED_ADVISORY_CANARY';",
    );
    expect(workflow).toContain(
      "if (![independentAcknowledgement, soloAcknowledgement].includes(acknowledgement)) throw new Error('Exact protected execution acknowledgement is required.');",
    );
    expect(workflow).toContain(
      "if (process.env.GITHUB_ACTOR !== process.env.GITHUB_REPOSITORY_OWNER) throw new Error('Only the repository owner may dispatch the canary.');",
    );
    expect(workflow).toContain(
      "if (process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('Protected canary dispatch must use main.');",
    );
    expect(workflow).toContain(
      "if (mainRef.ref !== 'refs/heads/main' || mainRef.object?.sha !== commitSha) throw new Error('commit_sha must equal current main.');",
    );
    expect(workflow).toContain(
      "if (pull.state !== 'closed' || pull.merged !== true || pull.base?.ref !== 'main' || pull.head?.repo?.full_name !== repository) throw new Error('Approval pull request boundary is invalid.');",
    );
    expect(workflow).toContain(
      "if (pull.merge_commit_sha !== commitSha) throw new Error('Current main is not the approval pull request merge commit.');",
    );
    expect(workflow).toContain(
      "if (!/(^|[^A-Z0-9])WIN-275([^A-Z0-9]|$)/i.test(`${pull.title ?? ''}\\n${pull.body ?? ''}`)) throw new Error('Approval pull request must reference WIN-275.');",
    );
  });

  it("anchors the seven required exact-head and current-main checks with immediate revalidation", () => {
    expect(workflow).toContain(
      "const requiredCiChecks = ['policy', 'lint-typecheck', 'unit-tests', 'build', 'tier0-browser', 'auth-browser-smoke', 'ci-gate'];",
    );
    expect(workflow).toContain("check.head_sha === pull.head?.sha");
    expect(workflow).toContain("check.head_sha === commitSha");
    expect(workflow).toContain("check.app?.slug === 'github-actions'");
    expect(workflow).toContain("check.status === 'completed'");
    expect(workflow).toContain("check.conclusion === 'success'");

    for (const check of requiredChecks) {
      expect(workflow).toContain(`'${check}'`);
    }

    const revalidationStart = workflow.indexOf(
      "- name: Revalidate authority immediately before hosted access",
    );
    const hostedAccessStart = workflow.indexOf(
      "- name: Read-only canary preflight",
      revalidationStart,
    );
    expect(revalidationStart).toBeGreaterThan(-1);
    expect(hostedAccessStart).toBeGreaterThan(revalidationStart);

    const revalidationStep = workflow.slice(
      revalidationStart,
      hostedAccessStart,
    );
    expect(revalidationStep).toContain(
      "mainRef.object?.sha !== process.env.EXPECTED_SHA",
    );
    expect(revalidationStep).toContain(
      "check.head_sha === process.env.PR_HEAD_SHA",
    );
    expect(revalidationStep).toContain(
      "check.head_sha === process.env.EXPECTED_SHA",
    );
    expect(revalidationStep).toContain(
      "const requiredCiChecks = ['policy', 'lint-typecheck', 'unit-tests', 'build', 'tier0-browser', 'auth-browser-smoke', 'ci-gate'];",
    );
    expect(revalidationStep).toContain(
      "Exact-head required CI changed before hosted access",
    );
    expect(revalidationStep).toContain(
      "Current-main required CI changed before hosted access",
    );
    expect(revalidationStep).toContain(
      "Independent approval changed before hosted access.",
    );
    expect(revalidationStep).toContain(
      "repositoryDetails.owner?.type !== 'User' || repositoryDetails.owner?.login !== process.env.GITHUB_REPOSITORY_OWNER || String(repositoryDetails.owner?.id) !== process.env.GITHUB_ACTOR_ID || process.env.GITHUB_ACTOR !== process.env.GITHUB_REPOSITORY_OWNER",
    );
    expect(revalidationStep).toContain(
      "maintainers.length !== 1 || maintainers[0]?.login !== process.env.GITHUB_REPOSITORY_OWNER || String(maintainers[0]?.id) !== process.env.GITHUB_ACTOR_ID",
    );
    expect(revalidationStep).toContain(
      "Solo-maintainer topology changed before hosted access.",
    );
  });

  it("anchors solo-attestation PASS specialists, invariants, and LF-normalized protected-surface hashes", () => {
    expect(workflow).toContain(
      "const specialists = ['code-review-engineer', 'security-engineer', 'test-engineer', 'software-architect', 'supabase-reviewer'];",
    );
    expect(workflow).toContain(
      "throw new Error('Passing specialist attestations are incomplete.');",
    );
    expect(workflow).toContain(
      "const surfaces = ['.github/workflows/agent-work-ledger-hosted-advisory-canary.yml', 'scripts/agent-work-ledger-hosted-advisory-canary.mjs', 'tests/agentWorkLedgerHostedAdvisoryCanary.test.ts', 'docs/ai/handoffs/WIN-275-hosted-advisory-canary.md', 'docs/ai/reviews/WIN-275-hosted-advisory-canary-attestation.md', '.github/workflows/agent-work-ledger-hosted-shadow-proof.yml', 'scripts/agent-work-ledger-hosted-shadow-proof.mjs', 'tests/agentWorkLedgerHostedShadowProof.test.ts'];",
    );
    expect(workflow).toContain(
      "throw new Error(`Protected surface hash drifted: ${surface}.`);",
    );

    expect(attestation.schemaVersion).toBe(1);
    expect(attestation.issue).toBe("WIN-275");
    expect(attestation.reviewMode).toBe("solo-maintainer-owner-attestation");
    expect(attestation.repository).toBe("Jeduardo622/AllIincompassing");
    expect(attestation.invariants).toEqual(expectedInvariants);

    for (const specialist of requiredSpecialists) {
      expect(attestation.specialistReviews?.[specialist]?.verdict).toBe("PASS");
      expect(attestation.specialistReviews?.[specialist]?.agentId).toMatch(
        /^[0-9a-f-]{36}$/,
      );
    }

    const protectedSurfaceHashes = attestation.protectedSurfaceHashes ?? {};
    expect(Object.keys(protectedSurfaceHashes).sort()).toEqual(
      [...protectedSurfaces].sort(),
    );

    for (const surface of protectedSurfaces) {
      expect(protectedSurfaceHashes[surface]).toMatch(/^[0-9a-f]{64}$/);
      const actualHash = createHash("sha256")
        .update(readFileSync(path.resolve(surface), "utf8").replace(/\r\n/g, "\n"))
        .digest("hex");
      expect(protectedSurfaceHashes[surface]).toBe(actualHash);
    }
  });
});
