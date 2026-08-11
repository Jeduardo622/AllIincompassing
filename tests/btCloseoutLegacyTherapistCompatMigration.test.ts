import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const MIGRATION_PATH = path.join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260810222545_bt_closeout_legacy_therapist_compat.sql',
);
const SMOKE_SQL_PATH = path.join(process.cwd(), 'tests', 'sql', 'bt_aba_session_note_closeout_smoke.sql');

const sql = readFileSync(MIGRATION_PATH, 'utf8');
const smokeSql = readFileSync(SMOKE_SQL_PATH, 'utf8');

const functionBody = (qualifiedName: string): string => {
  const escapedName = qualifiedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`create or replace function ${escapedName}\\([\\s\\S]*?\\n\\$\\$;`, 'i');
  const match = sql.match(pattern);
  expect(match, `${qualifiedName} function should exist`).not.toBeNull();
  return match?.[0] ?? '';
};

describe('WIN-240 BT closeout legacy therapist compatibility migration', () => {
  it('adds a service-role-only helper that allows only same-org exact bt or therapist closeout actors', () => {
    const helper = functionBody('app.current_user_can_act_as_bt_closeout_actor');

    expect(helper).toMatch(/returns boolean/i);
    expect(helper).toMatch(/stable[\s\S]*security definer[\s\S]*set search_path = ''/i);
    expect(helper).toMatch(/auth\.uid\(\)/i);
    expect(helper).toMatch(/p_organization_id <> app\.current_user_organization_id\(\)/i);
    expect(helper).toMatch(/app\.current_user_has_exact_role_for_org\([\s\S]*array\['bt'\]::text\[\][\s\S]*array\['admin', 'admin_schedule', 'midtier', 'bcba', 'therapist'\]::text\[\]/i);
    expect(helper).toMatch(/app\.current_user_has_exact_active_role_for_org\([\s\S]*array\['therapist'\]::text\[\]/i);
    expect(helper).toMatch(/from public\.therapists therapist[\s\S]*therapist\.organization_id = p_organization_id[\s\S]*therapist\.status = 'active'[\s\S]*therapist\.deleted_at is null[\s\S]*upper\(btrim\(coalesce\(therapist\.title, ''\)\)\) in \('BT', 'RBT'\)/i);
    expect(helper).toMatch(/therapist\.id = v_actor[\s\S]*from public\.user_therapist_links utl[\s\S]*utl\.user_id = v_actor[\s\S]*utl\.therapist_id = therapist\.id/i);
    expect(sql).toMatch(/revoke all on function app\.current_user_can_act_as_bt_closeout_actor\(uuid, uuid\) from public, anon, authenticated/i);
    expect(sql).toMatch(/grant execute on function app\.current_user_can_act_as_bt_closeout_actor\(uuid, uuid\) to service_role/i);
    expect(sql).not.toMatch(/grant execute on function app\.current_user_can_act_as_bt_closeout_actor\(uuid, uuid\) to authenticated/i);
  });

  it('rewires the closeout resolver, draft, read, finalize, and creator to the shared helper only', () => {
    const resolver = functionBody('public.resolve_assigned_bt_session_capture_billing');
    const draft = functionBody('public.save_bt_aba_session_note_draft');
    const reader = functionBody('public.get_bt_aba_session_note');
    const finalize = functionBody('public.finalize_bt_aba_session_note');
    const creator = functionBody('public.create_supervision_session_note_request_for_completed_session');

    for (const body of [resolver, draft, reader, finalize, creator]) {
      expect(body).toMatch(/app\.current_user_can_act_as_bt_closeout_actor\(/i);
      expect(body).not.toMatch(/array\['bt'\]::text\[\][\s\S]*array\['admin', 'admin_schedule', 'midtier', 'bcba', 'therapist'\]::text\[\][\s\S]*from public\.therapists therapist/i);
    }
  });

  it('preserves trial-capture checks only on resolver, draft, and finalize, while keeping get and creator looser', () => {
    const resolver = functionBody('public.resolve_assigned_bt_session_capture_billing');
    const draft = functionBody('public.save_bt_aba_session_note_draft');
    const reader = functionBody('public.get_bt_aba_session_note');
    const finalize = functionBody('public.finalize_bt_aba_session_note');
    const creator = functionBody('public.create_supervision_session_note_request_for_completed_session');

    for (const body of [resolver, draft, finalize]) {
      expect(body).toMatch(/current_user_can_capture_trial_event/i);
    }
    expect(reader).not.toMatch(/current_user_can_capture_trial_event/i);
    expect(creator).not.toMatch(/current_user_can_capture_trial_event/i);
  });

  it('keeps the latest amended completed-note read body and the current creator authority envelope', () => {
    const reader = functionBody('public.get_bt_aba_session_note');
    const creator = functionBody('public.create_supervision_session_note_request_for_completed_session');

    expect(reader).toMatch(/v_latest_amendment_responses/i);
    expect(reader).toMatch(/from public\.bt_session_note_amendments amendment/i);
    expect(reader).toMatch(/coalesce\(v_latest_amendment_responses, v_note\.bt_aba_responses, '\{\}'::jsonb\)/i);

    expect(creator).toMatch(/v_actor_is_admin[\s\S]*array\['admin', 'super_admin', 'org_admin', 'org_super_admin'\]/i);
    expect(creator).toMatch(/v_actor_has_schedule_authority[\s\S]*array\['admin_schedule', 'midtier', 'bcba'\]/i);
    expect(creator).toMatch(/app\.current_user_can_act_as_bt_closeout_actor\(\s*v_actor_org\s*,\s*v_session\.therapist_id\s*\)/i);
    expect(creator).toMatch(/app\.has_complete_bt_review_packet\(v_actor_org, v_session\.id\) is not true[\s\S]*return null/i);
  });

  it('extends the closeout smoke with linked legacy therapist success and deny cases', () => {
    expect(smokeSql).toContain('legacy therapist billing resolver failed');
    expect(smokeSql).toContain('legacy therapist draft failed');
    expect(smokeSql).toContain('legacy therapist finalize failed');
    expect(smokeSql).toContain('legacy therapist creator replay returned a different request');
    expect(smokeSql).toContain('legacy therapist finalization did not create the expected supervision request');
    expect(smokeSql).toContain('unlinked legacy therapist unexpectedly resolved billing');
    expect(smokeSql).toContain('unlinked legacy therapist unexpectedly wrote a draft');
    expect(smokeSql).toContain('unlinked legacy therapist unexpectedly read BT ABA note');
    expect(smokeSql).toContain('unlinked legacy therapist unexpectedly created a supervision request');
    expect(smokeSql).toContain('legacy therapist admin overlap unexpectedly resolved billing');
    expect(smokeSql).toContain('legacy therapist admin overlap unexpectedly wrote a draft');
    expect(smokeSql).toContain('legacy therapist admin overlap unexpectedly read BT ABA note');
    expect(smokeSql).toContain('legacy therapist admin overlap unexpectedly finalized a note');
    expect(smokeSql).toContain('elevated linked BCBA unexpectedly read BT ABA note');
    expect(smokeSql).toContain('cross-org BT unexpectedly wrote a draft');
    expect(smokeSql).toContain('unrelated BT unexpectedly read BT ABA note');
  });
});
