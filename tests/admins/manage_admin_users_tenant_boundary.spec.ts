import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20260715134500_repair_manage_admin_users_tenant_boundary.sql',
);

describe('manage_admin_users tenant boundary repair', () => {
  it('derives the caller type and tenant from current authoritative request state', () => {
    const sql = readFileSync(migrationPath, 'utf8').replace(/\s+/g, ' ');

    expect(sql).toMatch(/coalesce\(auth\.jwt\(\)\s*->>\s*'role',\s*''\)/i);
    expect(sql).not.toMatch(/current_setting\('request\.jwt\.claim\.role'/i);
    expect(sql).toMatch(/select p\.organization_id, p\.is_active into v_caller_org, v_caller_active from public\.profiles p where p\.id = v_caller_id/i);
    expect(sql).toContain('app.resolve_user_organization_id(v_target_id)');
    expect(sql).toMatch(/if v_caller_org <> v_target_org then\s+raise exception/i);
    expect(sql.match(/coalesce\(v_caller_active, false\) is not true/g)).toHaveLength(2);
  });

  it('keeps delegated admin assignment on the same canonical active-profile boundary', () => {
    const sql = readFileSync(migrationPath, 'utf8').replace(/\s+/g, ' ');

    expect(sql).toMatch(/create or replace function public\.assign_admin_role/i);
    expect(sql).toMatch(/left join public\.profiles p on p\.id = u\.id/i);
    expect(sql).toMatch(/if not v_is_service_role and coalesce\(v_target_active, false\) is not true/i);
    expect(sql).toMatch(/if v_target_org is distinct from organization_id then/i);
    expect(sql).not.toMatch(/if v_target_org is not null and v_target_org <> organization_id then/i);
    expect(sql).toMatch(/on conflict \(user_id, role_id\) do update set is_active = true, expires_at = null/i);
    expect(sql).not.toMatch(/get_organization_id_from_metadata/i);
  });

  it('keeps the authenticated and service-role grants explicit', () => {
    const sql = readFileSync(migrationPath, 'utf8').replace(/\s+/g, ' ');

    expect(sql).toMatch(/revoke execute on function public\.manage_admin_users\(text, text\) from public/i);
    expect(sql).toMatch(/revoke execute on function public\.manage_admin_users\(text, text\) from anon/i);
    expect(sql).toMatch(/grant execute on function public\.manage_admin_users\(text, text\) to authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.manage_admin_users\(text, text\) to service_role/i);
    expect(sql).toMatch(/revoke execute on function public\.assign_admin_role\(text, uuid, text\) from anon/i);
    expect(sql).toMatch(/revoke execute on function public\.assign_admin_role\(text, uuid, text\) from authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.assign_admin_role\(text, uuid, text\) to service_role/i);
  });
});
