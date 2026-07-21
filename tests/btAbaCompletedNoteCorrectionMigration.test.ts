import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDirectory = join(process.cwd(), 'supabase/migrations');
const migrationFiles = readdirSync(migrationDirectory)
  .filter((name) => name.endsWith('_bt_aba_completed_note_latest_amendment.sql'));
const migration = migrationFiles[0]
  ? readFileSync(join(migrationDirectory, migrationFiles[0]), 'utf8')
  : '';

const functionBody = migration.match(
  /create or replace function public\.get_bt_aba_session_note[\s\S]*?\n\$\$;/i,
)?.[0] ?? '';

describe('completed BT ABA note latest-amendment migration', () => {
  it('replaces only the assigned-BT read RPC with the latest tenant-scoped amendment', () => {
    expect(migrationFiles).toHaveLength(1);
    expect(migration).toMatch(/@migration-intent:[^\n]*latest finalized BT ABA correction/i);
    expect(functionBody).toMatch(/v_session\.organization_id <> app\.current_user_organization_id\(\)/i);
    expect(functionBody).toMatch(/app\.current_user_has_exact_role_for_org\([\s\S]*array\['bt'\]::text\[\][\s\S]*array\['admin', 'admin_schedule', 'midtier', 'bcba', 'therapist'\]::text\[\]/i);
    expect(functionBody).toMatch(/from public\.supervision_session_note_requests request[\s\S]*request\.session_id = v_session\.id[\s\S]*request\.organization_id = v_session\.organization_id[\s\S]*request\.client_id = v_session\.client_id[\s\S]*request\.bt_therapist_id = v_session\.therapist_id[\s\S]*request\.status in \('pending', 'correction_required', 'resubmitted', 'completed'\)/i);
    expect(functionBody).toMatch(/from public\.bt_session_note_amendments amendment[\s\S]*amendment\.request_id = v_request_id[\s\S]*amendment\.organization_id = v_session\.organization_id[\s\S]*amendment\.original_bt_note_id = v_note\.id[\s\S]*order by amendment\.version_number desc/i);
    expect(functionBody).toMatch(/coalesce\(v_latest_amendment_responses, v_note\.bt_aba_responses/i);
    expect(migration).toMatch(/revoke execute on function public\.get_bt_aba_session_note\(uuid\) from public, anon/i);
    expect(migration).toMatch(/grant execute on function public\.get_bt_aba_session_note\(uuid\) to authenticated, service_role/i);
  });
});
