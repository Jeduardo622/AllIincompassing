import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationSql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260530140500_atomic_admin_invite_rate_limit.sql'),
  'utf-8',
).replace(/\r\n/g, '\n');

const functionSql = migrationSql.match(
  /create or replace function public\.create_admin_invite_token_rate_limited[\s\S]+?\n\$\$;/i,
)?.[0] ?? '';

describe('admin invite atomic rate-limit migration', () => {
  it('serializes check and insert through a per-admin advisory transaction lock', () => {
    expect(functionSql, 'create_admin_invite_token_rate_limited function should exist').toBeTruthy();

    const lockIndex = functionSql.indexOf('pg_advisory_xact_lock');
    const countIndex = functionSql.indexOf('SELECT COUNT(*)::integer');
    const insertIndex = functionSql.indexOf('INSERT INTO public.admin_invite_tokens');

    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(countIndex).toBeGreaterThan(lockIndex);
    expect(insertIndex).toBeGreaterThan(countIndex);
  });

  it('keeps duplicate-active, expired-prune, rate-limit, and insert logic inside one RPC', () => {
    expect(functionSql).toMatch(/active_invite_exists/i);
    expect(functionSql).toMatch(/DELETE FROM public\.admin_invite_tokens/i);
    expect(functionSql).toMatch(/created_by = p_created_by/i);
    expect(functionSql).toMatch(/v_window_start timestamptz := v_now - interval '1 hour'/i);
    expect(functionSql).toMatch(/v_invite_limit integer := 10/i);
    expect(functionSql).toMatch(/created_at >= v_window_start/i);
    expect(functionSql).toMatch(/rate_limited/i);
    expect(functionSql).toMatch(/RETURN QUERY SELECT v_inserted\.id, v_inserted\.expires_at, 'created'::text/i);
  });

  it('defends auth, org scope, and super-admin invite escalation in the RPC', () => {
    expect(functionSql).not.toMatch(/p_window_start/i);
    expect(functionSql).not.toMatch(/p_limit/i);
    expect(functionSql).toMatch(/auth\.uid\(\) <> p_created_by/i);
    expect(functionSql).toMatch(/app\.current_user_is_super_admin\(\)/i);
    expect(functionSql).toMatch(/app\.is_admin\(\)/i);
    expect(functionSql).toMatch(/app\.current_user_organization_id\(\) IS DISTINCT FROM p_organization_id/i);
    expect(functionSql).toMatch(/Only super admins can create super admin invites/i);
  });

  it('does not expose the RPC to public or anonymous callers', () => {
    expect(migrationSql).toMatch(/REVOKE ALL ON FUNCTION public\.create_admin_invite_token_rate_limited/i);
    expect(migrationSql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.create_admin_invite_token_rate_limited[\s\S]+FROM anon;/i);
    expect(migrationSql).toMatch(/GRANT EXECUTE ON FUNCTION public\.create_admin_invite_token_rate_limited[\s\S]+TO authenticated;/i);
  });
});
