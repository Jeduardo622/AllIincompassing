import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, test } from "vitest";

const repoRoot = path.resolve(__dirname, "..", "..");
const scriptPath = path.join(repoRoot, "scripts", "ci", "deploy-payroll-administration-function.mjs");
const tempDirs: string[] = [];

const write = (root: string, relativePath: string, content: string) => {
  const target = path.join(root, relativePath);
  writeFileSync(target, content, "utf8");
};

const makeFakeSupabase = ({
  listPayload = [{ slug: "payroll-administration", verify_jwt: true }],
  secretListPayload = [
    { name: "UPSTASH_REDIS_REST_URL" },
    { name: "UPSTASH_REDIS_REST_TOKEN" },
  ],
  deployFailure = "docker-rate-limit",
}: {
  listPayload?: unknown;
  secretListPayload?: unknown;
  deployFailure?: "docker-rate-limit" | "none";
} = {}) => {
  const root = mkdtempSync(path.join(tmpdir(), "payroll-administration-deploy-"));
  tempDirs.push(root);
  const statePath = path.join(root, "state.json");
  writeFileSync(statePath, JSON.stringify({ calls: [], failedOnce: false }), "utf8");
  write(root, "supabase-driver.mjs", [
    "import { readFileSync, writeFileSync } from 'node:fs';",
    "const statePath = process.env.FAKE_SUPABASE_STATE_PATH;",
    "const state = JSON.parse(readFileSync(statePath, 'utf8'));",
    "const args = process.argv.slice(2);",
    "state.calls.push(args);",
    "if (args[0] === 'secrets' && args[1] === 'list') {",
    `  process.stdout.write(JSON.stringify(${JSON.stringify(secretListPayload)}));`,
    "  writeFileSync(statePath, JSON.stringify(state, null, 2));",
    "  process.exit(0);",
    "}",
    "if (args[0] === 'functions' && args[1] === 'deploy') {",
    `  if (${JSON.stringify(deployFailure)} === 'docker-rate-limit' && !args.includes('--use-api') && !state.failedOnce) {`,
    "    state.failedOnce = true;",
    "    writeFileSync(statePath, JSON.stringify(state, null, 2));",
    "    console.error('toomanyrequests: public.ecr.aws/supabase/edge-runtime rate exceeded');",
    "    process.exit(1);",
    "  }",
    "  writeFileSync(statePath, JSON.stringify(state, null, 2));",
    "  process.exit(0);",
    "}",
    "if (args[0] === 'functions' && args[1] === 'list') {",
    `  process.stdout.write(JSON.stringify(${JSON.stringify(listPayload)}));`,
    "  writeFileSync(statePath, JSON.stringify(state, null, 2));",
    "  process.exit(0);",
    "}",
    "writeFileSync(statePath, JSON.stringify(state, null, 2));",
    "process.exit(1);",
  ].join("\n"));
  write(root, "supabase", "#!/usr/bin/env sh\nnode \"$(dirname \"$0\")/supabase-driver.mjs\" \"$@\"\n");
  write(root, "supabase.cmd", "@echo off\r\nnode \"%~dp0supabase-driver.mjs\" %*\r\n");
  chmodSync(path.join(root, "supabase"), 0o755);
  return { root, statePath };
};

