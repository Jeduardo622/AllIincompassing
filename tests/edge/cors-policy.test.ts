import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WILDCARD_CORS_PATTERN =
  /['"]access-control-allow-origin['"]\s*:\s*['"]\*['"]/i;

function getProtectedFunctionSourceFiles(repoRoot: string): string[] {
  const functionsRoot = join(repoRoot, "supabase", "functions");
  const entries = readdirSync(functionsRoot, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name !== "_shared" && name !== "lib")
    .filter((name) => {
      const tomlPath = join(functionsRoot, name, "function.toml");
      try {
        const toml = readFileSync(tomlPath, "utf8");
        return /verify_jwt\s*=\s*true/i.test(toml);
      } catch {
        return false;
      }
    })
    .map((name) => join("supabase", "functions", name, "index.ts"));
}

describe("edge function CORS policy", () => {
  it("does not allow wildcard origins for protected edge functions", () => {
    const repoRoot = process.cwd();
    const protectedFunctionFiles = getProtectedFunctionSourceFiles(repoRoot);
    expect(protectedFunctionFiles.length).toBeGreaterThan(0);

    for (const file of protectedFunctionFiles) {
      const source = readFileSync(join(repoRoot, file), "utf8");
      expect(source).not.toMatch(WILDCARD_CORS_PATTERN);
    }
  });
});

