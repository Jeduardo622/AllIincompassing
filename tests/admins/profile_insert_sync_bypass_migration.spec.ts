import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20260814205000_profile_insert_sync_bypass.sql',
);
const syncMigrationPath = join(
  process.cwd(),
  'supabase/migrations/20260703195500_sync_user_profile_organization_scope.sql',
);

const readMigration = (): string => (existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '');

describe('profile insert sync bypass migration', () => {
  it('honors the trusted sync bypass before self-service field normalization', () => {
    const sql = readMigration();
    const normalizedSql = sql.toLowerCase();

    expect(sql, 'the forward migration must exist').not.toBe('');
    const bypassOffset = normalizedSql.indexOf("current_setting('app.bypass_profile_role_guard', true)");
    const organizationNormalizationOffset = normalizedSql.indexOf('new.organization_id := null');

    expect(bypassOffset).toBeGreaterThan(-1);
    expect(organizationNormalizationOffset).toBeGreaterThan(bypassOffset);
    expect(sql).toMatch(/if[\s\S]*app\.bypass_profile_role_guard[\s\S]*return new;/i);
  });

  it('preserves the service-role, super-admin, and unprivileged normalization branches', () => {
    const sql = readMigration();

    expect(sql).toMatch(/is_service_role boolean := coalesce\(jwt_role, ''\) = 'service_role'/i);
    expect(sql).toMatch(/if is_service_role or app\.current_user_is_super_admin\(\) then[\s\S]*return new;/i);
    expect(sql).toMatch(/new\.role := 'client'::role_type;/i);
    expect(sql).toMatch(/new\.organization_id := null;/i);
    expect(sql).toMatch(/new\.is_active := coalesce\(new\.is_active, true\);/i);
  });

  it('matches the existing transaction-local sync contract without widening database surfaces', () => {
    const sql = readMigration();
    const syncSql = readFileSync(syncMigrationPath, 'utf8');

    expect(syncSql).toMatch(/set_config\('app\.bypass_profile_role_guard', 'on', true\)/i);
    expect(sql).toMatch(/create or replace function app\.normalize_profile_insert_authz_fields\(\)/i);
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/set search_path = public, auth/i);
    expect(sql).not.toMatch(/\b(?:grant|revoke|create policy|drop policy|alter table|create trigger|drop trigger)\b/i);
    expect(sql).not.toMatch(/\b(?:insert into|update public\.|delete from|truncate)\b/i);
  });
});
