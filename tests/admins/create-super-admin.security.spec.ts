import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('create_super_admin hardening', () => {
  const migrationSql = readFileSync(
    join(process.cwd(), 'supabase/migrations/20250101000000_fix_user_profiles_auth.sql'),
    'utf-8',
  );

  const functionSqlMatch = migrationSql.match(
    /CREATE OR REPLACE FUNCTION create_super_admin[\s\S]+?END;\s*\$\$/,
  );
  const functionSql = functionSqlMatch?.[0] ?? '';

  it('requires a super_admin JWT role before updating profiles', () => {
    expect(functionSql, 'create_super_admin function should exist').toBeTruthy();
    expect(functionSql).toMatch(/current_setting\('request\.jwt\.claim\.role', true\)/);
    expect(functionSql).toMatch(/RAISE EXCEPTION USING ERRCODE = '42501'/);
    expect(functionSql).toMatch(/create_super_admin requires a role claim/);
    expect(functionSql).toMatch(/Only super_admins may call create_super_admin/);
  });

  it('logs promotion attempts into admin_actions with an audit reason and timestamp', () => {
    expect(functionSql).toMatch(/INSERT INTO admin_actions[\s\S]+super_admin_promotion/);
    expect(functionSql).toMatch(/'reason'/);
    expect(functionSql).toMatch(/'performed_at'/);
  });

  it('allows successful execution to continue for legitimate super admins', () => {
    expect(functionSql).toMatch(/RAISE NOTICE 'User % promoted to super_admin'/);
  });

  it('limits function execution grants to service_role', () => {
    expect(migrationSql).toMatch(
      /GRANT EXECUTE ON FUNCTION create_super_admin\(TEXT\) TO service_role;/,
    );
    expect(migrationSql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION create_super_admin\(TEXT\) TO authenticated;/,
    );
  });
});
