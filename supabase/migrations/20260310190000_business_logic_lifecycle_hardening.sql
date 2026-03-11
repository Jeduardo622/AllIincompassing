-- @migration-intent: Lock scheduling RPC execution to least-privilege roles and enforce session/authorization lifecycle status constraints and transition guards.
-- @migration-dependencies: 20260310190000_auth_access_hardening.sql
-- @migration-rollback: Re-grant legacy RPC execute privileges and drop lifecycle check constraints/triggers/functions if rollback is required after validation.

set search_path = public;

-- Workstream A: lock down scheduling RPC execution paths.
revoke execute on function public.acquire_session_hold(uuid, uuid, timestamptz, timestamptz, uuid, integer) from public;
revoke execute on function public.acquire_session_hold(uuid, uuid, timestamptz, timestamptz, uuid, integer) from anon;
revoke execute on function public.acquire_session_hold(uuid, uuid, timestamptz, timestamptz, uuid, integer) from authenticated;
revoke execute on function public.acquire_session_hold(uuid, uuid, timestamptz, timestamptz, uuid, integer) from service_role;

revoke execute on function public.acquire_session_hold(uuid, uuid, timestamptz, timestamptz, uuid, integer, uuid) from public;
revoke execute on function public.acquire_session_hold(uuid, uuid, timestamptz, timestamptz, uuid, integer, uuid) from anon;
revoke execute on function public.acquire_session_hold(uuid, uuid, timestamptz, timestamptz, uuid, integer, uuid) from authenticated;
grant execute on function public.acquire_session_hold(uuid, uuid, timestamptz, timestamptz, uuid, integer, uuid) to service_role;

revoke execute on function public.confirm_session_hold(uuid, jsonb) from public;
revoke execute on function public.confirm_session_hold(uuid, jsonb) from anon;
revoke execute on function public.confirm_session_hold(uuid, jsonb) from authenticated;
grant execute on function public.confirm_session_hold(uuid, jsonb) to service_role;

revoke execute on function public.confirm_session_hold(uuid, jsonb, uuid) from public;
revoke execute on function public.confirm_session_hold(uuid, jsonb, uuid) from anon;
revoke execute on function public.confirm_session_hold(uuid, jsonb, uuid) from authenticated;
revoke execute on function public.confirm_session_hold(uuid, jsonb, uuid) from service_role;

do $$
declare
  v_disallowed_count integer;
begin
  select count(*)
  into v_disallowed_count
  from information_schema.routine_privileges rp
  where rp.specific_schema = 'public'
    and rp.routine_name = 'acquire_session_hold'
    and rp.grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
    and rp.privilege_type = 'EXECUTE'
    and rp.specific_name like 'acquire_session_hold\_%'
    and rp.specific_name in (
      select specific_name
      from information_schema.parameters
      where specific_schema = 'public'
      group by specific_name
      having count(*) = 6
    );

  if v_disallowed_count > 0 then
    raise exception 'Legacy acquire_session_hold overload is still executable by API roles.';
  end if;

  if not has_function_privilege('service_role', 'public.acquire_session_hold(uuid, uuid, timestamp with time zone, timestamp with time zone, uuid, integer, uuid)', 'EXECUTE') then
    raise exception 'service_role must retain EXECUTE on actor-validated acquire_session_hold overload.';
  end if;

  if not has_function_privilege('service_role', 'public.confirm_session_hold(uuid, jsonb)', 'EXECUTE') then
    raise exception 'service_role must retain EXECUTE on confirm_session_hold(uuid, jsonb).';
  end if;
end
$$;

-- Workstream B: normalize existing statuses before constraints.
update public.sessions
set status = lower(trim(coalesce(status, 'scheduled')))
where status is null or status <> lower(trim(status));

update public.sessions
set status = 'scheduled'
where status not in ('scheduled', 'completed', 'cancelled', 'no-show');

update public.authorizations
set status = lower(trim(coalesce(status, 'pending')))
where status is null or status <> lower(trim(status));

update public.authorizations
set status = 'pending'
where status not in ('pending', 'approved', 'denied', 'expired');

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sessions_status_check'
      and conrelid = 'public.sessions'::regclass
  ) then
    alter table public.sessions
      add constraint sessions_status_check
      check (status in ('scheduled', 'completed', 'cancelled', 'no-show'));
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'authorizations_status_check'
      and conrelid = 'public.authorizations'::regclass
  ) then
    alter table public.authorizations
      add constraint authorizations_status_check
      check (status in ('pending', 'approved', 'denied', 'expired'));
  end if;
end
$$;

-- Workstream B: enforce valid lifecycle transitions.
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

  if old.status = 'scheduled' and new.status in ('completed', 'cancelled', 'no-show') then
    return new;
  end if;

  raise exception 'Invalid sessions.status transition from % to %', old.status, new.status
    using errcode = '23514';
end;
$$;

drop trigger if exists sessions_status_transition_guard on public.sessions;
create trigger sessions_status_transition_guard
before update of status on public.sessions
for each row
execute function public.enforce_session_status_transition();

create or replace function public.enforce_authorization_status_transition()
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

  if old.status = 'pending' and new.status in ('approved', 'denied', 'expired') then
    return new;
  end if;

  if old.status = 'approved' and new.status = 'expired' then
    return new;
  end if;

  raise exception 'Invalid authorizations.status transition from % to %', old.status, new.status
    using errcode = '23514';
end;
$$;

drop trigger if exists authorizations_status_transition_guard on public.authorizations;
create trigger authorizations_status_transition_guard
before update of status on public.authorizations
for each row
execute function public.enforce_authorization_status_transition();
