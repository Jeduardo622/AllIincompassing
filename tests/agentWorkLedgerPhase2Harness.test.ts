import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  HARD_TIMEOUT_BUDGETS_MS,
  PHASE2_CHECKS,
  PHASE2_COMMAND,
  PHASE2_HEAD_GUARD_PATHS,
  buildPhase2ChildEnv,
  createArchivePlan,
  createRunArtifacts,
  derivePhase2RuntimeEnv,
  getCheckDefinition,
  getCheckEnvironmentNames,
  parseSupabaseStatusEnv,
  runPhase2Harness,
  sanitizeCommandEvidence,
  validatePhase2HostEnv,
} from "../scripts/agent-work-ledger-harness/phase2Harness.mjs";
import {
  assertExactPhase2FunctionUrl,
  assertLocalPostgresUrl,
  assertLocalSupabaseHttpUrl,
} from "../scripts/agent-work-ledger-harness/localRuntime.mjs";
import { buildSyntheticPostgresUrl } from
  "./helpers/syntheticPostgresUrl";

const tempRoots: string[] = [];
const committedSha = "b".repeat(40);
const imageId = `sha256:${"a".repeat(64)}`;
const anonKey = "local-anon-key-not-for-artifacts";
const serviceRoleKey = "local-service-role-key-not-for-artifacts";
const loopbackPostgresUrl =
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const containerPostgresUrl =
  "postgresql://postgres:postgres@supabase_db_AllIincompassing:5432/postgres";
const statusOutput = [
  'API_URL="http://127.0.0.1:54321"',
  `DB_URL="${loopbackPostgresUrl}"`,
  `ANON_KEY="${anonKey}"`,
  `SERVICE_ROLE_KEY="${serviceRoleKey}"`,
].join("\n");

type FailureKind = "nonzero" | "timeout";
type ResidueKind = "container" | "volume" | "network-attached" | "network-remains";
type SupabaseResidueKind = "clears-after-retry" | "container" | "volume";

type Invocation = {
  command: string;
  args: string[];
  env: Record<string, string | undefined>;
};

const makeExecutor = ({
  failCleanupAudit = false,
  failPreflightComposeDown = false,
  failPreflightResidueProof = false,
  failStatus = false,
  firstResetFails = false,
  gitStatusOutput = "",
  gitStatusRequiredPathspec,
  interruptController,
  interruptDuringComposeDown = false,
  failureInjection,
  preflightResidue,
  residue,
  supabaseResidue,
}: {
  failCleanupAudit?: boolean;
  failPreflightComposeDown?: boolean;
  failPreflightResidueProof?: boolean;
  failStatus?: boolean;
  firstResetFails?: boolean;
  gitStatusOutput?: string;
  gitStatusRequiredPathspec?: string;
  interruptController?: AbortController;
  interruptDuringComposeDown?: boolean;
  failureInjection?: { id: string; kind: FailureKind };
  preflightResidue?: "container" | "volume";
  residue?: ResidueKind;
  supabaseResidue?: SupabaseResidueKind;
} = {}) => {
  const invocations: Invocation[] = [];
  let networkExists = false;
  let failureInjected = false;
  let composeDownSeen = false;
  let composeResidueProofSeen = false;
  let containerProofCount = 0;
  let volumeProofCount = 0;
  let supabaseResidueActive = Boolean(supabaseResidue);
  let supabaseStopCount = 0;
  let resetCount = 0;
  const execute = async (
    command: string,
    args: string[],
    options: {
      env?: Record<string, string | undefined>;
      signal?: AbortSignal;
    } = {},
  ) => {
    invocations.push({ command, args, env: { ...options.env } });
    if (command === "supabase" && args[0] === "stop") {
      supabaseStopCount += 1;
      if (supabaseResidue === "clears-after-retry" && supabaseStopCount >= 2) {
        supabaseResidueActive = false;
      }
    }
    if (command === "supabase" && args[0] === "db" && args[1] === "reset") {
      resetCount += 1;
      if (firstResetFails && resetCount === 1) {
        return { code: 1, stdout: "", stderr: "transient reset failure" };
      }
    }
    if (command === "docker-compose" && args.includes("down") && !composeDownSeen) {
      composeDownSeen = true;
      if (failPreflightComposeDown) {
        return { code: 1, stdout: "", stderr: "preflight down failed" };
      }
    }
    if (command === "docker" && args[0] === "ps" && !composeResidueProofSeen) {
      composeResidueProofSeen = true;
      if (failPreflightResidueProof) {
        return { code: 1, stdout: "", stderr: "preflight proof failed" };
      }
    }
    if (
      interruptController &&
      !interruptDuringComposeDown &&
      command === "docker-compose" &&
      args.at(-1) === "stack-health"
    ) {
      interruptController.abort(new Error("phase2_signal_sigterm"));
      if (options.signal?.aborted) throw options.signal.reason;
    }
    if (
      interruptController &&
      interruptDuringComposeDown &&
      command === "docker-compose" &&
      args.includes("down")
    ) {
      interruptController.abort(new Error("phase2_signal_sigint"));
    }
    if (command === "git" && args[0] === "rev-parse") {
      return { code: 0, stdout: `${committedSha}\n`, stderr: "" };
    }
    if (command === "git" && args[0] === "status") {
      return {
        code: 0,
        stdout: !gitStatusRequiredPathspec || args.includes(gitStatusRequiredPathspec)
          ? gitStatusOutput
          : "",
        stderr: "",
      };
    }
    if (command === "docker" && args[0] === "image" && args[1] === "inspect") {
      return { code: 0, stdout: `${imageId}\n`, stderr: "" };
    }
    if (command === "supabase" && args[0] === "status") {
      if (failStatus) return { code: 1, stdout: "", stderr: "status failed" };
      return { code: 0, stdout: statusOutput, stderr: "" };
    }
    const harnessIndex = args.indexOf("agent-work-harness");
    const invokedCommand = harnessIndex >= 0 ? args.slice(harnessIndex + 1) : [];
    const invokedCheck = PHASE2_CHECKS.find(({ command: checkCommand }) =>
      JSON.stringify(checkCommand) === JSON.stringify(invokedCommand)
    );
    if (
      failureInjection &&
      !failureInjected &&
      invokedCheck?.id === failureInjection.id
    ) {
      failureInjected = true;
      if (failureInjection.kind === "timeout") {
        throw new Error("phase2_command_timeout");
      }
      return { code: 23, stdout: "check failed", stderr: "bounded failure" };
    }
    if (command === "docker" && args[0] === "network" && args[1] === "create") {
      networkExists = true;
      return { code: 0, stdout: "network-id\n", stderr: "" };
    }
    if (command === "docker" && args[0] === "network" && args[1] === "rm") {
      if (residue !== "network-remains") networkExists = false;
      return { code: 0, stdout: "agent-work-phase2\n", stderr: "" };
    }
    if (command === "docker" && args[0] === "network" && args[1] === "inspect") {
      return {
        code: 0,
        stdout: residue === "network-attached"
          ? '{"container-id":{"Name":"leftover"}}\n'
          : "{}\n",
        stderr: "",
      };
    }
    if (command === "docker" && args[0] === "network" && args[1] === "ls") {
      return { code: 0, stdout: networkExists ? "network-id\n" : "", stderr: "" };
    }
    if (command === "docker" && args[0] === "ps") {
      containerProofCount += 1;
      const composeResidueQuery = args.includes(
        "label=com.docker.compose.project=agent-work-ledger-phase2",
      );
      const supabaseResidueQuery = args.includes(
        "label=com.supabase.cli.project=AllIincompassing",
      );
      return {
        code: 0,
        stdout: supabaseResidueQuery && supabaseResidueActive &&
            supabaseResidue !== "volume"
          ? "leftover-supabase-container\n"
          : composeResidueQuery &&
              (preflightResidue === "container" && containerProofCount === 1 ||
                residue === "container" && containerProofCount > 1)
          ? "leftover-container\n"
          : "",
        stderr: "",
      };
    }
    if (command === "docker" && args[0] === "volume" && args[1] === "ls") {
      volumeProofCount += 1;
      const composeResidueQuery = args.includes(
        "label=com.docker.compose.project=agent-work-ledger-phase2",
      );
      const supabaseResidueQuery = args.includes(
        "label=com.supabase.cli.project=AllIincompassing",
      );
      return {
        code: 0,
        stdout: supabaseResidueQuery && supabaseResidueActive &&
            supabaseResidue === "volume"
          ? "leftover-supabase-volume\n"
          : composeResidueQuery &&
              (preflightResidue === "volume" && volumeProofCount === 1 ||
                residue === "volume" && volumeProofCount > 1)
          ? "leftover-volume\n"
          : "",
        stderr: "",
      };
    }
    if (
      failCleanupAudit &&
      command === "docker-compose" &&
      args.includes("scripts/agent-work-ledger-harness/cleanupAudit.mjs")
    ) {
      return {
        code: 1,
        stdout: "",
        stderr: `cleanup failed with ${serviceRoleKey}`,
      };
    }
    return {
      code: 0,
      stdout: `raw child output containing ${serviceRoleKey}`,
      stderr: "",
    };
  };
  return { execute, invocations };
};

