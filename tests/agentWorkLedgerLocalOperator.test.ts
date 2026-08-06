import { describe, expect, it, vi } from "vitest";

const EXPECTED_REQUIRED_OPERATOR_CHECK_IDS = [
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
] as const;

const MACHINE_SAFE_CODE = /^[a-z0-9_]+$/;

const loadOperatorModule = () =>
  import("../scripts/agent-work-ledger-local-operator.mjs");

const buildValidHarnessResult = () => {
  const checks = EXPECTED_REQUIRED_OPERATOR_CHECK_IDS.map((id) => ({
    id,
    status: "passed",
    startedAtUtc: "2026-08-06T12:00:00.000Z",
    endedAtUtc: "2026-08-06T12:00:01.000Z",
    durationMs: 1000,
    sanitizedOutputSha256: "a".repeat(64),
  }));

  return {
    runId: "20260806-operator-red-contract",
    artifacts: {
      reportDir: "artifacts/phase2/20260806-operator-red-contract",
      summaryLogPath: "artifacts/phase2/20260806-operator-red-contract/summary.log",
      manifestPath: "artifacts/phase2/20260806-operator-red-contract/manifest.json",
    },
    manifest: {
      schemaVersion: 1,
      commitSha: "b".repeat(40),
      imageId: "sha256:" + "c".repeat(64),
      command: "npm run test:agent-work:phase2",
      startedAtUtc: "2026-08-06T12:00:00.000Z",
      endedAtUtc: "2026-08-06T12:10:00.000Z",
      durationMs: 600_000,
      checks,
      cleanup: {
        status: "passed",
        databaseAudit: "passed",
        composeDown: "passed",
        supabaseStop: "passed",
        composeResidue: "passed",
        networkResidue: "passed",
        archiveContext: "passed",
      },
      exitStatus: "passed",
      exitCode: 0,
      artifacts: {
        summaryLogSha256: "d".repeat(64),
        checkEvidenceSha256: "e".repeat(64),
      },
    },
  };
};

const buildFailureHarnessResult = () => {
  const result = buildValidHarnessResult();
  return {
    ...result,
    manifest: {
      ...result.manifest,
      checks: result.manifest.checks.map((check, index) =>
        index === 0
          ? { ...check, status: "failed" as const }
          : check
      ),
      cleanup: {
        ...result.manifest.cleanup,
        networkResidue: "failed",
      },
      exitStatus: "failed",
      exitCode: 11,
      failure: {
        reasonCode: "phase2_check_failed_stack-health",
      },
    },
  };
};

const createProcessImpl = () => {
  const writes: string[] = [];
  return {
    exitCode: undefined as number | undefined,
    writes,
    stdout: {
      write: (chunk: string | Uint8Array) => {
        writes.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
        return true;
      },
    },
    stderr: {
      write: (chunk: string | Uint8Array) => {
        writes.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
        return true;
      },
    },
  };
};

const assertMachineSafeError = (error: unknown, secret?: string) => {
  expect(error).toBeInstanceOf(Error);
  const message = error instanceof Error ? error.message : String(error);
  expect(message).toMatch(MACHINE_SAFE_CODE);
  if (secret) {
    expect(message).not.toContain(secret);
  }
};

