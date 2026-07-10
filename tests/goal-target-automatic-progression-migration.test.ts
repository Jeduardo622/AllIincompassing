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
  });

  it("creates scoped normalized criteria and immutable history tables", () => {
    expect(sql).toMatch(/create table[^;]+goal_target_phase_criteria/is);
    expect(sql).toMatch(/unique\s*\(target_id, phase\)/is);
    expect(sql).toMatch(/metric text[\s\S]*metric is null or metric in \('percent_correct'\)/is);
    expect(sql).toMatch(/threshold numeric[\s\S]*threshold is null or threshold between 0 and 100/is);
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
  });

  it("exposes only a hardened manual override function contract", () => {
    expect(sql).toMatch(/create or replace function public\.override_goal_target_progression\(/is);
    expect(sql).toMatch(/revoke execute on function public\.override_goal_target_progression[^;]+from public, anon/is);
    expect(sql).toMatch(/grant execute on function public\.override_goal_target_progression[^;]+to authenticated, service_role/is);
    expect(sql).toMatch(/reason[\s\S]*btrim[\s\S]*expected_version/is);
    expect(sql).toMatch(/current_user_has_exact_role_for_org\([\s\S]*array\['bcba', 'midtier'\]::text\[\]/is);
  });

  it("preserves metadata and documents an additive truthful rollback", () => {
    expect(sql).toMatch(/^-- @migration-intent:/);
    expect(sql).toMatch(/^-- @migration-dependencies:/m);
    expect(sql).toMatch(/^-- @migration-rollback:.*drop.*goal_target_transitions.*goal_target_phase_evaluations.*goal_target_phase_criteria/ims);
  });
});
