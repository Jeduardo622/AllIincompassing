import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('admin_actions advisor covering index migration', () => {
  const migrationsDir = join(process.cwd(), 'supabase/migrations');
  const migrationFile = '20260707125557_repair_live_admin_actions_advisor_covering_index.sql';
  const migrationSql = readFileSync(join(migrationsDir, migrationFile), 'utf-8');
  const executableSql = migrationSql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

  it('tracks exactly one hosted follow-up migration for the admin_actions foreign-key advisor repair', () => {
    const migrationFiles = readdirSync(migrationsDir).filter((fileName) =>
      fileName.endsWith('_repair_live_admin_actions_advisor_covering_index.sql'),
    );

    expect(migrationFiles).toEqual([migrationFile]);
  });

  it('covers the advisor-reported admin_actions admin_user_id foreign key column', () => {
    expect(migrationSql).toMatch(
      /create index if not exists admin_actions_admin_user_id_idx\s+on public\.admin_actions \(admin_user_id\);/i,
    );
  });

  it('stays limited to index-only DDL', () => {
    expect(executableSql).not.toMatch(/\b(create|alter|drop)\s+(table|policy|function|trigger)\b/i);
    expect(executableSql).not.toMatch(/\b(grant|revoke|insert|update|delete)\b/i);
  });
});
