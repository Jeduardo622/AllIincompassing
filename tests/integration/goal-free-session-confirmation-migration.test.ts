// @vitest-environment node
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const MIGRATION_PATH = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260703032815_allow_goal_free_session_confirmation.sql",
);

function readMigration(): string {
  return fs.readFileSync(MIGRATION_PATH, "utf8").replace(/\r\n/g, "\n");
}

describe("goal-free session confirmation migration", () => {
  it("makes sessions clinical links nullable for scheduling-only bookings", () => {
    const sql = readMigration();

    expect(sql).toContain("alter column program_id drop not null");
    expect(sql).toContain("alter column goal_id drop not null");
  });

  it("keeps confirm_session_hold required fields limited to scheduling identity and time", () => {
    const sql = readMigration();

    expect(sql).toMatch(
      /if v_therapist_id is null or v_client_id is null or v_start is null or v_end is null then/i,
    );
    expect(sql).not.toMatch(
      /if v_therapist_id is null or v_client_id is null or v_program_id is null or v_goal_id is null or v_start is null or v_end is null then/i,
    );
  });

  it("rejects half-linked clinical sessions instead of accepting inconsistent goal links", () => {
    const sql = readMigration();

    expect(sql).toMatch(/\(v_program_id is null\) <> \(v_goal_id is null\)/i);
    expect(sql).toContain("program_id and goal_id must be provided together when clinical goals are attached.");
  });

  it("preserves service-role-only execute access for the security-definer confirmation RPC", () => {
    const sql = readMigration();

    expect(sql).toContain("revoke execute on function public.confirm_session_hold(uuid, jsonb) from public;");
    expect(sql).toContain("revoke execute on function public.confirm_session_hold(uuid, jsonb) from anon;");
    expect(sql).toContain("revoke execute on function public.confirm_session_hold(uuid, jsonb) from authenticated;");
    expect(sql).toContain("grant execute on function public.confirm_session_hold(uuid, jsonb) to service_role;");
  });
});
