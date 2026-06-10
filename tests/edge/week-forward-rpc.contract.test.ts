import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("week-forward scheduling RPC migration contract", () => {
  it("restores the RPC with admin-only execution and schema-cache reload", () => {
    const migrationPath = path.join(
      process.cwd(),
      "supabase",
      "migrations",
      "20260610191118_restore_week_forward_rpc.sql",
    );
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
});
