import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20260730183000_preserve_admin_invite_audit_fks.sql',
);

const migrationSql = readFileSync(migrationPath, 'utf-8').replace(/\r\n/g, '\n');

describe('admin invite audit FK lifecycle migration', () => {
  it('documents the forward-fix intent and rollback scope', () => {
    expect(migrationSql).toMatch(/^-- @migration-intent:.*preserve admin invite audit rows/i);
    expect(migrationSql).toMatch(/^-- @migration-dependencies: 20260730170000_therapist_invite_target_lifecycle\.sql/im);
    expect(migrationSql).toMatch(
      /^-- @migration-rollback:.*restore the prior admin_invite_tokens created_by and accepted_by_user_id foreign keys/im,
    );
  });

  it('makes created_by nullable before recreating its FK as on delete set null', () => {
    expect(migrationSql).toMatch(/alter table public\.admin_invite_tokens\s+alter column created_by drop not null;/i);
    expect(migrationSql).toMatch(/drop constraint if exists admin_invite_tokens_created_by_fkey/i);
    expect(migrationSql).toMatch(
      /add constraint admin_invite_tokens_created_by_fkey[\s\S]+foreign key \(created_by\) references auth\.users\(id\) on delete set null/i,
    );
  });

  it('recreates accepted_by_user_id with on delete set null using the canonical constraint name', () => {
    expect(migrationSql).toMatch(/drop constraint if exists admin_invite_tokens_accepted_by_user_id_fkey/i);
    expect(migrationSql).toMatch(
      /add constraint admin_invite_tokens_accepted_by_user_id_fkey[\s\S]+foreign key \(accepted_by_user_id\) references auth\.users\(id\) on delete set null/i,
    );
  });

  it('keeps the changes transactional and append-only for migration history', () => {
    expect(migrationSql).toMatch(/begin;/i);
    expect(migrationSql).toMatch(/commit;/i);
    expect(migrationSql).not.toMatch(/drop column/i);
    expect(migrationSql).not.toMatch(/delete from public\.admin_invite_tokens/i);
  });
});
