import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20260718204735_allow_exact_bt_proof_history_cleanup.sql',
);
const sql = readFileSync(migrationPath, 'utf8');

describe('supervision correction proof cleanup migration', () => {
  it('limits immutable-history deletion to service-role cleanup of exact synthetic proof organizations', () => {
    expect(sql).toMatch(/create or replace function app\.is_exact_bt_proof_organization\(p_organization_id uuid\)/i);
    expect(sql).toMatch(/current_user = 'service_role'/i);
    expect(sql).toMatch(/metadata\s*->\s*'tags'/i);
    expect(sql).toMatch(/\^bt-aba-proof-\[a-z0-9-\]\+\$/i);
    expect(sql).toMatch(/organization\.slug = 'bt-proof-' \|\| marker\.value/i);
    expect(sql).toMatch(/organization\.metadata\s*->>\s*'notes' = 'Synthetic fixture ' \|\| marker\.value/i);
    expect(sql).toMatch(/join public\.profiles profile[\s\S]*profile\.id = organization\.created_by[\s\S]*profile\.organization_id = organization\.id[\s\S]*profile\.role = 'bt'[\s\S]*profile\.is_active is true/i);
    expect(sql).toMatch(/join public\.therapists therapist[\s\S]*therapist\.id = profile\.id[\s\S]*therapist\.organization_id = organization\.id[\s\S]*therapist\.email = 'playwright\.ci\.bt\.' \|\| marker\.value \|\| '@example\.com'[\s\S]*therapist\.status = 'active'[\s\S]*therapist\.deleted_at is null/i);
    expect(sql).toMatch(/revoke all on function app\.is_exact_bt_proof_organization\(uuid\) from public, anon, authenticated/i);
    expect(sql).toMatch(/grant execute on function app\.is_exact_bt_proof_organization\(uuid\) to service_role/i);
  });

  it('preserves immutable correction and amendment history outside the exact proof exception', () => {
    expect(sql).toMatch(/create or replace function public\.prevent_supervision_session_note_corrections_delete\(\)[\s\S]*if app\.is_exact_bt_proof_organization\(old\.organization_id\)[\s\S]*return old[\s\S]*supervision correction history is immutable/i);
    expect(sql).toMatch(/create or replace function public\.prevent_bt_session_note_amendment_mutations\(\)[\s\S]*if tg_op = 'DELETE'[\s\S]*app\.is_exact_bt_proof_organization\(old\.organization_id\)[\s\S]*return old[\s\S]*bt session note amendments are immutable/i);
  });
});
