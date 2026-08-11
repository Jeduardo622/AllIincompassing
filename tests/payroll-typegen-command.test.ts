import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(
  readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
) as {
  scripts?: Record<string, string>;
};

describe("payroll local typegen command", () => {
  it("adds a local-only canonical typegen script", () => {
    const command = packageJson.scripts?.["typegen:local"];

    expect(command).toBe(
      "supabase gen types typescript --local > src/lib/generated/database.types.ts",
    );
    expect(command).toContain("--local");
    expect(command).not.toContain("$SUPABASE_PROJECT_ID");
    expect(command).not.toContain("src/lib/db.types.ts");
  });
});
