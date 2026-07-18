import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260718155154_return_bt_supervision_correction.sql'),
  'utf8',
);

const functionBody = (name: string) =>
  sql.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, 'i'))?.[0] ?? '';

describe('supervision correction workflow migration', () => {
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
    expect(sql).toMatch(/num_nonnulls\(resolved_at, resolving_bt_user_id, resulting_amendment_id\) in \(0, 3\)/i);
    expect(sql).toMatch(/foreign key \(request_id, organization_id\)[\s\S]*references public\.supervision_session_note_requests\(id, organization_id\)/i);
    expect(sql).toMatch(/foreign key \(original_bt_note_id, organization_id\)[\s\S]*references public\.client_session_notes\(id, organization_id\)/i);
    expect(sql).toMatch(/foreign key \(correction_id, request_id, organization_id\)[\s\S]*references public\.supervision_session_note_corrections\(id, request_id, organization_id\)/i);
    expect(sql).toMatch(/foreign key \(resulting_amendment_id, request_id, organization_id\)[\s\S]*references public\.bt_session_note_amendments\(id, request_id, organization_id\)/i);
    expect(sql).toMatch(/create unique index if not exists supervision_session_note_corrections_one_unresolved_idx[\s\S]*where resolved_at is null/i);
    expect(sql).toMatch(/create index if not exists supervision_session_note_corrections_request_lookup_idx/i);
    expect(sql).toMatch(/create index if not exists bt_session_note_amendments_request_version_idx/i);
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

  it('defines fixed-search-path security-definer staged RPC shells for return, BT correction inbox, and BT resubmission', () => {
    const returnToBt = functionBody('return_supervision_session_note_request_to_bt');
    const btTasks = functionBody('get_bt_supervision_correction_tasks');
    const resubmit = functionBody('resubmit_bt_supervision_correction');

    for (const body of [returnToBt, btTasks, resubmit]) {
      expect(body).toMatch(/security definer/i);
      expect(body).toMatch(/set search_path = ''/i);
    }

    expect(sql).toMatch(/create or replace function public\.return_supervision_session_note_request_to_bt/i);
    expect(sql).toMatch(/create or replace function public\.get_bt_supervision_correction_tasks/i);
    expect(sql).toMatch(/create or replace function public\.resubmit_bt_supervision_correction/i);
    expect(sql).toMatch(/revoke all on function public\.return_supervision_session_note_request_to_bt\(uuid, text\) from public, anon/i);
    expect(sql).toMatch(/revoke all on function public\.get_bt_supervision_correction_tasks\(\) from public, anon/i);
    expect(sql).toMatch(/revoke all on function public\.resubmit_bt_supervision_correction\(/i);
    expect(sql).not.toMatch(/grant execute on function public\.return_supervision_session_note_request_to_bt\(uuid, text\) to authenticated/i);
    expect(sql).not.toMatch(/grant execute on function public\.get_bt_supervision_correction_tasks\(\) to authenticated/i);
    expect(sql).not.toMatch(/grant execute on function public\.resubmit_bt_supervision_correction\([^)]+\) to authenticated/i);
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
});
