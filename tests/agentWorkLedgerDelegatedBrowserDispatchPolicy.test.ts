import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const agentsPath = path.resolve("AGENTS.md");
const laneContractPath = path.resolve("docs/ai/cto-lane-contract.md");
const highRiskPathsPath = path.resolve("docs/ai/high-risk-paths.md");
const routeTaskSkillPath = path.resolve(".agents/skills/route-task/SKILL.md");
const cleanupHandoffPath = path.resolve(
  "docs/ai/handoffs/WIN-275-stale-edge-secret-cleanup.md",
);
const cleanupAttestationPath = path.resolve(
  "docs/ai/reviews/WIN-275-stale-edge-secret-cleanup-attestation.md",
);
const canaryHandoffPath = path.resolve(
  "docs/ai/handoffs/WIN-275-hosted-advisory-canary.md",
);
const canaryAttestationPath = path.resolve(
  "docs/ai/reviews/WIN-275-hosted-advisory-canary-attestation.md",
);
const qaPersonaHandoffPath = path.resolve(
  "docs/ai/WIN-43-persistent-qa-personas-handoff.md",
);
const qaAuditHandoffPath = path.resolve(
  "docs/ai/WIN-43-qa-audit-credential-handoff.md",
);

const policySources = [
  { label: "AGENTS", text: readFileSync(agentsPath, "utf8") },
  { label: "lane contract", text: readFileSync(laneContractPath, "utf8") },
  { label: "high-risk paths", text: readFileSync(highRiskPathsPath, "utf8") },
  { label: "route-task skill", text: readFileSync(routeTaskSkillPath, "utf8") },
  {
    label: "WIN-275 cleanup handoff",
    text: readFileSync(cleanupHandoffPath, "utf8"),
  },
  {
    label: "WIN-275 cleanup attestation",
    text: readFileSync(cleanupAttestationPath, "utf8"),
  },
  {
    label: "WIN-275 canary handoff",
    text: readFileSync(canaryHandoffPath, "utf8"),
  },
  {
    label: "WIN-275 canary attestation",
    text: readFileSync(canaryAttestationPath, "utf8"),
  },
  {
    label: "WIN-43 persona handoff",
    text: readFileSync(qaPersonaHandoffPath, "utf8"),
  },
  {
    label: "WIN-43 audit handoff",
    text: readFileSync(qaAuditHandoffPath, "utf8"),
  },
] as const;

const hostedSafetyPolicySources = policySources.filter(
  ({ label }) => !label.startsWith("WIN-43"),
);

const cleanupWorkflowPath =
  ".github/workflows/agent-work-ledger-stale-edge-secret-cleanup.yml";
const canaryWorkflowPath =
  ".github/workflows/agent-work-ledger-hosted-advisory-canary.yml";
const qaPersonaWorkflowPath = ".github/workflows/provision-qa-personas.yaml";
const cleanupWorkflow = readFileSync(path.resolve(cleanupWorkflowPath), "utf8");
const canaryWorkflow = readFileSync(path.resolve(canaryWorkflowPath), "utf8");
const qaPersonaWorkflow = readFileSync(
  path.resolve(qaPersonaWorkflowPath),
  "utf8",
);
const cleanupAcknowledgement =
  "I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_WIN_275_STALE_EDGE_SECRET_CLEANUP";
const canaryAcknowledgement =
  "I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_AGENT_WORK_LEDGER_HOSTED_ADVISORY_CANARY";
const qaPersonaAcknowledgement =
  "I_APPROVE_WIN_43_QA_PERSONA_PROVISIONING";
const exactAllowlist =
  "Delegated browser dispatch allowlist (exactly three literal entries): [`.github/workflows/agent-work-ledger-stale-edge-secret-cleanup.yml`, `.github/workflows/agent-work-ledger-hosted-advisory-canary.yml`, `.github/workflows/provision-qa-personas.yaml`].";
const delegatedWorkflowPaths = [
  cleanupWorkflowPath,
  canaryWorkflowPath,
  qaPersonaWorkflowPath,
] as const;
const delegatedAcknowledgements = [
  cleanupAcknowledgement,
  canaryAcknowledgement,
  qaPersonaAcknowledgement,
] as const;

