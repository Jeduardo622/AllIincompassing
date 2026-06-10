import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("week-forward scheduling RPC migration contract", () => {
  const migrationPath = path.join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260610194313_fix_week_forward_conflict_scope.sql",
  );

  it("restores the RPC with admin-only execution and schema-cache reload", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("create or replace function public.apply_schedule_week_forward");
    expect(sql).toContain("security definer");
    expect(sql).toContain("app.user_has_role_for_org('admin'");
    expect(sql).toContain("app.user_has_role_for_org('super_admin'");
    expect(sql).toContain("v_source.organization_id <> v_source_org");
    expect(sql).toContain("v_source.status <> 'scheduled'");
    expect(sql).toContain("revoke execute on function public.apply_schedule_week_forward");
    expect(sql).toContain("grant execute on function public.apply_schedule_week_forward");
    expect(sql).toContain("to authenticated");
    expect(sql).toContain("notify pgrst, 'reload schema'");
  });

  it("limits existing-session conflicts to the same therapist or client", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toMatch(
      /join public\.sessions e\s+on e\.organization_id = c\.organization_id\s+and e\.status <> 'cancelled'\s+and tstzrange\(e\.start_time, e\.end_time, '\[\)'\) && tstzrange\(c\.candidate_start, c\.candidate_end, '\[\)'\)\s+and \(\s+e\.therapist_id = c\.therapist_id\s+or e\.client_id = c\.client_id\s+\)/,
    );
  });
});
