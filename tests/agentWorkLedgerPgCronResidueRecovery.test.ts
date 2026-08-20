import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildPgCronResidueRecoveryMutationQuery,
  parseExpectedPgCronOid,
  reassertRuntimeDisabledWith,
  reconcilePgCronResidueRecovery,
  runPgCronResidueRecovery,
  writePgCronResidueRecoveryFailureArtifact,
} from "../scripts/agent-work-ledger-pg-cron-residue-recovery.mjs";

const workflowPath = path.resolve(
  ".github/workflows/agent-work-ledger-pg-cron-residue-recovery.yml",
);
const scriptPath = path.resolve(
  "scripts/agent-work-ledger-pg-cron-residue-recovery.mjs",
);
const handoffPath = path.resolve(
  "docs/ai/handoffs/WIN-275-pg-cron-residue-recovery.md",
);
const reviewPath = path.resolve(
  "docs/ai/reviews/WIN-275-pg-cron-residue-recovery-attestation.md",
);
const manifestPath = path.resolve(
  "docs/ai/reviews/WIN-275-pg-cron-residue-recovery-solo-maintainer-attestation.json",
);
const packageJsonPath = path.resolve("package.json");

const safeRead = (filePath: string) =>
  existsSync(filePath) ? readFileSync(filePath, "utf8") : "";

const workflow = safeRead(workflowPath);
const script = safeRead(scriptPath);
const handoff = safeRead(handoffPath);
const review = safeRead(reviewPath);
const manifest = JSON.parse(safeRead(manifestPath) || "{}");
const packageJson = safeRead(packageJsonPath);

const cleanBaseline = {
  pg_cron_oid: 457927,
  cron_job_count: 0,
  ledger_rows: 0,
  queue_depth: 0,
  archive_depth: 0,
  draft_rows: 0,
  vault_canary_names: 0,
  active_retention_policies: 0,
  ungranted_lock_count: 0,
  synthetic_fixture_residue: 0,
};

