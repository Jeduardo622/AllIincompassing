import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, test } from "vitest";

const repoRoot = path.resolve(__dirname, "..", "..");
const scriptPath = path.join(repoRoot, "scripts", "ci", "deploy-session-edge-bundle.mjs");

const tempDirs: string[] = [];

const write = (root: string, relativePath: string, content: string) => {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
};

const makeFakeSupabase = () => {
  const root = mkdtempSync(path.join(tmpdir(), "supabase-ci-deploy-"));
  const statePath = path.join(root, "state.json");
  tempDirs.push(root);

  writeFileSync(statePath, JSON.stringify({ calls: [], deployed: [], failedOnce: false }, null, 2));
  write(
    root,
    "supabase-driver.mjs",
    [
      "import { readFileSync, writeFileSync } from 'node:fs';",
      "",
      "const statePath = process.env.FAKE_SUPABASE_STATE_PATH;",
      "const args = process.argv.slice(2);",
      "const state = JSON.parse(readFileSync(statePath, 'utf8'));",
      "state.calls.push(args);",
      "",
      "if (args[0] === 'functions' && args[1] === 'deploy') {",
      "  const fn = args[2];",
      "  const useApi = args.includes('--use-api');",
      "  if (fn === 'sessions-book' && !useApi && state.failedOnce === false) {",
      "    state.failedOnce = true;",
      "    writeFileSync(statePath, JSON.stringify(state, null, 2));",
      "    console.error('failed to create the docker container: public.ecr.aws/supabase/edge-runtime:v1.71.0: toomanyrequests: Rate exceeded');",
      "    process.exit(1);",
      "  }",
      "  if (!state.deployed.includes(fn)) {",
      "    state.deployed.push(fn);",
      "  }",
      "  writeFileSync(statePath, JSON.stringify(state, null, 2));",
      "  console.log(`deployed ${fn}${useApi ? ' with --use-api' : ''}`);",
      "  process.exit(0);",
      "}",
      "",
      "if (args[0] === 'functions' && args[1] === 'list') {",
      "  writeFileSync(statePath, JSON.stringify(state, null, 2));",
      "  process.stdout.write(JSON.stringify(state.deployed.map((slug) => ({ slug, verify_jwt: true }))));",
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

describe("deploy-session-edge-bundle", () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  test("retries with --use-api when Docker bundle pulls are rate-limited", () => {
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

    const combinedOutput = `${result.stdout}\n${result.stderr}`;
    const state = JSON.parse(readFileSync(statePath, "utf8")) as {
      calls: string[][];
      deployed: string[];
      failedOnce: boolean;
    };

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(combinedOutput).toContain("retrying with --use-api");
    expect(state.calls[0]).toEqual(["functions", "deploy", "sessions-book", "--project-ref", "wnnjeqheqxxyrgsjmygy"]);
    expect(state.calls[1]).toEqual([
      "functions",
      "deploy",
      "sessions-book",
      "--project-ref",
      "wnnjeqheqxxyrgsjmygy",
      "--use-api",
    ]);
    expect(state.calls.at(-1)).toEqual(["functions", "list", "--project-ref", "wnnjeqheqxxyrgsjmygy", "--output", "json"]);
    expect(state.deployed.length).toBeGreaterThan(10);
  });
});