const createHarnessFixture = async (options: {
  failCleanupAudit?: boolean;
  failPreflightComposeDown?: boolean;
  failPreflightResidueProof?: boolean;
  failStatus?: boolean;
  firstResetFails?: boolean;
  gitStatusOutput?: string;
  gitStatusRequiredPathspec?: string;
  interruptController?: AbortController;
  interruptDuringComposeDown?: boolean;
  failureInjection?: { id: string; kind: FailureKind };
  preflightResidue?: "container" | "volume";
  residue?: ResidueKind;
  supabaseResidue?: SupabaseResidueKind;
} = {}) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "phase2-harness-test-"));
  const archiveRoot = await mkdtemp(path.join(os.tmpdir(), "phase2-archive-test-"));
  tempRoots.push(cwd, archiveRoot);
  const executor = makeExecutor(options);
  let tick = 0;
  const run = () => runPhase2Harness({
    cwd,
    env: { PATH: process.env.PATH },
    signal: options.interruptController?.signal,
    runId: "20260803T010203Z-test",
    dependencies: {
      execute: executor.execute,
      now: () => new Date(Date.UTC(2026, 7, 3, 1, 2, 3 + tick++)),
      prepareArchiveContext: async () => ({
        tempRoot: archiveRoot,
        contextDir: cwd,
      }),
    },
  });
  return { cwd, executor, run };
};

const commandIndex = (
  invocations: Invocation[],
  command: string,
  argsPrefix: string[],
) => invocations.findIndex((entry) =>
  entry.command === command &&
  argsPrefix.every((value, index) => entry.args[index] === value)
);

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((entry) =>
    rm(entry, { recursive: true, force: true })
  ));
});

