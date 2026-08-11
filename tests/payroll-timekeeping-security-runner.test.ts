import { spawnSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("payroll timekeeping security runner", () => {
  it("fails before connecting when the database is not the exact local Supabase target", () => {
    const result = spawnSync(
      process.execPath,
      [path.join(process.cwd(), "scripts", "payroll-timekeeping-security-contract.mjs")],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          PAYROLL_LOCAL_DATABASE_URL:
            "postgresql://postgres@example.invalid:5432/postgres",
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "requires the exact local Supabase loopback database",
    );
  });
});
