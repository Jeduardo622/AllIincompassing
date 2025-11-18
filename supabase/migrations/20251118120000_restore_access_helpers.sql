begin;

set search_path = public, app, auth;

drop function if exists app.current_therapist_id() cascade;

create or replace function app.current_therapist_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_user constant uuid := auth.uid();
  v_therapist uuid;
begin
  if v_user is null then
    return null;
  end if;

  select ut.therapist_id
    into v_therapist
    from user_therapist_links ut
   where ut.user_id = v_user
   order by ut.created_at desc
   limit 1;

  if v_therapist is not null then
    return v_therapist;
  end if;

  select t.id
    into v_therapist
    from public.therapists t
   where t.id = v_user;

  return v_therapist;
end;
$$;

grant execute on function app.current_therapist_id() to authenticated;

drop function if exists app.can_access_session(uuid) cascade;

create or replace function app.can_access_session(p_session_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_user constant uuid := auth.uid();
begin
  if v_user is null or p_session_id is null then
    return false;
  end if;

  if app.is_admin() then
    return true;
  end if;

  if exists (
    select 1
      from public.sessions s
     where s.id = p_session_id
       and s.therapist_id = app.current_therapist_id()
  ) then
    return true;
  end if;

  if exists (
    select 1
      from public.sessions s
     where s.id = p_session_id
       and s.client_id = v_user
  ) then
    return true;
  end if;

  if exists (
    select 1
      from public.sessions s
      join public.client_guardians cg on cg.client_id = s.client_id
     where s.id = p_session_id
       and cg.guardian_id = v_user
       and cg.deleted_at is null
  ) then
    return true;
  end if;

  return false;
end;
$$;

grant execute on function app.can_access_session(uuid) to authenticated;

drop function if exists app.can_access_client(uuid) cascade;

create or replace function app.can_access_client(p_client_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_user constant uuid := auth.uid();
begin
  if v_user is null or p_client_id is null then
    return false;
  end if;

  if app.is_admin() then
    return true;
  end if;

  if v_user = p_client_id then
    return true;
  end if;

  if exists (
    select 1
      from public.client_guardians cg
     where cg.client_id = p_client_id
       and cg.guardian_id = v_user
       and cg.deleted_at is null
  ) then
    return true;
  end if;

  if exists (
    select 1
      from public.sessions s
     where s.client_id = p_client_id
       and s.therapist_id = app.current_therapist_id()
  ) then
    return true;
  end if;

  if exists (
    select 1
      from public.clients c
     where c.id = p_client_id
       and c.therapist_id = app.current_therapist_id()
  ) then
    return true;
  end if;

  return false;
end;
$$;

grant execute on function app.can_access_client(uuid) to authenticated;

-- Therapist assignment columns
alter table public.clients
  add column if not exists therapist_id uuid references public.therapists(id),
  add column if not exists therapist_assigned_at timestamptz;

create index if not exists clients_therapist_id_idx
  on public.clients (therapist_id);

create or replace function app.set_client_therapist_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.therapist_id is not null and
     (old.therapist_id is distinct from new.therapist_id) then
    new.therapist_assigned_at := timezone('utc', now());
  end if;
  return new;
end;
$$;

drop trigger if exists set_client_therapist_assignment on public.clients;
create trigger set_client_therapist_assignment
  before insert or update on public.clients
  for each row
  execute function app.set_client_therapist_assignment();

commit;

