// @vitest-environment node
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const MIGRATION_PATH = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260429142000_dashboard_service_authority_rpc.sql",
);

function readMigration(): string {
  return fs.readFileSync(MIGRATION_PATH, "utf8");
}

describe("dashboard authority migration", () => {
  it("adds a service-role-only trusted dashboard RPC", () => {
    const sql = readMigration();

    expect(sql).toContain("create or replace function public.get_dashboard_data_for_org(");
    expect(sql).toContain("actor_user_id uuid");
    expect(sql).toContain("target_organization_id uuid");
    expect(sql).toContain("security definer");
    expect(sql).toContain("grant execute on function public.get_dashboard_data_for_org(uuid, uuid) to service_role;");
    expect(sql).toContain("revoke execute on function public.get_dashboard_data_for_org(uuid, uuid) from authenticated;");
    expect(sql).toContain("revoke execute on function public.get_dashboard_data_for_org(uuid, uuid) from dashboard_consumer;");
  });

  it("keeps direct authenticated dashboard RPC denied", () => {
    const sql = readMigration();

    expect(sql).toContain("revoke execute on function public.get_dashboard_data() from authenticated;");
    expect(sql).toContain("grant execute on function public.get_dashboard_data() to dashboard_consumer;");
    expect(sql).toContain("grant execute on function public.get_dashboard_data() to service_role;");
    expect(sql).not.toContain("grant execute on function public.get_dashboard_data() to authenticated;");
  });

  it("re-checks actor authority and explicitly filters dashboard reads by requested organization", () => {
    const sql = readMigration();

    expect(sql).toContain("where p.id = actor_user_id");
    expect(sql).toContain("ur.user_id = actor_user_id");
    expect(sql).toContain("r.name in ('admin', 'org_admin', 'org_super_admin')");
    expect(sql).toContain("r.name = 'super_admin'");
    expect(sql).not.toContain("r.name in ('super_admin', 'org_super_admin')");
    expect(sql).toContain("v_actor_org = target_organization_id");
    expect(sql).toContain("s.organization_id = target_organization_id");
    expect(sql).toContain("t.organization_id = target_organization_id");
    expect(sql).toContain("c.organization_id = target_organization_id");
    expect(sql).toContain("br.organization_id = target_organization_id");
  });
});
