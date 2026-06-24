import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('transcript duplicate session_id index cleanup migration', () => {
  const migrationSql = readFileSync(
    join(
      process.cwd(),
      'supabase/migrations/20260624131146_drop_duplicate_transcript_session_indexes.sql',
    ),
    'utf-8',
  );

  it('keeps the FK-covering session_id index names canonical', () => {
    expect(migrationSql).toMatch(
      /create index if not exists session_transcripts_session_id_idx\s+on public\.session_transcripts\(session_id\);/i,
    );
    expect(migrationSql).toMatch(
      /create index if not exists session_transcript_segments_session_id_idx\s+on public\.session_transcript_segments\(session_id\);/i,
    );
  });

  it('drops only the redundant idx-prefixed session_id indexes', () => {
    expect(migrationSql).toMatch(/drop index if exists public\.idx_session_transcripts_session_id;/i);
    expect(migrationSql).toMatch(
      /drop index if exists public\.idx_session_transcript_segments_session_id;/i,
    );
    expect(migrationSql).not.toMatch(/drop index if exists public\.session_transcripts_session_id_idx;/i);
    expect(migrationSql).not.toMatch(
      /drop index if exists public\.session_transcript_segments_session_id_idx;/i,
    );
  });

  it('asserts duplicate names are gone and canonical indexes remain', () => {
    expect(migrationSql).toMatch(/to_regclass\('public\.idx_session_transcripts_session_id'\) is not null/i);
    expect(migrationSql).toMatch(
      /to_regclass\('public\.idx_session_transcript_segments_session_id'\) is not null/i,
    );
    expect(migrationSql).toMatch(/to_regclass\('public\.session_transcripts_session_id_idx'\) is null/i);
    expect(migrationSql).toMatch(
      /to_regclass\('public\.session_transcript_segments_session_id_idx'\) is null/i,
    );
  });
});
