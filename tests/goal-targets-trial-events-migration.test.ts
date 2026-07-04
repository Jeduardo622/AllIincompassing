import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION_PATH = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260703173000_goal_targets_trial_events.sql",
);

const sql = readFileSync(MIGRATION_PATH, "utf8");

describe("goal targets and trial events migration", () => {
  it("represents session appointment metadata used by trial-event capture", () => {
    expect(sql).toContain("alter table public.sessions");
    expect(sql).toContain("add column if not exists appointment_id uuid");
    expect(sql).toContain("add column if not exists metadata jsonb not null default '{}'::jsonb");
    expect(sql).toMatch(
      /alter table public\.sessions[\s\S]*drop constraint if exists sessions_metadata_object_chk[\s\S]*add constraint sessions_metadata_object_chk[\s\S]*check \(jsonb_typeof\(metadata\) = 'object'\)/,
    );
    expect(sql).toMatch(
      /create index if not exists sessions_appointment_id_idx[\s\S]*on public\.sessions \(appointment_id\)[\s\S]*where appointment_id is not null/,
    );
    expect(sql).toContain("v_has_appointment_id := (p_session ? 'appointment_id') or (p_session ? 'appointmentId')");
    expect(sql).toContain("v_has_metadata := p_session ? 'metadata'");
    expect(sql).toMatch(/v_appointment_id := coalesce\(nullif\(p_session->>'appointment_id', ''\)::uuid, nullif\(p_session->>'appointmentId', ''\)::uuid\)/);
    expect(sql).toMatch(/v_metadata := case[\s\S]*when v_has_metadata then p_session->'metadata'[\s\S]*else '\{\}'::jsonb[\s\S]*end/);
    expect(sql).toContain("return jsonb_build_object('success', false, 'error_code', 'INVALID_METADATA'");
    expect(sql).toMatch(/insert into public\.sessions \([\s\S]*appointment_id[\s\S]*metadata[\s\S]*\)[\s\S]*values \([\s\S]*v_appointment_id[\s\S]*v_metadata/s);
    expect(sql).toMatch(/update public\.sessions[\s\S]*appointment_id = case when v_has_appointment_id then v_appointment_id else appointment_id end[\s\S]*metadata = case when v_has_metadata then v_metadata else metadata end/s);
  });

  it("creates normalized target and trial-event tables with tenant scope", () => {
    expect(sql).toContain("create table if not exists public.goal_targets");
    expect(sql).toContain("create table if not exists public.trial_events");
    expect(sql).toContain("organization_id uuid not null references public.organizations(id)");
    expect(sql).toContain("client_id uuid not null references public.clients(id)");
    expect(sql).toContain("target_id uuid not null references public.goal_targets(id)");
    expect(sql).toContain("trial_number integer not null check (trial_number > 0)");
    expect(sql).toContain("value numeric constraint trial_events_value_nonnegative check (value is null or value >= 0)");
  });

  it("preserves trial history by preventing authenticated target deletes and target cascade deletes", () => {
    expect(sql).toContain("target_id uuid not null references public.goal_targets(id),");
    expect(sql).toContain("goal_id uuid not null references public.goals(id),");
    expect(sql).not.toContain("target_id uuid not null references public.goal_targets(id) on delete cascade");
    expect(sql).not.toContain("goal_id uuid not null references public.goals(id) on delete cascade");
    expect(sql).toContain("grant select, insert, update on table public.goal_targets to authenticated;");
    expect(sql).toContain("revoke delete on table public.goal_targets from authenticated;");
    expect(sql).not.toContain("grant select, insert, update, delete on table public.goal_targets to authenticated;");
    expect(sql).toMatch(
      /alter table public\.goal_targets[\s\S]*drop constraint if exists goal_targets_goal_id_fkey[\s\S]*add constraint goal_targets_goal_id_fkey[\s\S]*foreign key \(goal_id\) references public\.goals\(id\)/,
    );
    expect(sql).toMatch(
      /alter table public\.trial_events[\s\S]*drop constraint if exists trial_events_target_id_fkey[\s\S]*add constraint trial_events_target_id_fkey[\s\S]*foreign key \(target_id\) references public\.goal_targets\(id\)/,
    );
    expect(sql).toMatch(
      /alter table public\.trial_events[\s\S]*drop constraint if exists trial_events_goal_id_fkey[\s\S]*add constraint trial_events_goal_id_fkey[\s\S]*foreign key \(goal_id\) references public\.goals\(id\)/,
    );
    expect(sql).toMatch(
      /alter table public\.trial_events[\s\S]*drop constraint if exists trial_events_value_nonnegative[\s\S]*add constraint trial_events_value_nonnegative[\s\S]*check \(value is null or value >= 0\)/,
    );
    expect(sql).toContain("create policy goal_targets_org_insert");
    expect(sql).toContain("create policy goal_targets_org_update");
    expect(sql).toContain("drop policy if exists goal_targets_org_manage on public.goal_targets;");
    expect(sql).not.toContain("create policy goal_targets_org_manage");
  });

  it("prevents duplicate trial numbers for the same target within a session", () => {
    expect(sql).toContain("create unique index if not exists trial_events_session_target_trial_uidx");
    expect(sql).toContain("on public.trial_events (session_id, target_id, trial_number)");
  });

  it("overwrites client-supplied audit actor fields from auth.uid at the database boundary", () => {
    expect(sql).toContain("new.created_by := coalesce(app.current_user_id(), new.created_by);");
    expect(sql).toContain("new.updated_by := coalesce(app.current_user_id(), new.updated_by, new.created_by);");
  });

  it("keeps admin_schedule out of program-goal management while preserving BT data-taking boundaries", () => {
    expect(sql).toContain("app.current_user_can_manage_programs_goals(organization_id)");
    expect(sql).toContain("app.current_user_can_capture_trial_event(organization_id, client_id)");
    expect(sql).toContain("app.current_user_can_take_client_data(target_organization_id, target_client_id)");
    expect(sql).toContain("app.current_user_has_exact_role_for_org(target_organization_id, array['bcba']::text[])");
    expect(sql).toContain("app.current_user_can_manage_locked_trial_event(organization_id)");
    expect(sql).not.toMatch(/current_user_can_manage_programs_goals[\s\S]*admin_schedule/);
  });

  it("enforces measurement-specific response and value semantics", () => {
    expect(sql).toContain("v_target.measurement_type in ('correctIncorrect', 'taskAnalysis') and new.response is null");
    expect(sql).toContain("v_target.measurement_type in ('correctIncorrect', 'taskAnalysis') and new.value is not null");
    expect(sql).toContain("v_target.measurement_type in ('frequency', 'rate', 'duration', 'timeSample', 'latency', 'IRT') and new.value is null");
    expect(sql).toContain("v_target.measurement_type in ('frequency', 'rate', 'duration', 'timeSample', 'latency', 'IRT') and new.response is not null");
  });

  it("does not allow org-level locked-session managers to delete trial events outside client capture scope", () => {
    expect(sql).toMatch(
      /create policy trial_events_org_delete[\s\S]*app\.current_user_can_capture_trial_event\(organization_id, client_id\)[\s\S]*app\.current_user_can_manage_locked_trial_event\(organization_id\)/,
    );
  });

  it("exposes protected public RPC wrappers used by server trial-event routes", () => {
    expect(sql).toContain("create or replace function public.session_has_locked_note(target_session_id uuid)");
    expect(sql).toContain("app.current_user_can_capture_trial_event(session_scope.organization_id, session_scope.client_id)");
    expect(sql).toContain("raise exception 'session lock state is not in scope'");
    expect(sql).toContain("return app.session_has_locked_note(target_session_id);");
    expect(sql).toContain("create or replace function public.current_user_can_manage_locked_trial_event(target_organization_id uuid)");
    expect(sql).toContain("select app.current_user_can_manage_locked_trial_event(target_organization_id);");
    expect(sql).toContain("create or replace function public.current_user_can_capture_trial_event(target_organization_id uuid, target_client_id uuid)");
    expect(sql).toContain("select app.current_user_can_capture_trial_event(target_organization_id, target_client_id);");
    expect(sql).toContain("create or replace function public.current_user_can_take_client_data(target_organization_id uuid, target_client_id uuid)");
    expect(sql).toContain("select app.current_user_can_take_client_data(target_organization_id, target_client_id);");
    expect(sql).toContain("grant execute on function public.session_has_locked_note(uuid) to authenticated, service_role;");
    expect(sql).toContain("grant execute on function public.current_user_can_manage_locked_trial_event(uuid) to authenticated, service_role;");
    expect(sql).toContain("grant execute on function public.current_user_can_capture_trial_event(uuid, uuid) to authenticated, service_role;");
    expect(sql).toContain("grant execute on function public.current_user_can_take_client_data(uuid, uuid) to authenticated, service_role;");
    expect(sql).toContain("revoke execute on function public.session_has_locked_note(uuid) from public, anon;");
    expect(sql).toContain("revoke execute on function public.current_user_can_manage_locked_trial_event(uuid) from public, anon;");
    expect(sql).toContain("revoke execute on function public.current_user_can_capture_trial_event(uuid, uuid) from public, anon;");
    expect(sql).toContain("revoke execute on function public.current_user_can_take_client_data(uuid, uuid) from public, anon;");
  });

  it("grants Data API access explicitly and denies anon access", () => {
    expect(sql).toContain("revoke all on table public.goal_targets from anon;");
    expect(sql).toContain("grant select, insert, update on table public.goal_targets to authenticated;");
    expect(sql).toContain("grant select, insert, update, delete on table public.goal_targets to service_role;");
    expect(sql).toContain("revoke all on table public.trial_events from anon;");
    expect(sql).toContain("grant select, insert, update, delete on table public.trial_events to authenticated;");
    expect(sql).toContain("grant select, insert, update, delete on table public.trial_events to service_role;");
  });

  it("enables RLS and reloads PostgREST schema", () => {
    expect(sql).toContain("alter table public.goal_targets enable row level security;");
    expect(sql).toContain("alter table public.trial_events enable row level security;");
    expect(sql).toContain("notify pgrst, 'reload schema';");
  });
});