describe("deploy-payroll-administration-function", () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  test("deploys payroll-administration, retries Docker rate limits with --use-api, and verifies verify_jwt", () => {
    const { root, statePath } = makeFakeSupabase();
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${root}${path.delimiter}${process.env.PATH ?? ""}`,
        FAKE_SUPABASE_STATE_PATH: statePath,
        SUPABASE_PROJECT_REF: "wnnjeqheqxxyrgsjmygy",
        SUPABASE_ACCESS_TOKEN: "synthetic-token",
      },
      timeout: 120_000,
    });
    const state = JSON.parse(readFileSync(statePath, "utf8")) as { calls: string[][] };

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("retrying with --use-api");
    expect(state.calls).toEqual([
      ["secrets", "list", "--project-ref", "wnnjeqheqxxyrgsjmygy", "--output", "json"],
      ["functions", "deploy", "payroll-administration", "--project-ref", "wnnjeqheqxxyrgsjmygy"],
      ["functions", "deploy", "payroll-administration", "--project-ref", "wnnjeqheqxxyrgsjmygy", "--use-api"],
      ["functions", "list", "--project-ref", "wnnjeqheqxxyrgsjmygy", "--output", "json"],
    ]);
  });

  test.each([
    ["UPSTASH_REDIS_REST_URL", [{ name: "UPSTASH_REDIS_REST_TOKEN" }]],
    ["UPSTASH_REDIS_REST_TOKEN", [{ name: "UPSTASH_REDIS_REST_URL" }]],
  ])("fails before deploy when remote secret %s is missing", (missingName, secretListPayload) => {
    const { root, statePath } = makeFakeSupabase({ secretListPayload, deployFailure: "none" });
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${root}${path.delimiter}${process.env.PATH ?? ""}`,
        FAKE_SUPABASE_STATE_PATH: statePath,
        SUPABASE_PROJECT_REF: "wnnjeqheqxxyrgsjmygy",
        SUPABASE_ACCESS_TOKEN: "synthetic-token",
      },
      timeout: 120_000,
    });
    const state = JSON.parse(readFileSync(statePath, "utf8")) as { calls: string[][] };

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain(`Missing remote Edge secret: ${missingName}`);
    expect(state.calls).toEqual([
      ["secrets", "list", "--project-ref", "wnnjeqheqxxyrgsjmygy", "--output", "json"],
    ]);
  });

  test("supports exact remote secret-name verification without deploying", () => {
    const { root, statePath } = makeFakeSupabase({ deployFailure: "none" });
    const result = spawnSync(process.execPath, [scriptPath, "--verify-edge-secrets"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${root}${path.delimiter}${process.env.PATH ?? ""}`,
        FAKE_SUPABASE_STATE_PATH: statePath,
        SUPABASE_PROJECT_REF: "wnnjeqheqxxyrgsjmygy",
        SUPABASE_ACCESS_TOKEN: "synthetic-token",
      },
      timeout: 120_000,
    });
    const state = JSON.parse(readFileSync(statePath, "utf8")) as { calls: string[][] };

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(state.calls).toEqual([
      ["secrets", "list", "--project-ref", "wnnjeqheqxxyrgsjmygy", "--output", "json"],
    ]);
  });

  test("fails when payroll-administration is missing from the remote function list", () => {
    const { root, statePath } = makeFakeSupabase({ listPayload: [{ slug: "payroll-timesheets", verify_jwt: true }], deployFailure: "none" });
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, PATH: `${root}${path.delimiter}${process.env.PATH ?? ""}`, FAKE_SUPABASE_STATE_PATH: statePath, SUPABASE_PROJECT_REF: "wnnjeqheqxxyrgsjmygy", SUPABASE_ACCESS_TOKEN: "synthetic-token" },
      timeout: 120_000,
    });

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain("Missing deployed function after deploy: payroll-administration");
  });

  test("fails when payroll-administration verify_jwt is false", () => {
    const { root, statePath } = makeFakeSupabase({ listPayload: [{ slug: "payroll-administration", verify_jwt: false }], deployFailure: "none" });
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, PATH: `${root}${path.delimiter}${process.env.PATH ?? ""}`, FAKE_SUPABASE_STATE_PATH: statePath, SUPABASE_PROJECT_REF: "wnnjeqheqxxyrgsjmygy", SUPABASE_ACCESS_TOKEN: "synthetic-token" },
      timeout: 120_000,
    });

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain("verify_jwt must be true for payroll-administration");
  });

  test("fails fast when deploy prerequisites are missing", () => {
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, SUPABASE_PROJECT_REF: "", SUPABASE_URL: "", SUPABASE_ACCESS_TOKEN: "" },
      timeout: 120_000,
    });

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain("Missing SUPABASE_ACCESS_TOKEN");
  });
});
