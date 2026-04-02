-- @migration-intent: Repair production drift where 20260401000000 and 20260401120000 were not recorded
--   in schema_migrations while later migrations applied. Idempotent: safe if objects already exist.
--   Version aligns with migration applied to production via Supabase dashboard/MCP (20260402182221).
-- @migration-dependencies: 20260401143000_fix_user_roles_policy_recursion.sql
-- @migration-rollback: Not automated; coordinate manual rollback if required.

begin;

-- From 20260401000000_add_goal_notes_to_session_notes.sql (idempotent)
alter table public.client_session_notes
  add column if not exists goal_notes jsonb null;

comment on column public.client_session_notes.goal_notes is
  'Per-goal note text keyed by goal UUID. Shape: { "<goal_id>": "<note_text>" }. NULL when no per-goal notes entered.';

-- From 20260401120000_harden_session_close_notes_boundary.sql (idempotent policies/function/trigger)
set search_path = public;

create or replace function public.enforce_in_progress_close_notes_coverage()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_missing_goal_count integer := 0;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.status = old.status then
    return new;
  end if;

  if not (
    old.status = 'in_progress'
    and new.status in ('completed', 'no-show')
  ) then
    return new;
  end if;

  with required_goals as (
    select sg.goal_id::text as goal_id
    from public.session_goals sg
    where sg.session_id = new.id
      and sg.organization_id = new.organization_id
  ),
  covered_goals as (
    select distinct key as goal_id
    from public.client_session_notes csn
    cross join lateral jsonb_each(coalesce(csn.goal_notes, '{}'::jsonb)) as goal_entries(key, value)
    where csn.session_id = new.id
      and csn.organization_id = new.organization_id
      and jsonb_typeof(goal_entries.value) = 'string'
      and btrim(goal_entries.value #>> '{}') <> ''
  )
  select count(*)
  into v_missing_goal_count
  from required_goals rg
  left join covered_goals cg
    on cg.goal_id = rg.goal_id
  where cg.goal_id is null;

  if v_missing_goal_count > 0 then
    raise exception using
      errcode = 'P0001',
      message = 'SESSION_NOTES_REQUIRED',
      detail = 'Session notes with goal progress are required before closing this session.';
  end if;

  return new;
end;
$$;

drop trigger if exists sessions_close_notes_coverage_guard on public.sessions;
create trigger sessions_close_notes_coverage_guard
before update of status on public.sessions
for each row
execute function public.enforce_in_progress_close_notes_coverage();

drop policy if exists session_goals_org_manage on public.session_goals;
drop policy if exists session_goals_org_read on public.session_goals;
drop policy if exists session_goals_org_insert on public.session_goals;
drop policy if exists session_goals_org_update on public.session_goals;
drop policy if exists session_goals_org_delete on public.session_goals;

create policy session_goals_org_read
  on public.session_goals
  for select
  to authenticated
  using (
    organization_id = app.current_user_organization_id()
    and (
      app.user_has_role_for_org('therapist', organization_id)
      or app.user_has_role_for_org('admin', organization_id)
      or app.user_has_role_for_org('super_admin', organization_id)
    )
  );

create policy session_goals_org_insert
  on public.session_goals
  for insert
  to authenticated
  with check (
    organization_id = app.current_user_organization_id()
    and (
      app.user_has_role_for_org('therapist', organization_id)
      or app.user_has_role_for_org('admin', organization_id)
      or app.user_has_role_for_org('super_admin', organization_id)
    )
  );

create policy session_goals_org_update
  on public.session_goals
  for update
  to authenticated
  using (
    organization_id = app.current_user_organization_id()
    and (
      app.user_has_role_for_org('therapist', organization_id)
      or app.user_has_role_for_org('admin', organization_id)
      or app.user_has_role_for_org('super_admin', organization_id)
    )
    and exists (
      select 1
      from public.sessions s
      where s.id = session_goals.session_id
        and s.organization_id = session_goals.organization_id
        and s.status <> 'in_progress'
    )
  )
  with check (
    organization_id = app.current_user_organization_id()
    and (
      app.user_has_role_for_org('therapist', organization_id)
      or app.user_has_role_for_org('admin', organization_id)
      or app.user_has_role_for_org('super_admin', organization_id)
    )
    and exists (
      select 1
      from public.sessions s
      where s.id = session_goals.session_id
        and s.organization_id = session_goals.organization_id
        and s.status <> 'in_progress'
    )
  );

create policy session_goals_org_delete
  on public.session_goals
  for delete
  to authenticated
  using (
    organization_id = app.current_user_organization_id()
    and (
      app.user_has_role_for_org('therapist', organization_id)
      or app.user_has_role_for_org('admin', organization_id)
      or app.user_has_role_for_org('super_admin', organization_id)
    )
    and exists (
      select 1
      from public.sessions s
      where s.id = session_goals.session_id
        and s.organization_id = session_goals.organization_id
        and s.status <> 'in_progress'
    )
  );

commit;
