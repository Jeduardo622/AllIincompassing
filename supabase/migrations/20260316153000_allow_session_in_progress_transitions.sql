-- @migration-intent: Align sessions status constraints/transitions with start_session_with_goals, which sets status to in_progress.
-- @migration-dependencies: 20260310190000_business_logic_lifecycle_hardening.sql
-- @migration-rollback: Remove in_progress from sessions_status_check and revert transition guard to pre-start flow.

set search_path = public;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'sessions_status_check'
      and conrelid = 'public.sessions'::regclass
  ) then
    alter table public.sessions drop constraint sessions_status_check;
  end if;
end
$$;

alter table public.sessions
  add constraint sessions_status_check
  check (status in ('scheduled', 'in_progress', 'completed', 'cancelled', 'no-show'));

create or replace function public.enforce_session_status_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.status = old.status then
    return new;
  end if;

  if old.status = 'scheduled' and new.status in ('in_progress', 'completed', 'cancelled', 'no-show') then
    return new;
  end if;

  if old.status = 'in_progress' and new.status in ('completed', 'cancelled', 'no-show') then
    return new;
  end if;

  raise exception 'Invalid sessions.status transition from % to %', old.status, new.status
    using errcode = '23514';
end;
$$;
