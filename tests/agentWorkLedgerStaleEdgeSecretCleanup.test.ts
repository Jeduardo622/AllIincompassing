import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  runApprovedStaleEdgeSecretCleanup,
  runDisabledFallback,
  writeCleanupFailureArtifact,
} from "../scripts/agent-work-ledger-stale-edge-secret-cleanup.mjs";

const workflowPath = path.resolve(
  ".github/workflows/agent-work-ledger-stale-edge-secret-cleanup.yml",
);
const scriptPath = path.resolve(
  "scripts/agent-work-ledger-stale-edge-secret-cleanup.mjs",
);
const handoffPath = path.resolve(
  "docs/ai/handoffs/WIN-275-stale-edge-secret-cleanup.md",
);
const reviewPath = path.resolve(
  "docs/ai/reviews/WIN-275-stale-edge-secret-cleanup-attestation.md",
);
const manifestPath = path.resolve(
  "docs/ai/reviews/WIN-275-stale-edge-secret-cleanup-solo-maintainer-attestation.json",
);
const packageJsonPath = path.resolve("package.json");

const safeRead = (filePath: string) =>
  existsSync(filePath) ? readFileSync(filePath, "utf8") : "";

const workflow = safeRead(workflowPath);
const script = safeRead(scriptPath);
const handoff = safeRead(handoffPath);
const review = safeRead(reviewPath);
const packageJson = safeRead(packageJsonPath);
const manifest = JSON.parse(safeRead(manifestPath) || "{}");

const cleanBaseline = {
  pg_cron: false,
  vault_names: 0,
  queue_depth: 0,
  archive_depth: 0,
  database_lock_count: 0,
  active_retention_policies: 0,
  ledger_rows: 0,
  draft_packets: 0,
};

