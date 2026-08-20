import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const agentsPath = path.resolve("AGENTS.md");
const laneContractPath = path.resolve("docs/ai/cto-lane-contract.md");
const highRiskPathsPath = path.resolve("docs/ai/high-risk-paths.md");
const routeTaskSkillPath = path.resolve(".agents/skills/route-task/SKILL.md");
const handoffPath = path.resolve(
  "docs/ai/handoffs/WIN-275-stale-edge-secret-cleanup.md",
);
const cleanupAttestationPath = path.resolve(
  "docs/ai/reviews/WIN-275-stale-edge-secret-cleanup-attestation.md",
);

const policySources = [
  { label: "AGENTS", text: readFileSync(agentsPath, "utf8") },
  { label: "lane contract", text: readFileSync(laneContractPath, "utf8") },
  { label: "high-risk paths", text: readFileSync(highRiskPathsPath, "utf8") },
  { label: "route-task skill", text: readFileSync(routeTaskSkillPath, "utf8") },
  { label: "WIN-275 handoff", text: readFileSync(handoffPath, "utf8") },
  {
    label: "WIN-275 cleanup attestation",
    text: readFileSync(cleanupAttestationPath, "utf8"),
  },
] as const;

const cleanupWorkflowPath =
  ".github/workflows/agent-work-ledger-stale-edge-secret-cleanup.yml";
const cleanupWorkflow = readFileSync(path.resolve(cleanupWorkflowPath), "utf8");
const exactAcknowledgement =
  "I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_WIN_275_STALE_EDGE_SECRET_CLEANUP";
const exactAllowlist =
  "Delegated browser dispatch allowlist (exactly one entry): [`.github/workflows/agent-work-ledger-stale-edge-secret-cleanup.yml`].";

describe("WIN-275 delegated browser dispatch policy", () => {
  it("retains the cleanup workflow's enforceable fail-closed dispatch gates", () => {
    expect(cleanupWorkflow).toContain(exactAcknowledgement);
    expect(cleanupWorkflow).toContain(
      "process.env.GITHUB_ACTOR !== process.env.GITHUB_REPOSITORY_OWNER",
    );
    expect(cleanupWorkflow).toContain(
      "mainRef.object?.sha !== process.env.EXPECTED_SHA",
    );
    expect(cleanupWorkflow).toContain(
      "pull.merge_commit_sha !== commitSha",
    );
    expect(cleanupWorkflow).toContain(
      "check.head_sha === process.env.EXPECTED_SHA",
    );
    expect(cleanupWorkflow).toContain("check.app?.slug === 'github-actions'");
    expect(cleanupWorkflow).toContain("check.conclusion === 'success'");
    expect(cleanupWorkflow).toContain("protectedSurfaceHashes");
    expect(cleanupWorkflow).toContain("specialistReviews");

    const revalidationStart = cleanupWorkflow.indexOf(
      "- name: Revalidate authority immediately before hosted cleanup",
    );
    const cleanupStart = cleanupWorkflow.indexOf(
      "- name: Remove approved stale Edge-secret names",
      revalidationStart,
    );
    expect(revalidationStart).toBeGreaterThan(-1);
    expect(cleanupStart).toBeGreaterThan(revalidationStart);
  });

  it("encodes the only delegated-dispatch allowlist and exact binding inputs", () => {
    for (const { label, text } of policySources) {
      expect(
        text.match(/Delegated browser dispatch allowlist/g) ?? [],
        `${label} should define exactly one delegated-dispatch allowlist`,
      ).toHaveLength(1);
      expect(text, `${label} should use the exact one-entry allowlist`).toContain(
        exactAllowlist,
      );
      const delegatedWorkflowPaths = [
        ...text.matchAll(/\.github\/workflows\/[a-z0-9-]+\.ya?ml/gi),
      ].map(([workflowPath]) => workflowPath);
      expect(
        [...new Set(delegatedWorkflowPaths)],
        `${label} should name no second delegated workflow path`,
      ).toEqual([cleanupWorkflowPath]);
      expect(
        text,
        `${label} should scope the exception to the cleanup workflow`,
      ).toContain(cleanupWorkflowPath);
      expect(
        text,
        `${label} should require the exact solo acknowledgement`,
      ).toContain(exactAcknowledgement);
      expect(
        text,
        `${label} should bind authorization to the merged WIN-275 PR number`,
      ).toMatch(/merged WIN-275 PR number|merged PR number/i);
      expect(
        text,
        `${label} should bind authorization to the current-main commit SHA`,
      ).toMatch(/current[- ]main (?:commit )?SHA|exact current `main`|exact current main/i);
      expect(
        text,
        `${label} should bind authorization to immutable workflow inputs`,
      ).toMatch(/workflow-specific immutable inputs|immutable inputs/i);
    }
  });

  it("requires one-time browser-only delegation with immediate revalidation and fail-closed drift handling", () => {
    for (const { label, text } of policySources) {
      expect(
        text,
        `${label} should allow only a browser click through the owner session`,
      ).toMatch(/browser click dispatch|browser-only|already-authenticated (?:in-app )?GitHub (?:browser )?session/i);
      expect(text, `${label} should require current-task authorization`).toMatch(
        /current task/i,
      );
      expect(
        text,
        `${label} should require immediate revalidation before the click`,
      ).toMatch(/immediately before click|immediately before hosted access|immediately before dispatch/i);
      expect(
        text,
        `${label} should require rechecking current main, PR, CI, owner identity, maintainer topology, manifest hashes, and visible exact inputs`,
      ).toMatch(/main\/PR\/required CI\/owner identity\/sole-maintainer topology\/manifest hashes|main, PR, required CI, owner identity, sole-maintainer topology, manifest hashes, and visible exact inputs/i);
      expect(
        text,
        `${label} should make the authorization one-time and consumed on click`,
      ).toMatch(/one-time|consumed on click|non-transferable|non-reusable/i);
      expect(
        text,
        `${label} should revoke the authorization on drift or ambiguity`,
      ).toMatch(/revoked by any drift|missing evidence|navigation\/session ambiguity|failed run|fresh authorization/i);
    }
  });

  it("retains the general prohibition and forbids all broadening vectors", () => {
    for (const { label, text } of policySources) {
      expect(
        text,
        `${label} should preserve the general no-Codex-merge rule`,
      ).toMatch(
        /Codex cannot merge|Codex must never merge|Codex must not merge|no Codex merge/i,
      );
      expect(
        text,
        `${label} should preserve the general no-dispatch rule outside the narrow exception`,
      ).toMatch(/general prohibition|all other .* dispatch actions|do not remove the general prohibition|no Codex merge or dispatch/i);
      expect(
        text,
        `${label} should forbid non-browser dispatch methods and self-authorization`,
      ).toMatch(/forbid gh\/CLI\/API\/token dispatch|secret viewing|self-authorization/i);
      expect(
        text,
        `${label} should forbid active mode, gate weakening, and extension to other workflows`,
      ).toMatch(/active mode|gate weakening|any other workflow|extension to any other workflow/i);
      expect(
        text,
        `${label} should keep owner personal inspection and merge mandatory`,
      ).toMatch(/owner must .*inspect and merge|owner (?:must )?personally .*inspect(?:s)? and merge(?:s)?/i);
    }
  });
});
