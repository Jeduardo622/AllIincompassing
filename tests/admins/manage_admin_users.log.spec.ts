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
});
