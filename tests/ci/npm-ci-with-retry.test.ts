import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";

import { runNpmCiWithRetry } from "../../scripts/ci/npm-ci-with-retry.mjs";

const repoRoot = path.resolve(__dirname, "..", "..");
const wrapperPath = path.join(repoRoot, "scripts", "ci", "npm-ci-with-retry.mjs");

describe("runNpmCiWithRetry", () => {
  test("returns after the first successful attempt", async () => {
    const runAttempt = vi.fn().mockResolvedValue(0);
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(
      runNpmCiWithRetry({ runAttempt, wait, baseDelayMs: 100 }),
    ).resolves.toBeUndefined();

    expect(runAttempt).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  test("retries failed installs with bounded linear backoff", async () => {
    const runAttempt = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(1).mockResolvedValue(0);
    const wait = vi.fn().mockResolvedValue(undefined);

    await runNpmCiWithRetry({ runAttempt, wait, baseDelayMs: 100 });

    expect(runAttempt).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenNthCalledWith(1, 100);
    expect(wait).toHaveBeenNthCalledWith(2, 200);
  });

  test("fails after three unsuccessful attempts", async () => {
    const runAttempt = vi.fn().mockResolvedValue(17);
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(
      runNpmCiWithRetry({ runAttempt, wait, baseDelayMs: 100 }),
    ).rejects.toThrow("npm ci failed after 3 attempts (last exit code 17)");

    expect(runAttempt).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
  });
});

test("direct execution launches npm ci successfully", () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "npm-ci-with-retry-"));
  writeFileSync(path.join(fixtureRoot, "package.json"), '{"name":"retry-fixture","version":"1.0.0"}\n');
  writeFileSync(
    path.join(fixtureRoot, "package-lock.json"),
    '{"name":"retry-fixture","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"retry-fixture","version":"1.0.0"}}}\n',
  );

  const result = spawnSync(process.execPath, [wrapperPath], {
    cwd: fixtureRoot,
    encoding: "utf8",
  });

  expect(result.status, result.stderr).toBe(0);
});

test("the main CI workflow routes dependency installs through the retry wrapper", () => {
  const workflow = readFileSync(path.join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");

  expect(workflow).not.toMatch(/^\s*run: npm ci\s*$/m);
  expect(workflow.match(/^\s*run: node scripts\/ci\/npm-ci-with-retry\.mjs\s*$/gm)).toHaveLength(14);
});

test("the standalone tenant-safety workflow routes dependency installation through the retry wrapper", () => {
  const workflow = readFileSync(
    path.join(repoRoot, ".github", "workflows", "tenant-safety.yml"),
    "utf8",
  );

  expect(workflow).not.toMatch(/^\s*run: npm ci\s*$/m);
  expect(workflow.match(/^\s*run: node scripts\/ci\/npm-ci-with-retry\.mjs\s*$/gm)).toHaveLength(1);
});
