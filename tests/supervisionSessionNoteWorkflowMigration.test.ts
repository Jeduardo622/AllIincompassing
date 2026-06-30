import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('supervision session note workflow migration', () => {
  const migrationSql = readFileSync(
    join(
      process.cwd(),
      'supabase/migrations/20260629233000_create_supervision_session_note_workflow.sql',
    ),
    'utf-8',
  );

  it('creates dedicated request and note tables without reusing client_session_notes', () => {
    expect(migrationSql).toMatch(/create table if not exists public\.supervision_session_note_requests/i);
    expect(migrationSql).toMatch(/create table if not exists public\.supervision_session_notes/i);
    expect(migrationSql).toMatch(/references public\.sessions\(id\)/i);
    expect(migrationSql).toMatch(/references public\.session_note_templates\(id\)/i);
    expect(migrationSql).not.toMatch(/alter table public\.client_session_notes/i);
  });

  it('keeps one open request per session and stores structured note responses', () => {
    expect(migrationSql).toMatch(/unique\s*\(\s*session_id\s*\)/i);
    expect(migrationSql).toMatch(/responses jsonb not null default '\{\}'::jsonb/i);
    expect(migrationSql).toMatch(/status text not null default 'pending'/i);
    expect(migrationSql).toMatch(/completed_at timestamptz/i);
  });

  it('enables tenant RLS and limits browser table access to admin reads in the same organization', () => {
    expect(migrationSql).toMatch(/alter table public\.supervision_session_note_requests enable row level security/i);
    expect(migrationSql).toMatch(/alter table public\.supervision_session_notes enable row level security/i);
    expect(migrationSql).toMatch(/app\.user_has_role_for_org\(auth\.uid\(\), organization_id, array\['admin', 'super_admin', 'org_admin', 'org_super_admin'\]\)/i);
    expect(migrationSql).toMatch(/grant select on table public\.supervision_session_note_requests to authenticated/i);
    expect(migrationSql).toMatch(/grant select on table public\.supervision_session_notes to authenticated/i);
    expect(migrationSql).not.toMatch(/grant select,\s*insert,\s*update on table public\.supervision_session_note_requests to authenticated/i);
    expect(migrationSql).not.toMatch(/grant select,\s*insert,\s*update on table public\.supervision_session_notes to authenticated/i);
    expect(migrationSql).not.toMatch(/create policy supervision_session_note_requests_admin_insert/i);
    expect(migrationSql).not.toMatch(/create policy supervision_session_note_requests_admin_update/i);
    expect(migrationSql).not.toMatch(/create policy supervision_session_notes_admin_insert/i);
    expect(migrationSql).not.toMatch(/create policy supervision_session_notes_admin_update/i);
  });

  it('adds a tenant-checked RPC for session completion to create due requests', () => {
    expect(migrationSql).toMatch(/create or replace function public\.create_supervision_session_note_request_for_completed_session/i);
    expect(migrationSql).toMatch(/p_session_id uuid/i);
    expect(migrationSql).toMatch(/security definer/i);
    expect(migrationSql).toMatch(/app\.resolve_user_organization_id\(v_actor\)/i);
    expect(migrationSql).toMatch(/upper\(btrim\(coalesce\(t\.title, ''\)\)\) in \('BT', 'RBT'\) as is_bt_rbt/i);
    expect(migrationSql).toMatch(/grant execute on function public\.create_supervision_session_note_request_for_completed_session\(uuid\) to authenticated, service_role/i);
  });

  it('adds an admin reconciliation RPC so missed completion-side requests still appear in the queue', () => {
    expect(migrationSql).toMatch(/create or replace function public\.reconcile_supervision_session_note_requests/i);
    expect(migrationSql).toMatch(/p_since timestamptz default timezone\('utc', now\(\)\) - interval '14 days'/i);
    expect(migrationSql).toMatch(/app\.user_has_role_for_org\(\s*v_actor,\s*v_actor_org,\s*array\['admin', 'super_admin', 'org_admin', 'org_super_admin'\]\s*\)/i);
    expect(migrationSql).toMatch(/left join public\.supervision_session_note_requests existing\s+on existing\.session_id = s\.id/i);
    expect(migrationSql).toMatch(/upper\(btrim\(coalesce\(t\.title, ''\)\)\) in \('BT', 'RBT'\)/i);
    expect(migrationSql).toMatch(/on conflict \(session_id\) do nothing/i);
    expect(migrationSql).toMatch(/grant execute on function public\.reconcile_supervision_session_note_requests\(timestamptz\) to authenticated, service_role/i);
  });

  it('adds an atomic admin RPC for completing structured supervision notes', () => {
    expect(migrationSql).toMatch(/create or replace function public\.complete_supervision_session_note_request/i);
    expect(migrationSql).toMatch(/p_request_id uuid/i);
    expect(migrationSql).toMatch(/p_template_id uuid/i);
    expect(migrationSql).toMatch(/p_responses jsonb/i);
    expect(migrationSql).toMatch(/app\.user_has_role_for_org\(\s*v_actor,\s*v_actor_org,\s*array\['admin', 'super_admin', 'org_admin', 'org_super_admin'\]\s*\)/i);
    expect(migrationSql).toMatch(/where r\.id = p_request_id\s+and r\.organization_id = v_actor_org/i);
    expect(migrationSql).toMatch(/if v_request\.status <> 'pending' then\s+raise exception using errcode = '23514', message = 'Supervision request is not pending';\s+end if;/i);
    expect(migrationSql).toMatch(/and t\.organization_id = v_actor_org\s+and t\.template_type = 'supervision_session_note'/i);
    expect(migrationSql).toMatch(/jsonb_array_elements\(v_template\.template_structure->'sections'\)/i);
    expect(migrationSql).toMatch(/coalesce\(\(field\.value->>'required'\)::boolean, false\) as is_required/i);
    expect(migrationSql).toMatch(/template_field\.is_required is true/i);
    expect(migrationSql).toMatch(/field\.value->>'required_when' as required_when/i);
    expect(migrationSql).toMatch(/template_field\.required_when like '% includes %'/i);
    expect(migrationSql).toMatch(/split_part\(template_field\.required_when, ' includes ', 1\)/i);
    expect(migrationSql).toMatch(/raise exception using errcode = '23514', message = 'Required supervision note response missing'/i);
    expect(migrationSql).toMatch(/for update/i);
    expect(migrationSql).toMatch(/on conflict \(request_id\) do nothing/i);
    expect(migrationSql).toMatch(/if v_note_id is null then\s+raise exception using errcode = '23514', message = 'Supervision request is not pending';\s+end if;/i);
    expect(migrationSql).not.toMatch(/on conflict \(request_id\) do update/i);
    expect(migrationSql).toMatch(/grant execute on function public\.complete_supervision_session_note_request\(uuid, uuid, jsonb\) to authenticated, service_role/i);
  });
});
