// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ADMIN_LINK_MIGRATION = path.join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260506153005_admin_therapist_links.sql'
);

const CLIENT_LINK_MIGRATION = path.join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260302120000_client_therapist_links.sql'
);

const readMigration = (migrationPath: string) => fs.readFileSync(migrationPath, 'utf8');

const extractFunction = (sql: string, functionName: string) => {
  const start = sql.indexOf(`create or replace function public.${functionName}(`);
  expect(start).toBeGreaterThanOrEqual(0);

  const nextFunction = sql.indexOf('create or replace function public.', start + 1);
  return sql.slice(start, nextFunction === -1 ? sql.length : nextFunction);
};

describe('admin therapist link migration contract', () => {
  it('adds only RPC-bound admin/super-admin therapist link entrypoints', () => {
    const sql = readMigration(ADMIN_LINK_MIGRATION);

    expect(sql).toContain('create or replace function public.get_admin_linkable_therapists(');
    expect(sql).toContain('create or replace function public.get_admin_therapist_links(');
    expect(sql).toContain('create or replace function public.set_admin_therapist_link(');
    expect(sql).toContain('create or replace function public.delete_admin_therapist_link(');
    expect(sql).toContain('security definer');
    expect(sql).toContain('set search_path = public, auth, app');
    expect(sql).toContain('insert into public.user_therapist_links (user_id, therapist_id)');
    expect(sql).toContain('delete from public.user_therapist_links');
    expect(sql).not.toContain('public.get_organization_id_from_metadata');
    expect(sql).not.toContain('alter table public.user_roles');
    expect(sql).not.toContain('alter table public.roles');
  });

  it('requires authenticated admin authority and explicit organization scope', () => {
    const sql = readMigration(ADMIN_LINK_MIGRATION);

    expect(sql.match(/auth\.uid\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(sql.match(/p_organization_id is null/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(sql.match(/where ur\.user_id = v_actor/g)?.length ?? 0).toBe(4);
    expect(sql.match(/r\.name in \('admin', 'org_admin', 'super_admin', 'org_super_admin'\)/g)?.length ?? 0).toBe(4);
    expect(sql).toContain('app.current_user_is_super_admin()');
    expect(sql).toContain("raise exception using errcode = '28000', message = 'Authentication required'");
    expect(sql).toContain("raise exception using errcode = '42501', message = 'Caller organization mismatch'");
  });

  it('denies cross-org target users and therapists before writing links', () => {
    const sql = readMigration(ADMIN_LINK_MIGRATION);

    expect(sql).toContain('v_target_org := app.resolve_user_organization_id(target_user_id)');
    expect(sql).toContain('join public.profiles p');
    expect(sql).toContain('and p.organization_id = p_organization_id');
    expect(sql).toContain('v_target_org is null or v_target_org <> p_organization_id');
    expect(sql).toContain('t.organization_id = p_organization_id');
    expect(sql).toContain('v_therapist_org <> p_organization_id');
    expect(sql).toContain("raise exception using errcode = '42501', message = 'Target user organization mismatch'");
    expect(sql).toContain("raise exception using errcode = '42501', message = 'Therapist organization mismatch'");
  });

  it('limits target users to administrator role names only', () => {
    const sql = readMigration(ADMIN_LINK_MIGRATION);

    expect(sql.match(/r\.name in \('admin', 'super_admin', 'org_admin', 'org_super_admin'\)/g)?.length ?? 0).toBe(3);
    expect(sql.match(/where ur\.user_id = target_user_id/g)?.length ?? 0).toBe(2);
    expect(sql).toContain('where ur.user_id = utl.user_id');
    expect(sql.match(/raise exception using errcode = '42501', message = 'Target user is not an administrator'/g)?.length ?? 0).toBe(2);
    expect(sql).not.toContain("r.name in ('admin', 'super_admin', 'org_admin', 'org_super_admin', 'therapist')");
    expect(sql).not.toContain("r.name in ('admin', 'super_admin', 'org_admin', 'org_super_admin', 'client')");
  });

  it('keeps the delete RPC constrained to admin targets before unlinking', () => {
    const sql = readMigration(ADMIN_LINK_MIGRATION);
    const deleteRpc = extractFunction(sql, 'delete_admin_therapist_link');
    const deleteStatementIndex = deleteRpc.indexOf('delete from public.user_therapist_links');

    expect(deleteStatementIndex).toBeGreaterThanOrEqual(0);
    expect(deleteRpc.indexOf('v_target_org := app.resolve_user_organization_id(target_user_id)')).toBeGreaterThanOrEqual(0);
    expect(deleteRpc.indexOf('v_target_org is null or v_target_org <> p_organization_id')).toBeGreaterThanOrEqual(0);
    expect(deleteRpc.indexOf("r.name in ('admin', 'super_admin', 'org_admin', 'org_super_admin')")).toBeGreaterThanOrEqual(0);
    expect(deleteRpc.indexOf("raise exception using errcode = '42501', message = 'Target user is not an administrator'")).toBeGreaterThanOrEqual(0);
    expect(deleteRpc.indexOf('v_therapist_org is null or v_therapist_org <> p_organization_id')).toBeGreaterThanOrEqual(0);
    expect(deleteRpc.indexOf("where user_id = target_user_id\n    and therapist_id = target_therapist_id")).toBeGreaterThanOrEqual(0);

    expect(deleteRpc.indexOf('v_target_org is null or v_target_org <> p_organization_id')).toBeLessThan(deleteStatementIndex);
    expect(deleteRpc.indexOf("r.name in ('admin', 'super_admin', 'org_admin', 'org_super_admin')")).toBeLessThan(deleteStatementIndex);
    expect(deleteRpc.indexOf('v_therapist_org is null or v_therapist_org <> p_organization_id')).toBeLessThan(deleteStatementIndex);
  });

  it('keeps direct execute access denied to public and anon callers', () => {
    const sql = readMigration(ADMIN_LINK_MIGRATION);

    expect(sql).toContain('revoke execute on function public.get_admin_linkable_therapists(uuid) from public, anon;');
    expect(sql).toContain('revoke execute on function public.get_admin_therapist_links(uuid) from public, anon;');
    expect(sql).toContain('revoke execute on function public.set_admin_therapist_link(uuid, uuid, uuid) from public, anon;');
    expect(sql).toContain('revoke execute on function public.delete_admin_therapist_link(uuid, uuid, uuid) from public, anon;');
    expect(sql).toContain('grant execute on function public.get_admin_linkable_therapists(uuid) to authenticated, service_role;');
    expect(sql).toContain('grant execute on function public.get_admin_therapist_links(uuid) to authenticated, service_role;');
    expect(sql).toContain('grant execute on function public.set_admin_therapist_link(uuid, uuid, uuid) to authenticated, service_role;');
    expect(sql).toContain('grant execute on function public.delete_admin_therapist_link(uuid, uuid, uuid) to authenticated, service_role;');
    expect(sql).not.toContain('grant execute on function public.set_admin_therapist_link(uuid, uuid, uuid) to anon;');
  });
});

describe('client therapist link migration contract', () => {
  it('keeps the existing client-therapist link authorization path intact', () => {
    const sql = readMigration(CLIENT_LINK_MIGRATION);

    expect(sql).toContain('create table if not exists public.client_therapist_links');
    expect(sql).toContain('app.set_client_therapist_link_defaults()');
    expect(sql).toContain('client_therapist_links_manage_scope');
    expect(sql).toContain('app.can_access_client(client_id)');
    expect(sql).toContain('therapist_id = app.current_therapist_id()');
  });
});
