import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('admin invite target therapist FK advisor index migration', () => {
  const migrationsDir = join(process.cwd(), 'supabase/migrations');
  const migrationFile = '20260818160000_repair_admin_invite_target_therapist_fk_covering_index.sql';
  const migrationSql = readFileSync(join(migrationsDir, migrationFile), 'utf-8');
  const executableSql = migrationSql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

  it('tracks exactly one hosted follow-up migration for the admin invite target therapist foreign-key advisor repair', () => {
    const migrationFiles = readdirSync(migrationsDir).filter((fileName) =>
      fileName.endsWith('_repair_admin_invite_target_therapist_fk_covering_index.sql'),
    );

    expect(migrationFiles).toEqual([migrationFile]);
  });

  it('adds a leading-column covering index for the advisor-reported target therapist foreign key', () => {
    expect(migrationSql).toMatch(
      /create index if not exists admin_invite_tokens_target_therapist_id_idx\s+on public\.admin_invite_tokens \(target_therapist_id\);/i,
    );
  });

  it('stays limited to index-only DDL', () => {
    expect(executableSql).not.toMatch(/\b(create|alter|drop)\s+(table|policy|function|trigger)\b/i);
    expect(executableSql).not.toMatch(/\b(grant|revoke|insert|update|delete)\b/i);
  });
});
