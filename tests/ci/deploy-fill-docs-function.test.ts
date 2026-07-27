import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const repoRoot = path.resolve(__dirname, "..", "..");
const scriptPath = path.join(repoRoot, "scripts", "ci", "deploy-fill-docs-function.mjs");

const tempDirs: string[] = [];

const write = (root: string, relativePath: string, content: string) => {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
};

const makeFakeSupabase = ({
  listPayload = [{ slug: "fill-docs", verify_jwt: true }],
  deployFailure = "none",
} = {}) => {
  const root = mkdtempSync(path.join(tmpdir(), "supabase-fill-docs-deploy-"));
  const statePath = path.join(root, "state.json");
  tempDirs.push(root);

  writeFileSync(statePath, JSON.stringify({ calls: [] }, null, 2));
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
      "  writeFileSync(statePath, JSON.stringify(state, null, 2));",
      "  if (deployFailure === 'docker-static-files') {",
      "    console.error('failed to bundle function: static_files are not supported with Management API deployments; Docker runtime required');",
      "    process.exit(1);",
      "  }",
      "  if (deployFailure === 'rate-limit') {",
      "    console.error('failed to create the docker container: public.ecr.aws/supabase/edge-runtime:v1.71.0: toomanyrequests: Rate exceeded');",
      "    process.exit(1);",
      "  }",
      "  console.log(`deployed ${args[2]}`);",
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

const runScript = (
  env: NodeJS.ProcessEnv,
  fakeSupabase?: { root: string; statePath: string },
) =>
  spawnSync(process.execPath, [scriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
      PATH: fakeSupabase ? `${fakeSupabase.root}${path.delimiter}${process.env.PATH ?? ""}` : process.env.PATH,
      FAKE_SUPABASE_STATE_PATH: fakeSupabase?.statePath,
    },
    timeout: 120_000,
  });

describe("deploy-fill-docs-function", () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  test("maps the CI package command to the fill-docs deploy helper", () => {
    const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["ci:deploy:fill-docs-function"]).toBe(
      "node scripts/ci/deploy-fill-docs-function.mjs",
    );
  });

  test("deploys only fill-docs, derives the project ref, and never uses --use-api", () => {
    const fakeSupabase = makeFakeSupabase();
    const result = runScript(
      {
        SUPABASE_URL: "https://wnnjeqheqxxyrgsjmygy.supabase.co",
        SUPABASE_ACCESS_TOKEN: "test-token",
      },
      fakeSupabase,
    );
    const state = JSON.parse(readFileSync(fakeSupabase.statePath, "utf8")) as { calls: string[][] };

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).not.toContain("--use-api");
    expect(state.calls).toEqual([
      ["functions", "deploy", "fill-docs", "--project-ref", "wnnjeqheqxxyrgsjmygy"],
      ["functions", "list", "--project-ref", "wnnjeqheqxxyrgsjmygy", "--output", "json"],
    ]);
  });

  test("fails fast when SUPABASE_ACCESS_TOKEN is missing", () => {
    const result = runScript({
      SUPABASE_PROJECT_REF: "wnnjeqheqxxyrgsjmygy",
      SUPABASE_ACCESS_TOKEN: "",
    });

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain("Missing SUPABASE_ACCESS_TOKEN");
  });

  test("fails fast when no project ref can be derived", () => {
    const result = runScript({
      SUPABASE_URL: "",
      SUPABASE_PROJECT_REF: "",
      SUPABASE_ACCESS_TOKEN: "test-token",
    });

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain("Missing project ref");
  });

  test("fails fast when SUPABASE_PROJECT_REF and SUPABASE_URL disagree", () => {
    const result = runScript({
      SUPABASE_URL: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co",
      SUPABASE_PROJECT_REF: "wnnjeqheqxxyrgsjmygy",
      SUPABASE_ACCESS_TOKEN: "test-token",
    });

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      "SUPABASE_PROJECT_REF and SUPABASE_URL resolve to different projects",
    );
  });

  test("fails without retry when Docker/static-file deployment fails", () => {
    const fakeSupabase = makeFakeSupabase({
      deployFailure: "docker-static-files",
    });
    const result = runScript(
      {
        SUPABASE_PROJECT_REF: "wnnjeqheqxxyrgsjmygy",
        SUPABASE_ACCESS_TOKEN: "test-token",
      },
      fakeSupabase,
    );
    const state = JSON.parse(readFileSync(fakeSupabase.statePath, "utf8")) as { calls: string[][] };
    const combinedOutput = `${result.stdout}\n${result.stderr}`;

    expect(result.status).toBe(1);
    expect(combinedOutput).toContain("Static-file");
    expect(combinedOutput).toContain("Docker");
    expect(state.calls).toEqual([
      ["functions", "deploy", "fill-docs", "--project-ref", "wnnjeqheqxxyrgsjmygy"],
    ]);
  });

  test("fails without retry when Docker pulls are rate-limited", () => {
    const fakeSupabase = makeFakeSupabase({
      deployFailure: "rate-limit",
    });
    const result = runScript(
      {
        SUPABASE_PROJECT_REF: "wnnjeqheqxxyrgsjmygy",
        SUPABASE_ACCESS_TOKEN: "test-token",
      },
      fakeSupabase,
    );
    const state = JSON.parse(readFileSync(fakeSupabase.statePath, "utf8")) as { calls: string[][] };
    const combinedOutput = `${result.stdout}\n${result.stderr}`;

    expect(result.status).toBe(1);
    expect(combinedOutput).toContain("Docker");
    expect(state.calls).toEqual([
      ["functions", "deploy", "fill-docs", "--project-ref", "wnnjeqheqxxyrgsjmygy"],
    ]);
  });

  test("fails when fill-docs is missing from the remote function list", () => {
    const fakeSupabase = makeFakeSupabase({
      listPayload: [{ slug: "sessions-book", verify_jwt: true }],
    });
    const result = runScript(
      {
        SUPABASE_PROJECT_REF: "wnnjeqheqxxyrgsjmygy",
        SUPABASE_ACCESS_TOKEN: "test-token",
      },
      fakeSupabase,
    );

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain("Missing deployed function after deploy: fill-docs");
  });

  test("fails when fill-docs verify_jwt is not true", () => {
    const fakeSupabase = makeFakeSupabase({
      listPayload: [{ slug: "fill-docs", verify_jwt: false }],
    });
    const result = runScript(
      {
        SUPABASE_PROJECT_REF: "wnnjeqheqxxyrgsjmygy",
        SUPABASE_ACCESS_TOKEN: "test-token",
      },
      fakeSupabase,
    );

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain("verify_jwt must be true for fill-docs");
  });
});
