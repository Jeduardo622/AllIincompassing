import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const workflowPath = path.resolve(
  ".github/workflows/agent-work-ledger-stale-edge-secret-cleanup.yml",
);
const attestationPath = path.resolve(
  "docs/ai/reviews/WIN-275-stale-edge-secret-cleanup-solo-maintainer-attestation.json",
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

const protectedSurfaces = [
  ".github/workflows/agent-work-ledger-stale-edge-secret-cleanup.yml",
  "scripts/agent-work-ledger-stale-edge-secret-cleanup.mjs",
  "tests/agentWorkLedgerStaleEdgeSecretCleanup.test.ts",
  "tests/workflows/github-actions-node24-runtime.test.ts",
  "docs/ai/handoffs/WIN-275-stale-edge-secret-cleanup.md",
  "docs/ai/reviews/WIN-275-stale-edge-secret-cleanup-attestation.md",
  "scripts/agent-work-ledger-hosted-advisory-canary.mjs",
] as const;

describe("WIN-275 stale Edge-secret cleanup dispatch anchor", () => {
  it("anchors the exact protected owner acknowledgement and immutable current-main gates", () => {
    expect(workflow).toContain(
      "I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_WIN_275_STALE_EDGE_SECRET_CLEANUP",
    );
    expect(workflow).not.toContain(
      "I_APPROVE_WIN_275_STALE_EDGE_SECRET_CLEANUP",
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

  it("anchors exact-head GitHub Actions required-check success policy", () => {
    expect(workflow).toContain(
      "const requiredCiChecks = ['policy', 'lint-typecheck', 'unit-tests', 'build', 'tier0-browser', 'auth-browser-smoke', 'ci-gate'];",
    );
    expect(workflow).toContain("check.head_sha === commitSha");
    expect(workflow).toContain("check.app?.slug === 'github-actions'");
    expect(workflow).toContain("check.status === 'completed'");
    expect(workflow).toContain("check.conclusion === 'success'");

    for (const check of requiredChecks) {
      expect(workflow).toContain(`'${check}'`);
    }

    const revalidationStart = workflow.indexOf(
      "- name: Revalidate authority immediately before hosted cleanup",
    );
    const cleanupStart = workflow.indexOf(
      "- name: Remove approved stale Edge-secret names",
      revalidationStart,
    );
    expect(revalidationStart).toBeGreaterThan(-1);
    expect(cleanupStart).toBeGreaterThan(revalidationStart);

    const revalidationStep = workflow.slice(revalidationStart, cleanupStart);
    expect(revalidationStep).toContain(
      "mainRef.object?.sha !== process.env.EXPECTED_SHA",
    );
    expect(revalidationStep).toContain(
      "process.env.GITHUB_ACTOR !== process.env.GITHUB_REPOSITORY_OWNER",
    );
    expect(revalidationStep).toContain(
      "check.head_sha === process.env.EXPECTED_SHA",
    );
    expect(revalidationStep).toContain(
      "const requiredCiChecks = ['policy', 'lint-typecheck', 'unit-tests', 'build', 'tier0-browser', 'auth-browser-smoke', 'ci-gate'];",
    );
    expect(revalidationStep).toContain(
      "check.app?.slug === 'github-actions'",
    );
    expect(revalidationStep).toContain("check.status === 'completed'");
    expect(revalidationStep).toContain("check.conclusion === 'success'");
    expect(revalidationStep).toContain(
      "repositoryDetails.owner?.type !== 'User' || repositoryDetails.owner?.login !== process.env.GITHUB_REPOSITORY_OWNER || String(repositoryDetails.owner?.id) !== process.env.GITHUB_ACTOR_ID",
    );
    expect(revalidationStep).toContain(
      "maintainers.length !== 1 || maintainers[0]?.login !== process.env.GITHUB_REPOSITORY_OWNER || String(maintainers[0]?.id) !== process.env.GITHUB_ACTOR_ID",
    );
  });

  it("anchors PASS specialist reviews and the protected cleanup surface hash set", () => {
    expect(attestation.issue).toBe("WIN-275");
    expect(attestation.reviewMode).toBe("solo-maintainer-owner-attestation");
    expect(attestation.repository).toBe("Jeduardo622/AllIincompassing");

    for (const specialist of requiredSpecialists) {
      expect(attestation.specialistReviews?.[specialist]?.verdict).toBe("PASS");
    }

    const protectedSurfaceHashes = attestation.protectedSurfaceHashes ?? {};

    for (const surface of protectedSurfaces) {
      expect(protectedSurfaceHashes[surface]).toMatch(/^[0-9a-f]{64}$/);
      const actualHash = createHash("sha256")
        .update(execFileSync("git", ["show", `HEAD:${surface}`]))
        .digest("hex");
      expect(protectedSurfaceHashes[surface]).toBe(actualHash);
    }
  });
});
