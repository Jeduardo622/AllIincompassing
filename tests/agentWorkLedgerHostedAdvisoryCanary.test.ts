import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertPreflight,
  buildDropCanaryPgCronExtensionQuery,
  buildMeasurementQuery,
  buildPreflightQuery,
  captureCanarySecretDigests,
  extractMeasurementSummary,
  parseEdgeSecretListing,
  runCleanupSequence,
  writePhaseFailureArtifact,
} from "../scripts/agent-work-ledger-hosted-advisory-canary.mjs";

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
  it("extracts measurement summaries from resolved management results", () => {
    expect(
      extractMeasurementSummary({
        result: [{ measurements: { cron_jobs: 2, http_successes: 4 } }],
      }),
    ).toEqual({
      cron_jobs: 2,
      http_successes: 4,
    });
    expect(
      extractMeasurementSummary([
        { measurements: { cron_jobs: 1, http_failures: 0 } },
      ]),
    ).toEqual({
      cron_jobs: 1,
      http_failures: 0,
    });
  });

  it("requires read-only cleanup authority proof before hosted mutation", () => {
    const query = buildPreflightQuery();

    expect(query).toContain("'current_role_is_superuser'");
    expect(query).toContain("'current_role_is_supabase_admin'");
    expect(query).toContain("'current_role_can_act_as_supabase_admin'");
    expect(query).toContain("'cleanup_authority_proven'");
    expect(query).not.toContain(
      "pg_has_role(current_user, 'supabase_admin', 'SET')",
    );
    expect(script.match(/await assertMutationAuthorityPreflight\(\)/g)).toHaveLength(
      1,
    );

    const baselineSummary = {
      runtime_mode_secret_present: true,
      pg_cron: false,
      pg_net: true,
      vault: true,
      cron_jobs: 0,
      vault_names: 0,
      queue_depth: 0,
      archive_depth: 0,
      ledger_rows: 0,
      draft_packets: 0,
      active_retention_policies: 0,
      retention_decisions: 3,
      cleanup_authority_proven: true,
      current_role_is_superuser: false,
      current_role_is_supabase_admin: true,
      current_role_can_act_as_supabase_admin: false,
    };

    expect(() => assertPreflight(baselineSummary)).not.toThrow();
    expect(() =>
      assertPreflight({
        ...baselineSummary,
        cleanup_authority_proven: false,
        current_role_is_supabase_admin: false,
      }),
    ).toThrow("Management API cleanup authority over pg_cron is unavailable.");
  });

  it("rechecks authority only before pg_cron installation and never gates cleanup", () => {
    const setupMeasureStart = script.indexOf("const setupMeasurePhase");
    const cleanupVerifyStart = script.indexOf("const cleanupVerifyPhase");
    const setupMeasureSource = script.slice(
      setupMeasureStart,
      cleanupVerifyStart,
    );
    const cleanupVerifySource = script.slice(cleanupVerifyStart);

    expect(setupMeasureStart).toBeGreaterThan(0);
    expect(cleanupVerifyStart).toBeGreaterThan(setupMeasureStart);
    expect(setupMeasureSource).toContain(
      "await assertMutationAuthorityPreflight();",
    );
    expect(setupMeasureSource.indexOf("assertMutationAuthorityPreflight")).toBeLessThan(
      setupMeasureSource.indexOf("installCanaryPgCronExtension"),
    );
    expect(cleanupVerifySource).not.toContain(
      "assertMutationAuthorityPreflight",
    );
    expect(workflow).toMatch(
      /Cleanup and verify zero residue\s+if: always\(\)/,
    );
  });

  it("joins cron run history to cron jobs before filtering by job name", () => {
    const query = buildMeasurementQuery();

    expect(query).toContain("join cron.job as jobs on jobs.jobid = runs.jobid");
    expect(query).toContain(
      "jobs.jobname in ('agent-work-runner-hosted','agent-work-sweeper-hosted')",
    );
    expect(query).not.toMatch(
      /from cron\.job_run_details(?:\s+as\s+\w+)?\s+where\s+(?:\w+\.)?jobname\b/,
    );
    expect(query).not.toContain("a.jobid=b.jobid");
    expect(query).toContain(
      "a.runid<b.runid and a.start_time < b.end_time and b.start_time < a.end_time",
    );
  });

  it("builds a parameter-free pg_cron ownership guard from a validated OID", () => {
    const query = buildDropCanaryPgCronExtensionQuery(275);

    expect(query).toContain("oid = 275::oid");
    expect(query).not.toContain("$1");
    expect(query).toContain("canary_pg_cron_ownership_drifted");
    expect(query).toContain("foreign_cron_job_detected");
    expect(() => buildDropCanaryPgCronExtensionQuery(Number.NaN)).toThrow(
      "Canary pg_cron ownership proof is missing.",
    );
  });

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

  it("parses JSON and ANSI table secret listings without secret values", () => {
    expect(script).toContain('runManagementSecretsRequest("POST"');
    expect(script).toContain('runManagementSecretsRequest("DELETE"');
    expect(script).not.toContain('runManagementSecretsRequest("GET"');
    const jsonListing = parseEdgeSecretListing(
      JSON.stringify([
        { name: "AGENT_WORK_LEDGER_RUNTIME_MODE", value: "runtime-digest" },
        { name: "AGENT_WORK_RUNNER_SECRET", digest: "runner-digest" },
      ]),
    );
    expect(jsonListing).toEqual(
      new Map([
        ["AGENT_WORK_LEDGER_RUNTIME_MODE", "runtime-digest"],
        ["AGENT_WORK_RUNNER_SECRET", "runner-digest"],
      ]),
    );
    const ansiListing = parseEdgeSecretListing(
      "\u001b[1m NAME \u001b[0m │ \u001b[1m DIGEST \u001b[0m\nAGENT_WORK_LEDGER_RUNTIME_MODE │ runtime-digest\nAGENT_WORK_RUNNER_SECRET │ runner-digest\n",
    );
    expect(ansiListing).toEqual(jsonListing);
    expect(() =>
      parseEdgeSecretListing("unexpected human output without a digest column"),
    ).toThrow("Secret listing output is unsupported.");
  });

  it("captures exact post-create digests before cleanup can claim ownership", () => {
    expect(
      captureCanarySecretDigests(
        new Map([
          ["AGENT_WORK_RUNNER_SECRET", "server-runner-digest"],
          ["AGENT_WORK_SWEEPER_SECRET", "server-sweeper-digest"],
          ["AGENT_WORK_HOSTED_PROJECT_REF", "server-project-digest"],
        ]),
      ),
    ).toEqual({
      AGENT_WORK_RUNNER_SECRET: "server-runner-digest",
      AGENT_WORK_SWEEPER_SECRET: "server-sweeper-digest",
      AGENT_WORK_HOSTED_PROJECT_REF: "server-project-digest",
    });
    expect(() => captureCanarySecretDigests(new Map())).toThrow(
      "Created canary Edge secret digest is missing.",
    );
  });

  it("cleans up disabled-first and proves zero residue across jobs, vault names, edge secrets, pg_cron, and fixtures", () => {
    expect(script).toContain('cleanupOperations.setRuntimeMode("disabled")');
    expect(script).toContain("cleanupOperations.disableHostedScheduler()");
    expect(script).toContain("cleanupOperations.unsetEdgeSecrets(");
    expect(script).toContain("secret.id = owned.id::uuid");
    expect(script).not.toContain("delete from vault.secrets where name = any");
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
      {
        pgCronInstalledByCanary: true,
        pgCronExtensionOid: 275,
        edgeSecretDigests: {
          AGENT_WORK_RUNNER_SECRET: "runner-digest",
          AGENT_WORK_SWEEPER_SECRET: "sweeper-digest",
          AGENT_WORK_HOSTED_PROJECT_REF: "project-digest",
        },
        vaultSecretIds: {
          agent_work_hosted_project_ref: "00000000-0000-4000-8000-000000000001",
          agent_work_hosted_publishable_key:
            "00000000-0000-4000-8000-000000000002",
          agent_work_hosted_runner_secret:
            "00000000-0000-4000-8000-000000000003",
          agent_work_hosted_sweeper_secret:
            "00000000-0000-4000-8000-000000000004",
        },
      },
      {
        setRuntimeMode: async (mode: string) => calls.push(`mode:${mode}`),
        disableHostedScheduler: record("scheduler:disable"),
        listEdgeSecrets: async () => {
          calls.push("edge-secrets:list");
          return new Map([
            ["AGENT_WORK_RUNNER_SECRET", "runner-digest"],
            ["AGENT_WORK_SWEEPER_SECRET", "sweeper-digest"],
            ["AGENT_WORK_HOSTED_PROJECT_REF", "project-digest"],
          ]);
        },
        unsetEdgeSecrets: async (names: string[]) =>
          calls.push(`edge-secrets:unset:${names.join(",")}`),
        deleteVaultSecrets: async (ids: Record<string, string>) =>
          calls.push(`vault:delete:${Object.keys(ids).join(",")}`),
        dropCanaryPgCronExtension: record("pg-cron:drop"),
        deleteSyntheticFixtures: record("fixtures:delete"),
      },
    );
    expect(calls).toEqual([
      "mode:disabled",
      "scheduler:disable",
      "edge-secrets:list",
      "edge-secrets:unset:AGENT_WORK_RUNNER_SECRET,AGENT_WORK_SWEEPER_SECRET,AGENT_WORK_HOSTED_PROJECT_REF",
      "vault:delete:agent_work_hosted_project_ref,agent_work_hosted_publishable_key,agent_work_hosted_runner_secret,agent_work_hosted_sweeper_secret",
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
          listEdgeSecrets: async () => new Map(),
          unsetEdgeSecrets: async () => calls.push("edge-secrets:unset"),
          deleteVaultSecrets: async () => calls.push("vault:delete"),
          dropCanaryPgCronExtension: async () => calls.push("pg-cron:drop"),
          deleteSyntheticFixtures: async () => calls.push("fixtures:delete"),
        },
      ),
    ).rejects.toThrow("Canary cleanup completed with failures.");
    expect(calls.at(-1)).toBe("fixtures:delete");
  });

  it("does not unset canary secrets that were never created", async () => {
    const calls: string[] = [];
    await runCleanupSequence(
      { pgCronInstalledByCanary: false },
      {
        setRuntimeMode: async () => calls.push("mode:disabled"),
        disableHostedScheduler: async () => calls.push("scheduler:disable"),
        listEdgeSecrets: async () =>
          new Map([
            ["AGENT_WORK_LEDGER_RUNTIME_MODE", "runtime-digest"],
            ["UNRELATED_SECRET", "unrelated-digest"],
          ]),
        unsetEdgeSecrets: async () => calls.push("edge-secrets:unset"),
        deleteVaultSecrets: async () => calls.push("vault:delete"),
        dropCanaryPgCronExtension: async () => calls.push("pg-cron:drop"),
        deleteSyntheticFixtures: async () => calls.push("fixtures:delete"),
      },
    );
    expect(calls).toEqual([
      "mode:disabled",
      "scheduler:disable",
      "fixtures:delete",
    ]);
  });

  it("fails closed without deletion when a canary name has foreign ownership", async () => {
    const calls: string[] = [];
    await expect(
      runCleanupSequence(
        {
          pgCronInstalledByCanary: false,
          edgeSecretDigests: { AGENT_WORK_RUNNER_SECRET: "owned-digest" },
        },
        {
          setRuntimeMode: async () => calls.push("mode:disabled"),
          disableHostedScheduler: async () => calls.push("scheduler:disable"),
          listEdgeSecrets: async () =>
            new Map([["AGENT_WORK_RUNNER_SECRET", "foreign-digest"]]),
          unsetEdgeSecrets: async () => calls.push("edge-secrets:unset"),
          deleteVaultSecrets: async () => calls.push("vault:delete"),
          dropCanaryPgCronExtension: async () => calls.push("pg-cron:drop"),
          deleteSyntheticFixtures: async () => calls.push("fixtures:delete"),
        },
      ),
    ).rejects.toThrow("Canary cleanup completed with failures.");
    expect(calls).not.toContain("edge-secrets:unset");
    expect(calls.at(-1)).toBe("fixtures:delete");
  });

  it.each([
    ["preflight", "failure-preflight.json"],
    ["setup/measure", "failure-setup-measure.json"],
    ["cleanup/verify", "failure-cleanup-verify.json"],
  ] as const)(
    "writes a sanitized artifact when %s fails before normal evidence",
    async (phase, filename) => {
      const directory = mkdtempSync(path.join(os.tmpdir(), "win-275-failure-"));
      try {
        const artifact = await writePhaseFailureArtifact(phase, directory);
        const contents = readFileSync(artifact, "utf8");
        const parsed = JSON.parse(contents);
        expect(parsed.fixed_booleans).toEqual({
          execution_failed: true,
          preflight_failed: phase === "preflight",
          setup_measure_failed: phase === "setup/measure",
          cleanup_verify_failed: phase === "cleanup/verify",
          retention_activation_performed: false,
          retention_deletion_performed: false,
        });
        expect(contents).not.toContain("error");
        expect(contents).not.toContain("secret");
        expect(path.basename(artifact)).toBe(filename);
      } finally {
        rmSync(directory, { force: true, recursive: true });
      }
    },
  );

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
        .update(
          readFileSync(path.resolve(surface), "utf8").replace(/\r\n/g, "\n"),
        )
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