describe("agent work ledger phase2 harness contracts", () => {
  it("rejects hosted refs, remote urls, and inherited remote-capable credentials", () => {
    expect(() => validatePhase2HostEnv({
      SUPABASE_URL: "https://project.supabase.co",
    })).toThrow(/local-only/i);
    expect(() => validatePhase2HostEnv({
      SUPABASE_PROJECT_REF: "hosted-project-ref",
    })).toThrow(/project ref/i);
    expect(() => validatePhase2HostEnv({
      SUPABASE_SERVICE_ROLE_KEY: "host-service-role-key",
    })).toThrow(/credential/i);
    expect(() => validatePhase2HostEnv({
      OPENAI_API_KEY: "provider-key",
    })).toThrow(/credential/i);
    expect(() => validatePhase2HostEnv({
      SUPABASE_URL: "http://user:secret@127.0.0.1:54321/",
    })).toThrow(/exact local/i);
    expect(() => validatePhase2HostEnv({
      VITE_SUPABASE_URL: "http://127.0.0.1:54321/functions/v1?token=secret",
    })).toThrow(/exact local/i);
    expect(() => validatePhase2HostEnv({
      SUPABASE_DB_URL: buildSyntheticPostgresUrl(
        "postgresql",
        "postgres",
        "postgres",
        "127.0.0.1",
        54322,
        "not-postgres",
        "",
      ),
    })).toThrow(/exact local/i);
  });

  it("parses local status output and derives exact process-only container values", () => {
    const status = parseSupabaseStatusEnv(statusOutput);
    const runtime = derivePhase2RuntimeEnv(status, {
      runnerSecret: "runner-secret",
      sweeperSecret: "sweeper-secret",
    });

    expect(runtime).toMatchObject({
      PHASE2_CONTAINER_SUPABASE_URL:
        "http://supabase_kong_AllIincompassing:8000",
      PHASE2_CONTAINER_SUPABASE_DB_URL:
        containerPostgresUrl,
      PHASE2_SUPABASE_ANON_KEY: anonKey,
      PHASE2_SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
      PHASE2_RUNNER_SECRET: "runner-secret",
      PHASE2_SWEEPER_SECRET: "sweeper-secret",
    });

    expect(() => derivePhase2RuntimeEnv({
      ...status,
      API_URL: "https://project.supabase.co",
    }, {
      runnerSecret: "runner-secret",
      sweeperSecret: "sweeper-secret",
    })).toThrow(/status_api_url_not_loopback/);
    expect(() => derivePhase2RuntimeEnv({
      ...status,
      DB_URL: buildSyntheticPostgresUrl(
        "postgresql",
        "postgres",
        "postgres",
        "db.project.supabase.co",
        null,
        "postgres",
        "",
      ),
    }, {
      runnerSecret: "runner-secret",
      sweeperSecret: "sweeper-secret",
    })).toThrow(/status_db_url_not_loopback/);
  });

  it("executes one cold lifecycle and runs generic compose commands directly", async () => {
    const fixture = await createHarnessFixture();
    await fixture.run();
    const { invocations } = fixture.executor;

    const initialStop = commandIndex(invocations, "supabase", [
      "stop", "--project-id", "AllIincompassing", "--no-backup", "--yes",
    ]);
    const preflightComposeDown = invocations.findIndex((entry) =>
      entry.command === "docker-compose" && entry.args.includes("down") &&
      entry.args.includes("--volumes") && entry.args.includes("--remove-orphans")
    );
    const preflightContainerProof = invocations.findIndex((entry, index) =>
      index > preflightComposeDown && entry.command === "docker" &&
      entry.args[0] === "ps"
    );
    const preflightVolumeProof = invocations.findIndex((entry, index) =>
      index > preflightContainerProof && entry.command === "docker" &&
      entry.args[0] === "volume" && entry.args[1] === "ls"
    );
    const networkCreate = commandIndex(invocations, "docker", [
      "network", "create", "agent-work-phase2",
    ]);
    const start = commandIndex(invocations, "supabase", [
      "start", "--network-id", "agent-work-phase2", "--yes",
    ]);
    const status = commandIndex(invocations, "supabase", ["status", "-o", "env"]);
    expect(initialStop).toBeGreaterThanOrEqual(0);
    expect(preflightComposeDown).toBeGreaterThanOrEqual(0);
    expect(invocations[preflightComposeDown].env).toMatchObject({
      COMPOSE_DISABLE_ENV_FILE: "1",
      PHASE2_CONTAINER_SUPABASE_URL:
        "http://supabase_kong_AllIincompassing:8000",
      PHASE2_SUPABASE_ANON_KEY: "cleanup-unused",
      PHASE2_SUPABASE_SERVICE_ROLE_KEY: "cleanup-unused",
      PHASE2_RUNNER_SECRET: "cleanup-unused",
      PHASE2_SWEEPER_SECRET: "cleanup-unused",
    });
    expect(preflightContainerProof).toBeGreaterThan(preflightComposeDown);
    expect(preflightVolumeProof).toBeGreaterThan(preflightContainerProof);
    expect(initialStop).toBeGreaterThan(preflightVolumeProof);
    expect(networkCreate).toBeGreaterThan(initialStop);
    expect(start).toBeGreaterThan(networkCreate);
    expect(status).toBeGreaterThan(start);
    expect(invocations.filter((entry) =>
      entry.command === "supabase" && entry.args[0] === "start"
    )).toHaveLength(1);

    const tenantRun = invocations.find((entry) =>
      entry.command === "docker-compose" &&
      entry.args.includes("scripts/agent-work-ledger-security-contract.mjs")
    );
    expect(tenantRun?.args.slice(-2)).toEqual([
      "node",
      "scripts/agent-work-ledger-security-contract.mjs",
    ]);

    const customRun = invocations.find((entry) =>
      entry.command === "docker-compose" && entry.args.at(-1) === "stack-health"
    );
    expect(customRun?.args.slice(-3)).toEqual([
      "node",
      "scripts/agent-work-ledger-harness/containerEntrypoint.mjs",
      "stack-health",
    ]);
  });

  it("keeps resets on the isolated network and proves Supabase residue is gone", async () => {
    const fixture = await createHarnessFixture();
    await fixture.run();

    const resets = fixture.executor.invocations.filter((entry) =>
      entry.command === "supabase" &&
      entry.args[0] === "db" &&
      entry.args[1] === "reset"
    );
    expect(resets).toHaveLength(
      PHASE2_CHECKS.filter(({ destructive }) => destructive).length,
    );
    expect(resets.every(({ args }) =>
      args.includes("--network-id") && args.includes("agent-work-phase2")
    )).toBe(true);

    const stops = fixture.executor.invocations.filter((entry) =>
      entry.command === "supabase" && entry.args[0] === "stop"
    );
    expect(stops).toHaveLength(2);
    expect(fixture.executor.invocations.some((entry) =>
      entry.command === "docker" &&
      entry.args[0] === "ps" &&
      entry.args.includes("label=com.supabase.cli.project=AllIincompassing")
    )).toBe(true);
    expect(fixture.executor.invocations.some((entry) =>
      entry.command === "docker" &&
      entry.args[0] === "volume" &&
      entry.args.includes("label=com.supabase.cli.project=AllIincompassing")
    )).toBe(true);
  });

  it("retries one failed local reset and keeps the retry on the isolated network", async () => {
    const fixture = await createHarnessFixture({ firstResetFails: true });
    await fixture.run();

    const resets = fixture.executor.invocations.filter((entry) =>
      entry.command === "supabase" &&
      entry.args[0] === "db" &&
      entry.args[1] === "reset"
    );
    expect(resets).toHaveLength(
      PHASE2_CHECKS.filter(({ destructive }) => destructive).length + 1,
    );
    expect(resets.slice(0, 2).every(({ args }) =>
      args.includes("--network-id") && args.includes("agent-work-phase2")
    )).toBe(true);
  });

  it("retries Supabase stop after observed residue and proves the retry clears it", async () => {
    const fixture = await createHarnessFixture({
      supabaseResidue: "clears-after-retry",
    });
    await fixture.run();

    const invocations = fixture.executor.invocations;
    const stops = invocations
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) =>
        entry.command === "supabase" && entry.args[0] === "stop"
      );
    const supabaseProofs = invocations
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) =>
        entry.command === "docker" &&
        entry.args.includes("label=com.supabase.cli.project=AllIincompassing")
      );

    expect(stops).toHaveLength(3);
    expect(supabaseProofs[0].index).toBeGreaterThan(stops[0].index);
    expect(stops[1].index).toBeGreaterThan(supabaseProofs[0].index);
    expect(supabaseProofs[2].index).toBeGreaterThan(stops[1].index);
  });

  it.each([
    ["container", "supabase_initial_container_residue_found"],
    ["volume", "supabase_initial_volume_residue_found"],
  ] as const)(
    "fails closed when Supabase %s residue persists after retry",
    async (supabaseResidue, reasonCode) => {
      const fixture = await createHarnessFixture({ supabaseResidue });
      await expect(fixture.run()).rejects.toThrow(reasonCode);
      const artifacts = createRunArtifacts({
        projectRoot: fixture.cwd,
        runId: "20260803T010203Z-test",
      });
      const manifest = JSON.parse(await readFile(artifacts.manifestPath, "utf8"));
      expect(manifest).toMatchObject({
        exitStatus: "failed",
        failure: { reasonCode },
      });
    },
  );

  it("uses the standalone Compose binary with the minimal child environment", async () => {
    const fixture = await createHarnessFixture();
    await fixture.run();

    const composeInvocations = fixture.executor.invocations.filter((entry) =>
      entry.command === "docker-compose"
    );
    expect(composeInvocations.length).toBeGreaterThan(0);
    expect(composeInvocations.every((entry) => entry.args[0] === "-p")).toBe(true);
    expect(fixture.executor.invocations.some((entry) =>
      entry.command === "docker" && entry.args[0] === "compose"
    )).toBe(false);
  });

  it.each([
    ["M  package.json\n", "package.json"],
    [" M scripts/agent-work-ledger-harness/phase2Harness.mjs\n", "scripts/agent-work-ledger-harness"],
    ["M  scripts/agent-work-ledger-edge-smoke.mjs\n", ":(glob)scripts/agent-work-ledger-*.mjs"],
    [" M supabase/config.toml\n", "supabase/config.toml"],
    ["M  supabase/migrations/20260803000000_phase2.sql\n", "supabase/migrations"],
    [" M supabase/functions/agent-work-runner/index.ts\n", "supabase/functions/agent-work-runner"],
    ["M  tests/agentWorkLedgerEval.test.ts\n", ":(glob)tests/agentWorkLedger*.test.ts"],
    [" M tests/agentTraceReportSelectorIndexes.test.ts\n", ":(glob)tests/agentTrace*.test.ts"],
  ])("rejects staged or unstaged relevant HEAD drift before archive/build: %s", async (gitStatusOutput, gitStatusRequiredPathspec) => {
    const fixture = await createHarnessFixture({
      gitStatusOutput,
      gitStatusRequiredPathspec,
    });
    await expect(fixture.run()).rejects.toThrow(/relevant_files_differ_from_head/);
    expect(fixture.executor.invocations.some((entry) =>
      entry.command === "docker" && entry.args[0] === "build"
    )).toBe(false);
    expect(fixture.executor.invocations.some((entry) =>
      entry.command === "docker" && entry.args[0] === "network" &&
      entry.args[1] === "create"
    )).toBe(false);
  });

  it("accepts unrelated authorized drift while guarding only image-relevant paths", async () => {
    const fixture = await createHarnessFixture();
    await expect(fixture.run()).resolves.toBeDefined();
    const status = fixture.executor.invocations.find((entry) =>
      entry.command === "git" && entry.args[0] === "status"
    );
    expect(PHASE2_HEAD_GUARD_PATHS).toEqual([
      "package.json",
      "package-lock.json",
      ".dockerignore",
      "docker/agent-work-ledger",
      "scripts/agent-work-ledger-harness",
      ":(glob)scripts/agent-work-ledger-*.mjs",
      "supabase/config.toml",
      "supabase/migrations",
      "supabase/functions/agent-work-items",
      "supabase/functions/agent-work-runner",
      "supabase/functions/agent-work-sweeper",
      "supabase/functions/generate-program-goals",
      "supabase/functions/_shared/agent-work",
      "supabase/functions/_shared/org.ts",
      "src/lib/agent-work-ledger.ts",
      "src/lib/ai.ts",
      "src/lib/__tests__/agent-work-ledger.test.ts",
      "src/lib/__tests__/ai-auth-fetch.test.ts",
      "src/components/agent-work",
      "src/components/ClientDetails/ProgramsGoalsTab.tsx",
      "src/components/__tests__/ProgramsGoalsTab.test.tsx",
      "src/server/api/assessment-drafts.ts",
      "src/server/api/assessment-promote.ts",
      "src/server/__tests__/assessmentDraftsHandler.test.ts",
      "src/server/__tests__/assessmentPromoteHandler.test.ts",
      "src/server/__tests__/runtimeConfigHandler.test.ts",
      ":(glob)tests/agentWorkLedger*.test.ts",
      ":(glob)tests/agentTrace*.test.ts",
    ]);
    expect(status?.args.slice(status.args.indexOf("--") + 1)).toEqual(
      PHASE2_HEAD_GUARD_PATHS,
    );
    expect(status?.args).not.toContain("deno.lock");
    expect(status?.args).not.toContain("reports/test-reliability-latest.json");
    expect(status?.args).not.toContain("docs/ai/handoffs/agent-work-ledger-foundation.md");
  });

  it.each([
    [{ failPreflightComposeDown: true }, "compose_preflight_down_failed"],
    [{ failPreflightResidueProof: true }, "compose_preflight_container_residue_check_failed"],
    [{ preflightResidue: "container" }, "compose_preflight_container_residue_found"],
    [{ preflightResidue: "volume" }, "compose_preflight_volume_residue_found"],
  ] as const)("fails closed before network creation when fresh Compose preflight fails: %s", async (options, reasonCode) => {
    const fixture = await createHarnessFixture(options);
    await expect(fixture.run()).rejects.toThrow(reasonCode);
    expect(fixture.executor.invocations.some((entry) =>
      entry.command === "docker" && entry.args[0] === "network" &&
      entry.args[1] === "create"
    )).toBe(false);
    const finalDown = fixture.executor.invocations.findLast((entry) =>
      entry.command === "docker-compose" && entry.args.includes("down")
    );
    expect(finalDown?.env).toMatchObject({
      COMPOSE_DISABLE_ENV_FILE: "1",
      PHASE2_SUPABASE_ANON_KEY: "cleanup-unused",
      PHASE2_SUPABASE_SERVICE_ROLE_KEY: "cleanup-unused",
      PHASE2_RUNNER_SECRET: "cleanup-unused",
      PHASE2_SWEEPER_SECRET: "cleanup-unused",
    });
  });

  it("injects status-derived local values into compose without persisting them", async () => {
    const fixture = await createHarnessFixture();
    const result = await fixture.run();
    const composeUp = fixture.executor.invocations.find((entry) =>
      entry.command === "docker-compose" && entry.args.includes("up")
    );

    expect(composeUp?.env).toMatchObject({
      PHASE2_CONTAINER_SUPABASE_URL:
        "http://supabase_kong_AllIincompassing:8000",
      PHASE2_CONTAINER_SUPABASE_DB_URL:
        containerPostgresUrl,
      PHASE2_SUPABASE_ANON_KEY: anonKey,
      PHASE2_SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    });

    const persisted = [
      await readFile(result.artifacts.manifestPath, "utf8"),
      await readFile(result.artifacts.summaryLogPath, "utf8"),
    ].join("\n");
    expect(persisted).not.toContain(anonKey);
    expect(persisted).not.toContain(serviceRoleKey);
    expect(persisted).not.toContain("127.0.0.1:54322");
  });

  it("records committed image and sanitized per-check evidence in the manifest", async () => {
    const fixture = await createHarnessFixture();
    const result = await fixture.run();
    const manifest = JSON.parse(
      await readFile(result.artifacts.manifestPath, "utf8"),
    );
    const summary = await readFile(result.artifacts.summaryLogPath, "utf8");

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      commitSha: committedSha,
      imageId,
      command: "npm run test:agent-work:phase2",
      startedAtUtc: "2026-08-03T01:02:03.000Z",
      cleanup: { status: "passed" },
      exitStatus: "passed",
      exitCode: 0,
    });
    expect(manifest.endedAtUtc).toMatch(/^2026-08-03T/);
    expect(manifest.durationMs).toBeGreaterThan(0);
    expect(manifest.checks).toHaveLength(12);
    expect(manifest.checks.map((check: { id: string }) => check.id)).toEqual(
      PHASE2_CHECKS.map(({ id }) => id),
    );
    expect(manifest.checks.every((check: Record<string, unknown>) =>
      check.status === "passed" &&
      typeof check.startedAtUtc === "string" &&
      typeof check.endedAtUtc === "string" &&
      typeof check.durationMs === "number"
    )).toBe(true);
    expect(manifest.checks[0].sanitizedOutputSha256).toBe(
      createHash("sha256")
        .update(sanitizeCommandEvidence(
          {
            code: 0,
            stdout: `raw child output containing ${serviceRoleKey}`,
            stderr: "",
          },
          [serviceRoleKey],
        ))
        .digest("hex"),
    );
    expect(manifest.artifacts.summaryLogSha256).toBe(
      createHash("sha256").update(summary).digest("hex"),
    );
    expect(manifest.artifacts.checkEvidenceSha256).toBe(
      createHash("sha256").update(JSON.stringify(
        manifest.checks.map(({
          id,
          status,
          sanitizedOutputSha256,
        }: {
          id: string;
          status: string;
          sanitizedOutputSha256: string;
        }) => ({ id, status, sanitizedOutputSha256 })),
      )).digest("hex"),
    );
    expect(JSON.stringify(manifest)).not.toContain(serviceRoleKey);
  });

  it("fingerprints redacted output content instead of only its presence", () => {
    const secret = "local-secret-not-for-evidence";
    const first = sanitizeCommandEvidence(
      { code: 0, stdout: `result=alpha token=${secret}`, stderr: "" },
      [secret],
    );
    const second = sanitizeCommandEvidence(
      { code: 0, stdout: `result=beta token=${secret}`, stderr: "" },
      [secret],
    );
    const equivalent = sanitizeCommandEvidence(
      { code: 0, stdout: "result=alpha token=another-secret", stderr: "" },
      ["another-secret"],
    );

    expect(first).not.toEqual(second);
    expect(first).toEqual(equivalent);
    expect(first).not.toContain(secret);
    expect(first).toContain("stdout_sha256=");
    expect(first).toContain("stderr_sha256=");
  });

  it("fails the run and manifest when the mandatory cleanup audit fails", async () => {
    const fixture = await createHarnessFixture({ failCleanupAudit: true });
    await expect(fixture.run()).rejects.toThrow(/cleanup_audit_failed/);

    const artifacts = createRunArtifacts({
      projectRoot: fixture.cwd,
      runId: "20260803T010203Z-test",
    });
    const manifest = JSON.parse(await readFile(artifacts.manifestPath, "utf8"));
    expect(manifest.cleanup.status).toBe("failed");
    expect(manifest.exitStatus).toBe("failed");
    expect(manifest.exitCode).toBe(1);
    expect(JSON.stringify(manifest)).not.toContain(serviceRoleKey);
  });

  it("attempts owner cleanup even when local status derivation fails", async () => {
    const fixture = await createHarnessFixture({ failStatus: true });
    await expect(fixture.run()).rejects.toThrow(/supabase_status_failed/);

    const cleanupRun = fixture.executor.invocations.find((entry) =>
      entry.command === "docker-compose" &&
      entry.args.includes("scripts/agent-work-ledger-harness/cleanupAudit.mjs")
    );
    expect(cleanupRun?.env).toMatchObject({
      PHASE2_CONTAINER_SUPABASE_DB_URL:
        containerPostgresUrl,
    });
    expect(cleanupRun?.env.PHASE2_SUPABASE_SERVICE_ROLE_KEY).not.toBe(
      serviceRoleKey,
    );
  });

  it("runs the normal fail-closed cleanup path when the main phase is interrupted", async () => {
    const interruptController = new AbortController();
    const fixture = await createHarnessFixture({ interruptController });
    await expect(fixture.run()).rejects.toThrow(/phase2_signal_sigterm/);

    const { invocations } = fixture.executor;
    const interruptedCheck = invocations.findIndex((entry) =>
      entry.command === "docker-compose" && entry.args.at(-1) === "stack-health"
    );
    const cleanupAudit = invocations.findIndex((entry) =>
      entry.command === "docker-compose" &&
      entry.args.includes("scripts/agent-work-ledger-harness/cleanupAudit.mjs")
    );
    const composeDown = invocations.findLastIndex((entry) =>
      entry.command === "docker-compose" && entry.args.includes("down")
    );
    const finalStop = invocations.findLastIndex((entry) =>
      entry.command === "supabase" && entry.args[0] === "stop"
    );
    expect(interruptedCheck).toBeGreaterThanOrEqual(0);
    expect(cleanupAudit).toBeGreaterThan(interruptedCheck);
    expect(composeDown).toBeGreaterThan(cleanupAudit);
    expect(finalStop).toBeGreaterThan(composeDown);

    const artifacts = createRunArtifacts({
      projectRoot: fixture.cwd,
      runId: "20260803T010203Z-test",
    });
    const manifest = JSON.parse(await readFile(artifacts.manifestPath, "utf8"));
    expect(manifest).toMatchObject({
      cleanup: { status: "passed" },
      exitStatus: "failed",
      exitCode: 1,
      failure: { reasonCode: "phase2_signal_sigterm" },
    });
  });

  it("finishes teardown but fails closed when interruption arrives during cleanup", async () => {
    const interruptController = new AbortController();
    const fixture = await createHarnessFixture({
      interruptController,
      interruptDuringComposeDown: true,
    });
    await expect(fixture.run()).rejects.toThrow(/phase2_signal_sigint/);

    const artifacts = createRunArtifacts({
      projectRoot: fixture.cwd,
      runId: "20260803T010203Z-test",
    });
    const manifest = JSON.parse(await readFile(artifacts.manifestPath, "utf8"));
    expect(manifest).toMatchObject({
      cleanup: { status: "passed" },
      exitStatus: "failed",
      exitCode: 1,
      failure: { reasonCode: "phase2_signal_sigint" },
    });
    expect(fixture.executor.invocations.some((entry) =>
      entry.command === "docker" && entry.args[0] === "ps"
    )).toBe(true);
    expect(fixture.executor.invocations.some((entry) =>
      entry.command === "docker" && entry.args[0] === "network" &&
      entry.args[1] === "rm"
    )).toBe(true);
  });

  it("keeps the fixed 12-check matrix and hard wall-clock budgets", () => {
    expect(PHASE2_COMMAND).toBe("test:agent-work:phase2");
    expect(PHASE2_CHECKS.map(({ id }) => id)).toEqual([
      "stack-health",
      "schema-seed",
      "tenant-security",
      "items-smoke",
      "chaos",
      "shadow-parity",
      "retention-trace",
      "hosted-scheduler-contract",
      "queue-scheduler",
      "app-api-unit-build",
      "deno-cached-tests",
      "cleanup-audit",
    ]);
    expect(getCheckDefinition("items-smoke").command).toEqual([
      "node",
      "scripts/agent-work-ledger-harness/containerEntrypoint.mjs",
      "items-smoke",
    ]);
    expect(PHASE2_CHECKS.filter(({ destructive }) => destructive).at(-1)?.id)
      .toBe("queue-scheduler");
    expect(HARD_TIMEOUT_BUDGETS_MS).toEqual({
      preflight: 30_000,
      archive: 30_000,
      dockerBuild: 300_000,
      supabaseStart: 180_000,
      supabaseReset: 180_000,
      composeUp: 180_000,
      check: 180_000,
      cleanupAudit: 120_000,
      composeDown: 120_000,
      supabaseStop: 120_000,
      residueCheck: 30_000,
    });
  });

  it("uses exact per-check environment allowlists without secret values in command args", async () => {
    const expected = {
      "stack-health": ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
      "schema-seed": ["SUPABASE_DB_URL"],
      "tenant-security": ["SUPABASE_DB_URL"],
      "items-smoke": [
        "AGENT_WORK_ITEMS_URL",
        "SUPABASE_ANON_KEY",
        "SUPABASE_DB_URL",
        "SUPABASE_URL",
      ],
      "hosted-scheduler-contract": ["SUPABASE_DB_URL"],
      "queue-scheduler": [
        "AGENT_WORK_RUNNER_SECRET",
        "AGENT_WORK_SWEEPER_SECRET",
        "SUPABASE_ANON_KEY",
        "SUPABASE_DB_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "SUPABASE_URL",
      ],
      chaos: [],
      "shadow-parity": [
        "AGENT_WORK_PHASE2_PROJECT_ID",
        "SUPABASE_DB_URL",
        "SUPABASE_URL",
      ],
      "retention-trace": ["SUPABASE_DB_URL"],
      "app-api-unit-build": [
        "SUPABASE_ANON_KEY",
        "SUPABASE_URL",
        "VITE_SUPABASE_ANON_KEY",
        "VITE_SUPABASE_EDGE_URL",
        "VITE_SUPABASE_URL",
      ],
      "deno-cached-tests": [],
      "cleanup-audit": ["SUPABASE_DB_URL"],
    } as const;
    for (const [id, names] of Object.entries(expected)) {
      expect(getCheckEnvironmentNames(id)).toEqual(names);
    }

    const fixture = await createHarnessFixture();
    await fixture.run();
    for (const check of PHASE2_CHECKS) {
      const invocation = fixture.executor.invocations.find((entry) => {
        const harnessIndex = entry.args.indexOf("agent-work-harness");
        return harnessIndex >= 0 &&
          JSON.stringify(entry.args.slice(harnessIndex + 1)) ===
            JSON.stringify(check.command);
      });
      expect(invocation).toBeDefined();
      const harnessIndex = invocation!.args.indexOf("agent-work-harness");
      const prefix = invocation!.args.slice(0, harnessIndex);
      const names = prefix.flatMap((value, index) =>
        value === "-e" ? [prefix[index + 1]] : []
      );
      expect(names).toEqual(expected[check.id as keyof typeof expected]);
      expect(invocation!.args.join(" ")).not.toContain(serviceRoleKey);
      expect(invocation!.args.join(" ")).not.toContain(anonKey);
    }
  });

  it.each(PHASE2_CHECKS.flatMap(({ id }) => [
    { id, kind: "nonzero" as const },
    { id, kind: "timeout" as const },
  ]))("fails closed and cleans after $kind from $id", async (failureInjection) => {
    const fixture = await createHarnessFixture({ failureInjection });
    await expect(fixture.run()).rejects.toThrow();

    const artifacts = createRunArtifacts({
      projectRoot: fixture.cwd,
      runId: "20260803T010203Z-test",
    });
    const manifest = JSON.parse(await readFile(artifacts.manifestPath, "utf8"));
    expect(manifest.checks.at(-1)).toMatchObject({
      id: failureInjection.id,
      status: "failed",
    });
    expect(manifest.exitStatus).toBe("failed");
    expect(fixture.executor.invocations.some((entry) =>
      entry.command === "docker-compose" && entry.args.includes("down")
    )).toBe(true);
    expect(fixture.executor.invocations.some((entry) =>
      entry.command === "supabase" && entry.args[0] === "stop"
    )).toBe(true);
    expect(fixture.executor.invocations.some((entry) =>
      entry.command === "docker" && entry.args[0] === "ps"
    )).toBe(true);
  });

  it.each([
    ["container", "compose_container_residue_found", "composeResidue"],
    ["volume", "compose_volume_residue_found", "composeResidue"],
    ["network-attached", "network_container_residue_found", "networkResidue"],
    ["network-remains", "network_residue_found", "networkResidue"],
  ] as const)(
    "fails closed when %s residue remains",
    async (residue, reasonCode, cleanupField) => {
      const fixture = await createHarnessFixture({ residue });
      await expect(fixture.run()).rejects.toThrow(reasonCode);
      const artifacts = createRunArtifacts({
        projectRoot: fixture.cwd,
        runId: "20260803T010203Z-test",
      });
      const manifest = JSON.parse(await readFile(artifacts.manifestPath, "utf8"));
      expect(manifest).toMatchObject({
        cleanup: { status: "failed", [cleanupField]: "failed" },
        exitStatus: "failed",
        failure: { reasonCode },
      });
    },
  );

  it("preserves exact tenant predicates and split runner/sweeper auth", () => {
    expect(getCheckDefinition("tenant-security").proves).toEqual([
      "step_item_org_client_parity",
      "queued_payload_org_parity",
    ]);
    expect(getCheckDefinition("queue-scheduler").auth).toEqual({
      projectKey: "publishable",
      invocationSecrets: [
        "x-agent-work-runner-secret",
        "x-agent-work-sweeper-secret",
      ],
    });
    expect(getCheckDefinition("deno-cached-tests").command).toEqual([
      "deno",
      "test",
      "--cached-only",
      "--frozen",
      "--node-modules-dir=none",
      "--lock=/opt/agent-work-ledger-deno.lock",
      "--allow-env=AGENT_WORK_PHASE2_CONTAINER,AGENT_WORK_LEGACY_GENERATION_DISABLED,SUPABASE_URL,VITE_SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,SUPABASE_ANON_KEY,VITE_SUPABASE_ANON_KEY,SUPABASE_PUBLISHABLE_KEY,VITE_SUPABASE_PUBLISHABLE_KEY,SUPABASE_PUBLISHABLE_KEY_SUPABASE_ANON_KEY,VITE_SUPABASE_PUBLISHABLE_KEY_SUPABASE_ANON_KEY,OPENAI_API_KEY,CORS_ALLOWED_ORIGINS,API_ALLOWED_ORIGINS,WS_NO_BUFFER_UTIL,WS_NO_UTF_8_VALIDATE",
      "supabase/functions/_shared/agent-work/caloptima-draft-review.test.ts",
      "supabase/functions/agent-work-items/index.test.ts",
      "supabase/functions/agent-work-runner/index.test.ts",
      "supabase/functions/agent-work-runner/chaos.test.ts",
      "supabase/functions/agent-work-sweeper/index.test.ts",
      "supabase/functions/generate-program-goals/ledger.test.ts",
      "supabase/functions/generate-program-goals/index.test.ts",
    ]);
  });

  it("enumerates every phase2 check against exact Compose endpoint validators", () => {
    const env = { AGENT_WORK_PHASE2_CONTAINER: "1" };
    const http = () => assertLocalSupabaseHttpUrl(
      "http://supabase_kong_AllIincompassing:8000",
      "SUPABASE_URL",
      env,
    );
    const database = () => assertLocalPostgresUrl(
      containerPostgresUrl,
      "SUPABASE_DB_URL",
      env,
    );
    const service = (url: string) => () => assertExactPhase2FunctionUrl(
      url,
      "FUNCTION_URL",
      env,
    );
    const contracts = new Map<string, Array<() => unknown>>([
      ["stack-health", [http, service("http://agent-work-items:8000/agent-work-items"), service("http://agent-work-runner:8000/agent-work-runner"), service("http://agent-work-sweeper:8000/agent-work-sweeper")]],
      ["schema-seed", [database]],
      ["tenant-security", [database]],
      ["items-smoke", [http, database, service("http://agent-work-items:8000/agent-work-items")]],
      ["chaos", [database]],
      ["shadow-parity", [http, database]],
      ["retention-trace", [database]],
      ["hosted-scheduler-contract", [database]],
      ["queue-scheduler", [http, database, service("http://agent-work-runner:8000/agent-work-runner"), service("http://agent-work-sweeper:8000/agent-work-sweeper")]],
      ["app-api-unit-build", [http]],
      ["deno-cached-tests", [http]],
      ["cleanup-audit", [database]],
    ]);

    expect([...contracts.keys()]).toEqual(PHASE2_CHECKS.map(({ id }) => id));
    for (const validators of contracts.values()) {
      for (const validate of validators) expect(validate).not.toThrow();
    }
  });

  it("allows the exact Compose app hostname without disabling Vite host checks", async () => {
    const compose = await readFile(
      path.join(
        process.cwd(),
        "docker",
        "agent-work-ledger",
        "docker-compose.phase2.yml",
      ),
      "utf8",
    );

    expect(compose).toContain(
      '__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: "agent-work-app"',
    );
    expect(compose.match(/__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS/g)).toHaveLength(1);
    expect(compose).not.toContain("allowedHosts: true");
  });

  it("keeps clean HEAD archive inputs and sanitized report paths", () => {
    expect(createArchivePlan()).toEqual({
      archiveFileName: "repo.tar",
      ref: "HEAD",
      strategy: "git-archive-head",
    });
    expect(buildPhase2ChildEnv({ PATH: "/usr/bin" })).toEqual({
      AGENT_WORK_PHASE2_CONTAINER: "1",
      PATH: "/usr/bin",
      COMPOSE_DISABLE_ENV_FILE: "1",
      COMPOSE_PROJECT_NAME: "agent-work-ledger-phase2",
      AGENT_WORK_PHASE2_IMAGE: "agent-work-ledger-phase2:local",
    });
    const artifacts = createRunArtifacts({
      projectRoot: "C:/repo",
      runId: "20260803T010203Z-abc123",
    });
    expect(artifacts.manifestPath).toBe(
      "C:/repo/.reports/agent-work-ledger-phase2/20260803T010203Z-abc123/manifest.json",
    );
  });
});
