import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('authorization advisor covering index migration', () => {
  const migrationsDir = join(process.cwd(), 'supabase/migrations');
  const migrationFile = '20260627232920_repair_live_authorization_advisor_covering_indexes.sql';
  const migrationSql = readFileSync(join(migrationsDir, migrationFile), 'utf-8');
  const executableSql = migrationSql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

  it('tracks the hosted follow-up migration version for live drift repair', () => {
    const migrationFiles = readdirSync(migrationsDir).filter((fileName) =>
      fileName.endsWith('_repair_live_authorization_advisor_covering_indexes.sql'),
    );

    expect(migrationFiles).toEqual([migrationFile]);
  });

  it('covers the two advisor-reported foreign key columns', () => {
    expect(migrationSql).toMatch(
      /create index if not exists authorization_services_org_auth_idx\s+on public\.authorization_services \(organization_id, authorization_id\);/i,
    );
    expect(migrationSql).toMatch(
      /create index if not exists client_session_notes_authorization_id_idx\s+on public\.client_session_notes \(authorization_id\);/i,
    );
  });

  it('stays limited to index-only DDL', () => {
    expect(executableSql).not.toMatch(/\b(create|alter|drop)\s+(table|policy|function|trigger)\b/i);
    expect(executableSql).not.toMatch(/\b(grant|revoke|insert|update|delete)\b/i);
  });
});
