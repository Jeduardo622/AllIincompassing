import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("user_therapist_links self-read policy", () => {
  it("lets authenticated users select only their own canonical therapist links", () => {
    const migrationDir = resolve("supabase/migrations");
    const source = readdirSync(migrationDir)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => readFileSync(resolve(migrationDir, name), "utf8"))
      .find((sql) => sql.includes("user_therapist_links_self_select"));

    expect(source, "missing forward migration for canonical self-link reads").toBeDefined();
    expect(source).toMatch(
      /create\s+policy\s+user_therapist_links_self_select[\s\S]*?on\s+public\.user_therapist_links[\s\S]*?for\s+select[\s\S]*?to\s+authenticated/i,
    );
    expect(source).toMatch(/using\s*\(\s*user_id\s*=\s*\(\s*select\s+auth\.uid\(\)\s*\)\s*\)/i);
    expect(source).not.toMatch(/grant\s+(?:insert|update|delete|all)[^;]*user_therapist_links/i);
  });
});
