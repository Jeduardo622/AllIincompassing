import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260716212837_bt_aba_session_note_closeout.sql'),
  'utf8',
);
const smoke = readFileSync(join(process.cwd(), 'tests/sql/bt_aba_session_note_closeout_smoke.sql'), 'utf8');

const functionBody = (name: string) =>
  sql.match(new RegExp(`create or replace function public\\.${name}[\\s\\S]*?\\n\\$\\$;`, 'i'))?.[0] ?? '';

describe('BT ABA session note closeout migration', () => {
  it('adds structured storage and caller-bound attestations', () => {
    expect(sql).toMatch(/add column if not exists bt_aba_template_id uuid/i);
    expect(sql).toMatch(/add column if not exists bt_aba_template_snapshot jsonb/i);
    expect(sql).toMatch(/add column if not exists bt_aba_responses jsonb/i);
    expect(sql).toMatch(/add column if not exists bt_aba_finalization_result jsonb/i);
    expect(sql).toMatch(/create table if not exists public\.session_note_attestations/i);
    expect(sql).toMatch(/unique\s*\(\s*note_id\s*,\s*attestation_role\s*,\s*signer_user_id\s*\)/i);
  });

  it('enables tenant RLS and keeps attestation writes behind the atomic RPC', () => {
    expect(sql).toMatch(/alter table public\.session_note_attestations enable row level security/i);
    expect(sql).toMatch(/organization_id = app\.current_user_organization_id\(\)/i);
    expect(sql).toMatch(/revoke all on table public\.session_note_attestations from public, anon/i);
    expect(sql).toMatch(/grant select on table public\.session_note_attestations to authenticated/i);
    expect(sql).not.toMatch(/create policy session_note_attestations_authenticated_insert/i);
    expect(sql).not.toMatch(/grant [^;]*insert[^;]* on table public\.session_note_attestations to authenticated/i);
  });

  it('seeds the approved organization-scoped template idempotently', () => {
    expect(sql).toMatch(/insert into public\.session_note_templates/i);
    expect(sql).toMatch(/'bt_aba_session_note'::text/i);
    expect(sql).toMatch(/where not exists\s*\([\s\S]*existing\.organization_id = organizations\.id[\s\S]*existing\.template_type = bt_template\.template_type[\s\S]*existing\.template_name = bt_template\.template_name/i);
    expect(sql).toMatch(/"required_when"\s*:\s*"purpose_of_session includes Other"/i);
    expect(sql).toMatch(/"required_when"\s*:\s*"skill_strategies includes Other"/i);
    expect(sql).toMatch(/"required_when"\s*:\s*"behavior_strategies includes Other"/i);
    expect(sql).toMatch(/"required_when"\s*:\s*"supervisor_support includes Other"/i);
  });

  it('defines a locked, assigned-BT-only draft RPC', () => {
    const draft = functionBody('save_bt_aba_session_note_draft');
    expect(draft).toMatch(/for update/i);
    expect(draft).toMatch(/v_session\.status <> 'in_progress'/i);
    expect(draft).toMatch(/v_session\.organization_id <> app\.current_user_organization_id\(\)/i);
    expect(draft).toMatch(/app\.current_user_has_exact_role_for_org\([\s\S]*array\['bt'\]::text\[\][\s\S]*array\['admin', 'admin_schedule', 'midtier', 'bcba', 'therapist'\]::text\[\]/i);
    expect(draft).toMatch(/from public\.user_therapist_links utl[\s\S]*utl\.user_id = v_actor[\s\S]*utl\.therapist_id = v_session\.therapist_id/i);
    expect(draft).toMatch(/v_session\.therapist_id = v_actor/i);
    expect(draft).toMatch(/therapist\.organization_id = v_session\.organization_id[\s\S]*therapist\.status = 'active'[\s\S]*therapist\.deleted_at is null[\s\S]*upper\(btrim\(coalesce\(therapist\.title, ''\)\)\) in \('BT', 'RBT'\)/i);
    expect(draft).toMatch(/v_note\.is_locked/i);
    expect(draft).toMatch(/bt_aba_template_id\s*=\s*p_template_id/i);
    expect(draft).toMatch(/bt_aba_template_snapshot\s*=\s*v_template\.template_structure/i);
    expect(draft).toMatch(/bt_aba_responses\s*=\s*coalesce\(p_responses/i);
  });

  it('derives billing identity from the locked session instead of caller note payload', () => {
    const draft = functionBody('save_bt_aba_session_note_draft');
    const finalize = functionBody('finalize_bt_aba_session_note');
    for (const body of [draft, finalize]) {
      expect(body).not.toMatch(/p_note_payload\s*->>\s*'authorization_id'|p_note_payload\s*->>\s*'requested_service_code'/i);
      expect(body).toMatch(/from public\.authorizations authz[\s\S]*authz\.organization_id = v_session\.organization_id[\s\S]*authz\.client_id = v_session\.client_id/i);
      expect(body).toMatch(/authz\.status = 'approved'[\s\S]*v_session\.start_time::date between authz\.start_date and authz\.end_date/i);
      expect(body).toMatch(/from public\.authorization_services service[\s\S]*service\.authorization_id = v_authorization\.id/i);
      expect(body).toMatch(/service\.decision_status = 'approved'[\s\S]*v_session\.start_time::date between service\.from_date and service\.to_date/i);
      expect(body).toMatch(/if not found and v_strict_billing then[\s\S]*v_service_code := 'UNSPECIFIED'/i);
      expect(body.indexOf('from public.authorizations authz')).toBeLessThan(body.indexOf('from public.authorization_services service'));
    }
    expect(draft).toMatch(/authorization_id\s*=\s*v_authorization\.id[\s\S]*service_code\s*=\s*v_service_code/i);
    expect(finalize).toMatch(/v_canonical_note_payload[\s\S]*jsonb_build_object\([\s\S]*'authorization_id', v_authorization\.id[\s\S]*'requested_service_code', v_service_code/i);
    expect(finalize).toMatch(/finalize_session_note_with_progression\([\s\S]*v_canonical_note_payload/i);
    expect(smoke).toMatch(/caller-supplied billing identity was trusted/i);
    expect(smoke).toMatch(/authorization-only relaxed capture failed/i);
  });

  it('provides a narrow tenant-safe assigned-BT read RPC', () => {
    const reader = functionBody('get_bt_aba_session_note');
    expect(reader).toMatch(/v_session\.organization_id <> app\.current_user_organization_id\(\)/i);
    expect(reader).toMatch(/app\.current_user_has_exact_role_for_org\([\s\S]*array\['bt'\]::text\[\][\s\S]*array\['admin', 'admin_schedule', 'midtier', 'bcba', 'therapist'\]::text\[\]/i);
    expect(reader).toMatch(/therapist\.organization_id = v_session\.organization_id[\s\S]*therapist\.status = 'active'[\s\S]*therapist\.deleted_at is null[\s\S]*upper\(btrim\(coalesce\(therapist\.title, ''\)\)\) in \('BT', 'RBT'\)/i);
    expect(reader).toMatch(/v_session\.therapist_id = v_actor[\s\S]*from public\.user_therapist_links utl[\s\S]*utl\.user_id = v_actor[\s\S]*utl\.therapist_id = v_session\.therapist_id/i);
    expect(reader).toMatch(/from public\.client_session_notes note[\s\S]*note\.session_id = v_session\.id[\s\S]*note\.organization_id = v_session\.organization_id[\s\S]*note\.client_id = v_session\.client_id[\s\S]*note\.therapist_id = v_session\.therapist_id/i);
    expect(reader).toMatch(/from public\.session_note_templates template[\s\S]*template\.organization_id = v_session\.organization_id[\s\S]*template\.template_type = 'bt_aba_session_note'/i);
    expect(reader).toMatch(/jsonb_build_object\([\s\S]*'note_id'[\s\S]*'template_id'[\s\S]*'responses'[\s\S]*'status'/i);
    expect(sql).toMatch(/revoke execute on function public\.get_bt_aba_session_note\(uuid\) from public, anon/i);
    expect(sql).toMatch(/grant execute on function public\.get_bt_aba_session_note\(uuid\) to authenticated, service_role/i);
    expect(smoke).toMatch(/assigned exact BT read failed[\s\S]*unrelated BT unexpectedly read BT ABA note[\s\S]*non-BT unexpectedly read BT ABA note/i);
  });

  it('finalizes atomically in the required order and preserves completion side effects', () => {
    const finalize = functionBody('finalize_bt_aba_session_note');
    expect(sql).toMatch(/create or replace function public\.finalize_bt_aba_session_note/i);
    expect(finalize).toMatch(/pg_advisory_xact_lock/i);
    expect(finalize).toMatch(/v_session\.status <> 'in_progress'/i);
    expect(finalize).toMatch(/from public\.user_therapist_links utl[\s\S]*utl\.user_id = v_actor[\s\S]*utl\.therapist_id = v_session\.therapist_id/i);
    expect(finalize).toMatch(/app\.current_user_has_exact_role_for_org\([\s\S]*array\['bt'\]::text\[\][\s\S]*array\['admin', 'admin_schedule', 'midtier', 'bcba', 'therapist'\]::text\[\]/i);
    expect(finalize).toMatch(/required BT ABA session note response missing/i);
    expect(finalize).toMatch(/bt_signature[\s\S]*signature_method[\s\S]*signature_value/i);

    const statusUpdate = finalize.indexOf("status = 'completed'");
    const progressionCall = finalize.indexOf('finalize_session_note_with_progression');
    const auditCall = finalize.indexOf('record_session_audit');
    const supervisionCall = finalize.indexOf('create_supervision_session_note_request_for_completed_session');
    expect(statusUpdate).toBeGreaterThan(-1);
    expect(statusUpdate).toBeLessThan(progressionCall);
    expect(progressionCall).toBeLessThan(auditCall);
    expect(auditCall).toBeLessThan(supervisionCall);
    expect(finalize).toMatch(/event_type\s*=\s*'session_completed'/i);
    expect(finalize).toMatch(/on conflict \(note_id, attestation_role, signer_user_id\) do nothing/i);
    expect(finalize).toMatch(/update public\.client_session_notes[\s\S]*bt_aba_finalization_result = v_result/i);
    expect(finalize).toMatch(/v_result := jsonb_build_object\([\s\S]*'status', 'completed'[\s\S]*return v_result/i);
    expect(finalize).not.toMatch(/insert into public\.supervision_session_note_requests/i);
  });

  it('routes linked distinct-user BT supervision through the canonical idempotent creator', () => {
    const creator = functionBody('create_supervision_session_note_request_for_completed_session');
    const finalize = functionBody('finalize_bt_aba_session_note');
    expect(creator).toMatch(/v_session\.therapist_id <> v_actor/i);
    expect(creator).toMatch(/from public\.user_therapist_links utl[\s\S]*utl\.user_id = v_actor[\s\S]*utl\.therapist_id = v_session\.therapist_id/i);
    expect(creator).toMatch(/v_actor_is_admin[\s\S]*v_session\.therapist_id <> v_actor[\s\S]*current_user_has_exact_role_for_org\([\s\S]*array\['bt'\]::text\[\][\s\S]*array\['admin', 'admin_schedule', 'midtier', 'bcba', 'therapist'\]::text\[\][\s\S]*user_therapist_links/i);
    expect(creator).toMatch(/on conflict \(session_id\) do update/i);
    expect(finalize.match(/create_supervision_session_note_request_for_completed_session/g)).toHaveLength(1);
    expect(smoke).toMatch(/non-BT linked caller unexpectedly created a supervision request/i);
  });

  it('returns the persisted completed result before validating retry payloads or repeating side effects', () => {
    const finalize = functionBody('finalize_bt_aba_session_note');
    const replayStart = finalize.indexOf("if v_session.status = 'completed' then");
    const strictAuthority = finalize.indexOf('app.current_user_has_exact_role_for_org');
    const noteLoad = finalize.indexOf('select note.* into v_note');
    const payloadValidation = finalize.indexOf("jsonb_typeof(coalesce(p_responses", replayStart);
    const replay = finalize.slice(replayStart, strictAuthority);
    expect(replay).toMatch(/v_note\.is_locked/i);
    expect(replay).toMatch(/v_note\.bt_aba_finalization_result is null/i);
    expect(replay).toMatch(/session_note_attestations/i);
    expect(replay).toMatch(/return v_note\.bt_aba_finalization_result/i);
    expect(replay).not.toMatch(/current_user_has_exact_role_for_org|current_user_can_capture_trial_event|user_therapist_links|therapist\.status|required BT ABA session note response missing|finalize_session_note_with_progression|record_session_audit|create_supervision_session_note_request/i);
    expect(noteLoad).toBeGreaterThan(-1);
    expect(noteLoad).toBeLessThan(replayStart);
    expect(replayStart).toBeGreaterThan(-1);
    expect(replayStart).toBeLessThan(strictAuthority);
    expect(replayStart).toBeLessThan(payloadValidation);
    expect(smoke).toMatch(/set is_active = false[\s\S]*delete from public\.user_therapist_links[\s\S]*set status = 'inactive'[\s\S]*invalid-payload signer replay/i);
  });

  it('documents restoration of the prior supervision helper on rollback', () => {
    expect(sql).toMatch(/@migration-rollback:[^\n]*restore the prior create_supervision_session_note_request_for_completed_session definition/i);
    expect(sql).toMatch(/@migration-rollback:[^\n]*drop get_bt_aba_session_note/i);
  });

  it('keeps RPC exposure least privileged', () => {
    expect(sql).toMatch(/revoke execute on function public\.save_bt_aba_session_note_draft\(uuid, uuid, jsonb, jsonb\) from public, anon/i);
    expect(sql).toMatch(/revoke execute on function public\.finalize_bt_aba_session_note\(uuid, uuid, jsonb, jsonb, jsonb, jsonb\) from public, anon/i);
    expect(sql).toMatch(/revoke execute on function public\.get_bt_aba_session_note\(uuid\) from public, anon/i);
    expect(sql).toMatch(/grant execute on function public\.save_bt_aba_session_note_draft\(uuid, uuid, jsonb, jsonb\) to authenticated, service_role/i);
    expect(sql).toMatch(/grant execute on function public\.finalize_bt_aba_session_note\(uuid, uuid, jsonb, jsonb, jsonb, jsonb\) to authenticated, service_role/i);
  });
});
