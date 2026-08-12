import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("payroll timekeeping security runner", () => {
  it("asserts Task 2A capture read and exception-mutation protections in the local runner", () => {
    const script = readFileSync(
      path.join(process.cwd(), "scripts", "payroll-timekeeping-security-contract.mjs"),
      "utf8",
    );

    expect(script).toContain("get_payroll_day");
    expect(script).toContain("get_session_payroll_context");
    expect(script).toContain("session_outside_shift");
    expect(script).toContain("timekeeping_exceptions");
    expect(script).toContain("actorIsAssignedEmployee");
    expect(script).toContain("requires the exact local Supabase loopback database");
  });

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
