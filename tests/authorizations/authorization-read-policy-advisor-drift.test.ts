import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('authorization read policy advisor drift migration', () => {
  const migrationsDir = join(process.cwd(), 'supabase/migrations');
  const migrationFile = '20260630164649_repair_live_authorization_read_policy_advisor_drift.sql';
  const migrationSql = readFileSync(join(migrationsDir, migrationFile), 'utf-8');
  const executableSql = migrationSql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

  it('tracks the hosted follow-up migration version for the lingering legacy policy drift', () => {
    const migrationFiles = readdirSync(migrationsDir).filter((fileName) =>
      fileName.endsWith('_repair_live_authorization_read_policy_advisor_drift.sql'),
    );

    expect(migrationFiles).toEqual([migrationFile]);
  });

  it('drops the two legacy authorization read policies that duplicate the org-scoped contract', () => {
    expect(migrationSql).toMatch(
      /drop policy if exists "Authorizations are viewable by admin and assigned therapist"\s+on public\.authorizations;/i,
    );
    expect(migrationSql).toMatch(
      /drop policy if exists "Authorization services are viewable by admin and assigned therapist"\s+on public\.authorization_services;/i,
    );
  });

  it('stays limited to drop-policy repair DDL', () => {
    expect(executableSql).not.toMatch(/\b(create|alter)\s+(table|policy|function|trigger|index)\b/i);
    expect(executableSql).not.toMatch(/\b(grant|revoke|insert|update|delete)\b/i);
  });
});
