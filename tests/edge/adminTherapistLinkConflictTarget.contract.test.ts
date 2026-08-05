// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATION_PATH = path.join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260805160000_disambiguate_admin_therapist_link_conflict.sql',
);

const readMigration = () => fs.readFileSync(MIGRATION_PATH, 'utf8').replace(/\r\n/g, '\n');

describe('admin therapist link conflict target repair', () => {
  it('uses the named user/therapist unique constraint instead of ambiguous output column names', () => {
    const sql = readMigration();

    expect(sql).toContain('create or replace function public.set_admin_therapist_link(');
    expect(sql).toContain(
      'on conflict on constraint user_therapist_links_user_id_therapist_id_key do nothing',
    );
    expect(sql).not.toContain('on conflict (user_id, therapist_id) do nothing');
    expect(sql).toContain('from pg_catalog.pg_constraint c');
    expect(sql).toContain("c.conname = 'user_therapist_links_user_id_therapist_id_key'");
    expect(sql).toContain("c.contype = 'u'");
    expect(sql).toContain('c.conkey = array[');
    expect(sql).toContain('from pg_catalog.pg_attribute a');
    expect(sql).toContain("a.attname = 'user_id'");
    expect(sql).toContain("a.attname = 'therapist_id'");
    expect(sql).toContain(']::smallint[]');
    expect(sql).not.toContain(
      'Re-apply supabase/migrations/20260804103000_expand_staff_therapist_link_targets.sql',
    );
    expect(sql).toContain(
      'while retaining ON CONFLICT ON CONSTRAINT user_therapist_links_user_id_therapist_id_key',
    );
  });

  it('preserves the protected caller, target-role, tenant, and execute-grant boundaries', () => {
    const sql = readMigration();

    expect(sql).toContain('v_is_super_admin := app.current_user_is_super_admin()');
    expect(sql).toContain("r.name in ('admin', 'super_admin', 'org_admin', 'org_super_admin')");
    expect(sql).toContain("r.name in ('bt', 'therapist', 'midtier', 'admin_schedule', 'bcba')");
    expect(sql).toContain('v_target_org is null or v_target_org <> p_organization_id');
    expect(sql).toContain('v_therapist_org <> p_organization_id');
    expect(sql).toContain(
      'revoke execute on function public.set_admin_therapist_link(uuid, uuid, uuid) from public, anon;',
    );
    expect(sql).toContain(
      'grant execute on function public.set_admin_therapist_link(uuid, uuid, uuid) to authenticated, service_role;',
    );
  });
});
