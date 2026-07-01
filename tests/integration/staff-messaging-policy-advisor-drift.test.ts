import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('staff messaging policy advisor drift migration', () => {
  const migrationsDir = join(process.cwd(), 'supabase/migrations');
  const migrationFile = '20260630211421_repair_live_staff_messaging_policy_advisor_drift.sql';
  const migrationSql = readFileSync(join(migrationsDir, migrationFile), 'utf-8');
  const executableSql = migrationSql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

  it('tracks exactly one hosted-applied follow-up migration for the staff messaging auth.uid advisor drift', () => {
    const migrationFiles = readdirSync(migrationsDir).filter((fileName) =>
      fileName.endsWith('_repair_live_staff_messaging_policy_advisor_drift.sql'),
    );

    expect(migrationFiles).toEqual([migrationFile]);
  });

  it('rewrites only the participant self-update and participant insert policies with select-wrapped auth.uid()', () => {
    expect(migrationSql).toMatch(
      /create policy message_thread_participants_self_update\s+on public\.message_thread_participants\s+for update\s+to authenticated\s+using \(\(user_id = \(select auth\.uid\(\)\)\) and app\.is_staff_message_thread_participant\(thread_id\)\)\s+with check \(\(user_id = \(select auth\.uid\(\)\)\) and app\.is_staff_message_thread_participant\(thread_id\)\);/i,
    );
    expect(migrationSql).toMatch(
      /create policy messages_participant_insert\s+on public\.messages\s+for insert\s+to authenticated\s+with check \(\s+\(sender_id = \(select auth\.uid\(\)\)\)\s+and app\.is_staff_message_thread_participant\(thread_id\)\s+\);/i,
    );
  });

  it('stays limited to policy repair DDL on the two messaging tables', () => {
    expect(executableSql).not.toMatch(/\b(create|alter)\s+(table|function|trigger|index)\b/i);
    expect(executableSql).not.toMatch(/\b(grant|revoke|insert\s+into|update\s+\w+\s+set|delete\s+from)\b/i);
  });
});
