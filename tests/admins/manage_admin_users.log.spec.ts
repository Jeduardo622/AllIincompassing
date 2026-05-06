import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('manage_admin_users logging', () => {
  it('keeps super_admin access explicit while preserving same-org guards for regular admins', () => {
    const migrationSql = readFileSync(
      join(process.cwd(), 'supabase/migrations/20260506170000_super_admin_admin_management_authz.sql'),
      'utf-8',
    );

    const assignFunctionMatch = migrationSql.match(
      /create or replace function public\.assign_admin_role[\s\S]*?end;\s*\$\$/i,
    );
    expect(assignFunctionMatch, 'assign_admin_role should be redefined for super_admin support').toBeTruthy();

    const manageFunctionMatch = migrationSql.match(
      /create or replace function public\.manage_admin_users[\s\S]*?end;\s*\$\$/i,
    );
    expect(manageFunctionMatch, 'manage_admin_users should be redefined for super_admin support').toBeTruthy();

    const assignFunctionSql = assignFunctionMatch?.[0] ?? '';
    const manageFunctionSql = manageFunctionMatch?.[0] ?? '';

    expect(assignFunctionSql).toMatch(/public\.current_user_is_super_admin\(\)/i);
    expect(assignFunctionSql).not.toMatch(/app\.user_has_role\('super_admin'\)/i);
    expect(assignFunctionSql).toMatch(/if not v_is_super_admin and not exists/i);
    expect(assignFunctionSql).toMatch(/if not v_is_super_admin then[\s\S]*caller organization mismatch/i);

    expect(manageFunctionSql).toMatch(/public\.current_user_is_super_admin\(\)/i);
    expect(manageFunctionSql).not.toMatch(/app\.user_has_role\('super_admin'\)/i);
    expect(manageFunctionSql).toMatch(/if not v_is_service_role and not v_is_super_admin then[\s\S]*target user does not belong to the caller organization/i);
    expect(manageFunctionSql).toMatch(/cannot remove the last active administrator for the organization/i);
  });

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
