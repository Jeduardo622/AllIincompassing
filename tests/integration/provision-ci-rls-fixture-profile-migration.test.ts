import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("supabase/migrations/20260714130000_provision_ci_rls_fixture_profile.sql"),
  "utf8",
);

describe("service-only synthetic RLS fixture profile provisioning", () => {
  it("requires an expiring service-created actor and one active authoritative role", () => {
    expect(migration).toMatch(/raw_app_meta_data ->> 'ci_rls_fixture' = 'true'/i);
    expect(migration).toMatch(/raw_app_meta_data ->> 'ci_rls_expires_at'/i);
    expect(migration).toMatch(/from public\.user_roles/i);
    expect(migration).toMatch(/join public\.roles/i);
    expect(migration).toMatch(/coalesce\(ur\.is_active, true\) = true/i);
    expect(migration).toMatch(/count\(distinct r\.name\) = 1/i);
    expect(migration).toMatch(/bool_and\(r\.name in \('client', 'therapist', 'admin'\)\)/i);
  });

  it("validates tenant ownership from the role-specific authoritative record", () => {
    expect(migration).toMatch(/from public\.therapists/i);
    expect(migration).toMatch(/from public\.clients/i);
    expect(migration).toMatch(/get_organization_id_from_metadata/i);
    expect(migration).toMatch(/resolved_organization_id <> p_organization_id/i);
  });

  it("uses the profile guard bypass and remains service-role only", () => {
    expect(migration).toMatch(/set_config\('app\.bypass_profile_role_guard', 'on', true\)/i);
    expect(migration).toMatch(/if updated_rows <> 1 then/i);
    expect(migration).toMatch(/when others then[\s\S]*set_config\('app\.bypass_profile_role_guard', 'off', true\)/i);
    expect(migration).toMatch(/revoke execute on function public\.provision_ci_rls_fixture_profile\(uuid, uuid\) from public/i);
    expect(migration).toMatch(/from anon/i);
    expect(migration).toMatch(/from authenticated/i);
    expect(migration).toMatch(/grant execute on function public\.provision_ci_rls_fixture_profile\(uuid, uuid\) to service_role/i);
  });
});
