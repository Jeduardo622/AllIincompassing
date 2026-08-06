import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertPreflightSummary,
  assertSanitizedItem,
  buildCleanupBatch,
  deriveState,
  executePhase,
  firstRow,
} from "../scripts/agent-work-ledger-hosted-shadow-proof.mjs";

const workflowPath = path.resolve(
  ".github/workflows/agent-work-ledger-hosted-shadow-proof.yml",
);
const scriptPath = path.resolve(
  "scripts/agent-work-ledger-hosted-shadow-proof.mjs",
);
const packageJsonPath = path.resolve("package.json");
const opsDocPath = path.resolve("docs/ops/agent-work-ledger.md");
const activationPlanPath = path.resolve(
  "docs/superpowers/plans/2026-08-04-agent-work-ledger-operational-activation.md",
);
const handoffPath = path.resolve(
  "docs/ai/handoffs/agent-work-ledger-foundation.md",
);
const laneContractPath = path.resolve("docs/ai/cto-lane-contract.md");
const highRiskPathsPath = path.resolve("docs/ai/high-risk-paths.md");
const soloAttestationPath = path.resolve(
  "docs/ai/reviews/WIN-275-solo-maintainer-attestation.json",
);

const workflow = readFileSync(workflowPath, "utf8");
const script = readFileSync(scriptPath, "utf8");
const packageJson = readFileSync(packageJsonPath, "utf8");
const proofDocs = [opsDocPath, activationPlanPath, handoffPath].map(
  (filePath) => readFileSync(filePath, "utf8"),
);
const policyDocs = [laneContractPath, highRiskPathsPath].map((filePath) =>
  readFileSync(filePath, "utf8"),
);
const docs = [...proofDocs, ...policyDocs];
const requiredCiChecks = [
  "policy",
  "lint-typecheck",
  "unit-tests",
  "build",
  "tier0-browser",
  "auth-browser-smoke",
  "ci-gate",
];

const canonicalRepositoryHash = (repositoryPath: string) =>
  createHash("sha256")
    .update(
      readFileSync(path.resolve(repositoryPath), "utf8").replace(/\r\n/g, "\n"),
    )
    .digest("hex");

const extractWorkflowNodeScript = (stepName: string) => {
  const stepStart = workflow.indexOf(`- name: ${stepName}`);
  expect(stepStart).toBeGreaterThanOrEqual(0);
  const nextStep = workflow.indexOf("\n      - name:", stepStart + 1);
  const step = workflow.slice(stepStart, nextStep < 0 ? undefined : nextStep);
  const match = step.match(
    /node --input-type=module <<'NODE'\r?\n([\s\S]*?)\r?\n\s+NODE/,
  );
  expect(match).not.toBeNull();
  return (match?.[1] ?? "").replace(/^ {10}/gm, "");
};

type MockResponse = { body: unknown; status?: number };

const runApprovalValidator = (
  acknowledgement: string,
  responses: Record<string, MockResponse>,
) => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "ledger-approval-"));
  const outputPath = path.join(tempDir, "github-output.txt");
  writeFileSync(outputPath, "", "utf8");
  const prelude = `
    const responses = JSON.parse(Buffer.from(process.env.MOCK_RESPONSES_B64, 'base64').toString('utf8'));
    globalThis.fetch = async (input) => {
      const response = responses[String(input)];
      if (!response) return new Response(JSON.stringify({ message: 'not mocked' }), { status: 404 });
      return new Response(JSON.stringify(response.body), { status: response.status ?? 200 });
    };
  `;
  const preludeUrl = `data:text/javascript;base64,${Buffer.from(prelude).toString("base64")}`;
  const result = spawnSync(
    process.execPath,
    [`--import=${preludeUrl}`, "--input-type=module"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        APPROVAL_ACKNOWLEDGEMENT: acknowledgement,
        COMMIT_SHA: "a".repeat(40),
        GITHUB_ACTOR: "Jeduardo622",
        GITHUB_ACTOR_ID: "42",
        GITHUB_OUTPUT: outputPath,
        GITHUB_REF: "refs/heads/main",
        GITHUB_REPOSITORY_OWNER: "Jeduardo622",
        GITHUB_TOKEN: "synthetic-token",
        MOCK_RESPONSES_B64: Buffer.from(JSON.stringify(responses)).toString(
          "base64",
        ),
        PULL_REQUEST_NUMBER: "900",
        REPOSITORY: "Jeduardo622/AllIincompassing",
      },
      input: extractWorkflowNodeScript(
        "Validate owner approval and immutable main SHA",
      ),
    },
  );
  const output = readFileSync(outputPath, "utf8");
  rmSync(tempDir, { recursive: true, force: true });
  return { ...result, output };
};

const baseApprovalResponses = () => {
  const repository = "Jeduardo622/AllIincompassing";
  const api = `https://api.github.com/repos/${repository}`;
  const headSha = "b".repeat(40);
  return {
    api,
    headSha,
    responses: {
      [`${api}/git/ref/heads/main`]: {
        body: { ref: "refs/heads/main", object: { sha: "a".repeat(40) } },
      },
      [`${api}/pulls/900`]: {
        body: {
          base: { ref: "main" },
          body: "WIN-275",
          head: { repo: { full_name: repository }, sha: headSha },
          merge_commit_sha: "a".repeat(40),
          merged: true,
          merged_at: "2026-08-05T20:00:00Z",
          state: "closed",
          title: "WIN-275 solo attestation",
        },
      },
      [`${api}/commits/${headSha}/check-runs?per_page=100&page=1`]: {
        body: {
          check_runs: requiredCiChecks.map((name) => ({
            app: { slug: "github-actions" },
            conclusion: "success",
            head_sha: headSha,
            name,
            status: "completed",
          })),
        },
      },
    } as Record<string, MockResponse>,
  };
};

