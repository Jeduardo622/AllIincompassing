import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertPreflightSummary,
  assertSanitizedItem,
  buildCleanupBatch,
  deriveState,
  executePhase,
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

const workflow = readFileSync(workflowPath, "utf8");
const script = readFileSync(scriptPath, "utf8");
const packageJson = readFileSync(packageJsonPath, "utf8");
const docs = [opsDocPath, activationPlanPath, handoffPath].map((filePath) =>
  readFileSync(filePath, "utf8"),
);

const zeroSummary = () => ({
  runtime_config: { present: true, actions_disabled: false },
  scheduler: {
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

  it("binds execution to the merged WIN-275 PR and current independent approval", () => {
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
    expect(script).toContain("insert into public.profiles");
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
          event_trigger_enabled: false,
        },
        { final: true },
      ),
    ).toThrow("Append-only event trigger is not enabled.");
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
    for (const doc of docs) {
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
