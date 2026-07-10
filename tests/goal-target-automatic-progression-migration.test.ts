import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  path.join(process.cwd(), "supabase", "migrations", "20260710210551_goal_target_automatic_progression.sql"),
  "utf8",
);

describe("goal target automatic progression migration", () => {
  it("adds phase state and enforces one valid current target per goal", () => {
    expect(sql).toMatch(/create type public\.goal_target_phase as enum\s*\(\s*'baseline',\s*'teaching',\s*'generalization',\s*'mastery'\s*\)/is);
    expect(sql).toMatch(/add column if not exists current_phase public\.goal_target_phase/is);
    expect(sql).toMatch(/add column if not exists is_current boolean not null default false/is);
    expect(sql).toMatch(/add column if not exists evaluation_window_started_at timestamptz/is);
    expect(sql).toMatch(/add column if not exists progression_version bigint not null default 0/is);
    expect(sql).toMatch(/goal_targets_current_state_chk[\s\S]*not is_current or \(status = 'active' and current_phase is not null\)/is);
    expect(sql).toMatch(/create unique index[^;]+goal_targets_one_current_per_goal_idx[^;]+\(organization_id, goal_id\)[^;]+where is_current and status = 'active'/is);
    expect(sql).toContain("create or replace function app.guard_goal_target_progression_state()");
    expect(sql).toMatch(/if current_user in \('anon', 'authenticated', 'service_role'\)[\s\S]*new\.current_phase is distinct from old\.current_phase[\s\S]*raise exception/is);
    expect(sql).toContain("create trigger goal_targets_guard_progression_state");
    expect(sql).toMatch(/revoke insert, update on table public\.goal_targets from anon, authenticated, service_role/is);
    expect(sql).toMatch(/grant insert \(\s*organization_id, client_id, goal_id, name, measurement_type, graph_config,\s*status, sort_order, created_by, updated_by, created_at, updated_at\s*\)[^;]+to authenticated, service_role/is);
    expect(sql).toMatch(/grant update \(\s*organization_id, client_id, goal_id, name, measurement_type, graph_config,\s*status, sort_order, created_by, updated_by, created_at, updated_at\s*\)[^;]+to authenticated, service_role/is);
    expect(sql).toContain("create or replace function app.initialize_goal_target_progression_state()");
    expect(sql).toMatch(/initialize_goal_target_progression_state[\s\S]*security definer\s+set search_path = ''/is);
    expect(sql).toMatch(/pg_advisory_xact_lock\(hashtextextended\(v_goal_id::text, 0\)\)/is);
    expect(sql).toMatch(/from public\.goals g[\s\S]*where g\.id = v_goal_id/is);
    expect(sql).toMatch(/new\.status = 'active'[\s\S]*v_goal_status = 'active'[\s\S]*not exists \([\s\S]*is_current[\s\S]*status = 'active'/is);
    expect(sql).toMatch(/order by gt\.sort_order, gt\.created_at, gt\.id[\s\S]*limit 1/is);
    expect(sql).toMatch(/set current_phase = 'baseline'::public\.goal_target_phase,[\s\S]*is_current = true,[\s\S]*evaluation_window_started_at = timezone\('utc', now\(\)\)/is);
    expect(sql).toMatch(/create trigger goal_targets_initialize_progression_state\s+after insert on public\.goal_targets/is);
    expect(sql).toMatch(/create trigger goal_targets_initialize_progression_on_activation\s+after update of status on public\.goal_targets/is);
    expect(sql).toMatch(/create trigger goals_initialize_target_progression_on_activation\s+after update of status on public\.goals/is);
    expect(sql).toMatch(/tg_table_name = 'goal_targets'[\s\S]*old\.status is distinct from 'active'[\s\S]*new\.status = 'active'/is);
    expect(sql).toMatch(/tg_table_name = 'goals'[\s\S]*old\.status is distinct from 'active'[\s\S]*new\.status = 'active'/is);
    expect(sql).toMatch(/set current_phase = 'baseline'::public\.goal_target_phase,[\s\S]*is_current = true,[\s\S]*evaluation_window_started_at = timezone\('utc', now\(\)\),[\s\S]*progression_version = progression_version \+ 1/is);
    expect(sql).toMatch(/revoke execute on function app\.initialize_goal_target_progression_state\(\)[^;]+from public, anon, authenticated, service_role/is);
  });

  it("creates scoped normalized criteria and immutable history tables", () => {
    expect(sql).toMatch(/create table[^;]+goal_target_phase_criteria/is);
    expect(sql).toMatch(/unique\s*\(target_id, phase\)/is);
    expect(sql).toMatch(/metric text[\s\S]*metric is null or metric in \('percent_correct', 'percent_independent', 'total_value', 'average_value'\)/is);
    expect(sql).toMatch(/threshold numeric[\s\S]*threshold is null[\s\S]*threshold >= 0/is);
    expect(sql).toMatch(/threshold[\s\S]*not in \('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric\)/is);
    expect(sql).toMatch(/min_observations integer[\s\S]*check \(min_observations is null or min_observations > 0\)/is);
    expect(sql).toMatch(/consecutive_sessions integer[\s\S]*check \(consecutive_sessions is null or consecutive_sessions > 0\)/is);
    expect(sql).toMatch(/create table[^;]+goal_target_phase_evaluations/is);
    expect(sql).toMatch(/result text not null[\s\S]*'qualifying'[\s\S]*'blocked_incomplete_criteria'/is);
    expect(sql).toMatch(/unique\s*\(session_id, target_id, phase, progression_version\)/is);
    expect(sql).toMatch(/create table[^;]+goal_target_transitions/is);
    expect(sql).toMatch(/source text not null[\s\S]*source in \('automatic', 'manual'\)/is);
    expect(sql).not.toMatch(/target_id uuid[^,;]+on delete cascade/is);
    expect(sql).not.toMatch(/session_id uuid[^,;]+on delete cascade/is);
  });

  it("rejects every PostgreSQL numeric non-finite threshold before metric bounds", () => {
    expect(sql).toMatch(/new\.threshold in \('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric\)[\s\S]*criterion threshold must be finite/is);
    expect(sql).toMatch(/criterion threshold must be finite[\s\S]*new\.metric in \('percent_correct', 'percent_independent'\)[\s\S]*new\.threshold > 100/is);
  });

  it("derives and validates tenant scope with fixed-search-path helpers", () => {
    expect(sql).toContain("create or replace function app.set_goal_target_progression_scope()");
    expect(sql).toMatch(/from public\.goal_targets gt[\s\S]*where gt\.id = new\.target_id/is);
    expect(sql).toMatch(/new\.organization_id := v_target\.organization_id[\s\S]*new\.client_id := v_target\.client_id[\s\S]*new\.goal_id := v_target\.goal_id/is);
    expect(sql).toMatch(/new\.created_by := coalesce\(auth\.uid\(\), new\.created_by\)/is);
    expect(sql).toMatch(/security definer\s+set search_path = ''/is);
    expect(sql).toContain("create trigger goal_target_phase_criteria_set_scope");
    expect(sql).toContain("create trigger goal_target_phase_evaluations_set_scope");
    expect(sql).toContain("create trigger goal_target_transitions_set_scope");
  });

  it("backfills incomplete criteria and deterministically activates only eligible targets", () => {
    expect(sql).toMatch(/cross join[^;]+\('baseline'::public\.goal_target_phase\)[\s\S]*\('teaching'::public\.goal_target_phase\)[\s\S]*\('generalization'::public\.goal_target_phase\)[\s\S]*\('mastery'::public\.goal_target_phase\)/is);
    expect(sql).toMatch(/insert into public\.goal_target_phase_criteria[\s\S]*metric[\s\S]*comparator[\s\S]*threshold[\s\S]*select[\s\S]*null[\s\S]*null[\s\S]*null/is);
    expect(sql).toMatch(/update public\.goal_targets[\s\S]*set is_current = false[\s\S]*where status = 'mastered'/is);
    expect(sql).toMatch(/row_number\(\) over \([\s\S]*partition by organization_id, goal_id[\s\S]*order by sort_order, created_at, id/is);
    expect(sql).toMatch(/status = 'active'/is);
    expect(sql).toMatch(/evaluation_window_started_at = v_migration_time/is);
    expect(sql).not.toMatch(/(?:update|delete from) public\.trial_events/is);
    expect(sql).not.toMatch(/(?:update|delete from) public\.sessions/is);
  });

  it("enables tenant-scoped RLS with criteria-only clinician mutation", () => {
    for (const table of ["goal_target_phase_criteria", "goal_target_phase_evaluations", "goal_target_transitions"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security;`);
      expect(sql).toContain(`revoke all on table public.${table} from anon;`);
    }
    expect(sql).toMatch(/create policy goal_target_phase_criteria_org_read[\s\S]*organization_id = app\.current_user_organization_id\(\)/is);
    expect(sql).toMatch(/create policy goal_target_phase_criteria_org_insert[\s\S]*current_user_has_exact_role_for_org\(organization_id, array\['bcba', 'midtier'\]::text\[\]\)/is);
    expect(sql).toMatch(/current_user_is_super_admin\(\)/is);
    expect(sql).toContain("grant select, insert, update on table public.goal_target_phase_criteria to authenticated;");
    expect(sql).toContain("revoke delete on table public.goal_target_phase_criteria from authenticated;");
    expect(sql).toContain("grant select on table public.goal_target_phase_evaluations to authenticated;");
    expect(sql).toContain("grant select on table public.goal_target_transitions to authenticated;");
    expect(sql).toContain("revoke insert, update, delete on table public.goal_target_phase_evaluations from authenticated;");
    expect(sql).toContain("revoke insert, update, delete on table public.goal_target_transitions from authenticated;");
    expect(sql).toContain("revoke insert, update, delete on table public.goal_target_phase_evaluations from service_role;");
    expect(sql).toContain("revoke insert, update, delete on table public.goal_target_transitions from service_role;");
    expect(sql).not.toContain("create policy goal_target_phase_evaluations_service_role_all");
    expect(sql).not.toContain("create policy goal_target_transitions_service_role_all");
  });

  it("exposes only a hardened manual override function contract", () => {
    expect(sql).toMatch(/create or replace function public\.override_goal_target_progression\(/is);
    expect(sql).toMatch(/revoke execute on function public\.override_goal_target_progression[^;]+from public, anon/is);
    expect(sql).toMatch(/grant execute on function public\.override_goal_target_progression[^;]+to authenticated, service_role/is);
    expect(sql).toMatch(/reason[\s\S]*btrim[\s\S]*expected_version/is);
    expect(sql).toMatch(/current_user_has_exact_role_for_org\([\s\S]*array\['bcba', 'midtier'\]::text\[\]/is);
  });

  it("keeps the automatic evaluator internal and exposes structured results", () => {
    expect(sql).toMatch(/create or replace function app\.evaluate_goal_target_progression\(\s*target_session_id uuid,\s*target_note_id uuid\s*\)/is);
    expect(sql).toMatch(/returns table\s*\([\s\S]*outcome text[\s\S]*goal_id uuid[\s\S]*target_id uuid[\s\S]*previous_phase public\.goal_target_phase[\s\S]*current_phase public\.goal_target_phase[\s\S]*next_target_id uuid[\s\S]*goal_status text[\s\S]*warning text/is);
    expect(sql).toMatch(/revoke execute on function app\.evaluate_goal_target_progression\(uuid, uuid\)[^;]+from public, anon, authenticated/is);
  });

  it("serializes note finalization by session and reuses a canonical note when note id is omitted", () => {
    expect(sql).toMatch(/select s\.\* into v_session[\s\S]*where s\.id = target_session_id[\s\S]*for update/is);
    expect(sql).toMatch(/if target_note_id is not null[\s\S]*else[\s\S]*from public\.client_session_notes csn[\s\S]*csn\.session_id = v_session\.id[\s\S]*order by csn\.is_locked desc, csn\.signed_at desc nulls last, csn\.created_at desc, csn\.id desc[\s\S]*for update/is);
    expect(sql).toMatch(/if v_note\.id is null[\s\S]*insert into public\.client_session_notes/is);
  });

  it("derives finalized timing and service values from persisted scoped records", () => {
    expect(sql).toMatch(/v_session\.start_time::date[\s\S]*v_session\.start_time::time[\s\S]*v_session\.end_time::time/is);
    expect(sql).toMatch(/extract\(epoch from \(v_session\.end_time - v_session\.start_time\)\)\s*\/\s*60/is);
    expect(sql).toMatch(/authorization_services[\s\S]*service_code = nullif\(note_payload->>'requested_service_code', ''\)[\s\S]*order by/is);
    expect(sql).not.toMatch(/note_payload->>'session_date'/is);
    expect(sql).not.toMatch(/note_payload->>'start_time'/is);
    expect(sql).not.toMatch(/note_payload->>'end_time'/is);
    expect(sql).not.toMatch(/note_payload->>'session_duration'/is);
  });

  it("owns strict billing policy in tenant-scoped database functions", () => {
    expect(sql).toMatch(/insert into public\.feature_flags[\s\S]*session_capture_strict_billing_gate[\s\S]*false[\s\S]*on conflict/is);
    expect(sql).toMatch(/create or replace function app\.session_capture_strict_billing_gate\(target_organization_id uuid\)[\s\S]*security definer[\s\S]*set search_path = ''/is);
    expect(sql).toMatch(/coalesce\(organization_override\.is_enabled, flag_default\.default_enabled, false\)[\s\S]*organization_feature_flags/is);
    expect(sql).toMatch(/create or replace function public\.get_session_capture_strict_billing_gate\(target_organization_id uuid\)[\s\S]*current_user_is_super_admin[\s\S]*resolve_user_organization_id/is);
    expect(sql).toMatch(/revoke execute on function public\.get_session_capture_strict_billing_gate\(uuid\) from public, anon/is);
    expect(sql).toMatch(/grant execute on function public\.get_session_capture_strict_billing_gate\(uuid\) to authenticated, service_role/is);
  });

  it("enforces strict billing inside finalization without caller policy input", () => {
    expect(sql).not.toMatch(/finalize_session_note_with_progression\([^)]*(?:strict|relax)/is);
    expect(sql).toMatch(/v_strict_billing := app\.session_capture_strict_billing_gate\(v_session\.organization_id\)/is);
    expect(sql).toMatch(/if v_strict_billing[\s\S]*v_authorization\.status <> 'approved'[\s\S]*v_session\.start_time::date not between v_authorization\.start_date and v_authorization\.end_date[\s\S]*requested service is not authorized/is);
  });

  it("preserves metadata and documents an additive truthful rollback", () => {
    expect(sql).toMatch(/^-- @migration-intent:/);
    expect(sql).toMatch(/^-- @migration-dependencies:/m);
    expect(sql).toMatch(/^-- @migration-rollback:.*drop.*goal_target_transitions.*goal_target_phase_evaluations.*goal_target_phase_criteria.*set_goal_target_progression_scope.*guard_goal_target_progression_state.*initialize_goal_target_progression_state/ims);
  });
});