describe("WIN-275 pg_cron residue recovery contract", () => {
  it("adds a dedicated owner-dispatched residue recovery surface", () => {
    expect(existsSync(workflowPath)).toBe(true);
    expect(existsSync(scriptPath)).toBe(true);
    expect(existsSync(handoffPath)).toBe(true);
    expect(existsSync(reviewPath)).toBe(true);
    expect(existsSync(manifestPath)).toBe(true);
    expect(packageJson).toContain(
      '"agent-work:pg-cron-residue-recovery:contract"',
    );
  });

  it("hash-binds every reviewed recovery and delegated-policy surface", () => {
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.issue).toBe("WIN-275");
    expect(manifest.approvedIncidentPgCronOid).toBe(457927);
    for (const specialist of [
      "code-review-engineer",
      "security-engineer",
      "test-engineer",
      "software-architect",
      "supabase-reviewer",
      "devops-engineer",
    ]) {
      expect(manifest.specialistReviews?.[specialist]?.verdict).toBe("PASS");
      expect(manifest.specialistReviews?.[specialist]?.agentId).toMatch(
        /^[0-9a-f-]{36}$/,
      );
    }
    expect(
      new Set(
        Object.values(manifest.specialistReviews ?? {}).map(
          (review: { agentId?: string }) => review.agentId,
        ),
      ).size,
    ).toBe(6);
    for (const [surface, expected] of Object.entries(
      manifest.protectedSurfaceHashes ?? {},
    )) {
      const actual = createHash("sha256")
        .update(readFileSync(path.resolve(surface), "utf8").replace(/\r\n/g, "\n"))
        .digest("hex");
      expect(expected, surface).toBe(actual);
    }
    expect(Object.keys(manifest.protectedSurfaceHashes ?? {})).toEqual(
      expect.arrayContaining([
        ".github/workflows/agent-work-ledger-pg-cron-residue-recovery.yml",
        ".github/workflows/provision-qa-personas.yaml",
        "scripts/agent-work-ledger-pg-cron-residue-recovery.mjs",
        "tests/agentWorkLedgerPgCronResidueRecovery.test.ts",
        "tests/agentWorkLedgerDelegatedBrowserDispatchPolicy.test.ts",
        ".agents/skills/route-task/SKILL.md",
        "AGENTS.md",
        "docs/ai/cto-lane-contract.md",
        "docs/ai/high-risk-paths.md",
        "docs/ai/WIN-43-persistent-qa-personas-handoff.md",
        "docs/ai/WIN-43-qa-audit-credential-handoff.md",
        "docs/ai/reviews/WIN-43-qa-persona-delegated-browser-dispatch-attestation.json",
        "tests/workflows/provision-qa-personas.test.ts",
        "docs/ai/reviews/WIN-275-solo-maintainer-attestation.json",
        "scripts/agent-work-ledger-hosted-advisory-canary.mjs",
      ]),
    );
  });

  it("requires exact-main owner approval, current-main merge proof, safe OID input, and immediate revalidation", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toMatch(
      /recover:\s+name: pg_cron residue recovery\s+if: \$\{\{ always\(\) \}\}/,
    );
    expect(workflow).toContain("timeout-minutes: 20");
    expect(workflow).toContain("commit_sha:");
    expect(workflow).toContain("pull_request_number:");
    expect(workflow).toContain("expected_pg_cron_oid:");
    expect(workflow).toContain("approval_acknowledgement:");
    expect(workflow).toContain(
      "I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_WIN_275_PG_CRON_RESIDUE_RECOVERY",
    );
    expect(workflow).not.toContain(
      "I_APPROVE_WIN_275_PG_CRON_RESIDUE_RECOVERY",
    );
    expect(workflow).toContain(
      "process.env.GITHUB_ACTOR !== process.env.GITHUB_REPOSITORY_OWNER",
    );
    expect(workflow).toContain("process.env.GITHUB_REF !== 'refs/heads/main'");
    expect(workflow).toContain("pull.merge_commit_sha !== commitSha");
    expect(workflow).toContain("Approval pull request must reference WIN-275.");
    expect(workflow).toContain("check.head_sha === commitSha");
    expect(workflow).toContain("check.app?.slug === 'github-actions'");
    expect(workflow).toContain("check.conclusion === 'success'");
    expect(workflow).toContain("/collaborators?affiliation=direct");
    expect(workflow).toContain("value.permissions?.admin");
    expect(workflow).toContain("value.permissions?.maintain");
    expect(workflow).toContain("value.permissions?.push");
    expect(workflow).toContain("protectedSurfaceHashes");
    expect(workflow).toContain("specialistReviews");
    expect(workflow).toContain("Specialist review identities must be independent.");
    expect(workflow).toContain(
      "docs/ai/reviews/WIN-275-pg-cron-residue-recovery-solo-maintainer-attestation.json",
    );
    expect(workflow).toContain(
      "Revalidate authority immediately before pg_cron recovery",
    );
    expect(workflow).toContain("PR_HEAD_SHA:");
    expect(workflow).toContain("Exact-head required CI changed before hosted recovery");
    expect(workflow.match(/git status --porcelain/g)).toHaveLength(2);
    expect(workflow).not.toContain("workflow_call:");
    expect(workflow).not.toContain("npm ci");
  });

  it("keeps the workflow bounded to public sanitized artifacts and the one recovery script", () => {
    expect(workflow).toContain(
      "node scripts/agent-work-ledger-pg-cron-residue-recovery.mjs preflight",
    );
    expect(workflow).toContain(
      "node scripts/agent-work-ledger-pg-cron-residue-recovery.mjs recover",
    );
    expect(workflow).toContain(
      "node scripts/agent-work-ledger-pg-cron-residue-recovery.mjs reconcile",
    );
    expect(workflow).toContain("steps.recovery.outcome == 'failure'");
    expect(workflow).toContain("steps.recovery.outcome == 'cancelled'");
    expect(workflow).toContain(
      "node scripts/agent-work-ledger-pg-cron-residue-recovery.mjs disabled-fallback",
    );
    expect(workflow).toContain(
      "agent-work-ledger-pg-cron-residue-recovery-public/**",
    );
    expect(workflow).not.toContain(
      "agent-work-ledger-pg-cron-residue-recovery-private/**",
    );
    expect(workflow).not.toContain("workflow_run:");
  });

  it("validates expected_pg_cron_oid as a positive safe integer and builds an exact-oid mutation query", () => {
    expect(parseExpectedPgCronOid("457927")).toBe(457927);
    for (const invalid of ["", "0", "-1", "1.5", "abc", `${2 ** 53}`]) {
      expect(() => parseExpectedPgCronOid(invalid)).toThrow(
        "expected_pg_cron_oid must be a positive safe integer.",
      );
    }
    expect(() => parseExpectedPgCronOid("457928")).toThrow(
      "expected_pg_cron_oid must match approved incident OID 457927.",
    );

    const query = buildPgCronResidueRecoveryMutationQuery(457927);
    expect(query).toContain("set local lock_timeout = '5s'");
    expect(query).toContain("set local statement_timeout = '20s'");
    expect(query).toContain("pg_advisory_xact_lock");
    expect(query).toContain("lock table cron.job in access exclusive mode");
    expect(query).toContain("public.agent_work_items");
    expect(query).toContain("vault.secrets");
    expect(query).toContain("auth.users");
    expect(query).not.toContain("in share mode");
    expect(query).toContain("oid = 457927::oid");
    expect(query).toContain("drop extension pg_cron");
    expect(query).toContain("foreign_cron_job_detected");
    expect(query).toContain("pg_cron_oid_drifted");
    expect(query).toContain("cron_job_residue_detected");
    expect(query).not.toContain("$1");
  });

  it("keeps the script read-only outside the single recovery transaction and forbids unrelated cleanup", () => {
    expect(script).toContain("read_only: true");
    expect(script).toContain("cron_job_count");
    expect(script).toContain("vault_canary_names");
    expect(script).toContain("queue_depth");
    expect(script).toContain("archive_depth");
    expect(script).toContain("draft_rows");
    expect(script).toContain("active_retention_policies");
    expect(script).toContain("ungranted_lock_count");
    expect(script).toContain("synthetic_fixture_residue");
    expect(script).toContain("DROP EXTENSION pg_cron");
    expect(script).not.toContain("delete from vault");
    expect(script).not.toContain("delete from public.agent_work_items");
    expect(script).not.toContain("delete from pgmq");
    expect(script).not.toContain("delete from public.agent_work_retention_policies");
    expect(script).not.toContain("workflow_run");
    expect(script).not.toContain("active mode");
  });

  it("runs disabled reassertion, preflight, one mutation transaction, and post-verify in strict order", async () => {
    const calls: string[] = [];
    const result = await runPgCronResidueRecovery(
      "I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_WIN_275_PG_CRON_RESIDUE_RECOVERY",
      457927,
      {
        reassertRuntimeDisabled: async () => calls.push("mode:disabled"),
        readHostedBaseline: async () => {
          calls.push("baseline:read:before");
          return cleanBaseline;
        },
        executeRecoveryMutation: async (oid: number) => {
          calls.push(`mutation:${oid}`);
          return { dropped_extension: true, dropped_oid: oid, cron_job_count: 0 };
        },
        readHostedPostRecovery: async () => {
          calls.push("baseline:read:after");
          return { ...cleanBaseline, pg_cron_oid: null };
        },
      },
    );

    expect(calls).toEqual([
      "mode:disabled",
      "baseline:read:before",
      "mutation:457927",
      "baseline:read:after",
    ]);
    expect(result).toEqual({
      droppedExtension: true,
      droppedOid: 457927,
      cronJobCount: 0,
      postExtensionPresent: false,
    });
  });

  it("fails closed before mutation when the baseline drifts or the acknowledgement is wrong", async () => {
    await expect(
      runPgCronResidueRecovery(
        "I_APPROVE_SOMETHING_ELSE",
        457927,
        {
          reassertRuntimeDisabled: async () => undefined,
          readHostedBaseline: async () => cleanBaseline,
          executeRecoveryMutation: async () => ({
            dropped_extension: true,
            dropped_oid: 457927,
            cron_job_count: 0,
          }),
          readHostedPostRecovery: async () => ({ ...cleanBaseline, pg_cron_oid: null }),
        },
      ),
    ).rejects.toThrow(
      "Exact pg_cron residue recovery acknowledgement is required.",
    );

    const calls: string[] = [];
    await expect(
      runPgCronResidueRecovery(
        "I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_WIN_275_PG_CRON_RESIDUE_RECOVERY",
        457927,
        {
          reassertRuntimeDisabled: async () => calls.push("mode:disabled"),
          readHostedBaseline: async () => ({
            ...cleanBaseline,
            cron_job_count: 1,
          }),
          executeRecoveryMutation: async () => {
            calls.push("mutation");
            return { dropped_extension: true, dropped_oid: 457927, cron_job_count: 0 };
          },
          readHostedPostRecovery: async () => ({ ...cleanBaseline, pg_cron_oid: null }),
        },
      ),
    ).rejects.toThrow("Hosted pg_cron residue recovery baseline drifted.");
    expect(calls).toEqual(["mode:disabled"]);
  });

  it("fails closed when the mutation or post-state does not prove the exact OID was removed and other baselines stayed zero", async () => {
    const acknowledgement =
      "I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_WIN_275_PG_CRON_RESIDUE_RECOVERY";

    await expect(
      runPgCronResidueRecovery(acknowledgement, 457927, {
        reassertRuntimeDisabled: async () => undefined,
        readHostedBaseline: async () => cleanBaseline,
        executeRecoveryMutation: async () => ({
          dropped_extension: true,
          dropped_oid: 999999,
          cron_job_count: 0,
        }),
        readHostedPostRecovery: async () => ({ ...cleanBaseline, pg_cron_oid: null }),
      }),
    ).rejects.toThrow("pg_cron recovery mutation did not prove exact OID removal.");

    await expect(
      runPgCronResidueRecovery(acknowledgement, 457927, {
        reassertRuntimeDisabled: async () => undefined,
        readHostedBaseline: async () => cleanBaseline,
        executeRecoveryMutation: async () => ({
          dropped_extension: true,
          dropped_oid: 457927,
          cron_job_count: 0,
        }),
        readHostedPostRecovery: async () => ({
          ...cleanBaseline,
          pg_cron_oid: null,
          queue_depth: 1,
        }),
      }),
    ).rejects.toThrow("Hosted pg_cron residue recovery post-state drifted.");
  });

  it("writes a sanitized failure artifact without secret, query, or exception text", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "win-275-pg-cron-"));
    try {
      const artifact = await writePgCronResidueRecoveryFailureArtifact(directory);
      const contents = readFileSync(artifact, "utf8");
      const parsed = JSON.parse(contents);
      expect(parsed.fixed_booleans).toEqual({
        execution_failed: true,
        residue_recovery_failed: true,
        runtime_disabled_reasserted: false,
        advisory_mode_enabled: false,
        schedule_created: false,
        retention_deletion_performed: false,
        customer_record_contents_returned: false,
      });
      expect(contents).not.toContain("exception");
      expect(contents).not.toContain("drop extension pg_cron");
      expect(contents).not.toContain("access_token");
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("confirms disabled mode only after the protected request succeeds", async () => {
    const bodies: unknown[] = [];
    await expect(
      reassertRuntimeDisabledWith(async (body) => {
        bodies.push(body);
      }),
    ).resolves.toBe(true);
    expect(bodies).toEqual([
      [{ name: "AGENT_WORK_LEDGER_RUNTIME_MODE", value: "disabled" }],
    ]);

    await expect(
      reassertRuntimeDisabledWith(async () => {
        throw new Error("synthetic management request failure");
      }),
    ).rejects.toThrow("synthetic management request failure");
  });

  it("reconciles both post-commit timeout and pre-commit failure states", async () => {
    await expect(
      reconcilePgCronResidueRecovery(457927, async () => ({
        ...cleanBaseline,
        pg_cron_oid: null,
      })),
    ).resolves.toEqual({
      recoveryCompleted: true,
      remainingExtensionCount: 0,
    });

    await expect(
      reconcilePgCronResidueRecovery(457927, async () => cleanBaseline),
    ).resolves.toEqual({
      recoveryCompleted: false,
      remainingExtensionCount: 1,
    });

    await expect(
      reconcilePgCronResidueRecovery(457927, async () => ({
        ...cleanBaseline,
        pg_cron_oid: 457928,
      })),
    ).rejects.toThrow(
      "Hosted pg_cron residue recovery reconciliation drifted.",
    );
  });

  it("documents the exact OID contract, non-goals, and owner-only delegated boundary", () => {
    for (const doc of [handoff, review]) {
      expect(doc).toContain("owner-dispatched");
      expect(doc).toContain("expected_pg_cron_oid");
      expect(doc).toContain("457927");
      expect(doc).toContain(
        "I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_WIN_275_PG_CRON_RESIDUE_RECOVERY",
      );
      expect(doc).toContain("read-only preflight");
      expect(doc).toContain("cron.job=0");
      expect(doc).toContain("DROP EXTENSION pg_cron");
      expect(doc).toContain("ACCESS EXCLUSIVE");
      expect(doc).toContain("no retries");
      expect(doc).toContain("no chaining");
      expect(doc).toContain("no advisory");
      expect(doc).toContain("no active");
      expect(doc).toContain("no schedules");
      expect(doc).toContain("no Vault");
      expect(doc).toContain("no retention deletion");
      expect(doc).toContain("do not return or archive customer record contents");
      expect(doc).toContain("public artifact");
      expect(doc).toContain("hash-bound specialist manifest");
      expect(doc).toContain("created after final specialist review");
    }
  });
});
