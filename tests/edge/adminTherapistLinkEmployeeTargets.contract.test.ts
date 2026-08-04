// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATION_PATH = path.join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260804103000_expand_staff_therapist_link_targets.sql',
);

const readMigration = () => fs.readFileSync(MIGRATION_PATH, 'utf8').replace(/\r\n/g, '\n');

const extractFunction = (sql: string, functionName: string) => {
  const start = sql.indexOf(`create or replace function public.${functionName}(`);
  expect(start).toBeGreaterThanOrEqual(0);

  const nextFunction = sql.indexOf('create or replace function public.', start + 1);
  return sql.slice(start, nextFunction === -1 ? sql.length : nextFunction);
};

describe('admin therapist link employee-target repair', () => {
  it('keeps non-super-admin callers on admin targets while allowing super admins to manage the broader employee role tree', () => {
    const sql = readMigration();
    const listFn = extractFunction(sql, 'get_admin_therapist_links');
    const setFn = extractFunction(sql, 'set_admin_therapist_link');
    const deleteFn = extractFunction(sql, 'delete_admin_therapist_link');

    expect(sql.match(/r\.name in \('admin', 'org_admin', 'super_admin', 'org_super_admin'\)/g)?.length ?? 0).toBeGreaterThanOrEqual(4);

    for (const fn of [listFn, setFn, deleteFn]) {
      expect(fn).toContain("r.name in ('admin', 'super_admin', 'org_admin', 'org_super_admin')");
      expect(fn).toContain("v_is_super_admin");
      expect(fn).toContain("and r.name in ('bt', 'therapist', 'midtier', 'admin_schedule', 'bcba')");
    }

    expect(setFn).toContain("raise exception using errcode = '42501', message = 'Target user does not hold a linkable role for this caller'");
    expect(deleteFn).toContain("raise exception using errcode = '42501', message = 'Target user does not hold a linkable role for this caller'");
  });

  it('keeps execute grants scoped to authenticated and service_role only', () => {
    const sql = readMigration();

    expect(sql).toContain('revoke execute on function public.get_admin_linkable_therapists(uuid) from public, anon;');
    expect(sql).toContain('revoke execute on function public.get_admin_therapist_links(uuid) from public, anon;');
    expect(sql).toContain('revoke execute on function public.set_admin_therapist_link(uuid, uuid, uuid) from public, anon;');
    expect(sql).toContain('revoke execute on function public.delete_admin_therapist_link(uuid, uuid, uuid) from public, anon;');

    expect(sql).toContain('grant execute on function public.get_admin_linkable_therapists(uuid) to authenticated, service_role;');
    expect(sql).toContain('grant execute on function public.get_admin_therapist_links(uuid) to authenticated, service_role;');
    expect(sql).toContain('grant execute on function public.set_admin_therapist_link(uuid, uuid, uuid) to authenticated, service_role;');
    expect(sql).toContain('grant execute on function public.delete_admin_therapist_link(uuid, uuid, uuid) to authenticated, service_role;');
  });

  it('keeps same-org therapist checks and active therapist filtering in the write paths', () => {
    const sql = readMigration();
    const setFn = extractFunction(sql, 'set_admin_therapist_link');
    const deleteFn = extractFunction(sql, 'delete_admin_therapist_link');

    expect(setFn).toContain("v_target_org is null or v_target_org <> p_organization_id");
    expect(setFn).toContain("lower(coalesce(t.status, 'active')) = 'active'");
    expect(setFn).toContain('t.deleted_at is null');
    expect(setFn).toContain('insert into public.user_therapist_links (user_id, therapist_id)');

    expect(deleteFn).toContain("v_target_org is null or v_target_org <> p_organization_id");
    expect(deleteFn).toContain('delete from public.user_therapist_links');
    expect(deleteFn).toContain("where user_id = target_user_id\n    and therapist_id = target_therapist_id");
  });
});
