import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const migrationFile = '20260725000810_forward_fix_bcba_authorization_readonly.sql';
const migrationSql = readFileSync(join(migrationsDir, migrationFile), 'utf8').replace(
  /\r\n/g,
  '\n',
);

describe('BCBA authorization read-only migration', () => {
  it('tracks a single forward migration for the BCBA authorization boundary', () => {
    const migrationFiles = readdirSync(migrationsDir).filter((fileName) =>
      fileName.endsWith('_forward_fix_bcba_authorization_readonly.sql'),
    );

    expect(migrationFiles).toEqual([migrationFile]);
  });

  it('removes BCBA while preserving the established authorization managers', () => {
    expect(migrationSql).toContain('app.current_user_is_super_admin()');
    expect(migrationSql).toContain(
      "ARRAY['admin', 'admin_schedule', 'midtier']::text[]",
    );
    expect(migrationSql).toContain(
      "NOT app.current_user_has_exact_role_for_org(\n        target_organization_id,\n        ARRAY['bcba']::text[]",
    );
    expect(migrationSql).not.toContain(
      "ARRAY['admin', 'admin_schedule', 'midtier', 'bcba']::text[]",
    );
  });

  it('preserves org-scoped BCBA reads independently from mutation authority', () => {
    expect(migrationSql).toContain(
      'CREATE OR REPLACE FUNCTION app.current_user_can_read_authorization_row',
    );
    expect(migrationSql).toContain("ARRAY['bcba']::text[]");
    expect(migrationSql).toContain(
      'IF p_organization_id IS DISTINCT FROM app.current_user_organization_id()',
    );
    expect(migrationSql).toContain(
      'app.current_user_can_manage_authorizations(p_organization_id)',
    );
  });

  it('preserves helper hardening and refreshes the PostgREST schema', () => {
    expect(migrationSql).toContain('SECURITY DEFINER');
    expect(migrationSql).toContain('SET search_path = public, app, auth');
    expect(migrationSql).toContain(
      'REVOKE EXECUTE ON FUNCTION app.current_user_can_manage_authorizations(uuid) FROM PUBLIC, anon;',
    );
    expect(migrationSql).toContain(
      'GRANT EXECUTE ON FUNCTION app.current_user_can_manage_authorizations(uuid) TO authenticated, service_role;',
    );
    expect(migrationSql).toContain(
      'REVOKE EXECUTE ON FUNCTION app.current_user_can_read_authorization_row(uuid, uuid, uuid) FROM PUBLIC, anon;',
    );
    expect(migrationSql).toContain("NOTIFY pgrst, 'reload schema';");
  });

  it('blocks BCBA writes even through provider-self policies or security-definer RPCs', () => {
    expect(migrationSql).toContain(
      'CREATE OR REPLACE FUNCTION app.enforce_bcba_authorization_read_only()',
    );
    expect(migrationSql).toContain(
      "RAISE EXCEPTION 'BCBA authorization access is read-only'",
    );
    expect(migrationSql).toContain('BEFORE INSERT OR UPDATE OR DELETE');
    expect(migrationSql).toContain('ON public.authorizations');
    expect(migrationSql).toContain('ON public.authorization_services');
    expect(migrationSql).toContain("USING ERRCODE = '42501'");
    expect(migrationSql).toContain(
      'REVOKE EXECUTE ON FUNCTION app.enforce_bcba_authorization_read_only() FROM PUBLIC, anon, authenticated;',
    );
  });
});
