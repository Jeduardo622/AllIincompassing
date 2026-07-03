import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('sync_user_profile organization sync', () => {
  it('persists organization_id from auth metadata under the profile guard bypass', () => {
    const migrationSql = readFileSync(
      join(process.cwd(), 'supabase/migrations/20260703195500_sync_user_profile_organization_scope.sql'),
      'utf-8',
    );

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
    const migrationSql = readFileSync(
      join(process.cwd(), 'supabase/migrations/20260703195500_sync_user_profile_organization_scope.sql'),
      'utf-8',
    );

    expect(migrationSql).toMatch(/where r\.name in \('admin', 'super_admin'\)/i);
    expect(migrationSql).toMatch(/p\.organization_id is null/i);
    expect(migrationSql).toMatch(/set organization_id = b\.metadata_org_id/i);
  });
});
