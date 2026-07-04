import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('sync_user_profile organization sync', () => {
  const readMigrationSql = () =>
    readFileSync(
      join(process.cwd(), 'supabase/migrations/20260703195500_sync_user_profile_organization_scope.sql'),
      'utf-8',
    );

  it('persists organization_id from auth metadata under the profile guard bypass', () => {
    const migrationSql = readMigrationSql();

    const syncFunctionMatch = migrationSql.match(
      /create or replace function public\.sync_user_profile\(\)[\s\S]*?end;\s*\$\$/i,
    );
    expect(syncFunctionMatch, 'sync_user_profile should be redefined').toBeTruthy();

    const syncFunctionSql = syncFunctionMatch?.[0] ?? '';

    expect(syncFunctionSql).toMatch(/get_organization_id_from_metadata\(NEW\.raw_user_meta_data\)/i);
    expect(syncFunctionSql).toMatch(/set_config\('app\.bypass_profile_role_guard', 'on', true\)/i);
    expect(syncFunctionSql).toMatch(/insert into profiles[\s\S]*organization_id/i);
    expect(syncFunctionSql).toMatch(/organization_id = coalesce\(excluded\.organization_id, profiles\.organization_id\)/i);
  });

  it('backfills missing admin profile organizations from auth metadata', () => {
    const migrationSql = readMigrationSql();

    expect(migrationSql).toMatch(/where r\.name in \('admin', 'super_admin'\)/i);
    expect(migrationSql).toMatch(/p\.organization_id is null/i);
    expect(migrationSql).toMatch(/join public\.organizations o on o\.id = metadata_org\.metadata_org_id/i);
    expect(migrationSql).toMatch(/set organization_id = b\.metadata_org_id/i);
  });

  it('skips orphaned metadata organizations instead of creating or assigning them', () => {
    const migrationSql = readMigrationSql();

    expect(migrationSql).toMatch(
      /join lateral \(\s*select public\.get_organization_id_from_metadata\(u\.raw_user_meta_data\) as metadata_org_id\s*\) metadata_org on true/i,
    );
    expect(migrationSql).toMatch(/join public\.organizations o on o\.id = metadata_org\.metadata_org_id/i);
    expect(migrationSql).not.toMatch(/\binsert\s+into\s+public\.organizations\b/i);
    expect(migrationSql).not.toMatch(/\binsert\s+into\s+organizations\b/i);
  });
});