describe("agent-work local operator contract", () => {
  it("exports the fixed operator surface and the exact Phase 2 check ids", async () => {
    const mod = await loadOperatorModule();

    expect(mod.REQUIRED_OPERATOR_CHECK_IDS).toEqual(
      [...EXPECTED_REQUIRED_OPERATOR_CHECK_IDS],
    );
    expect(typeof mod.validateOperatorArgs).toBe("function");
    expect(typeof mod.validateOperatorResult).toBe("function");
    expect(typeof mod.runLocalOperator).toBe("function");
  });

  it("accepts no argv and rejects any argv with operator_arguments_forbidden", async () => {
    const mod = await loadOperatorModule();

    expect(() => mod.validateOperatorArgs([])).not.toThrow();
    expect(() => mod.validateOperatorArgs(["--help"])).toThrow(
      "operator_arguments_forbidden",
    );
    expect(() => mod.validateOperatorArgs(["--workflow=shadow"])).toThrow(
      "operator_arguments_forbidden",
    );
  });

  it("validates the exact passed Phase 2 manifest, cleanup state, and artifact hashes", async () => {
    const mod = await loadOperatorModule();
    const validResult = buildValidHarnessResult();

    expect(() => mod.validateOperatorResult(validResult)).not.toThrow();
  });

  it.each([
    {
      label: "missing required check evidence",
      mutate: (result: ReturnType<typeof buildValidHarnessResult>) => ({
        ...result,
        manifest: {
          ...result.manifest,
          checks: result.manifest.checks.slice(1),
        },
      }),
    },
    {
      label: "failed required check evidence",
      mutate: (result: ReturnType<typeof buildValidHarnessResult>) => ({
        ...result,
        manifest: {
          ...result.manifest,
          checks: result.manifest.checks.map((check, index) =>
            index === 0 ? { ...check, status: "failed" as const } : check
          ),
        },
      }),
    },
    {
      label: "failed cleanup evidence",
      mutate: (result: ReturnType<typeof buildValidHarnessResult>) => ({
        ...result,
        manifest: {
          ...result.manifest,
          cleanup: {
            ...result.manifest.cleanup,
            composeDown: "failed",
          },
        },
      }),
    },
    {
      label: "bad artifact hash evidence",
      mutate: (result: ReturnType<typeof buildValidHarnessResult>) => ({
        ...result,
        manifest: {
          ...result.manifest,
          artifacts: {
            ...result.manifest.artifacts,
            summaryLogSha256: "not-a-sha256",
          },
        },
      }),
    },
    {
      label: "leaked secret text in evidence",
      mutate: (result: ReturnType<typeof buildValidHarnessResult>) => ({
        ...result,
        manifest: {
          ...result.manifest,
          artifacts: {
            ...result.manifest.artifacts,
            checkEvidenceSha256: "super-secret-token",
          },
        },
      }),
    },
  ])("rejects %s with a machine-safe code", async ({ mutate }) => {
    const mod = await loadOperatorModule();
    const secret = "super-secret-token";
    const invalidResult = mutate(buildValidHarnessResult());

    let error: unknown;
    try {
      mod.validateOperatorResult(invalidResult);
    } catch (caught) {
      error = caught;
    }

    assertMachineSafeError(error, secret);
  });

  it("delegates once, writes only machine-safe output, propagates nonzero, and does not expose secrets", async () => {
    const mod = await loadOperatorModule();
    const processImpl = createProcessImpl();
    const runHarness = vi.fn()
      .mockResolvedValueOnce(buildValidHarnessResult())
      .mockResolvedValueOnce(buildFailureHarnessResult());
    const readManifest = vi.fn()
      .mockResolvedValueOnce(buildValidHarnessResult().manifest)
      .mockResolvedValueOnce(buildFailureHarnessResult().manifest);

    const successCode = await mod.runLocalOperator({
      argv: [],
      runHarness,
      readManifest,
      processImpl,
    });

    expect(runHarness).toHaveBeenCalledTimes(1);
    expect(successCode).toBe(0);
    expect(processImpl.exitCode).toBe(0);
    expect(processImpl.writes).toHaveLength(1);
    expect(processImpl.writes[0]).toMatch(MACHINE_SAFE_CODE);
    expect(processImpl.writes[0]).not.toContain("super-secret-token");

    processImpl.writes.length = 0;
    processImpl.exitCode = undefined;

    const failureCode = await mod.runLocalOperator({
      argv: [],
      runHarness,
      readManifest,
      processImpl,
    });

    expect(runHarness).toHaveBeenCalledTimes(2);
    expect(failureCode).toBe(11);
    expect(processImpl.exitCode).toBe(11);
    expect(processImpl.writes).toHaveLength(1);
    expect(processImpl.writes[0]).toMatch(MACHINE_SAFE_CODE);
    expect(processImpl.writes[0]).not.toContain("super-secret-token");
    expect(readManifest).toHaveBeenCalledTimes(2);
  });

  it("rejects argv at the operator boundary with a machine-safe operator_arguments_forbidden code", async () => {
    const mod = await loadOperatorModule();
    const processImpl = createProcessImpl();
    const runHarness = vi.fn();

    const code = await mod.runLocalOperator({
      argv: ["--help"],
      runHarness,
      processImpl,
    });

    expect(runHarness).not.toHaveBeenCalled();
    expect(code).toBe(1);
    expect(processImpl.exitCode).toBe(1);
    expect(processImpl.writes).toEqual(["operator_arguments_forbidden\n"]);
  });

  it("collapses arbitrary harness errors instead of transforming their contents", async () => {
    const mod = await loadOperatorModule();
    const processImpl = createProcessImpl();
    const runHarness = vi.fn().mockRejectedValue(
      new Error("failed with secret value customer-token-123"),
    );

    expect(await mod.runLocalOperator({ argv: [], runHarness, processImpl })).toBe(1);
    expect(processImpl.writes).toEqual(["operator_failed"]);
  });

  it("fails closed when the persisted manifest differs from the in-memory result", async () => {
    const mod = await loadOperatorModule();
    const processImpl = createProcessImpl();
    const result = buildValidHarnessResult();
    const readManifest = vi.fn().mockResolvedValue({
      ...result.manifest,
      commitSha: "f".repeat(40),
    });

    expect(await mod.runLocalOperator({
      argv: [],
      runHarness: vi.fn().mockResolvedValue(result),
      readManifest,
      processImpl,
    })).toBe(1);
    expect(readManifest).toHaveBeenCalledWith(result.artifacts.manifestPath);
    expect(processImpl.writes).toEqual(["operator_manifest_mismatch"]);
  });
});
