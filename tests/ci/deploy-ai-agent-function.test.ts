import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const repoRoot = path.resolve(__dirname, "..", "..");
const scriptPath = path.join(repoRoot, "scripts", "ci", "deploy-ai-agent-function.mjs");

const tempDirs: string[] = [];

const write = (root: string, relativePath: string, content: string) => {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
};

const makeFakeSupabase = ({
  listPayload = [{ slug: "ai-agent-optimized", verify_jwt: true }],
  deployFailure = "rate-limit-once",
} = {}) => {
  const root = mkdtempSync(path.join(tmpdir(), "supabase-ai-agent-deploy-"));
  const statePath = path.join(root, "state.json");
  tempDirs.push(root);

  writeFileSync(statePath, JSON.stringify({ calls: [], failedOnce: false }, null, 2));
  write(
    root,
    "supabase-driver.mjs",
    [
      "import { readFileSync, writeFileSync } from 'node:fs';",
      "",
      "const statePath = process.env.FAKE_SUPABASE_STATE_PATH;",
      `const deployFailure = ${JSON.stringify(deployFailure)};`,
      "const args = process.argv.slice(2);",
      "const state = JSON.parse(readFileSync(statePath, 'utf8'));",
      "state.calls.push(args);",
      "",
      "if (args[0] === 'functions' && args[1] === 'deploy') {",
      "  const useApi = args.includes('--use-api');",
      "  if (deployFailure === 'non-rate-limit') {",
      "    writeFileSync(statePath, JSON.stringify(state, null, 2));",
      "    console.error('deploy denied by remote API');",
      "    process.exit(1);",
      "  }",
      "  if (!useApi && state.failedOnce === false && (deployFailure === 'rate-limit-once' || deployFailure === 'rate-limit-then-api-failure')) {",
      "    state.failedOnce = true;",
      "    writeFileSync(statePath, JSON.stringify(state, null, 2));",
      "    console.error('failed to create the docker container: public.ecr.aws/supabase/edge-runtime:v1.71.0: toomanyrequests: Rate exceeded');",
      "    process.exit(1);",
      "  }",
      "  if (useApi && deployFailure === 'rate-limit-then-api-failure') {",
      "    writeFileSync(statePath, JSON.stringify(state, null, 2));",
      "    console.error('server-side bundle failed');",
      "    process.exit(1);",
      "  }",
      "  writeFileSync(statePath, JSON.stringify(state, null, 2));",
      "  console.log(`deployed ${args[2]}${useApi ? ' with --use-api' : ''}`);",
      "  process.exit(0);",
      "}",
      "",
      "if (args[0] === 'functions' && args[1] === 'list') {",
      `  process.stdout.write(JSON.stringify(${JSON.stringify(listPayload)}));`,
      "  writeFileSync(statePath, JSON.stringify(state, null, 2));",
      "  process.exit(0);",
      "}",
      "",
      "writeFileSync(statePath, JSON.stringify(state, null, 2));",
      "console.error(`Unexpected supabase args: ${args.join(' ')}`);",
      "process.exit(1);",
      "",
    ].join("\n"),
  );
  write(root, "supabase", "#!/usr/bin/env sh\nnode \"$(dirname \"$0\")/supabase-driver.mjs\" \"$@\"\n");
  write(root, "supabase.cmd", "@echo off\r\nnode \"%~dp0supabase-driver.mjs\" %*\r\n");
  chmodSync(path.join(root, "supabase"), 0o755);

  return { root, statePath };
};

