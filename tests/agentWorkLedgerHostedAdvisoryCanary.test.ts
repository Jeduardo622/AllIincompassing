import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCleanupSequence } from "../scripts/agent-work-ledger-hosted-advisory-canary.mjs";

const workflowPath = path.resolve(
  ".github/workflows/agent-work-ledger-hosted-advisory-canary.yml",
);
const scriptPath = path.resolve(
  "scripts/agent-work-ledger-hosted-advisory-canary.mjs",
);
const packageJsonPath = path.resolve("package.json");
const reviewDocPath = path.resolve(
  "docs/ai/reviews/WIN-275-hosted-advisory-canary-attestation.md",
);
const soloAttestationPath = path.resolve(
  "docs/ai/reviews/WIN-275-hosted-advisory-canary-solo-maintainer-attestation.json",
);
const handoffDocPath = path.resolve(
  "docs/ai/handoffs/WIN-275-hosted-advisory-canary.md",
);

const safeRead = (filePath: string) =>
  existsSync(filePath) ? readFileSync(filePath, "utf8") : "";

const workflow = safeRead(workflowPath);
const script = safeRead(scriptPath);
const packageJson = safeRead(packageJsonPath);
const reviewDoc = safeRead(reviewDocPath);
const handoffDoc = safeRead(handoffDocPath);
const soloAttestation = JSON.parse(safeRead(soloAttestationPath) || "{}");

