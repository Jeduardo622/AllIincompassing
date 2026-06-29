import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationSql = () =>
  readFileSync(
    join(process.cwd(), 'supabase/migrations/20260628221116_repair_manage_admin_users_advisor_surface.sql'),
    'utf-8',
  );

describe('manage_admin_users advisor repair migration', () => {
  it('drops obsolete overloads that can retain stale security-definer search_path state', () => {
    const sql = migrationSql();

    expect(sql).toMatch(/drop function if exists public\.manage_admin_users\(text,\s*uuid\)/i);
    expect(sql).toMatch(/drop function if exists public\.manage_admin_users\(text,\s*text,\s*jsonb\)/i);
    expect(sql).toMatch(/drop function if exists public\.manage_admin_users\(text,\s*text,\s*jsonb,\s*text\)/i);
    expect(sql).toMatch(/drop function if exists public\.manage_admin_users\(text,\s*uuid,\s*jsonb\)/i);
    expect(sql).toMatch(/drop function if exists public\.manage_admin_users\(text,\s*uuid,\s*uuid\)/i);
  });

  it('keeps the explicit-org overload on executor/service-role grants only', () => {
    const sql = migrationSql();

    expect(sql).toMatch(/revoke execute on function public\.manage_admin_users\(text,\s*text,\s*uuid\) from public/i);
    expect(sql).toMatch(/revoke execute on function public\.manage_admin_users\(text,\s*text,\s*uuid\) from anon/i);
    expect(sql).toMatch(/revoke execute on function public\.manage_admin_users\(text,\s*text,\s*uuid\) from authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.manage_admin_users\(text,\s*text,\s*uuid\) to service_role/i);
    expect(sql).toMatch(/grant execute on function public\.manage_admin_users\(text,\s*text,\s*uuid\) to app_admin_executor/i);
  });

  it('guards grant repair so replay is safe when the explicit-org overload is absent', () => {
    const sql = migrationSql();

    expect(sql).toMatch(/if to_regprocedure\('public\.manage_admin_users\(text,text,uuid\)'\) is not null then/i);
  });

  it('does not revoke the current two-argument browser admin RPC surface', () => {
    const sql = migrationSql();

    expect(sql).not.toMatch(/revoke execute on function public\.manage_admin_users\(text,\s*text\) from authenticated/i);
    expect(sql).not.toMatch(/drop function if exists public\.manage_admin_users\(text,\s*text\)/i);
  });

  it('documents a concrete rollback command for the only narrowed current overload', () => {
    const sql = migrationSql();

    expect(sql).toMatch(/grant execute on function public\.manage_admin_users\(text,\s*text,\s*uuid\) to authenticated/i);
    expect(sql).toMatch(/No rollback for dropped obsolete overloads/i);
  });
});
