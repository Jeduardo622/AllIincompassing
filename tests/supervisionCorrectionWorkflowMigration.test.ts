import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260718155154_return_bt_supervision_correction.sql'),
  'utf8',
);

const reviewPacketGrantFixSql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260718225017_restrict_supervision_review_packet_rpc.sql'),
  'utf8',
);

const triggerHardeningSql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260718225105_harden_supervision_correction_trigger_functions.sql'),
  'utf8',
);

const signatureLimitFixPath = join(
  process.cwd(),
  'supabase/migrations/20260719000630_align_bt_correction_signature_limits.sql',
);
const signatureLimitFixSql = existsSync(signatureLimitFixPath)
  ? readFileSync(signatureLimitFixPath, 'utf8')
  : '';

const functionBody = (name: string) =>
  sql.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, 'i'))?.[0] ?? '';

const functionBodyFrom = (migrationSql: string, name: string) =>
  migrationSql.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, 'i'))?.[0] ?? '';

describe('supervision correction workflow migration', () => {
  it('reapplies the review packet RPC grants after its replacement', () => {
    expect(reviewPacketGrantFixSql).toMatch(
      /revoke all on function public\.get_pending_supervision_review_packets\(\) from public, anon/i,
    );
    expect(reviewPacketGrantFixSql).toMatch(
      /grant execute on function public\.get_pending_supervision_review_packets\(\) to authenticated, service_role/i,
    );
  });

  it('pins correction trigger search paths and removes direct browser execution', () => {
    for (const functionName of [
      'guard_supervision_session_note_corrections_update',
      'prevent_supervision_session_note_corrections_delete',
      'prevent_bt_session_note_amendment_mutations',
    ]) {
      expect(triggerHardeningSql).toMatch(
        new RegExp(`alter function public\\.${functionName}\\(\\) set search_path = ''`, 'i'),
      );
      expect(triggerHardeningSql).toMatch(
        new RegExp(`revoke all on function public\\.${functionName}\\(\\) from public, anon, authenticated`, 'i'),
      );
    }
  });

  it('keeps typed correction signatures at 200 characters and drawn signatures at 20000', () => {
    const body = functionBodyFrom(signatureLimitFixSql, 'resubmit_bt_supervision_correction');

    expect(signatureLimitFixSql).toMatch(/signature_method = 'typed'[\s\S]*char_length\(signature_value\) <= 200/i);
    expect(signatureLimitFixSql).toMatch(/signature_method = 'drawn'[\s\S]*char_length\(signature_value\) <= 20000/i);
    expect(body).toMatch(/v_signature_method = 'typed'[\s\S]*char_length\(v_signature_value\) > 200/i);
    expect(body).toMatch(/v_signature_method = 'drawn'[\s\S]*char_length\(v_signature_value\) > 20000/i);

    expect(signatureLimitFixSql).toMatch(/from pg_catalog\.pg_constraint[\s\S]*pg_catalog\.pg_get_constraintdef/i);
    expect(signatureLimitFixSql).toMatch(/alter table public\.bt_session_note_amendments drop constraint %I/i);
    expect(signatureLimitFixSql).toMatch(/create or replace function public\.resubmit_bt_supervision_correction/i);
    expect(signatureLimitFixSql).toMatch(/v_signature_method = 'drawn'[\s\S]*char_length\(v_signature_value\) > 20000/i);
  });

  it('documents a reviewed forward-only rollback path', () => {
    expect(sql).toMatch(/^-- @migration-intent: Add an append-only, tenant-safe Return to BT correction and resubmission workflow/i);
    expect(sql).toMatch(/@migration-dependencies:\s*20260717235500_align_supervision_request_linked_therapist_authority\.sql/i);
    expect(sql).toMatch(/@migration-rollback:[^\n]*restores the prior request status constraint and rpc definitions/i);
    expect(sql).toMatch(/@migration-rollback:[^\n]*preserving all signed correction and amendment history/i);
    expect(sql).toMatch(/@migration-rollback:[^\n]*normalization of correction_required\/resubmitted rows before restoring prior constraint/i);
  });

  it('extends supervision request states for the correction loop without dropping legacy states', () => {
    expect(sql).toMatch(/drop constraint if exists supervision_session_note_requests_status_check/i);
    expect(sql).toMatch(/add constraint supervision_session_note_requests_status_check[\s\S]*status in \('pending', 'correction_required', 'resubmitted', 'completed', 'cancelled'\)/i);
    expect(sql).toMatch(/correction_required/i);
    expect(sql).toMatch(/resubmitted/i);
  });

  it('creates append-only correction and amendment tables with monotonic uniqueness and unresolved-round protection', () => {
    expect(sql).toMatch(/create table public\.supervision_session_note_corrections/i);
    expect(sql).toMatch(/create table public\.bt_session_note_amendments/i);
    expect(sql).toMatch(/correction_round integer not null/i);
    expect(sql).toMatch(/version_number integer not null/i);
    expect(sql).toMatch(/check \(correction_round > 0\)/i);
    expect(sql).toMatch(/check \(version_number > 1\)/i);
    expect(sql).toMatch(/unique\s*\(\s*request_id\s*,\s*correction_round\s*\)/i);
    expect(sql).toMatch(/unique\s*\(\s*request_id\s*,\s*version_number\s*\)/i);
    expect(sql).toMatch(/unique\s*\(\s*id\s*,\s*request_id\s*,\s*organization_id\s*,\s*correction_round\s*\)/i);
    expect(sql).toMatch(/foreign key \(correction_id, request_id, organization_id, correction_round\)[\s\S]*references public\.supervision_session_note_corrections\(id, request_id, organization_id, correction_round\)/i);
    expect(sql).not.toMatch(/foreign key \(request_id, correction_round\)[\s\S]*references public\.supervision_session_note_corrections\(request_id, correction_round\)/i);
    expect(sql).toMatch(/unique\s*\(\s*id\s*,\s*correction_id\s*\)/i);
    expect(sql).toMatch(/num_nonnulls\(resolved_at, resolving_bt_user_id, resulting_amendment_id\) in \(0, 3\)/i);
    expect(sql).toMatch(/foreign key \(request_id, organization_id\)[\s\S]*references public\.supervision_session_note_requests\(id, organization_id\)/i);
    expect(sql).toMatch(/foreign key \(original_bt_note_id, organization_id\)[\s\S]*references public\.client_session_notes\(id, organization_id\)/i);
    expect(sql).toMatch(/foreign key \(resulting_amendment_id, id\)[\s\S]*references public\.bt_session_note_amendments\(id, correction_id\)/i);
    expect(sql).toMatch(/create unique index if not exists supervision_session_note_corrections_one_unresolved_idx[\s\S]*where resolved_at is null/i);
    expect(sql).toMatch(/create index if not exists supervision_session_note_corrections_request_lookup_idx/i);
    expect(sql).toMatch(/create index if not exists bt_session_note_amendments_request_version_idx/i);
  });

  it('binds amendments and resulting amendment references to the exact correction row', () => {
    expect(sql).toMatch(/foreign key \(correction_id, request_id, organization_id, correction_round\)[\s\S]*references public\.supervision_session_note_corrections\(id, request_id, organization_id, correction_round\)/i);
    expect(sql).toMatch(/foreign key \(resulting_amendment_id, id\)[\s\S]*references public\.bt_session_note_amendments\(id, correction_id\)/i);
    expect(sql).toMatch(/wrong-round cross-links are rejected by the composite correction lineage foreign keys|correction_round mismatches are rejected by the composite correction lineage foreign keys/i);
    expect(sql).toMatch(/wrong-correction resulting amendment links are rejected by the exact resulting amendment foreign key|resulting_amendment_id cannot target a different correction id/i);
  });

  it('enables RLS and keeps the new append-only tables rpc-only for browser callers', () => {
    for (const table of [
      'supervision_session_note_corrections',
      'bt_session_note_amendments',
    ]) {
      expect(sql).toMatch(new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
      expect(sql).toMatch(new RegExp(`revoke all on table public\\.${table} from public, anon`, 'i'));
      expect(sql).toMatch(new RegExp(`grant all on table public\\.${table} to service_role`, 'i'));
      expect(sql).not.toMatch(new RegExp(`grant [^;]* on table public\\.${table} to authenticated`, 'i'));
    }
  });

  it('defines fixed-search-path security-definer RPCs for return, BT correction inbox, BT resubmission, packet review, completion, and action counts', () => {
    const returnToBt = functionBody('return_supervision_session_note_request_to_bt');
    const btTasks = functionBody('get_bt_supervision_correction_tasks');
    const resubmit = functionBody('resubmit_bt_supervision_correction');
    const packetReview = functionBody('get_pending_supervision_review_packets');
    const completion = functionBody('complete_supervision_session_note_request');
    const actionCount = functionBody('get_supervision_session_note_action_count');

    for (const body of [returnToBt, btTasks, resubmit, packetReview, completion, actionCount]) {
      expect(body).toMatch(/security definer/i);
      expect(body).toMatch(/set search_path = ''/i);
    }

    expect(sql).toMatch(/create or replace function public\.return_supervision_session_note_request_to_bt/i);
    expect(sql).toMatch(/create or replace function public\.get_bt_supervision_correction_tasks/i);
    expect(sql).toMatch(/create or replace function public\.resubmit_bt_supervision_correction/i);
    expect(sql).toMatch(/create or replace function public\.get_pending_supervision_review_packets\(\)/i);
    expect(sql).toMatch(/create or replace function public\.complete_supervision_session_note_request\(\s*p_request_id uuid,\s*p_template_id uuid,\s*p_responses jsonb\s*\)/i);
    expect(sql).toMatch(/create or replace function public\.get_supervision_session_note_action_count\(\)/i);
    expect(sql).toMatch(/revoke all on function public\.return_supervision_session_note_request_to_bt\(uuid, text\) from public, anon/i);
    expect(sql).toMatch(/revoke all on function public\.get_bt_supervision_correction_tasks\(\) from public, anon/i);
    expect(sql).toMatch(/revoke all on function public\.resubmit_bt_supervision_correction\(/i);
    expect(sql).toMatch(/grant execute on function public\.return_supervision_session_note_request_to_bt\(uuid, text\) to authenticated, service_role/i);
    expect(sql).toMatch(/grant execute on function public\.get_bt_supervision_correction_tasks\(\) to authenticated, service_role/i);
    expect(sql).toMatch(/grant execute on function public\.resubmit_bt_supervision_correction\([^)]+\) to authenticated, service_role/i);
    expect(sql).toMatch(/revoke all on function public\.get_pending_supervision_review_packets\(\) from public, anon[\s\S]*drop function if exists public\.get_pending_supervision_review_packets\(\)[\s\S]*create or replace function public\.get_pending_supervision_review_packets\(\)[\s\S]*grant execute on function public\.get_pending_supervision_review_packets\(\) to authenticated, service_role/i);
    expect(sql).toMatch(/grant execute on function public\.get_pending_supervision_review_packets\(\) to authenticated, service_role/i);
    expect(sql).toMatch(/grant execute on function public\.complete_supervision_session_note_request\(uuid, uuid, jsonb\) to authenticated, service_role/i);
    expect(sql).toMatch(/grant execute on function public\.get_supervision_session_note_action_count\(\) to authenticated, service_role/i);
  });

  it('enforces append-only mutation guards on the new correction history tables', () => {
    expect(sql).toMatch(/create or replace function public\.guard_supervision_session_note_corrections_update\(\)/i);
    expect(sql).toMatch(/resolved_at may only transition from null to a timestamp/i);
    expect(sql).toMatch(/resolved corrections require resulting_amendment_id/i);
    expect(sql).toMatch(/create trigger supervision_session_note_corrections_guard_update/i);
    expect(sql).toMatch(/before update on public\.supervision_session_note_corrections/i);
    expect(sql).toMatch(/create trigger supervision_session_note_corrections_prevent_delete/i);
    expect(sql).toMatch(/before delete on public\.supervision_session_note_corrections/i);
    expect(sql).toMatch(/create or replace function public\.prevent_bt_session_note_amendment_mutations\(\)/i);
    expect(sql).toMatch(/bt session note amendments are immutable/i);
    expect(sql).toMatch(/create trigger bt_session_note_amendments_prevent_update/i);
    expect(sql).toMatch(/before update on public\.bt_session_note_amendments/i);
    expect(sql).toMatch(/create trigger bt_session_note_amendments_prevent_delete/i);
    expect(sql).toMatch(/before delete on public\.bt_session_note_amendments/i);
  });

  it('requires assigned exact BCBA return authorization with a trimmed nonblank reason on pending or resubmitted requests', () => {
    const body = functionBody('return_supervision_session_note_request_to_bt');

    expect(body).toMatch(/auth\.uid\(\)/i);
    expect(body).toMatch(/app\.resolve_user_organization_id\(v_actor\)/i);
    expect(body).toMatch(/app\.user_has_exact_active_role_for_org\([\s\S]*array\['bcba'\]::text\[\]/i);
    expect(body).toMatch(/assigned_admin_user_id is distinct from v_actor/i);
    expect(body).toMatch(/v_reason := btrim\(coalesce\(p_reason, ''\)\)/i);
    expect(body).toMatch(/char_length\(v_reason\) = 0/i);
    expect(body).toMatch(/char_length\(v_reason\) > 2000/i);
    expect(body).toMatch(/v_request\.status not in \('pending', 'resubmitted'\)/i);
    expect(body).toMatch(/for update/i);
    expect(body).toMatch(/insert into public\.supervision_session_note_corrections/i);
    expect(body).toMatch(/correction_round/i);
    expect(body).toMatch(/set status = 'correction_required'/i);
  });

  it('limits BT correction tasks to the original v1 signer who remains the active exact BT on the same therapist link', () => {
    const body = functionBody('get_bt_supervision_correction_tasks');

    expect(body).toMatch(/auth\.uid\(\)/i);
    expect(body).toMatch(/app\.resolve_user_organization_id\(v_actor\)/i);
    expect(body).toMatch(/app\.user_has_exact_active_role_for_org\([\s\S]*array\['bt'\]::text\[\]/i);
    expect(body).toMatch(/session_note_attestations attestation/i);
    expect(body).toMatch(/attestation\.attestation_role = 'bt'/i);
    expect(body).toMatch(/attestation\.supervision_note_id is null/i);
    expect(body).toMatch(/attestation\.signer_user_id = v_actor/i);
    expect(body).toMatch(/request\.status = 'correction_required'/i);
    expect(body).toMatch(/request\.assigned_admin_user_id/i);
    expect(body).toMatch(/request\.bt_therapist_id/i);
    expect(body).toMatch(/public\.user_therapist_links/i);
    expect(body).toMatch(/therapist\.status = 'active'/i);
    expect(body).toMatch(/upper\(btrim\(coalesce\(therapist\.title, ''\)\)\) in \('BT', 'RBT'\)/i);
    expect(body).toMatch(/bt_aba_template_snapshot/i);
    expect(body).toMatch(/bt_aba_responses/i);
    expect(body).toMatch(/jsonb_agg/i);
  });

  it('resubmits only immutable-template amendments with a fresh valid BT signature, monotonic versions, and atomic correction resolution', () => {
    const body = functionBody('resubmit_bt_supervision_correction');

    expect(body).toMatch(/auth\.uid\(\)/i);
    expect(body).toMatch(/app\.resolve_user_organization_id\(v_actor\)/i);
    expect(body).toMatch(/app\.user_has_exact_active_role_for_org\([\s\S]*array\['bt'\]::text\[\]/i);
    expect(body).toMatch(/session_note_attestations attestation/i);
    expect(body).toMatch(/attestation\.signer_user_id = v_actor/i);
    expect(body).toMatch(/v_request\.status <> 'correction_required'/i);
    expect(body).toMatch(/for update/i);
    expect(body).toMatch(/v_signature_method not in \('drawn', 'typed'\)/i);
    expect(body).toMatch(/char_length\(v_signature_value\) > 200/i);
    expect(body).toMatch(/left\(v_signature_value, 7\) <> 'points:'/i);
    expect(body).toMatch(/invalid drawn BT signature serialization|valid BT signature is required/i);
    expect(body).toMatch(/invalid BT ABA session note response type or option/i);
    expect(body).toMatch(/required BT ABA session note response missing/i);
    expect(body).toMatch(/insert into public\.bt_session_note_amendments/i);
    expect(body).toMatch(/version_number[\s\S]*coalesce\(max\(amendment\.version_number\), 1\) \+ 1/i);
    expect(body).toMatch(/update public\.supervision_session_note_corrections/i);
    expect(body).toMatch(/resolved_at = timezone\('utc', now\(\)\)/i);
    expect(body).toMatch(/resulting_amendment_id = v_amendment_id/i);
    expect(body).toMatch(/update public\.supervision_session_note_requests/i);
    expect(body).toMatch(/set status = 'resubmitted'/i);
    expect(body).not.toMatch(/assigned_admin_user_id =/i);
    expect(body).not.toMatch(/bt_therapist_id =/i);
    expect(body).not.toMatch(/update public\.client_session_notes/i);
  });

  it('returns correction-aware BCBA packets with original and amendment versions plus server-derived action flags', () => {
    const body = functionBody('get_pending_supervision_review_packets');

    expect(body).toMatch(/request\.status in \('pending', 'correction_required', 'resubmitted', 'completed'\)/i);
    expect(body).toMatch(/app\.user_has_any_active_role_for_org\([\s\S]*array\['admin', 'super_admin', 'org_admin', 'org_super_admin'\]/i);
    expect(body).toMatch(/request\.assigned_admin_user_id = auth\.uid\(\)|request\.assigned_admin_user_id = v_actor/i);
    expect(body).toMatch(/app\.user_has_exact_active_role_for_org\([\s\S]*array\['bcba'\]::text\[\]/i);
    expect(body).toMatch(/bt_session_note_amendments/i);
    expect(body).toMatch(/jsonb_build_object\([\s\S]*'version_number', 1/i);
    expect(body).toMatch(/jsonb_agg\(/i);
    expect(body).toMatch(/order by amendment\.version_number asc/i);
    expect(body).toMatch(/correction_reason/i);
    expect(body).toMatch(/requested_at/i);
    expect(body).toMatch(/can_complete/i);
    expect(body).toMatch(/can_return/i);
    expect(body).toMatch(/\(\s*request\.assigned_admin_user_id = v_actor[\s\S]*array\['bcba'\]::text\[\][\s\S]*\) as can_complete/i);
    expect(body).toMatch(/\(\s*request\.assigned_admin_user_id = v_actor[\s\S]*array\['bcba'\]::text\[\][\s\S]*request\.status in \('pending', 'resubmitted'\)[\s\S]*\) as can_return/i);
    expect(body).toMatch(/request\.status in \('pending', 'resubmitted'\)/i);
    expect(body).toMatch(/request\.status <> 'correction_required'/i);
  });

  it('completes only pending or resubmitted requests against the latest reviewable packet without rerunning BT closeout side effects', () => {
    const body = functionBody('complete_supervision_session_note_request');

    expect(body).not.toMatch(/alias for \$1|alias for \$2|alias for \$3/i);
    expect(body).toMatch(/v_request\.status not in \('pending', 'resubmitted'\)/i);
    expect(body).toMatch(/bt_session_note_amendments/i);
    expect(body).toMatch(/order by amendment\.version_number desc/i);
    expect(body).toMatch(/limit 1/i);
    expect(body).toMatch(/session_note_attestations/i);
    expect(body).toMatch(/attestation_role = 'bt'/i);
    expect(body).toMatch(/assigned_admin_user_id is distinct from v_actor/i);
    expect(body).toMatch(/insert into public\.supervision_session_notes/i);
    expect(body).toMatch(/set status = 'completed'/i);
    expect(body).not.toMatch(/finalize_session_note_with_progression/i);
    expect(body).not.toMatch(/record_session_audit/i);
    expect(body).not.toMatch(/update public\.sessions/i);
  });

  it('replaces raw notification counting with a role-safe supervision action count rpc', () => {
    const body = functionBody('get_supervision_session_note_action_count');

    expect(body).toMatch(/auth\.uid\(\)/i);
    expect(body).toMatch(/app\.resolve_user_organization_id\(v_actor\)/i);
    expect(body).toMatch(/app\.user_has_exact_active_role_for_org\([\s\S]*array\['bcba'\]::text\[\]/i);
    expect(body).toMatch(/app\.user_has_exact_active_role_for_org\([\s\S]*array\['bt'\]::text\[\]/i);
    expect(body).toMatch(/request\.status in \('pending', 'resubmitted'\)/i);
    expect(body).toMatch(/request\.status = 'correction_required'/i);
    expect(body).toMatch(/attestation\.signer_user_id = v_actor/i);
    expect(body).toMatch(/return coalesce\(v_count, 0\)/i);
    expect(body).not.toMatch(/from public\.supervision_session_note_requests[\s\S]*request\.organization_id = v_actor_org[\s\S]*request\.status = 'pending'[\s\S]*return count/i);
  });
});
