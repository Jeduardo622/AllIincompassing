import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260717163000_route_bt_notes_to_assigned_bcba.sql'),
  'utf8',
);

describe('BCBA supervision review workflow migration', () => {
  it('resolves a unique linked BCBA before the sole organization BCBA fallback', () => {
    expect(sql).toMatch(/create or replace function app\.resolve_supervision_bcba_assignee/i);
    expect(sql).toMatch(/client_therapist_links/i);
    expect(sql).toMatch(/user_therapist_links/i);
    expect(sql).toMatch(/r\.name = 'bcba'/i);
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
    expect(sql).toMatch(/template_type = 'supervision_session_note'/i);
  });

  it('limits BCBA reads to assigned same-org requests while retaining admin visibility', () => {
    expect(sql).toMatch(/assigned_admin_user_id = auth\.uid\(\)/i);
    expect(sql).toMatch(/app\.user_has_role_for_org\([\s\S]*array\['bcba'\]/i);
    expect(sql).toMatch(/array\['admin', 'super_admin', 'org_admin', 'org_super_admin'\]/i);
  });

  it('returns a tenant-checked immutable BT review packet', () => {
    expect(sql).toMatch(/create or replace function public\.get_pending_supervision_review_packets\(\)/i);
    expect(sql).toMatch(/bt_aba_responses/i);
    expect(sql).toMatch(/bt_aba_template_snapshot/i);
    expect(sql).toMatch(/attestation_role = 'bt'/i);
    expect(sql).toMatch(/revoke all on function public\.get_pending_supervision_review_packets\(\) from public, anon/i);
  });

  it('requires the assigned exact BCBA and writes a BCBA attestation atomically', () => {
    expect(sql).toMatch(/v_request\.assigned_admin_user_id is distinct from v_actor/i);
    expect(sql).toMatch(/array\['bcba'\]/i);
    expect(sql).toMatch(/attestation_role[\s\S]*'bcba'/i);
    expect(sql).toMatch(/signature_method[\s\S]*signature_value/i);
    expect(sql).toMatch(/invalid BCBA signature/i);
  });
});