describe("agent work hosted advisory canary contract", () => {
  it("adds the new protected workflow, script, docs, and package command", () => {
    expect(existsSync(workflowPath)).toBe(true);
    expect(existsSync(scriptPath)).toBe(true);
    expect(existsSync(reviewDocPath)).toBe(true);
    expect(existsSync(soloAttestationPath)).toBe(true);
    expect(existsSync(handoffDocPath)).toBe(true);
    expect(packageJson).toContain(
      '"agent-work:hosted-advisory-canary:contract"',
    );
    expect(packageJson).toContain(
      "tests/agentWorkLedgerHostedAdvisoryCanary.test.ts",
    );
  });

  it("requires owner-dispatched current-main approval gates modeled on the shadow proof", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("commit_sha:");
    expect(workflow).toContain("pull_request_number:");
    expect(workflow).toContain("approval_acknowledgement:");
    expect(workflow).toContain(
      "I_APPROVE_AGENT_WORK_LEDGER_HOSTED_ADVISORY_CANARY",
    );
    expect(workflow).toContain(
      "I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_AGENT_WORK_LEDGER_HOSTED_ADVISORY_CANARY",
    );
    expect(workflow).toContain(
      "process.env.GITHUB_ACTOR !== process.env.GITHUB_REPOSITORY_OWNER",
    );
    expect(workflow).toContain("process.env.GITHUB_REF !== 'refs/heads/main'");
    expect(workflow).toContain("/git/ref/heads/main");
    expect(workflow).toContain("pull.merge_commit_sha !== commitSha");
    expect(workflow).toContain("Approval pull request must reference WIN-275.");
    expect(workflow).toContain("/check-runs");
    expect(workflow).toContain("check.head_sha === pull.head?.sha");
    expect(workflow).toContain("check.conclusion === 'success'");
    expect(workflow).toContain("/collaborators?affiliation=direct");
    expect(workflow).toContain(
      "Revalidate authority immediately before hosted access",
    );
    expect(workflow).toContain(
      "Exact-head required CI changed before hosted access",
    );
    expect(workflow).toContain("Current-main required CI is missing");
    expect(workflow).toContain(
      "Current-main required CI changed before hosted access",
    );
    expect(workflow).toContain(
      "Independent approval changed before hosted access",
    );
    expect(workflow).toContain(
      "Solo-maintainer topology changed before hosted access",
    );
    expect(workflow).toContain("const latestReviews = new Map()");
    expect(workflow.match(/SUPABASE_SERVICE_ROLE_KEY:/g)).toHaveLength(2);
    expect(workflow.match(/const latestReviews = new Map\(\)/g)).toHaveLength(
      2,
    );
    const authorityIndex = workflow.indexOf(
      "Revalidate authority immediately before hosted access",
    );
    const hostedIndex = workflow.indexOf("Read-only canary preflight");
    expect(authorityIndex).toBeGreaterThan(0);
    expect(hostedIndex).toBeGreaterThan(authorityIndex);
    expect(workflow).toContain(
      "docs/ai/reviews/WIN-275-hosted-advisory-canary-solo-maintainer-attestation.json",
    );
  });

  it("keeps the canary temporary, advisory-only, and exact-head CI bound", () => {
    expect(workflow).toContain("timeout-minutes: 45");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("policy");
    expect(workflow).toContain("lint-typecheck");
    expect(workflow).toContain("unit-tests");
    expect(workflow).toContain("build");
    expect(workflow).toContain("tier0-browser");
    expect(workflow).toContain("auth-browser-smoke");
    expect(workflow).toContain("ci-gate");
    expect(workflow).toContain("Hosted advisory canary");
    expect(workflow).not.toContain("workflow_call:");
  });

  it("fixes the schedule, timeout, and sweep bound in script code", () => {
    expect(script).toContain('const CANARY_SCHEDULE = "* * * * *"');
    expect(script).toContain("const CANARY_HTTP_TIMEOUT_MS = 5_000");
    expect(script).toContain("const CANARY_SWEEPER_BOUND = 25");
    expect(script).toContain('mode === "advisory" || mode === "disabled"');
    expect(script).not.toContain('mode === "active"');
    expect(script).not.toContain("provider");
    expect(script).not.toContain("generate-program-goals");
    expect(script).not.toContain("AGENT_WORK_LEGACY_GENERATION_DISABLED");
  });

  it("uses read-only preflight drift checks before any hosted mutation", () => {
    expect(script).toContain("read_only: true");
    expect(script).toContain("queue_depth");
    expect(script).toContain("oldest_message_age_seconds");
    expect(script).toContain("database_lock_count");
    expect(script).toContain("database_write_baseline");
    expect(script).toContain("http_response_baseline");
    expect(script).toContain("http_successes");
    expect(script).toContain("http_failures");
    expect(script).toContain("runtime_mode_secret_present");
    expect(script).toContain("pg_cron");
    expect(script).toContain("agent-work-runner-hosted");
    expect(script).toContain("agent-work-sweeper-hosted");
    expect(script).toContain("agent_work_hosted_project_ref");
    expect(script).toContain("agent_work_hosted_publishable_key");
    expect(script).toContain("agent_work_hosted_runner_secret");
    expect(script).toContain("agent_work_hosted_sweeper_secret");
  });

  it("cleans up disabled-first and proves zero residue across jobs, vault names, edge secrets, pg_cron, and fixtures", () => {
    expect(script).toContain('cleanupOperations.setRuntimeMode("disabled")');
    expect(script).toContain("cleanupOperations.disableHostedScheduler()");
    expect(script).toContain("cleanupOperations.unsetEdgeSecrets(");
    expect(script).toContain(
      "cleanupOperations.dropCanaryPgCronExtension(state.pgCronExtensionOid)",
    );
    expect(script).toContain("foreign_cron_job_detected");
    expect(script).toContain("canary_pg_cron_ownership_drifted");
    expect(script).toContain("cleanupOperations.deleteSyntheticFixtures(");
    expect(script).toContain("final_cron_jobs: 0");
    expect(script).toContain("final_vault_names: 0");
    expect(script).toContain("final_edge_secrets: 0");
    expect(script).toContain("final_fixture_rows: 0");
    expect(script).toContain("final_pg_cron_extensions: 0");
    expect(script).toContain("final_archive_depth: 0");
    expect(script).toContain("policy_unapproved_verified");
    expect(script).toContain("retention_activation_performed: false");
    expect(script).toContain("retention_deletion_performed: false");
  });

  it("executes cleanup in disabled-first destructive order", async () => {
    const calls: string[] = [];
    const record = (name: string) => async () => {
      calls.push(name);
    };
    await runCleanupSequence(
      { pgCronInstalledByCanary: true, pgCronExtensionOid: 275 },
      {
        setRuntimeMode: async (mode: string) => calls.push(`mode:${mode}`),
        disableHostedScheduler: record("scheduler:disable"),
        unsetEdgeSecrets: record("edge-secrets:unset"),
        deleteVaultSecrets: record("vault:delete"),
        dropCanaryPgCronExtension: record("pg-cron:drop"),
        deleteSyntheticFixtures: record("fixtures:delete"),
      },
    );
    expect(calls).toEqual([
      "mode:disabled",
      "scheduler:disable",
      "edge-secrets:unset",
      "vault:delete",
      "pg-cron:drop",
      "fixtures:delete",
    ]);
  });

  it("continues fixture cleanup after an earlier cleanup failure", async () => {
    const calls: string[] = [];
    await expect(
      runCleanupSequence(
        { pgCronInstalledByCanary: true, pgCronExtensionOid: 275 },
        {
          setRuntimeMode: async () => calls.push("mode:disabled"),
          disableHostedScheduler: async () => {
            calls.push("scheduler:disable");
            throw new Error("synthetic scheduler cleanup failure");
          },
          unsetEdgeSecrets: async () => calls.push("edge-secrets:unset"),
          deleteVaultSecrets: async () => calls.push("vault:delete"),
          dropCanaryPgCronExtension: async () => calls.push("pg-cron:drop"),
          deleteSyntheticFixtures: async () => calls.push("fixtures:delete"),
        },
      ),
    ).rejects.toThrow("Canary cleanup completed with failures.");
    expect(calls.at(-1)).toBe("fixtures:delete");
  });

  it("binds the solo-owner path to passing specialists and exact protected-surface hashes", () => {
    const specialists = [
      "code-review-engineer",
      "security-engineer",
      "test-engineer",
      "software-architect",
      "supabase-reviewer",
    ];
    for (const specialist of specialists) {
      expect(soloAttestation.specialistReviews?.[specialist]?.verdict).toBe(
        "PASS",
      );
      expect(soloAttestation.specialistReviews?.[specialist]?.agentId).toMatch(
        /^[0-9a-f-]{36}$/,
      );
    }
    const protectedSurfaces = [
      ".github/workflows/agent-work-ledger-hosted-advisory-canary.yml",
      "scripts/agent-work-ledger-hosted-advisory-canary.mjs",
      "tests/agentWorkLedgerHostedAdvisoryCanary.test.ts",
      "docs/ai/handoffs/WIN-275-hosted-advisory-canary.md",
      "docs/ai/reviews/WIN-275-hosted-advisory-canary-attestation.md",
      ".github/workflows/agent-work-ledger-hosted-shadow-proof.yml",
      "scripts/agent-work-ledger-hosted-shadow-proof.mjs",
      "tests/agentWorkLedgerHostedShadowProof.test.ts",
    ];
    for (const surface of protectedSurfaces) {
      const actual = createHash("sha256")
        .update(readFileSync(path.resolve(surface), "utf8").replace(/\r\n/g, "\n"))
        .digest("hex");
      expect(soloAttestation.protectedSurfaceHashes?.[surface]).toBe(actual);
    }
  });

  it("keeps the public artifact sanitized and excludes private state", () => {
    expect(script).toContain("fixed_booleans");
    expect(script).toContain("summary_sha256");
    expect(script).toContain(
      "Refusing sensitive or identifying evidence output.",
    );
    expect(workflow).toContain(
      "agent-work-ledger-hosted-advisory-canary-public/**",
    );
    expect(workflow).not.toContain(
      "agent-work-ledger-hosted-advisory-canary-private/**",
    );
  });

  it("documents the temporary advisory-only boundary and cleanup expectations", () => {
    for (const doc of [reviewDoc, handoffDoc]) {
      expect(doc).toContain("temporary advisory only");
      expect(doc).toContain("owner-dispatched");
      expect(doc).toContain("exact synthetic fixtures");
      expect(doc).toContain("no provider/model calls");
      expect(doc).toContain("no retention activation");
      expect(doc).toContain("no retention deletion");
      expect(doc).toContain("active");
      expect(doc).toContain("disabled");
      expect(doc).toContain("* * * * *");
      expect(doc).toContain("5000");
      expect(doc).toContain("25");
      expect(doc).toContain("public artifact");
      expect(doc).toContain("zero residue");
    }
  });
});