describe("deploy-ai-agent-function", () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  test("maps the CI package command to the governed deploy helper", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["ci:deploy:ai-agent-function"]).toBe(
      "node scripts/ci/deploy-ai-agent-function.mjs",
    );
  });

  test("deploys exactly ai-agent-optimized, retries Docker rate limits with --use-api, and verifies remote state", () => {
    const { root, statePath } = makeFakeSupabase();
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${root}${path.delimiter}${process.env.PATH ?? ""}`,
        FAKE_SUPABASE_STATE_PATH: statePath,
        SUPABASE_PROJECT_REF: "wnnjeqheqxxyrgsjmygy",
        SUPABASE_ACCESS_TOKEN: "test-token",
      },
      timeout: 120_000,
    });

    const state = JSON.parse(readFileSync(statePath, "utf8")) as {
      calls: string[][];
      failedOnce: boolean;
    };
    const combinedOutput = `${result.stdout}\n${result.stderr}`;

    expect(result.status, combinedOutput).toBe(0);
    expect(combinedOutput).toContain("retrying with --use-api");
    expect(state.calls).toEqual([
      ["functions", "deploy", "ai-agent-optimized", "--project-ref", "wnnjeqheqxxyrgsjmygy"],
      [
        "functions",
        "deploy",
        "ai-agent-optimized",
        "--project-ref",
        "wnnjeqheqxxyrgsjmygy",
        "--use-api",
      ],
      ["functions", "list", "--project-ref", "wnnjeqheqxxyrgsjmygy", "--output", "json"],
    ]);
  });

  test("fails when ai-agent-optimized is missing from remote function list", () => {
    const { root, statePath } = makeFakeSupabase({
      listPayload: [{ slug: "sessions-book", verify_jwt: true }],
    });
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${root}${path.delimiter}${process.env.PATH ?? ""}`,
        FAKE_SUPABASE_STATE_PATH: statePath,
        SUPABASE_PROJECT_REF: "wnnjeqheqxxyrgsjmygy",
        SUPABASE_ACCESS_TOKEN: "test-token",
      },
      timeout: 120_000,
    });

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain("Missing deployed function after deploy: ai-agent-optimized");
  });

  test("fails when ai-agent-optimized verify_jwt is false", () => {
    const { root, statePath } = makeFakeSupabase({
      listPayload: [{ slug: "ai-agent-optimized", verify_jwt: false }],
    });
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${root}${path.delimiter}${process.env.PATH ?? ""}`,
        FAKE_SUPABASE_STATE_PATH: statePath,
        SUPABASE_PROJECT_REF: "wnnjeqheqxxyrgsjmygy",
        SUPABASE_ACCESS_TOKEN: "test-token",
      },
      timeout: 120_000,
    });

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain("verify_jwt must be true for ai-agent-optimized");
  });

  test.each([
    ["missing", { slug: "ai-agent-optimized" }],
    ["a non-boolean string", { slug: "ai-agent-optimized", verify_jwt: "true" }],
  ])("fails when ai-agent-optimized verify_jwt is %s", (_case, functionState) => {
    const { root, statePath } = makeFakeSupabase({
      listPayload: [functionState],
    });
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${root}${path.delimiter}${process.env.PATH ?? ""}`,
        FAKE_SUPABASE_STATE_PATH: statePath,
        SUPABASE_PROJECT_REF: "wnnjeqheqxxyrgsjmygy",
        SUPABASE_ACCESS_TOKEN: "test-token",
      },
      timeout: 120_000,
    });

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain("verify_jwt must be true for ai-agent-optimized");
  });

  test("does not retry a deploy failure that is not a Docker rate limit", () => {
    const { root, statePath } = makeFakeSupabase({
      deployFailure: "non-rate-limit",
    });
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${root}${path.delimiter}${process.env.PATH ?? ""}`,
        FAKE_SUPABASE_STATE_PATH: statePath,
        SUPABASE_PROJECT_REF: "wnnjeqheqxxyrgsjmygy",
        SUPABASE_ACCESS_TOKEN: "test-token",
      },
      timeout: 120_000,
    });
    const state = JSON.parse(readFileSync(statePath, "utf8")) as { calls: string[][] };

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain("Failed to deploy ai-agent-optimized");
    expect(state.calls).toEqual([
      ["functions", "deploy", "ai-agent-optimized", "--project-ref", "wnnjeqheqxxyrgsjmygy"],
    ]);
  });

  test("fails after a Docker rate-limit retry also fails with --use-api", () => {
    const { root, statePath } = makeFakeSupabase({
      deployFailure: "rate-limit-then-api-failure",
    });
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${root}${path.delimiter}${process.env.PATH ?? ""}`,
        FAKE_SUPABASE_STATE_PATH: statePath,
        SUPABASE_PROJECT_REF: "wnnjeqheqxxyrgsjmygy",
        SUPABASE_ACCESS_TOKEN: "test-token",
      },
      timeout: 120_000,
    });
    const state = JSON.parse(readFileSync(statePath, "utf8")) as { calls: string[][] };
    const combinedOutput = `${result.stdout}\n${result.stderr}`;

    expect(result.status).toBe(1);
    expect(combinedOutput).toContain("retrying with --use-api");
    expect(combinedOutput).toContain("Failed to deploy ai-agent-optimized");
    expect(state.calls).toEqual([
      ["functions", "deploy", "ai-agent-optimized", "--project-ref", "wnnjeqheqxxyrgsjmygy"],
      [
        "functions",
        "deploy",
        "ai-agent-optimized",
        "--project-ref",
        "wnnjeqheqxxyrgsjmygy",
        "--use-api",
      ],
    ]);
  });
});