describe("delegated browser dispatch policy", () => {
  it("retains the cleanup workflow's enforceable fail-closed dispatch gates", () => {
    expect(cleanupWorkflow).toContain(cleanupAcknowledgement);
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

  it("retains the canary workflow's enforceable fail-closed dispatch gates", () => {
    expect(canaryWorkflow).toContain(canaryAcknowledgement);
    expect(canaryWorkflow).toContain(
      "process.env.GITHUB_ACTOR !== process.env.GITHUB_REPOSITORY_OWNER",
    );
    expect(canaryWorkflow).toContain(
      "mainRef.object?.sha !== process.env.EXPECTED_SHA",
    );
    expect(canaryWorkflow).toContain(
      "pull.merge_commit_sha !== commitSha",
    );
    expect(canaryWorkflow).toContain(
      "check.head_sha === process.env.EXPECTED_SHA",
    );
    expect(canaryWorkflow).toContain("check.app?.slug === 'github-actions'");
    expect(canaryWorkflow).toContain("check.conclusion === 'success'");
    expect(canaryWorkflow).toContain("protectedSurfaceHashes");
    expect(canaryWorkflow).toContain("specialistReviews");

    const revalidationStart = canaryWorkflow.indexOf(
      "- name: Revalidate authority immediately before hosted access",
    );
    const advisoryStart = canaryWorkflow.indexOf(
      "- name: Read-only canary preflight",
      revalidationStart,
    );
    expect(revalidationStart).toBeGreaterThan(-1);
    expect(advisoryStart).toBeGreaterThan(revalidationStart);
  });

  it("retains the QA persona workflow's owner-bound and secret-isolated gates", () => {
    expect(qaPersonaWorkflow).toContain(qaPersonaAcknowledgement);
    expect(qaPersonaWorkflow).toContain("github.actor_id == '129695080'");
    expect(qaPersonaWorkflow).toContain(
      "process.env.GITHUB_REF !== 'refs/heads/main'",
    );
    expect(qaPersonaWorkflow).toContain(
      "mainRef.object?.sha !== commitSha",
    );
    expect(qaPersonaWorkflow).toContain(
      "pull.merge_commit_sha !== commitSha",
    );
    expect(qaPersonaWorkflow).toContain(
      "Approval pull request must reference WIN-43.",
    );

    const revalidationStart = qaPersonaWorkflow.indexOf(
      "- name: Revalidate authority immediately before protected credentials",
    );
    const provisionStart = qaPersonaWorkflow.indexOf(
      "- name: Provision and verify persistent synthetic QA personas",
      revalidationStart,
    );
    expect(revalidationStart).toBeGreaterThan(-1);
    expect(provisionStart).toBeGreaterThan(revalidationStart);

    for (const role of [
      "ADMIN",
      "ADMIN_SCHEDULE",
      "BCBA",
      "BT",
      "CLIENT",
      "MIDTIER",
      "SUPERADMIN",
      "THERAPIST",
    ]) {
      expect(qaPersonaWorkflow).toContain(
        `secrets.QA_BOOTSTRAP_${role}_EMAIL`,
      );
      expect(qaPersonaWorkflow).toContain(
        `secrets.QA_BOOTSTRAP_${role}_PASSWORD`,
      );
    }
    expect(qaPersonaWorkflow).not.toContain("gh secret set");
    expect(qaPersonaWorkflow).not.toContain("actions: write");
    expect(qaPersonaWorkflow).not.toContain("contents: write");
  });

  it("encodes the only delegated-dispatch allowlist and exact binding inputs", () => {
    for (const { label, text } of policySources) {
      expect(
        text.match(/Delegated browser dispatch allowlist/g) ?? [],
        `${label} should define exactly one delegated-dispatch allowlist`,
      ).toHaveLength(1);
      expect(text, `${label} should use the exact three-entry allowlist`).toContain(
        exactAllowlist,
      );
      const namedWorkflowPaths = [
        ...text.matchAll(/\.github\/workflows\/[a-z0-9-]+\.ya?ml/gi),
      ].map(([workflowPath]) => workflowPath);
      expect(
        [...new Set(namedWorkflowPaths)],
        `${label} should name only the three delegated workflow paths`,
      ).toEqual([...delegatedWorkflowPaths]);
      for (const workflowPath of delegatedWorkflowPaths) {
        expect(
          text,
          `${label} should scope the exception to ${workflowPath}`,
        ).toContain(workflowPath);
      }
      const requiredAcknowledgements = label.startsWith("WIN-43")
        ? [qaPersonaAcknowledgement]
        : delegatedAcknowledgements;
      for (const acknowledgement of requiredAcknowledgements) {
        expect(
          text,
          `${label} should require the exact acknowledgement ${acknowledgement}`,
        ).toContain(acknowledgement);
      }
      expect(
        text,
        `${label} should bind authorization to the applicable merged issue PR number`,
      ).toMatch(/merged WIN-(?:275|43) PR number|merged PR number/i);
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

  it("requires separate one-time browser-only delegation for each workflow with immediate revalidation and fail-closed drift handling", () => {
    for (const { label, text } of policySources) {
      expect(
        text,
        `${label} should allow only one browser click through the owner session`,
      ).toMatch(/browser click dispatch|browser-only|already-authenticated (?:in-app )?GitHub (?:browser )?session/i);
      expect(
        text,
        `${label} should require separate current-task owner authorization per workflow`,
      ).toMatch(/current[- ]task/i);
      expect(
        text,
        `${label} should state one click and separate authorization per workflow`,
      ).toMatch(/exactly one (?:Browser-plugin )?(?:browser )?click dispatch|one browser click dispatch|separate current-task owner authorization per workflow|fresh current-task owner authorization per workflow/i);
      expect(
        text,
        `${label} should require immediate revalidation before the click`,
      ).toMatch(/immediately before click|immediately before hosted access|immediately before dispatch/i);
      expect(
        text,
        `${label} should require rechecking current main, PR, CI, owner identity, maintainer topology, manifest hashes, and visible exact inputs`,
      ).toMatch(/main\/PR\/required CI\/owner identity\/sole-maintainer topology\/manifest hashes|main, (?:the merged )?PR, required CI, owner identity, sole-maintainer topology, (?:manifest hashes|the hash-bound specialist manifest), and (?:the )?visible exact inputs/i);
      expect(
        text,
        `${label} should make the authorization one-time and consumed on click`,
      ).toMatch(/one-time|consumed on click|non-transferable|non-reusable/i);
      expect(
        text,
        `${label} should revoke the authorization on drift or ambiguity`,
      ).toMatch(/revoked by any drift|missing evidence|navigation\/session ambiguity|failed run|fresh authorization/i);
      expect(
        text,
        `${label} should preserve owner review and merge before delegated dispatch`,
      ).toMatch(/owner must .*inspect and merge|owner (?:must )?personally .*inspect(?:s)? and merge(?:s)?/i);
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
        `${label} should preserve gate weakening and workflow broadening bans`,
      ).toMatch(/gate weakening|any other workflow|extension to any other workflow|exact allowlist/i);
    }
  });

  it("retains cleanup and canary hosted-safety invariants", () => {
    for (const { label, text } of hostedSafetyPolicySources) {
      expect(
        text,
        `${label} should preserve temporary advisory-only canary, disabled-first restore, and zero-residue cleanup`,
      ).toMatch(/temporary advisory only|advisory only/i);
      expect(text, `${label} should preserve disabled-first restore`).toMatch(
        /restore(?:s)? disabled first|disabled-first|disabled first/i,
      );
      expect(text, `${label} should preserve zero residue`).toMatch(
        /zero residue|zero-residue/i,
      );
      expect(
        text,
        `${label} should preserve no provider calls and no retention deletion`,
      ).toMatch(/no provider\/model calls|forbids provider\/model calls/i);
      expect(text).toMatch(/no retention deletion|forbids .*retention deletion/i);
      expect(text, `${label} should preserve active-mode prohibition`).toMatch(
        /active mode remains forbidden|active mode.*forbidden|no active mode/i,
      );
    }
  });
});
