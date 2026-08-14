import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20260814213754_session_audit_created_by_typo_repair.sql',
);
const historicalMigrationPath = join(
  process.cwd(),
  'supabase/migrations/20250917183451_add_session_audit_fields.sql',
);

const readMigration = (): string => (existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '');

describe('session audit created_by typo repair migration', () => {
  it('restores the historical NEW.created_by assignment without the hosted typo', () => {
    const sql = readMigration();

    expect(sql, 'the forward migration must exist').not.toBe('');
    expect(sql).toMatch(/elsif new\.created_by is not null then\s+new\.updated_by := new\.created_by;/i);
    expect(sql).not.toMatch(/\bnew_created_by\b/i);
  });

  it('preserves the existing trigger function attributes and audit branches', () => {
    const sql = readMigration();
    const historicalSql = readFileSync(historicalMigrationPath, 'utf8');

    expect(historicalSql).toMatch(/new\.updated_by := new\.created_by;/i);
    expect(sql).toMatch(/create or replace function public\.set_sessions_audit_fields\(\)/i);
    expect(sql).toMatch(/returns trigger/i);
    expect(sql).toMatch(/language plpgsql/i);
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/set search_path = public/i);
    expect(sql).toMatch(/if tg_op = 'INSERT' then/i);
    expect(sql).toMatch(/elsif tg_op = 'UPDATE' then/i);
    expect(sql).toMatch(/new\.created_by := old\.created_by;/i);
    expect(sql).toMatch(/new\.updated_by := old\.updated_by;/i);
    expect(sql).toMatch(/return new;/i);
  });

  it('changes no policies, grants, trigger attachments, tables, or data', () => {
    const sql = readMigration();

    expect(sql).not.toMatch(/\b(?:grant|revoke|create policy|drop policy|alter policy)\b/i);
    expect(sql).not.toMatch(/\b(?:drop function|alter function)\b/i);
    expect(sql).not.toMatch(/\b(?:create trigger|drop trigger|alter table|create table|drop table)\b/i);
    expect(sql).not.toMatch(/\b(?:insert into|update public\.|delete from|truncate)\b/i);
  });
});
