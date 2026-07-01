import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('supervision session note request advisor index migration', () => {
  const migrationsDir = join(process.cwd(), 'supabase/migrations');
  const migrationFile = '20260701135309_repair_supervision_session_note_request_fk_covering_indexes.sql';
  const migrationSql = readFileSync(join(migrationsDir, migrationFile), 'utf-8');
  const executableSql = migrationSql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

  it('tracks exactly one hosted follow-up migration for the supervision request foreign-key advisor repair', () => {
    const migrationFiles = readdirSync(migrationsDir).filter((fileName) =>
      fileName.endsWith('_repair_supervision_session_note_request_fk_covering_indexes.sql'),
    );

    expect(migrationFiles).toEqual([migrationFile]);
  });

  it('covers the three advisor-reported foreign key columns', () => {
    expect(migrationSql).toMatch(
      /create index if not exists supervision_session_note_requests_bt_therapist_id_idx\s+on public\.supervision_session_note_requests \(bt_therapist_id\);/i,
    );
    expect(migrationSql).toMatch(
      /create index if not exists supervision_session_note_requests_client_id_idx\s+on public\.supervision_session_note_requests \(client_id\);/i,
    );
    expect(migrationSql).toMatch(
      /create index if not exists supervision_session_note_requests_requested_by_idx\s+on public\.supervision_session_note_requests \(requested_by\);/i,
    );
  });

  it('stays limited to index-only DDL', () => {
    expect(executableSql).not.toMatch(/\b(create|alter|drop)\s+(table|policy|function|trigger)\b/i);
    expect(executableSql).not.toMatch(/\b(grant|revoke|insert|update|delete)\b/i);
  });
});
