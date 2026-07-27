import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(__dirname, "..", "..");
const scriptPath = path.join(
  repoRoot,
  "scripts",
  "ci",
  "check-edge-deploy-prerequisites.mjs",
);

const runScript = (
  env: NodeJS.ProcessEnv,
  args: string[] = ["session edge"],
) =>
  spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
    timeout: 120_000,
  });

describe("check-edge-deploy-prerequisites", () => {
  test("can be imported as a library without executing the CLI", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `await import(${JSON.stringify(pathToFileURL(scriptPath).href)});`,
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          SUPABASE_PROJECT_REF: "",
          SUPABASE_URL: "",
          SUPABASE_ACCESS_TOKEN: "",
        },
        timeout: 120_000,
      },
    );

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toBe("\n");
  });

  test("accepts matching SUPABASE_PROJECT_REF and SUPABASE_URL inputs", () => {
    const result = runScript({
      SUPABASE_PROJECT_REF: "wnnjeqheqxxyrgsjmygy",
      SUPABASE_URL: "https://wnnjeqheqxxyrgsjmygy.supabase.co",
      SUPABASE_ACCESS_TOKEN: "test-token",
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      "session edge deploy prerequisites look valid",
    );
  });

  test("fails closed when SUPABASE_PROJECT_REF and SUPABASE_URL disagree", () => {
    const result = runScript({
      SUPABASE_PROJECT_REF: "wnnjeqheqxxyrgsjmygy",
      SUPABASE_URL: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co",
      SUPABASE_ACCESS_TOKEN: "test-token",
    });

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      "SUPABASE_PROJECT_REF and SUPABASE_URL resolve to different projects",
    );
  });

  test.each([
    "https://example.com",
    "https://wnnjeqheqxxyrgsjmygy.example.com",
    "https://short.supabase.co",
  ])("rejects an invalid Supabase project URL: %s", (supabaseUrl) => {
    const result = runScript({
      SUPABASE_URL: supabaseUrl,
      SUPABASE_PROJECT_REF: "",
      SUPABASE_ACCESS_TOKEN: "test-token",
    });

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain("Missing project ref");
  });

  test("fails closed when SUPABASE_ACCESS_TOKEN is missing", () => {
    const result = runScript({
      SUPABASE_PROJECT_REF: "wnnjeqheqxxyrgsjmygy",
      SUPABASE_URL: "",
      SUPABASE_ACCESS_TOKEN: "",
    });

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      "Missing SUPABASE_ACCESS_TOKEN",
    );
  });
});