describe("WIN-275 stale Edge-secret cleanup contract", () => {
  it("adds a dedicated owner-dispatched cleanup surface", () => {
    expect(existsSync(workflowPath)).toBe(true);
    expect(existsSync(scriptPath)).toBe(true);
    expect(existsSync(handoffPath)).toBe(true);
    expect(existsSync(reviewPath)).toBe(true);
    expect(existsSync(manifestPath)).toBe(true);
    expect(packageJson).toContain(
      '"agent-work:stale-edge-secret-cleanup:contract"',
    );
  });

  it("requires exact-main owner review and a cleanup-specific acknowledgement", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("commit_sha:");
    expect(workflow).toContain("pull_request_number:");
    expect(workflow).toContain("approval_acknowledgement:");
    expect(workflow).toContain(
      "I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_WIN_275_STALE_EDGE_SECRET_CLEANUP",
    );
    expect(workflow).not.toContain("I_APPROVE_WIN_275_STALE_EDGE_SECRET_CLEANUP");
    expect(workflow).toContain(
      "process.env.GITHUB_ACTOR !== process.env.GITHUB_REPOSITORY_OWNER",
    );
    expect(workflow).toContain("process.env.GITHUB_REF !== 'refs/heads/main'");
    expect(workflow).toContain("pull.merge_commit_sha !== commitSha");
    expect(workflow).toContain("Approval pull request must reference WIN-275.");
    expect(workflow).toContain("check.conclusion === 'success'");
    expect(workflow).toContain("/collaborators?affiliation=direct");
    expect(workflow).toContain("value.permissions?.admin");
    expect(workflow).toContain("value.permissions?.maintain");
    expect(workflow).toContain("value.permissions?.push");
    expect(workflow).toContain("Revalidate authority immediately before hosted cleanup");
    expect(workflow).not.toContain("pull.head.sha");
    expect(workflow).not.toContain("npm ci");
    expect(workflow.match(/git status --porcelain/g)).toHaveLength(2);
    expect(workflow).toContain(
      "node scripts/agent-work-ledger-stale-edge-secret-cleanup.mjs",
    );
    expect(workflow).toContain(
      "node scripts/agent-work-ledger-stale-edge-secret-cleanup.mjs disabled-fallback",
    );
  });

  it("keeps cleanup unable to mutate Vault, database rows, schedulers, or fixtures", () => {
    expect(script).not.toContain("delete from vault");
    expect(script).not.toContain("drop extension");
    expect(script).not.toContain("disable_hosted_agent_work_queue_scheduler");
    expect(script).not.toContain("hosted-shadow-proof.mjs");
    expect(script).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(workflow).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(workflow).not.toContain("SUPABASE_SECRET_KEY");
  });

  it("removes only approved fixed names after reasserting disabled", async () => {
    const calls: string[] = [];
    let listCount = 0;
    const result = await runApprovedStaleEdgeSecretCleanup(
      "I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_WIN_275_STALE_EDGE_SECRET_CLEANUP",
      {
        readHostedBaseline: async () => {
          calls.push("baseline:read");
          return cleanBaseline;
        },
        listEdgeSecrets: async () => {
          calls.push("edge-secrets:list");
          listCount += 1;
          if (listCount === 1) {
            return new Map([
              ["AGENT_WORK_LEDGER_RUNTIME_MODE", "old-runtime-digest"],
              ["AGENT_WORK_RUNNER_SECRET", "stale-runner-digest"],
              ["AGENT_WORK_HOSTED_PROJECT_REF", "stale-project-digest"],
              ["UNRELATED_SECRET", "unrelated-digest"],
            ]);
          }
          if (listCount === 2) {
            return new Map([
              ["AGENT_WORK_LEDGER_RUNTIME_MODE", "disabled-runtime-digest"],
              ["AGENT_WORK_RUNNER_SECRET", "stale-runner-digest"],
              ["AGENT_WORK_HOSTED_PROJECT_REF", "stale-project-digest"],
              ["UNRELATED_SECRET", "unrelated-digest"],
            ]);
          }
          return new Map([
            ["AGENT_WORK_LEDGER_RUNTIME_MODE", "disabled-runtime-digest"],
            ["UNRELATED_SECRET", "unrelated-digest"],
          ]);
        },
        setRuntimeMode: async (mode: string) => calls.push(`mode:${mode}`),
        unsetEdgeSecrets: async (names: string[]) =>
          calls.push(`edge-secrets:unset:${names.join(",")}`),
      },
    );

    expect(calls).toEqual([
      "baseline:read",
      "edge-secrets:list",
      "mode:disabled",
      "edge-secrets:list",
      "edge-secrets:unset:AGENT_WORK_RUNNER_SECRET,AGENT_WORK_HOSTED_PROJECT_REF",
      "edge-secrets:list",
      "baseline:read",
    ]);
    expect(result).toEqual({
      targetedNamesRemoved: 2,
      targetedNamesAbsentAfter: 3,
      unrelatedNamesPreserved: 1,
    });
  });

  it("rejects cleanup without the exact acknowledgement before hosted access", async () => {
    const calls: string[] = [];
    await expect(
      runApprovedStaleEdgeSecretCleanup("I_APPROVE_SOMETHING_ELSE", {
        readHostedBaseline: async () => {
          calls.push("baseline:read");
          return cleanBaseline;
        },
        listEdgeSecrets: async () => new Map(),
        setRuntimeMode: async () => undefined,
        unsetEdgeSecrets: async () => undefined,
      }),
    ).rejects.toThrow("Exact stale Edge-secret cleanup acknowledgement is required.");
    expect(calls).toEqual([]);
  });

  it("keeps the terminal fallback limited to reasserting disabled", async () => {
    const calls: string[] = [];
    await runDisabledFallback({
      setRuntimeMode: async (mode: string) => calls.push(`mode:${mode}`),
    });
    expect(calls).toEqual(["mode:disabled"]);
  });

  it("fails closed on hosted baseline drift before mutation", async () => {
    const calls: string[] = [];
    await expect(
      runApprovedStaleEdgeSecretCleanup(
        "I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_WIN_275_STALE_EDGE_SECRET_CLEANUP",
        {
          readHostedBaseline: async () => ({ ...cleanBaseline, queue_depth: 1 }),
          listEdgeSecrets: async () => {
            calls.push("edge-secrets:list");
            return new Map();
          },
          setRuntimeMode: async () => calls.push("mode:disabled"),
          unsetEdgeSecrets: async () => calls.push("edge-secrets:unset"),
        },
      ),
    ).rejects.toThrow("Hosted cleanup baseline drifted.");
    expect(calls).toEqual([]);
  });

  it("fails if targeted residue remains or unrelated metadata changes", async () => {
    const operations = (after: Map<string, string>) => {
      let reads = 0;
      return {
        readHostedBaseline: async () => cleanBaseline,
        listEdgeSecrets: async () => {
          reads += 1;
          return reads <= 2
            ? new Map([
                ["AGENT_WORK_RUNNER_SECRET", "stale-digest"],
                ["UNRELATED_SECRET", "unrelated-digest"],
              ])
            : after;
        },
        setRuntimeMode: async () => undefined,
        unsetEdgeSecrets: async () => undefined,
      };
    };
    const acknowledgement =
      "I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_WIN_275_STALE_EDGE_SECRET_CLEANUP";

    await expect(
      runApprovedStaleEdgeSecretCleanup(
        acknowledgement,
        operations(
          new Map([
            ["AGENT_WORK_RUNNER_SECRET", "stale-digest"],
            ["UNRELATED_SECRET", "unrelated-digest"],
            ["AGENT_WORK_LEDGER_RUNTIME_MODE", "disabled-digest"],
          ]),
        ),
      ),
    ).rejects.toThrow("Approved stale Edge-secret cleanup is incomplete.");

    await expect(
      runApprovedStaleEdgeSecretCleanup(
        acknowledgement,
        operations(
          new Map([
            ["UNRELATED_SECRET", "changed-digest"],
            ["AGENT_WORK_LEDGER_RUNTIME_MODE", "disabled-digest"],
          ]),
        ),
      ),
    ).rejects.toThrow("Unrelated Edge-secret metadata drifted during cleanup.");
  });

  it("fails before deletion if approved target metadata changes after disabled reassertion", async () => {
    const calls: string[] = [];
    let reads = 0;
    await expect(
      runApprovedStaleEdgeSecretCleanup(
        "I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_WIN_275_STALE_EDGE_SECRET_CLEANUP",
        {
          readHostedBaseline: async () => cleanBaseline,
          listEdgeSecrets: async () => {
            reads += 1;
            return new Map([
              [
                "AGENT_WORK_RUNNER_SECRET",
                reads === 1 ? "approved-digest" : "replacement-digest",
              ],
            ]);
          },
          setRuntimeMode: async () => calls.push("mode:disabled"),
          unsetEdgeSecrets: async () => calls.push("edge-secrets:unset"),
        },
      ),
    ).rejects.toThrow("Approved stale Edge-secret metadata drifted before deletion.");
    expect(calls).toEqual(["mode:disabled"]);
  });

  it("writes a sanitized failure artifact without exception or secret metadata", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "win-275-stale-cleanup-"));
    try {
      const artifact = await writeCleanupFailureArtifact(directory);
      const contents = readFileSync(artifact, "utf8");
      const parsed = JSON.parse(contents);
      expect(parsed.fixed_booleans).toEqual({
        execution_failed: true,
        stale_edge_cleanup_failed: true,
        runtime_advisory_enabled: false,
        vault_deletion_performed: false,
        database_row_deletion_performed: false,
        retention_deletion_performed: false,
      });
      expect(contents).not.toContain("digest");
      expect(contents).not.toContain("exception");
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("hash-binds specialist reviews to the exact cleanup surfaces", () => {
    for (const specialist of [
      "code-review-engineer",
      "security-engineer",
      "test-engineer",
      "software-architect",
      "supabase-reviewer",
    ]) {
      expect(manifest.specialistReviews?.[specialist]?.verdict).toBe("PASS");
      expect(manifest.specialistReviews?.[specialist]?.agentId).toMatch(
        /^[0-9a-f-]{36}$/,
      );
    }
    for (const surface of [
      ".github/workflows/agent-work-ledger-stale-edge-secret-cleanup.yml",
      "scripts/agent-work-ledger-stale-edge-secret-cleanup.mjs",
      "tests/agentWorkLedgerStaleEdgeSecretCleanup.test.ts",
      "tests/workflows/github-actions-node24-runtime.test.ts",
      "docs/ai/handoffs/WIN-275-stale-edge-secret-cleanup.md",
      "docs/ai/reviews/WIN-275-stale-edge-secret-cleanup-attestation.md",
      "scripts/agent-work-ledger-hosted-advisory-canary.mjs",
    ]) {
      const actual = createHash("sha256")
        .update(execFileSync("git", ["show", `:${surface}`]))
        .digest("hex");
      expect(manifest.protectedSurfaceHashes?.[surface]).toBe(actual);
    }
  });

  it("documents the exact deletion scope and all non-goals", () => {
    for (const doc of [handoff, review]) {
      expect(doc).toContain("owner-dispatched");
      expect(doc).toContain(
        "I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_WIN_275_STALE_EDGE_SECRET_CLEANUP",
      );
      expect(doc).not.toContain("I_APPROVE_WIN_275_STALE_EDGE_SECRET_CLEANUP");
      expect(doc).toContain("AGENT_WORK_RUNNER_SECRET");
      expect(doc).toContain("AGENT_WORK_SWEEPER_SECRET");
      expect(doc).toContain("AGENT_WORK_HOSTED_PROJECT_REF");
      expect(doc).toContain("AGENT_WORK_LEDGER_RUNTIME_MODE=disabled");
      expect(doc).toContain("no Vault deletion");
      expect(doc).toContain("no database row deletion");
      expect(doc).toContain("no retention deletion");
      expect(doc).toContain("no customer data");
      expect(doc).toContain("no active mode");
    }
  });
});
