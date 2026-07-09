import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationSql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260709011818_service_role_admin_invite_token_rpc.sql'),
  'utf-8',
).replace(/\r\n/g, '\n');

const functionSql = migrationSql.match(
  /create or replace function public\.create_admin_invite_token_rate_limited[\s\S]+?\n\$\$;/i,
)?.[0] ?? '';

describe('service-role admin invite token RPC migration', () => {
  it('keeps duplicate-active, prune, count, and insert inside the advisory lock RPC', () => {
    expect(functionSql, 'create_admin_invite_token_rate_limited function should exist').toBeTruthy();

    const lockIndex = functionSql.indexOf('pg_advisory_xact_lock');
    const activeInviteIndex = functionSql.indexOf('active_invite_exists');
    const pruneIndex = functionSql.indexOf('delete from public.admin_invite_tokens');
    const countIndex = functionSql.indexOf('select count(*)::integer');
    const insertIndex = functionSql.indexOf('insert into public.admin_invite_tokens');

    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(activeInviteIndex).toBeGreaterThan(lockIndex);
    expect(pruneIndex).toBeGreaterThan(activeInviteIndex);
    expect(countIndex).toBeGreaterThan(pruneIndex);
    expect(insertIndex).toBeGreaterThan(countIndex);
    expect(functionSql).toMatch(/v_invite_limit integer := 10/i);
    expect(functionSql).toMatch(/created_at >= v_window_start/i);
    expect(functionSql).toMatch(/rate_limited/i);
  });

  it('aligns execution grants to the hardened service-role-only boundary', () => {
    expect(migrationSql).toMatch(/revoke all on function public\.create_admin_invite_token_rate_limited[\s\S]+from public, anon, authenticated;/i);
    expect(migrationSql).toMatch(/grant execute on function public\.create_admin_invite_token_rate_limited[\s\S]+to service_role;/i);
    expect(functionSql).not.toMatch(/auth\.uid\(\)/i);
    expect(functionSql).toMatch(/service-role-only/i);
  });
});