const zeroSummary = () => ({
  runtime_config: { present: true, actions_disabled: false },
  scheduler: {
    extensions: { pgCron: false, pgNet: true, vault: true },
    secretsReady: false,
    runnerJob: { present: false },
    sweeperJob: { present: false },
  },
  vault_name_count: 0,
  active_retention_policy_count: 0,
  retention: {
    success: false,
    reason_code: "policy_unapproved",
    deleted_count: 0,
  },
  ledger_counts: Object.fromEntries(
    [
      "agent_work_items",
      "agent_work_item_dependencies",
      "agent_work_assessment_links",
      "agent_work_steps",
      "agent_work_step_dependencies",
      "agent_work_evidence",
      "agent_work_approvals",
      "agent_work_attempts",
      "agent_work_effects",
      "agent_work_events",
      "agent_work_retention_holds",
      "agent_work_retention_receipts",
      "agent_work_caloptima_draft_packets",
      "q_agent_work_steps",
      "a_agent_work_steps",
    ].map((key) => [key, 0]),
  ),
  scoped_counts: { agent_execution_traces: 0 },
  fixture_counts: { organizations: 0, clients: 0, assessments: 0, users: 0 },
  vault_extension_present: false,
  session_replication_role: "origin",
  event_trigger_enabled: true,
});

const sanitizedItem = (id: string, stepId: string) => ({
  approvals: [],
  blockers: [],
  dueAt: null,
  hasOwner: false,
  id,
  objective: "synthetic objective",
  risk: "moderate",
  status: "pending",
  steps: [
    {
      evidenceCount: 0,
      executionMode: "deterministic",
      id: stepId,
      key: "validate_inputs",
      lastReasonCode: null,
      status: "ready",
    },
  ],
  updatedAt: "2026-08-05T00:00:00.000Z",
  workflowKey: "assessment.iehp.prepare",
  workflowVersion: 1,
});

