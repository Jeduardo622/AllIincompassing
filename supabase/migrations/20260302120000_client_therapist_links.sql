begin;

set search_path = public, app, auth;

create table if not exists public.client_therapist_links (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  therapist_id uuid not null references public.therapists(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  created_by uuid references auth.users(id) on delete set null,
  unique (client_id, therapist_id)
);

create index if not exists client_therapist_links_client_idx
  on public.client_therapist_links (client_id);

create index if not exists client_therapist_links_therapist_idx
  on public.client_therapist_links (therapist_id);

create index if not exists client_therapist_links_org_client_idx
  on public.client_therapist_links (organization_id, client_id);

create index if not exists client_therapist_links_org_therapist_idx
  on public.client_therapist_links (organization_id, therapist_id);

create or replace function app.set_client_therapist_link_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_client_org uuid;
begin
  if new.client_id is null or new.therapist_id is null then
    raise exception 'client_id and therapist_id are required';
  end if;

  select c.organization_id
    into v_client_org
    from public.clients c
   where c.id = new.client_id;

  if v_client_org is null then
    raise exception 'client % not found', new.client_id;
  end if;

  if new.organization_id is null then
    new.organization_id := v_client_org;
  end if;

  if new.organization_id is distinct from v_client_org then
    raise exception 'client and link must belong to the same organization';
  end if;

  if new.created_by is null then
    new.created_by := auth.uid();
  end if;

  if new.created_at is null then
    new.created_at := timezone('utc', now());
  end if;

  return new;
end;
$$;

drop trigger if exists client_therapist_links_set_defaults on public.client_therapist_links;
create trigger client_therapist_links_set_defaults
before insert or update on public.client_therapist_links
for each row
execute function app.set_client_therapist_link_defaults();

insert into public.client_therapist_links (client_id, therapist_id, organization_id)
select c.id, c.therapist_id, c.organization_id
from public.clients c
where c.therapist_id is not null
on conflict (client_id, therapist_id) do nothing;

alter table public.client_therapist_links enable row level security;

drop policy if exists client_therapist_links_select_scope on public.client_therapist_links;
create policy client_therapist_links_select_scope
  on public.client_therapist_links
  for select
  to authenticated
  using (
    app.is_admin()
    or (
      organization_id = app.current_user_organization_id()
      and (
        therapist_id = app.current_therapist_id()
        or app.can_access_client(client_id)
      )
    )
  );

drop policy if exists client_therapist_links_manage_scope on public.client_therapist_links;
create policy client_therapist_links_manage_scope
  on public.client_therapist_links
  for all
  to authenticated
  using (
    app.is_admin()
    and organization_id = app.current_user_organization_id()
  )
  with check (
    app.is_admin()
    and organization_id = app.current_user_organization_id()
  );

grant select, insert, update, delete on public.client_therapist_links to authenticated;

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

  if exists (
    select 1
      from public.client_therapist_links ctl
     where ctl.client_id = p_client_id
       and ctl.therapist_id = app.current_therapist_id()
       and ctl.organization_id = app.current_user_organization_id()
  ) then
    return true;
  end if;

  return false;
end;
$$;

grant execute on function app.can_access_client(uuid) to authenticated;

commit;
