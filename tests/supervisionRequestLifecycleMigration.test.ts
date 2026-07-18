import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260717222331_repair_supervision_request_lifecycle.sql',
  ),
  'utf8',
);
const authorityCorrectionSql = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260717235500_align_supervision_request_linked_therapist_authority.sql',
  ),
  'utf8',
);

function functionBody(name: string): string {
  const pattern = new RegExp(
    `create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
    'i',
  );
  return migrationSql.match(pattern)?.[0] ?? '';
}

describe('supervision request lifecycle repair migration', () => {
  it('adds durable cancellation and reopen provenance to the request row', () => {
    expect(migrationSql).toMatch(/add column if not exists cancelled_at timestamptz/i);
    expect(migrationSql).toMatch(/add column if not exists cancelled_by uuid references auth\.users\(id\)/i);
    expect(migrationSql).toMatch(/add column if not exists cancellation_reason text/i);
    expect(migrationSql).toMatch(/add column if not exists cancellation_source text/i);
    expect(migrationSql).toMatch(/add column if not exists reopened_at timestamptz/i);
    expect(migrationSql).toMatch(/add column if not exists reopened_by uuid references auth\.users\(id\)/i);
    expect(migrationSql).toMatch(/add column if not exists reopen_source text/i);
    expect(migrationSql).toMatch(/create index if not exists supervision_session_note_requests_cancelled_by_idx[\s\S]*\(cancelled_by\)/i);
    expect(migrationSql).toMatch(/create index if not exists supervision_session_note_requests_reopened_by_idx[\s\S]*\(reopened_by\)/i);
  });

  it('requires auditable provenance whenever a request is cancelled', () => {
    expect(migrationSql).toMatch(/status <> 'cancelled'[\s\S]*cancelled_at is not null[\s\S]*nullif\(btrim\(cancellation_reason\), ''\) is not null/i);
    expect(migrationSql).toMatch(/char_length\(cancellation_reason\) <= 512/i);
    expect(migrationSql).toMatch(/nullif\(btrim\(cancellation_source\), ''\) is not null/i);
    expect(migrationSql).toMatch(/num_nonnulls\(reopened_at, reopen_source\) in \(0, 2\)/i);
  });

  it('locks the session and reopens a cancelled request only when its structured BT packet is complete', () => {
    expect(migrationSql).toMatch(/create or replace function public\.create_supervision_session_note_request_for_completed_session/i);
    expect(migrationSql).toMatch(/from public\.sessions s[\s\S]*where s\.id = p_session_id[\s\S]*for update/i);
    expect(migrationSql).toMatch(/app\.has_complete_bt_review_packet\(v_actor_org, v_session\.id\) is not true[\s\S]*return null/i);
    expect(migrationSql).toMatch(/from public\.supervision_session_note_requests request[\s\S]*request\.session_id = v_session\.id[\s\S]*request\.organization_id = v_actor_org[\s\S]*for update/i);
    expect(migrationSql).toMatch(/insert into public\.supervision_session_note_requests[\s\S]*on conflict \(session_id\) do nothing[\s\S]*if v_request_id is not null then[\s\S]*return v_request_id[\s\S]*select request\.\*[\s\S]*for update/i);
    expect(migrationSql).toMatch(/v_request\.status = 'cancelled'[\s\S]*set status = 'pending'/i);
    expect(migrationSql).toMatch(/v_request\.status = 'completed'[\s\S]*return v_request\.id/i);
  });

  it('keeps request creation authority aligned with authorized session closers', () => {
    const creator = functionBody('create_supervision_session_note_request_for_completed_session');

    expect(creator).toMatch(/v_actor_has_schedule_authority\s*:=\s*app\.user_has_any_active_role_for_org\([\s\S]*?array\['admin_schedule', 'midtier', 'bcba'\]/i);
    expect(creator).toMatch(/coalesce\(v_actor_has_schedule_authority, false\) is not true/i);
  });

  it('keeps the issued migration immutable and corrects linked-therapist authority forward', () => {
    expect(authorityCorrectionSql).toMatch(/where s\.id = p_session_id\s+and s\.organization_id = v_actor_org/i);
    expect(authorityCorrectionSql).toMatch(/v_session\.therapist_id <> v_actor\s+and not exists \(\s*select 1\s+from public\.user_therapist_links utl\s+where utl\.user_id = v_actor\s+and utl\.therapist_id = v_session\.therapist_id\s*\) then\s+raise exception using errcode = '42501'/i);
    expect(authorityCorrectionSql).not.toMatch(/array\['bt'\]::text\[][\s\S]*?from public\.user_therapist_links/i);
  });

  it('records reopen provenance, clears completion state, and recomputes the reviewer', () => {
    expect(migrationSql).toMatch(/reopened_at = timezone\('utc', now\(\)\)/i);
    expect(migrationSql).toMatch(/reopened_by = v_actor/i);
    expect(migrationSql).toMatch(/reopen_source = 'structured_bt_closeout'/i);
    expect(migrationSql).toMatch(/completed_at = null/i);
    expect(migrationSql).toMatch(/assigned_admin_user_id = app\.resolve_supervision_bcba_assignee/i);
  });

  it('lets reconciliation create only same-org recent packet-complete missing requests without reopening cancelled rows', () => {
    const reconcile = functionBody('reconcile_supervision_session_note_requests');

    expect(reconcile).toMatch(/create or replace function public\.reconcile_supervision_session_note_requests/i);
    expect(reconcile).toMatch(/s\.organization_id = v_actor_org/i);
    expect(reconcile).toMatch(/coalesce\(s\.end_time, s\.start_time, s\.created_at\) >= coalesce\(p_since/i);
    expect(reconcile).toMatch(/app\.has_complete_bt_review_packet\(s\.organization_id, s\.id\) is true/i);
    expect(reconcile).toMatch(/left join public\.supervision_session_note_requests existing[\s\S]*existing\.id is null/i);
    expect(reconcile).toMatch(/on conflict \(session_id\) do nothing/i);
    expect(reconcile).not.toMatch(/status\s*=\s*'cancelled'[\s\S]*set status\s*=\s*'pending'/i);
  });

  it('preserves browser grants and keeps arbitrary packet checks service-role-only', () => {
    expect(migrationSql).toMatch(/revoke all on function public\.create_supervision_session_note_request_for_completed_session\(uuid\) from public, anon/i);
    expect(migrationSql).toMatch(/grant execute on function public\.create_supervision_session_note_request_for_completed_session\(uuid\) to authenticated, service_role/i);
    expect(migrationSql).toMatch(/revoke all on function public\.reconcile_supervision_session_note_requests\(timestamptz\) from public, anon/i);
    expect(migrationSql).toMatch(/grant execute on function public\.reconcile_supervision_session_note_requests\(timestamptz\) to authenticated, service_role/i);
    expect(migrationSql).not.toMatch(/grant execute on function app\.has_complete_bt_review_packet\(uuid, uuid\) to authenticated/i);
  });

  it('uses one session-then-request lock order for creator and BCBA completion', () => {
    const creator = functionBody('create_supervision_session_note_request_for_completed_session');
    const completion = functionBody('complete_supervision_session_note_request');

    expect(completion).toMatch(/create or replace function public\.complete_supervision_session_note_request/i);
    for (const body of [creator, completion]) {
      const sessionLock = body.search(/from public\.sessions[\s\S]*?for update/i);
      const requestLock = body.search(/from public\.supervision_session_note_requests[\s\S]*?for update/i);
      expect(sessionLock).toBeGreaterThanOrEqual(0);
      expect(requestLock).toBeGreaterThan(sessionLock);
    }
  });

  it('contains no production row identifiers, deletes, or source clinical-record writes', () => {
    expect(migrationSql).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
    expect(migrationSql).not.toMatch(/delete\s+from/i);
    expect(migrationSql).not.toMatch(/update\s+public\.(sessions|client_session_notes|supervision_session_notes|session_audit_logs)/i);
  });
});
