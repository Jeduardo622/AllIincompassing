import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationSql = () =>
  readFileSync(
    join(process.cwd(), 'supabase/migrations/20260709172500_harden_admin_users_rpc_exposure.sql'),
    'utf-8',
  );

describe('admin users RPC exposure hardening migration', () => {
  it('removes the legacy unscoped get_admin_users overloads before recreating the scoped RPC', () => {
    const sql = migrationSql();

    expect(sql).toMatch(/drop function if exists public\.get_admin_users\(\)/i);
    expect(sql).toMatch(/drop function if exists public\.get_admin_users\(uuid\)/i);
    expect(sql).toMatch(/create or replace function public\.get_admin_users\(\s*organization_id uuid default null/i);
    expect(sql).toMatch(/returns setof public\.admin_users/i);
    expect(sql).not.toMatch(/return public\.get_admin_users\(\)/i);
  });

  it('requires an authenticated admin or super admin for non-service-role callers', () => {
    const sql = migrationSql();

    expect(sql).toMatch(/current_user_id uuid := auth\.uid\(\)/i);
    expect(sql).toMatch(/current_setting\('request\.jwt\.claim\.role', true\)/i);
    expect(sql).toMatch(/is_service_role boolean := request_role = 'service_role'/i);
    expect(sql).toMatch(/caller_is_super_admin :=[\s\S]*coalesce\(public\.current_user_is_super_admin\(\), false\)[\s\S]*or coalesce\(app\.user_has_role\('super_admin'\), false\)/i);
    expect(sql).toMatch(/r\.name = 'admin'[\s\S]*coalesce\(ur\.is_active, true\) = true[\s\S]*ur\.expires_at is null or ur\.expires_at > now\(\)/i);
    expect(sql).toMatch(/Only administrators or super admins can view admin users/i);
  });

  it('preserves organization scoping for regular admin callers', () => {
    const sql = migrationSql();

    expect(sql).toMatch(/select public\.get_organization_id_from_metadata\(u\.raw_user_meta_data\)[\s\S]*into caller_org_id/i);
    expect(sql).toMatch(/resolved_org <> caller_org_id[\s\S]*Caller organization mismatch/i);
    expect(sql).toMatch(/where r\.name = 'admin'[\s\S]*public\.get_organization_id_from_metadata\(u\.raw_user_meta_data\) = resolved_org/i);
  });

  it('uses explicit base-table queries so service-role callers do not depend on auth.uid-filtered view rows', () => {
    const sql = migrationSql();
    const serviceRoleBlock = sql.match(/if is_service_role then[\s\S]*?\n  end if;/i)?.[0] ?? '';

    expect(serviceRoleBlock).toMatch(/from auth\.users u[\s\S]*join public\.user_roles ur on ur\.user_id = u\.id[\s\S]*join public\.roles r on r\.id = ur\.role_id/i);
    expect(serviceRoleBlock).not.toMatch(/from public\.admin_users/i);
  });

  it('restores only service-role execute on the metadata compatibility wrapper', () => {
    const sql = migrationSql();

    expect(sql).toMatch(/create or replace function public\.manage_admin_users\(\s*operation text,\s*target_user_id text,\s*metadata jsonb/i);
    expect(sql).toMatch(/perform public\.manage_admin_users\(operation,\s*target_user_id\)/i);
    expect(sql).toMatch(/revoke execute on function public\.manage_admin_users\(text,\s*text,\s*jsonb\) from public/i);
    expect(sql).toMatch(/revoke execute on function public\.manage_admin_users\(text,\s*text,\s*jsonb\) from anon/i);
    expect(sql).toMatch(/revoke execute on function public\.manage_admin_users\(text,\s*text,\s*jsonb\) from authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.manage_admin_users\(text,\s*text,\s*jsonb\) to service_role/i);
  });

  it('normalizes the admin_users view to read-only grants for intended roles', () => {
    const sql = migrationSql();

    expect(sql).toMatch(/alter view public\.admin_users set \(security_barrier = true, security_invoker = true\)/i);
    expect(sql).toMatch(/revoke all privileges on public\.admin_users from public/i);
    expect(sql).toMatch(/revoke all privileges on public\.admin_users from anon/i);
    expect(sql).toMatch(/revoke all privileges on public\.admin_users from authenticated/i);
    expect(sql).toMatch(/revoke all privileges on public\.admin_users from service_role/i);
    expect(sql).toMatch(/grant select on public\.admin_users to authenticated/i);
    expect(sql).toMatch(/grant select on public\.admin_users to service_role/i);
    expect(sql).toMatch(/grant select on public\.admin_users to app_admin_executor/i);
    expect(sql).not.toMatch(/grant (insert|update|delete|all privileges) on public\.admin_users to authenticated/i);
  });
});
