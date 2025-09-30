import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('manage_admin_users logging', () => {
  it('defines admin action logging for add and remove operations', () => {
    const migrationSql = readFileSync(
      join(process.cwd(), 'supabase/migrations/20251025121500_admin_org_enforcement.sql'),
      'utf-8',
    );

    const manageFunctionMatch = migrationSql.match(
      /CREATE OR REPLACE FUNCTION manage_admin_users[\s\S]*?END;\s*\$\$/,
    );

    expect(manageFunctionMatch, 'manage_admin_users function should exist').toBeTruthy();
    const manageFunctionSql = manageFunctionMatch?.[0] ?? '';

    expect(manageFunctionSql).toMatch(/INSERT INTO admin_actions[\s\S]+admin_role_added/);
    expect(manageFunctionSql).toMatch(/INSERT INTO admin_actions[\s\S]+admin_role_removed/);
    expect(manageFunctionSql).toMatch(/organization_id/);
  });

  it('logs assign_admin_role actions with reason metadata and a single insert', () => {
    const migrationSql = readFileSync(
      join(process.cwd(), 'supabase/migrations/20251030120000_assign_admin_role_logging.sql'),
      'utf-8',
    );

    const assignFunctionMatch = migrationSql.match(
      /CREATE OR REPLACE FUNCTION assign_admin_role[\s\S]*?END;\s*\$\$/,
    );

    expect(assignFunctionMatch, 'assign_admin_role function should be redefined with logging').toBeTruthy();
    const assignFunctionSql = assignFunctionMatch?.[0] ?? '';

    const insertMatches = assignFunctionSql.match(/INSERT INTO admin_actions/gi) ?? [];
    expect(insertMatches).toHaveLength(1);
    expect(assignFunctionSql).toMatch(/admin_user_id[\s\S]+v_caller_id/);
    expect(assignFunctionSql).toMatch(/target_user_id[\s\S]+v_target_id/);
    expect(assignFunctionSql).toMatch(/organization_id[\s\S]+organization_id/);
    expect(assignFunctionSql).toMatch(/jsonb_build_object[\s\S]+reason/);
  });

  it('passes a descriptive reason from manage_admin_users to assign_admin_role', () => {
    const migrationSql = readFileSync(
      join(process.cwd(), 'supabase/migrations/20251030120000_assign_admin_role_logging.sql'),
      'utf-8',
    );

    const manageFunctionMatch = migrationSql.match(
      /CREATE OR REPLACE FUNCTION manage_admin_users[\s\S]*?END;\s*\$\$/,
    );

    expect(manageFunctionMatch, 'manage_admin_users function should include assign helper call').toBeTruthy();
    const manageFunctionSql = manageFunctionMatch?.[0] ?? '';

    expect(manageFunctionSql).toMatch(/PERFORM assign_admin_role[\s\S]*'manage_admin_users:add'/);
  });
});
