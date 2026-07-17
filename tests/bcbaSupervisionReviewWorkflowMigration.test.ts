import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260717163000_route_bt_notes_to_assigned_bcba.sql'),
  'utf8',
);
const btCloseoutSql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260716212837_bt_aba_session_note_closeout.sql'),
  'utf8',
);
const structuredPacketSql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260717191500_require_structured_bt_supervision_packet.sql'),
  'utf8',
);

describe('BCBA supervision review workflow migration', () => {
  it('resolves a unique linked BCBA before the sole organization BCBA fallback', () => {
    expect(sql).toMatch(/create or replace function app\.resolve_supervision_bcba_assignee/i);
    expect(sql).toMatch(/client_therapist_links/i);
    expect(sql).toMatch(/user_therapist_links/i);
    expect(sql).toMatch(/app\.user_has_exact_active_role_for_org\([\s\S]*array\['bcba'\]::text\[\]/i);
    expect(sql).toMatch(/lower\(btrim\(r\.name\)\) = 'bcba'/i);
    expect(sql).toMatch(/if v_linked_count = 1 then[\s\S]*return v_linked_user_id/i);
    expect(sql).toMatch(/if v_org_count = 1 then[\s\S]*return v_org_user_id/i);
    expect(sql).toMatch(/return null/i);
  });

  it('assigns creator and reconciled requests without blocking ambiguous closeout', () => {
    expect(sql).toMatch(/assigned_admin_user_id[\s\S]*app\.resolve_supervision_bcba_assignee/i);
    expect(sql).toMatch(/on conflict \(session_id\) do update[\s\S]*assigned_admin_user_id = coalesce/i);
    expect(sql).not.toMatch(/raise exception[^;]*(ambiguous|bcba assignment)/i);
  });

  it('backfills only pending unassigned deterministic requests', () => {
    expect(sql).toMatch(/update public\.supervision_session_note_requests/i);
    expect(sql).toMatch(/status = 'pending'/i);
    expect(sql).toMatch(/assigned_admin_user_id is null/i);
    expect(sql).toMatch(/resolved\.assigned_user_id is not null/i);
  });

  it('requires the BCBA signature and credential in the canonical template', () => {
    expect(sql).toMatch(/bcba_supervisor_signature[\s\S]*required[\s\S]*true/i);
    expect(sql).toMatch(/bcba_licensure_credential[\s\S]*required[\s\S]*true/i);
    expect(sql).toMatch(/template_type = 'supervision_session_note'[\s\S]*template_name = 'Supervision Session Note'/i);
  });

  it('limits BCBA reads to assigned same-org exact-role requests while retaining exact admin visibility', () => {
    expect(sql).toMatch(/assigned_admin_user_id = auth\.uid\(\)/i);
    expect(sql).toMatch(/app\.user_has_exact_active_role_for_org\([\s\S]*array\['bcba'\]::text\[\]/i);
    expect(sql).toMatch(/app\.user_has_any_active_role_for_org\([\s\S]*array\['admin', 'super_admin', 'org_admin', 'org_super_admin'\]/i);
    expect(sql).not.toMatch(/app\.user_has_role_for_org\([\s\S]*array\['bcba'\]/i);
    expect(sql).toMatch(/grant execute on function app\.user_has_any_active_role_for_org\(uuid, uuid, text\[\]\) to service_role/i);
    expect(sql).toMatch(/grant execute on function app\.user_has_exact_active_role_for_org\(uuid, uuid, text\[\]\) to service_role/i);
    expect(sql).toMatch(/create or replace function app\.current_user_has_any_active_role_for_org[\s\S]*auth\.uid\(\)[\s\S]*grant execute[\s\S]*to authenticated, service_role/i);
    expect(sql).toMatch(/create or replace function app\.current_user_has_exact_active_role_for_org[\s\S]*auth\.uid\(\)[\s\S]*grant execute[\s\S]*to authenticated, service_role/i);
  });

  it('returns a tenant-checked immutable BT review packet and fails closed on missing BT notes', () => {
    expect(sql).toMatch(/create or replace function public\.get_pending_supervision_review_packets\(\)/i);
    expect(sql).toMatch(/bt_aba_responses/i);
    expect(sql).toMatch(/bt_aba_template_snapshot/i);
    expect(sql).toMatch(/attestation_role = 'bt'/i);
    expect(sql).toMatch(/left join lateral \([\s\S]*session_note_attestations attestation[\s\S]*order by attestation\.signed_at desc, attestation\.id desc[\s\S]*limit 1[\s\S]*\) bt_attestation on true/i);
    expect(sql).toMatch(/therapist\.full_name as bt_therapist_name/i);
    expect(sql).not.toMatch(/therapist\.name as bt_therapist_name/i);
    expect(sql).toMatch(/Pending supervision request is missing BT session note/i);
    expect(sql).toMatch(/left join lateral \([\s\S]*from public\.client_session_notes note/i);
    expect(sql).toMatch(/template_name = 'Supervision Session Note'/i);
    expect(sql).toMatch(/revoke all on function public\.get_pending_supervision_review_packets\(\) from public, anon/i);
  });

  it('requires the latest BT note to include structured responses, a template snapshot, and a BT attestation', () => {
    expect(structuredPacketSql).toMatch(/create or replace function app\.has_complete_bt_review_packet/i);
    expect(structuredPacketSql).toMatch(/jsonb_typeof\(note\.bt_aba_responses\) = 'object'/i);
    expect(structuredPacketSql).toMatch(/jsonb_typeof\(note\.bt_aba_template_snapshot\) = 'object'/i);
    expect(structuredPacketSql).toMatch(/order by note\.created_at desc, note\.id desc[\s\S]*limit 1/i);
    expect(structuredPacketSql).toMatch(/attestation\.attestation_role = 'bt'/i);
    expect(structuredPacketSql).toMatch(/revoke all on function app\.has_complete_bt_review_packet\(uuid, uuid\) from public, anon, authenticated/i);
    expect(structuredPacketSql).toMatch(/grant execute on function app\.has_complete_bt_review_packet\(uuid, uuid\) to service_role/i);
    expect(structuredPacketSql).toMatch(/app\.has_complete_bt_review_packet\(request\.organization_id, request\.session_id\) is not true/i);
    expect(structuredPacketSql).toMatch(/request\.status = 'pending'[\s\S]*app\.has_complete_bt_review_packet\(request\.organization_id, request\.session_id\) is true/i);
    expect(structuredPacketSql).toMatch(/app\.has_complete_bt_review_packet\(v_actor_org, v_request\.session_id\) is not true/i);
    expect(structuredPacketSql).toMatch(/from public\.sessions session[\s\S]*session\.id = v_request\.session_id[\s\S]*for update/i);
    expect(structuredPacketSql).toMatch(/Complete structured BT session note and attestation required before supervision completion/i);
    expect(structuredPacketSql).toMatch(/Pending supervision request lacks a complete structured BT review packet/i);
  });

  it('requires the assigned exact BCBA, preserves the BT attestation target, and writes the BCBA attestation on the supervision note', () => {
    expect(sql).toMatch(/v_request\.assigned_admin_user_id is distinct from v_actor/i);
    expect(sql).toMatch(/Canonical supervision template not found in caller organization/i);
    expect(sql).toMatch(/nullif\(btrim\(coalesce\(v_responses->>'bcba_licensure_credential', ''\)\), ''\) is null/i);
    expect(sql).toMatch(/char_length\(v_signature_value\) > 16384/i);
    expect(sql).toMatch(/organization_id, note_id, supervision_note_id, signer_user_id, attestation_role/i);
    expect(sql).toMatch(/v_actor_org, null, v_note_id, v_actor, 'bcba'/i);
    expect(sql).toMatch(/signature_method[\s\S]*signature_value/i);
    expect(sql).toMatch(/invalid BCBA signature/i);
  });

  it('enforces exactly one attestation target and distinct uniqueness per note type', () => {
    expect(sql).toMatch(/add column if not exists supervision_note_id uuid references public\.supervision_session_notes\(id\)/i);
    expect(sql).toMatch(/alter column note_id drop not null/i);
    expect(btCloseoutSql).toMatch(/unique \(note_id, attestation_role, signer_user_id\)/i);
    expect(btCloseoutSql).toMatch(/on conflict \(note_id, attestation_role, signer_user_id\) do nothing/i);
    expect(sql).not.toMatch(/drop constraint if exists session_note_attestations_note_id_attestation_role_signer_user_id_key/i);
    expect(sql).toMatch(/session_note_attestations_supervision_note_unique_idx/i);
    expect(sql).toMatch(/session_note_attestations_exactly_one_target_chk/i);
    expect(sql).toMatch(/note_id is not null[\s\S]*supervision_note_id is null[\s\S]*note_id is null[\s\S]*supervision_note_id is not null/i);
  });
});