describe("agent work hosted shadow proof contract", () => {
  it("normalizes both Management API query response envelopes", () => {
    expect(firstRow([{ profiles: 2 }])).toEqual({ profiles: 2 });
    expect(firstRow({ result: [{ roles: 2 }] })).toEqual({ roles: 2 });
  });

  it("adds a local-only contract command and protected workflow", () => {
    expect(existsSync(workflowPath)).toBe(true);
    expect(existsSync(scriptPath)).toBe(true);
    expect(packageJson).toContain('"agent-work:hosted-shadow-proof:contract"');
    expect(packageJson).toContain(
      "tests/agentWorkLedgerHostedShadowProof.test.ts",
    );
    expect(packageJson).not.toContain(
      "agent-work-ledger-hosted-shadow-proof.mjs proof",
    );
  });

  it("requires owner dispatch from main and an immutable current main SHA", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("pull_request_number:");
    expect(workflow).toContain(
      "I_APPROVE_AGENT_WORK_LEDGER_HOSTED_SHADOW_PROOF",
    );
    expect(workflow).not.toContain(
      "if: github.actor == github.repository_owner",
    );
    expect(workflow).toContain(
      "process.env.GITHUB_ACTOR !== process.env.GITHUB_REPOSITORY_OWNER",
    );
    expect(workflow).toContain("process.env.GITHUB_REF !== 'refs/heads/main'");
    expect(workflow).toContain("/git/ref/heads/main");
    expect(workflow).toContain("mainRef.ref !== 'refs/heads/main'");
    expect(workflow).toContain("mainHeadSha !== commitSha");
    expect(workflow).toMatch(
      /ref: \$\{\{ steps\.approval\.outputs\.validated_sha \}\}/,
    );
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("timeout-minutes: 45");
  });

  it("binds execution to the merged WIN-275 PR and preserves independent approval", () => {
    expect(workflow).toContain("pull.merged !== true");
    expect(workflow).toContain("pull.merge_commit_sha !== commitSha");
    expect(workflow).toContain("Approval pull request must reference WIN-275.");
    expect(workflow).toContain("review.state === 'APPROVED'");
    expect(workflow).toContain("review.commit_id === pull.head?.sha");
    expect(workflow).toContain(
      "review.user?.login !== process.env.GITHUB_REPOSITORY_OWNER",
    );
    expect(workflow).toContain("review.user?.type === 'User'");
    expect(workflow).toContain("headers: githubHeaders");
    expect(workflow).not.toContain("headers: response.headers");
  });

  it("requires exact-head CI and a fail-closed solo-maintainer owner attestation", () => {
    expect(workflow).toContain("checks: read");
    expect(workflow).toContain("GITHUB_ACTOR_ID: ${{ github.actor_id }}");
    expect(workflow).toContain(
      "I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_AGENT_WORK_LEDGER_HOSTED_SHADOW_PROOF",
    );
    expect(workflow).toContain("/check-runs");
    expect(workflow).toContain("per_page=100&page=");
    expect(workflow).toContain("check.name === requiredName");
    expect(workflow).toContain("check.head_sha === pull.head?.sha");
    expect(workflow).toContain("check.app?.slug === 'github-actions'");
    expect(workflow).toContain("check.status === 'completed'");
    expect(workflow).toContain("check.conclusion === 'success'");
    for (const requiredCheck of requiredCiChecks) {
      expect(workflow).toContain(`'${requiredCheck}'`);
    }
    expect(workflow).toContain("/collaborators?affiliation=direct");
    expect(workflow).toContain("repositoryDetails.owner?.type !== 'User'");
    expect(workflow).toContain(
      "String(repositoryDetails.owner?.id) !== process.env.GITHUB_ACTOR_ID",
    );
    expect(workflow).toContain("collaborator.type === 'User'");
    expect(workflow).toContain(
      "collaborator.permissions?.admin || collaborator.permissions?.maintain || collaborator.permissions?.push",
    );
    expect(workflow).toContain("eligibleMaintainers.length !== 1");
    expect(workflow).toContain("reviewRoute = 'solo_owner_attestation'");
    expect(workflow).toContain("reviewRoute = 'independent_human'");
  });

  it("requires a commit-bound machine-readable specialist review attestation", () => {
    expect(existsSync(soloAttestationPath)).toBe(true);
    if (!existsSync(soloAttestationPath)) return;
    const attestation = JSON.parse(
      readFileSync(soloAttestationPath, "utf8"),
    ) as {
      protectedSurfaceHashes: Record<string, string>;
      specialistReviews: Record<string, { agentId: string; verdict: string }>;
    };
    for (const specialist of [
      "code-review-engineer",
      "security-engineer",
      "test-engineer",
      "supabase-reviewer",
    ]) {
      expect(attestation.specialistReviews[specialist]?.verdict).toBe("PASS");
      expect(attestation.specialistReviews[specialist]?.agentId).toMatch(
        /^[0-9a-f-]{36}$/,
      );
    }
    expect(
      attestation.protectedSurfaceHashes[
        "docs/ai/reviews/WIN-275-hosted-shadow-proof-attestation.md"
      ],
    ).toMatch(/^[0-9a-f]{64}$/);
    expect(
      attestation.protectedSurfaceHashes[
        "scripts/agent-work-ledger-hosted-shadow-proof.mjs"
      ],
    ).toMatch(/^[0-9a-f]{64}$/);
    expect(workflow).toContain(
      "const attestationPath = 'docs/ai/reviews/WIN-275-solo-maintainer-attestation.json'",
    );
    expect(workflow).toContain("getRepositoryContent(attestationPath)");
    expect(workflow).toContain("protectedSurfaceHashes");
    expect(workflow).toContain("createHash('sha256')");
    expect(workflow).toContain("code-review-engineer");
    expect(workflow).toContain("security-engineer");
    expect(workflow).toContain("test-engineer");
    expect(workflow).toContain("supabase-reviewer");
    expect(workflow).toContain(
      "'scripts/agent-work-ledger-hosted-shadow-proof.mjs'",
    );
  });

  it("binds every protected surface to canonical repository bytes", () => {
    const attestation = JSON.parse(
      readFileSync(soloAttestationPath, "utf8"),
    ) as {
      protectedSurfaceHashes: Record<string, string>;
    };

    for (const [repositoryPath, expectedHash] of Object.entries(
      attestation.protectedSurfaceHashes,
    )) {
      expect(expectedHash, repositoryPath).toBe(
        canonicalRepositoryHash(repositoryPath),
      );
    }
  });

  it("runs fallbacks only after hosted prerequisites exist", () => {
    expect(workflow).toMatch(
      /- name: Revalidate approval immediately before hosted access\r?\n\s+id: authority_revalidation/,
    );
    expect(workflow).toMatch(
      /- name: Preflight and setup synthetic shadow proof\r?\n\s+id: preflight/,
    );
    for (const stepName of [
      "Restore disabled runtime mode",
      "Verify disabled mode and cleanup",
      "Final disabled fallback",
    ]) {
      expect(workflow).toMatch(
        new RegExp(
          `- name: ${stepName}\\r?\\n\\s+if: always\\(\\) && steps\\.preflight\\.outcome != 'skipped'`,
        ),
      );
    }
    expect(workflow).toMatch(
      /- name: Upload sanitized artifact\r?\n\s+if: always\(\) && steps\.authority_revalidation\.outcome == 'success'/,
    );
  });

  it("paginates GitHub authority evidence and revalidates it before hosted access", () => {
    expect(workflow).toContain("const fetchAllPages = async");
    expect(workflow).toContain("page <= 20");
    expect(workflow).toContain(
      "GitHub pagination exceeded the fail-closed page limit.",
    );
    expect(workflow).toMatch(
      /Revalidate approval immediately before hosted access[\s\S]*?\/git\/ref\/heads\/main/,
    );
    expect(workflow).toMatch(
      /Revalidate approval immediately before hosted access[\s\S]*?REVIEW_ROUTE:/,
    );
    expect(workflow).toMatch(
      /Revalidate approval immediately before hosted access[\s\S]*?collaborators\?affiliation=direct/,
    );
    expect(workflow).toMatch(
      /Revalidate approval immediately before hosted access[\s\S]*?check-runs\?per_page=100&page=/,
    );
    expect(workflow).toMatch(
      /Revalidate approval immediately before hosted access[\s\S]*?Required ci-gate changed after initial validation\./,
    );
  });

  it("documents the narrow solo-maintainer policy without weakening critical routing", () => {
    for (const doc of docs) {
      expect(doc).toContain("solo-maintainer owner-attested critical lane");
    }
    expect(docs.join("\n").toLowerCase()).toContain(
      "independent-human approval remains the default",
    );
    expect(docs.join("\n")).toContain(
      "exactly one GitHub human maintainer with write-or-higher access",
    );
  });

  it("executes the independent-human route with paginated current-head review evidence", () => {
    const { api, headSha, responses } = baseApprovalResponses();
    responses[`${api}/pulls/900/reviews?per_page=100&page=1`] = {
      body: Array.from({ length: 100 }, (_, id) => ({ id })),
    };
    responses[`${api}/pulls/900/reviews?per_page=100&page=2`] = {
      body: [
        {
          commit_id: headSha,
          id: 101,
          state: "APPROVED",
          submitted_at: "2026-08-05T20:01:00Z",
          user: { login: "independent-reviewer", type: "User" },
        },
      ],
    };

    const result = runApprovalValidator(
      "I_APPROVE_AGENT_WORK_LEDGER_HOSTED_SHADOW_PROOF",
      responses,
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.output).toContain("review_route=independent_human");
    expect(result.output).toContain(`validated_pr_head_sha=${headSha}`);
  });

  it("executes the solo-owner route only with matching identity and hash-bound specialist evidence", () => {
    const { api, responses } = baseApprovalResponses();
    responses[`${api}/pulls/900/reviews?per_page=100&page=1`] = { body: [] };
    responses[api] = {
      body: { owner: { id: 42, login: "Jeduardo622", type: "User" } },
    };
    responses[`${api}/collaborators?affiliation=direct&per_page=100&page=1`] = {
      body: [
        {
          id: 42,
          login: "Jeduardo622",
          permissions: { admin: true, maintain: true, push: true },
          type: "User",
        },
      ],
    };

    const protectedSurfaces = [
      ".github/workflows/agent-work-ledger-hosted-shadow-proof.yml",
      "scripts/agent-work-ledger-hosted-shadow-proof.mjs",
      "tests/agentWorkLedgerHostedShadowProof.test.ts",
      "AGENTS.md",
      ".agents/skills/route-task/SKILL.md",
      "docs/ai/cto-lane-contract.md",
      "docs/ai/high-risk-paths.md",
      "docs/ops/agent-work-ledger.md",
      "docs/superpowers/plans/2026-08-04-agent-work-ledger-operational-activation.md",
      "docs/ai/handoffs/agent-work-ledger-foundation.md",
      "docs/ai/reviews/WIN-275-hosted-shadow-proof-attestation.md",
    ];
    const protectedSurfaceHashes = Object.fromEntries(
      protectedSurfaces.map((repositoryPath) => [
        repositoryPath,
        createHash("sha256").update(`content:${repositoryPath}`).digest("hex"),
      ]),
    );
    const attestation = {
      schemaVersion: 1,
      issue: "WIN-275",
      reviewMode: "solo-maintainer-owner-attestation",
      repository: "Jeduardo622/AllIincompassing",
      specialistReviews: {
        "code-review-engineer": {
          agentId: "11111111-1111-4111-8111-111111111111",
          verdict: "PASS",
        },
        "security-engineer": {
          agentId: "22222222-2222-4222-8222-222222222222",
          verdict: "PASS",
        },
        "test-engineer": {
          agentId: "33333333-3333-4333-8333-333333333333",
          verdict: "PASS",
        },
        "supabase-reviewer": {
          agentId: "44444444-4444-4444-8444-444444444444",
          verdict: "PASS",
        },
      },
      invariants: {
        exactMainAndCi: true,
        shadowOnly: true,
        disabledRestoreRequired: true,
        sanitizedEvidenceOnly: true,
        zeroProviderCalls: true,
        retentionPolicyUnapproved: true,
      },
      protectedSurfaceHashes,
    };
    responses[
      `${api}/contents/docs/ai/reviews/WIN-275-solo-maintainer-attestation.json?ref=${"a".repeat(40)}`
    ] = {
      body: {
        content: Buffer.from(JSON.stringify(attestation)).toString("base64"),
        encoding: "base64",
        type: "file",
      },
    };
    for (const repositoryPath of protectedSurfaces) {
      responses[`${api}/contents/${repositoryPath}?ref=${"a".repeat(40)}`] = {
        body: {
          content: Buffer.from(`content:${repositoryPath}`).toString("base64"),
          encoding: "base64",
          type: "file",
        },
      };
    }

    const result = runApprovalValidator(
      "I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_AGENT_WORK_LEDGER_HOSTED_SHADOW_PROOF",
      responses,
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.output).toContain("review_route=solo_owner_attestation");
    expect(result.output).toMatch(/attestation_sha256=[0-9a-f]{64}/);
  });

  it("rejects solo-owner attestation when another human has write access", () => {
    const { api, responses } = baseApprovalResponses();
    responses[`${api}/pulls/900/reviews?per_page=100&page=1`] = { body: [] };
    responses[api] = {
      body: { owner: { id: 42, login: "Jeduardo622", type: "User" } },
    };
    responses[`${api}/collaborators?affiliation=direct&per_page=100&page=1`] = {
      body: [
        {
          id: 42,
          login: "Jeduardo622",
          permissions: { admin: true },
          type: "User",
        },
        {
          id: 43,
          login: "second-maintainer",
          permissions: { push: true },
          type: "User",
        },
      ],
    };

    const result = runApprovalValidator(
      "I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_AGENT_WORK_LEDGER_HOSTED_SHADOW_PROOF",
      responses,
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "exactly one matching human maintainer with write-or-higher access",
    );
  });

  it("rejects approval when any exact-head required CI check is missing", () => {
    const { api, headSha, responses } = baseApprovalResponses();
    responses[`${api}/commits/${headSha}/check-runs?per_page=100&page=1`] = {
      body: {
        check_runs: requiredCiChecks
          .filter((name) => name !== "auth-browser-smoke")
          .map((name) => ({
            app: { slug: "github-actions" },
            conclusion: "success",
            head_sha: headSha,
            name,
            status: "completed",
          })),
      },
    };

    const result = runApprovalValidator(
      "I_APPROVE_AGENT_WORK_LEDGER_HOSTED_SHADOW_PROOF",
      responses,
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "missing successful required CI: auth-browser-smoke",
    );
  });

  it("keeps hosted credentials step-scoped and uses repository secret fallbacks", () => {
    const workflowHeader = workflow.split(/\r?\njobs:\r?\n/s)[0] ?? workflow;
    expect(workflowHeader).not.toMatch(
      /SUPABASE_(?:ACCESS_TOKEN|SERVICE_ROLE_KEY|PUBLISHABLE_KEY):/,
    );
    expect(workflow).toContain(
      "SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}",
    );
    expect(workflow).toContain("secrets.SUPABASE_PUBLISHABLE_KEY");
    expect(workflow).toContain("secrets.SUPABASE_SECRET_KEY");
    expect(workflow).not.toContain("SUPABASE_PAT");
    expect(workflow).not.toContain("SUPABASE_DB_PASSWORD");
  });

  it("runs phased proof with redundant unconditional restore and sanitized artifact upload", () => {
    expect(workflow).toContain(
      "agent-work-ledger-hosted-shadow-proof.mjs preflight/setup",
    );
    expect(workflow).toContain(
      "agent-work-ledger-hosted-shadow-proof.mjs proof",
    );
    expect(workflow).toContain(
      "agent-work-ledger-hosted-shadow-proof.mjs cleanup/verify",
    );
    expect(workflow).toMatch(
      /Restore disabled runtime mode[\s\S]*?if: always\(\)/,
    );
    expect(workflow).toMatch(
      /Verify disabled mode and cleanup[\s\S]*?if: always\(\)/,
    );
    expect(workflow).toMatch(/Final disabled fallback[\s\S]*?if: always\(\)/);
    expect(
      workflow.match(
        /supabase secrets set AGENT_WORK_LEDGER_RUNTIME_MODE=disabled/g,
      ),
    ).toHaveLength(2);
    expect(workflow).toContain("AGENT_WORK_LEDGER_RUNTIME_MODE=shadow");
    expect(workflow).toMatch(/retention-days:\s*[1-7]/);
    expect(workflow).not.toContain("agent-work-runner");
    expect(workflow).not.toContain("agent-work-sweeper");
  });

  it("derives deterministic, run-scoped synthetic fixture identities", () => {
    const first = deriveState("12345", "2");
    const second = deriveState("12345", "2");
    const other = deriveState("12346", "2");
    expect(first).toEqual(second);
    expect(first.fixture.organizationAId).not.toBe(
      other.fixture.organizationAId,
    );
    expect(first.fixture.organizationAId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.users[0].email).toMatch(
      /^agent-work-shadow-a-12345-2@example\.com$/,
    );
    expect(first.users[0].email).not.toBe(first.users[1].email);
  });

  it("uses the validated default metadata for synthetic organizations", () => {
    expect(script).toContain(
      "insert into public.organizations (id, name, slug)",
    );
    expect(script).not.toContain(
      `'\{"fixture":"agent-work-shadow-proof"\}'::jsonb`,
    );
  });

  it("cleans up a pre-user setup failure without claiming an API proof", async () => {
    const state = deriveState("pre-user-failure", "1");
    const events: string[] = [];

    await executePhase("cleanup/verify", {
      readState: async () => structuredClone(state),
      setRuntimeMode: async (mode: string) =>
        events.push(`runtime:set:${mode}`),
      signIn: async () => {
        throw new Error("sign-in-must-not-run");
      },
      pollForRuntimeMode: async () => {
        throw new Error("runtime-poll-must-not-run");
      },
      buildCleanupBatch,
      managementWrite: async () => events.push("cleanup:database"),
      deleteAuthUsers: async () => events.push("cleanup:auth"),
      deleteOrganizations: async () => events.push("cleanup:organizations"),
      readPreflightSummary: async () => zeroSummary(),
      assertPreflightSummary,
      writePublicArtifact: async ({
        fixedBooleans,
      }: {
        fixedBooleans: Record<string, boolean>;
      }) => {
        expect(fixedBooleans.disabled_restored).toBe(true);
        expect(fixedBooleans.disabled_api_verified).toBe(false);
        events.push("artifact:final");
      },
    });

    expect(events).toEqual([
      "runtime:set:disabled",
      "cleanup:database",
      "cleanup:auth",
      "cleanup:organizations",
      "artifact:final",
    ]);
  });

  it("requires disabled API verification after a synthetic user exists", async () => {
    const state = deriveState("post-user-failure", "1");
    state.users[0].id = "10000000-0000-4000-8000-000000000001";

    await expect(
      executePhase("cleanup/verify", {
        readState: async () => structuredClone(state),
        setRuntimeMode: async () => undefined,
        signIn: async () => "synthetic-token",
        pollForRuntimeMode: async () => {
          throw new Error("injected-disabled-api-failure");
        },
      }),
    ).rejects.toThrow("injected-disabled-api-failure");
  });

  it("executes the real three-phase control flow through deterministic fakes", async () => {
    const initialState = deriveState("behavior-proof", "1");
    const itemA = sanitizedItem(
      "10000000-0000-4000-8000-000000000011",
      "10000000-0000-4000-8000-000000000012",
    );
    const itemB = sanitizedItem(
      "20000000-0000-4000-8000-000000000011",
      "20000000-0000-4000-8000-000000000012",
    );
    let state = structuredClone(initialState);
    const events: string[] = [];
    const operations = {
      deriveState: () => structuredClone(initialState),
      supabaseUrl: () => "https://wnnjeqheqxxyrgsjmygy.supabase.co",
      declaredRuntimeMode: () => "shadow",
      writeState: async (nextState: typeof state) => {
        state = structuredClone(nextState);
        events.push("state:write");
      },
      readState: async () => structuredClone(state),
      readPreflightSummary: async () => zeroSummary(),
      assertPreflightSummary,
      setupOrganizations: async () => events.push("fixtures:organizations"),
      setupUsers: async (nextState: typeof state) => {
        nextState.users[0].id = "10000000-0000-4000-8000-000000000001";
        nextState.users[1].id = "10000000-0000-4000-8000-000000000002";
        events.push("fixtures:users");
      },
      setupClientsAndAssessments: async (nextState: typeof state) => {
        nextState.fixturesCreated = true;
        events.push("fixtures:tenant-data");
      },
      signIn: async (user: { email: string }) =>
        user.email.includes("-a-") ? "token-a" : "token-b",
      pollForRuntimeMode: async (mode: string) =>
        events.push(`runtime:verified:${mode}`),
      setRuntimeMode: async (mode: string) =>
        events.push(`runtime:set:${mode}`),
      writePublicArtifact: async ({
        fixedBooleans,
      }: {
        fixedBooleans: Record<string, boolean>;
      }) =>
        events.push(
          fixedBooleans.cleanup_completed
            ? "artifact:final"
            : "artifact:progress",
        ),
      createWorkItem: async (_token: string, assessmentId: string) => {
        const selected =
          assessmentId === initialState.fixture.assessmentAId ? itemA : itemB;
        events.push(`create:${selected.id}`);
        return structuredClone(selected);
      },
      requestAgentWork: async (
        token: string,
        method: string,
        pathName: string,
      ) => {
        if (method === "POST" && pathName.endsWith("/owner")) {
          events.push("advisory:denied");
          return {
            response: { status: 403 },
            parsed: { code: "advisory_mode_required" },
          };
        }
        if (method === "GET" && pathName.startsWith("?")) {
          const selected = token === "token-a" ? itemA : itemB;
          return {
            response: { status: 200 },
            parsed: { success: true, data: [structuredClone(selected)] },
          };
        }
        if (token === "token-b" && pathName === `/${itemA.id}`) {
          events.push("tenant:cross-denied");
          return { response: { status: 404 }, parsed: {} };
        }
        return {
          response: { status: 200 },
          parsed: { success: true, data: structuredClone(itemA) },
        };
      },
      managementRead: async (query: string, parameters: string[]) => {
        expect(query).toMatch(
          /from public\.agent_work_attempts\s+where organization_id in \(\$1::uuid, \$2::uuid\)/,
        );
        expect(query).toMatch(
          /from public\.agent_work_effects\s+where organization_id in \(\$1::uuid, \$2::uuid\)/,
        );
        expect(query).toMatch(
          /from public\.agent_execution_traces\s+where organization_id in \(\$1::uuid, \$2::uuid\)\s+or work_item_id in \(\$3::uuid, \$4::uuid\)/,
        );
        expect(query).toMatch(
          /from public\.agent_work_caloptima_draft_packets\s+where organization_id in \(\$1::uuid, \$2::uuid\)/,
        );
        expect(parameters).toEqual([
          initialState.fixture.organizationAId,
          initialState.fixture.organizationBId,
          itemA.id,
          itemB.id,
        ]);
        return {
          forbidden_counts: {
            attempts: 0,
            effects: 0,
            traces: 0,
            draft_packets: 0,
          },
        };
      },
      assertSanitizedItem,
      buildCleanupBatch,
      managementWrite: async (query: string) => {
        expect(query).toContain("begin;");
        expect(query).not.toContain("session_replication_role = replica");
        events.push("cleanup:database");
      },
      deleteAuthUsers: async () => events.push("cleanup:auth"),
      deleteOrganizations: async () => events.push("cleanup:organizations"),
    };

    await executePhase("preflight/setup", operations);
    await executePhase("proof", operations);
    await executePhase("cleanup/verify", operations);

    expect(
      events.filter((event) => event === `create:${itemA.id}`),
    ).toHaveLength(2);
    expect(events).toContain("tenant:cross-denied");
    expect(events).toContain("advisory:denied");
    expect(events.indexOf("runtime:set:shadow")).toBeLessThan(
      events.indexOf(`create:${itemA.id}`),
    );
    expect(events.indexOf("runtime:set:disabled")).toBeLessThan(
      events.indexOf("cleanup:database"),
    );
    expect(events.slice(-4)).toEqual([
      "cleanup:database",
      "cleanup:auth",
      "cleanup:organizations",
      "artifact:final",
    ]);
  });

  it("persists the first work-item cleanup scope before a later create fails", async () => {
    const state = deriveState("partial-proof", "1");
    state.fixturesCreated = true;
    state.shadowRequested = true;
    const itemA = sanitizedItem(
      "10000000-0000-4000-8000-000000000021",
      "10000000-0000-4000-8000-000000000022",
    );
    let createCount = 0;
    const writes: (typeof state)[] = [];

    await expect(
      executePhase("proof", {
        declaredRuntimeMode: () => "shadow",
        readState: async () => structuredClone(state),
        signIn: async () => "synthetic-token",
        createWorkItem: async () => {
          createCount += 1;
          if (createCount === 1) return structuredClone(itemA);
          throw new Error("injected_second_create_failure");
        },
        writeState: async (nextState: typeof state) => {
          writes.push(structuredClone(nextState));
        },
      }),
    ).rejects.toThrow("injected_second_create_failure");

    expect(writes).toHaveLength(1);
    expect(writes[0].proof).toEqual({
      workItemAId: itemA.id,
      workItemBId: null,
    });
  });

  it("uses real auth, tenant fixtures, and real create/list/detail requests", () => {
    expect(script).toContain("/admin/users");
    expect(script).toContain("/token?grant_type=password");
    expect(script).toContain("insert into public.organizations");
    expect(script).toContain("update public.profiles");
    expect(script).not.toContain("insert into public.profiles");
    expect(script).toContain("insert into public.user_roles");
    expect(script).toContain("insert into public.clients");
    expect(script).toContain("insert into public.assessment_documents");
    expect(script).toContain('"POST", "/assessment-prep"');
    expect(script).toContain(
      "Idempotent create returned a different work item.",
    );
    expect(script).toContain("Cross-tenant detail did not fail closed.");
    expect(script).toContain("advisory_mode_required");
  });

  it("does not write the generated profiles full_name column", () => {
    const setupUsers =
      script.match(
        /const setupUsers[\s\S]*?const setupClientsAndAssessments/,
      )?.[0] ?? "";

    expect(setupUsers).toContain("update public.profiles");
    expect(setupUsers).not.toContain("full_name");
    expect(setupUsers).toContain("where profiles.id = values_table.id");
    expect(setupUsers).toContain("role = 'admin'::public.role_type");
    expect(setupUsers).toContain("insert into public.user_roles");
    expect(setupUsers).toContain(
      "on conflict (user_id, role_id) do update set is_active = excluded.is_active, expires_at = null",
    );
    expect(setupUsers).toContain("profileRow.profiles === 2");
    expect(setupUsers).toContain("roleRow.roles === 2");
  });

  it("uses only the approved runtime secret and only shadow/disabled values", () => {
    const setRuntimeMode =
      script.match(/const setRuntimeMode[\s\S]*?\n};/)?.[0] ?? "";
    expect(script).toContain(
      'const RUNTIME_SECRET_NAME = "AGENT_WORK_LEDGER_RUNTIME_MODE"',
    );
    expect(setRuntimeMode).toContain("`${RUNTIME_SECRET_NAME}=${mode}`");
    expect(setRuntimeMode).toContain(
      'mode === "shadow" || mode === "disabled"',
    );
    expect(setRuntimeMode).not.toContain("advisory");
    expect(setRuntimeMode).not.toContain("active");
    expect(script).not.toContain("AGENT_WORK_RUNNER_SECRET");
    expect(script).not.toContain("AGENT_WORK_SWEEPER_SECRET");
    expect(script).not.toContain("AGENT_WORK_LEGACY_GENERATION_DISABLED=");
  });

  it("fails closed on hosted preflight and final zero-residue invariants", () => {
    const summary = zeroSummary();
    expect(() =>
      assertPreflightSummary(summary, { final: true }),
    ).not.toThrow();
    expect(() =>
      assertPreflightSummary(
        { ...summary, vault_name_count: 1 },
        { final: true },
      ),
    ).toThrow("Hosted scheduler Vault names must remain absent.");
    expect(() =>
      assertPreflightSummary(
        {
          ...summary,
          ledger_counts: { ...summary.ledger_counts, agent_work_items: 1 },
        },
        { final: true },
      ),
    ).toThrow("Expected global zero for agent_work_items.");
    expect(() =>
      assertPreflightSummary(
        {
          ...summary,
          scoped_counts: { agent_execution_traces: 1 },
        },
        { final: true },
      ),
    ).toThrow("Expected synthetic-scope zero for agent_execution_traces.");
    expect(() =>
      assertPreflightSummary(
        {
          ...summary,
          scheduler: {
            ...summary.scheduler,
            extensions: { ...summary.scheduler.extensions, pgCron: true },
          },
        },
        { final: true },
      ),
    ).toThrow("Hosted pg_cron extension must remain absent.");
    expect(() =>
      assertPreflightSummary(
        {
          ...summary,
          event_trigger_enabled: false,
        },
        { final: true },
      ),
    ).toThrow("Append-only event trigger is not enabled.");
  });

  it("keeps read-only preflight free of privileged control functions", () => {
    const preflightSql =
      script.match(/const preflightQuery = `([\s\S]*?)`;/)?.[1] ?? "";

    expect(preflightSql).toContain("'scheduler_extensions'");
    expect(preflightSql).not.toContain(
      "public.hosted_agent_work_queue_scheduler_status()",
    );
    expect(preflightSql).not.toContain(
      "public.prune_agent_work_retention_category",
    );
  });

  it("scopes shared trace residue checks to synthetic organizations and work items", () => {
    expect(script).toMatch(
      /'agent_execution_traces', \(\s*select count\(\*\)::integer from public\.agent_execution_traces\s+where organization_id in \(\$1::uuid, \$2::uuid\)\s+or work_item_id in \(\$9::uuid, \$10::uuid\)\s*\)/,
    );
    expect(script).not.toContain(
      "'agent_execution_traces', (select count(*)::integer from public.agent_execution_traces),",
    );
  });

  it("builds one crash-atomic FK-enforced exact-scope cleanup batch", () => {
    expect(() => buildCleanupBatch(deriveState("777", "1"))).not.toThrow();
    const state = deriveState("777", "1");
    state.users[0].id = "10000000-0000-4000-8000-000000000001";
    state.users[1].id = "10000000-0000-4000-8000-000000000002";
    state.proof.workItemAId = "10000000-0000-4000-8000-000000000003";
    state.proof.workItemBId = "10000000-0000-4000-8000-000000000004";
    const cleanup = buildCleanupBatch(state);
    expect(cleanup).toContain("begin;");
    expect(cleanup).not.toContain("session_replication_role = replica");
    expect(cleanup).toContain(
      "alter table public.agent_work_events disable trigger agent_work_events_prevent_update;",
    );
    expect(cleanup).toContain(
      "alter table public.agent_work_events enable trigger agent_work_events_prevent_update;",
    );
    expect(cleanup).toContain("message->>'organizationId'");
    expect(cleanup).toContain("foreign_agent_work_item_detected");
    expect(cleanup).toContain("synthetic_agent_work_cleanup_incomplete");
    expect(cleanup).toContain("public.agent_work_caloptima_draft_packets");
    expect(cleanup).toContain("public.agent_work_retention_receipts");
    expect(cleanup).toMatch(
      /delete from public\.agent_execution_traces where organization_id in \([^)]+\)\s+or work_item_id in \([^)]+\);/,
    );
    expect(cleanup).toMatch(
      /exists \(\s*select 1 from public\.agent_execution_traces\s+where organization_id in \([^)]+\)\s+or work_item_id in \([^)]+\)\s*\)/,
    );
    expect(cleanup).not.toContain("metadata");
    expect(cleanup).not.toContain(" like ");
    expect(cleanup).not.toContain("%");
    expect(cleanup).not.toContain("delete from auth.users");
    expect(cleanup.trim().endsWith("commit;")).toBe(true);
  });

  it("rejects unsafe cleanup interpolation", () => {
    const state = deriveState("888", "1");
    state.fixture.organizationAId = "x'); drop table public.organizations; --";
    expect(() => buildCleanupBatch(state)).toThrow("Invalid synthetic UUID.");
  });

  it("guards optional Vault access behind extension detection", () => {
    expect(script).toContain("extname = 'supabase_vault'");
    expect(script).toContain("summary.vault_extension_present === true");
    expect(
      script.indexOf("summary.vault_extension_present === true"),
    ).toBeLessThan(script.indexOf("from vault.secrets"));
  });

  it("enforces the exact sanitized response DTO", () => {
    const item = {
      approvals: [],
      blockers: [],
      dueAt: null,
      hasOwner: false,
      id: "10000000-0000-4000-8000-000000000001",
      objective: "synthetic objective",
      risk: "moderate",
      status: "pending",
      steps: [
        {
          evidenceCount: 0,
          executionMode: "deterministic",
          id: "10000000-0000-4000-8000-000000000002",
          key: "validate_inputs",
          lastReasonCode: null,
          status: "ready",
        },
      ],
      updatedAt: "2026-08-05T00:00:00.000Z",
      workflowKey: "assessment.iehp.prepare",
      workflowVersion: 1,
    };
    expect(() => assertSanitizedItem(item)).not.toThrow();
    expect(() =>
      assertSanitizedItem({ ...item, organizationId: "forbidden" }),
    ).toThrow("work item keys drifted.");
  });

  it("uses bounded requests and never logs hosted response bodies", () => {
    expect(script).toContain("AbortSignal.timeout(REQUEST_TIMEOUT_MS)");
    expect(script).toContain("RUNTIME_POLL_TIMEOUT_MS = 60_000");
    expect(script).not.toContain("await response.text()");
    expect(script).not.toContain("console.log");
    expect(script).not.toContain("console.error");
  });

  it("keeps the evidence schema numeric, boolean, hashed, and PHI-free", () => {
    expect(script).toContain("assertNumericRecord(counts");
    expect(script).toContain("fixed_booleans");
    expect(script).toContain("summary_sha256");
    expect(script).toContain(
      "Refusing sensitive or identifying evidence output.",
    );
    expect(workflow).toContain(
      "agent-work-ledger-hosted-shadow-proof-public/**",
    );
    expect(workflow).not.toContain(
      "agent-work-ledger-hosted-shadow-proof-private/**",
    );
  });

  it("does not execute hosted operations when imported", () => {
    expect(script).toMatch(/if \(import\.meta\.url === pathToFileURL/);
    expect(deriveState("import-check", "1").fixturesCreated).toBe(false);
  });

  it("documents the owner-dispatched shadow-only boundary", () => {
    for (const doc of proofDocs) {
      expect(doc).toContain("hosted shadow proof");
      expect(doc).toContain("owner-dispatched");
      expect(doc).toContain("shadow-only");
      expect(doc).toContain("advisory");
      expect(doc).toContain("active");
      expect(doc).toContain("disabled");
      expect(doc).toContain("cleanup");
      expect(doc).toContain("human review");
    }
  });
});
