import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("supabase/migrations/20260714153227_decompose_ci_rls_fixture_profile_guard.sql"),
  "utf8",
);
const executableMigration = migration.replace(/--.*$/gm, "");

describe("service-only synthetic RLS fixture profile provisioning", () => {
  it("requires an expiring service-created actor and one active authoritative role", () => {
    expect(executableMigration).toMatch(/select\s+u\.email,\s+u\.raw_app_meta_data ->> 'ci_rls_fixture' = 'true',\s+u\.raw_app_meta_data ->> 'ci_rls_expires_at'\s+into\s+actor_email,\s+actor_marker_ok,\s+actor_expiry_text\s+from auth\.users u\s+where u\.id = p_user_id/i);
    expect(executableMigration).toMatch(/lower\(actor_email\) like '%\.%@example\.com'/i);
    expect(executableMigration).toMatch(/from public\.user_roles/i);
    expect(executableMigration).toMatch(/join public\.roles/i);
    expect(executableMigration).toMatch(/coalesce\(ur\.is_active, true\) = true/i);
    expect(executableMigration).toMatch(/count\(distinct r\.name\)::integer/i);
    expect(executableMigration).toMatch(/bool_and\(r\.name in \('client', 'therapist', 'admin'\)\)/i);
    expect(executableMigration).toMatch(/if not found then\s*raise exception using[\s\S]*?message = 'Synthetic RLS actor is missing'[\s\S]*?end if;/i);
    expect(executableMigration).toMatch(/email_shape_ok := coalesce\([\s\S]*?;\s*if not email_shape_ok then\s*raise exception using[\s\S]*?message = 'Synthetic RLS actor email is not eligible'[\s\S]*?end if;/i);
    expect(executableMigration).toMatch(/if not coalesce\(actor_marker_ok, false\) then\s*raise exception using[\s\S]*?message = 'Synthetic RLS actor marker is required'[\s\S]*?end if;/i);
    expect(executableMigration).toMatch(/if actor_expiry_text is null then\s*raise exception using[\s\S]*?message = 'Synthetic RLS actor expiry is invalid'[\s\S]*?end if;/i);
    expect(executableMigration).toMatch(/begin\s*actor_unexpired := actor_expiry_text::timestamptz > now\(\);\s*exception\s*when invalid_datetime_format or datetime_field_overflow then\s*raise exception using[\s\S]*?message = 'Synthetic RLS actor expiry is invalid'[\s\S]*?end;/i);
    expect(executableMigration).toMatch(/if not actor_unexpired then\s*raise exception using[\s\S]*?message = 'Synthetic RLS actor marker is expired'[\s\S]*?end if;/i);
    expect(executableMigration).toMatch(/if distinct_role_count = 0 then\s*raise exception using[\s\S]*?message = 'Synthetic RLS actor has no active role'[\s\S]*?end if;/i);
    expect(executableMigration).toMatch(/if distinct_role_count <> 1 then\s*raise exception using[\s\S]*?message = 'Synthetic RLS actor must have exactly one active role'[\s\S]*?end if;/i);
    expect(executableMigration).toMatch(/if not allowed_roles_ok then\s*raise exception using[\s\S]*?message = 'Synthetic RLS actor role is not allowed'[\s\S]*?end if;/i);
  });

  it("reports only non-sensitive staged predicate evidence", () => {
    expect(migration).toMatch(/email_shape=%s marker=%s unexpired=%s active_role_count=%s distinct_role_count=%s allowed_roles=%s/i);
    expect(migration).not.toMatch(/detail[\s\S]{0,200}p_user_id/i);
    expect(migration).not.toMatch(/detail[\s\S]{0,200}actor_email/i);
    expect(migration).not.toMatch(/detail[\s\S]{0,200}raw_app_meta_data/i);
  });

  it("validates tenant ownership from the role-specific authoritative record", () => {
    expect(migration).toMatch(/from public\.therapists/i);
    expect(migration).toMatch(/from public\.clients/i);
    expect(migration).toMatch(/get_organization_id_from_metadata/i);
    expect(migration).toMatch(/resolved_organization_id <> p_organization_id/i);
  });

  it("uses the profile guard bypass and remains service-role only", () => {
    expect(migration).toMatch(/security definer/i);
    expect(migration).toMatch(/set search_path = ''/i);
    expect(migration).toMatch(/set_config\('app\.bypass_profile_role_guard', 'on', true\)/i);
    expect(migration).toMatch(/if updated_rows <> 1 then/i);
    expect(migration).toMatch(/when others then[\s\S]*set_config\('app\.bypass_profile_role_guard', 'off', true\)/i);
    expect(executableMigration).toMatch(/revoke execute on function public\.provision_ci_rls_fixture_profile\(uuid, uuid\) from public;/i);
    expect(executableMigration).toMatch(/revoke execute on function public\.provision_ci_rls_fixture_profile\(uuid, uuid\) from anon;/i);
    expect(executableMigration).toMatch(/revoke execute on function public\.provision_ci_rls_fixture_profile\(uuid, uuid\) from authenticated;/i);
    const grantStatements = [
      ...executableMigration.matchAll(
        /grant\s+execute\s+on\s+function\s+public\.provision_ci_rls_fixture_profile\(uuid, uuid\)[\s\S]*?;/gi,
      ),
    ].map((match) => match[0].replace(/\s+/g, " ").trim().toLowerCase());
    expect(grantStatements).toEqual([
      "grant execute on function public.provision_ci_rls_fixture_profile(uuid, uuid) to service_role;",
    ]);
  });
});
