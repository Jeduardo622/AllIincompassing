set search_path = public;

create table if not exists public.client_issues (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  category text,
  description text,
  status text,
  priority text,
  date_opened timestamptz not null default timezone('utc', now()),
  last_action timestamptz not null default timezone('utc', now()),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists client_issues_client_idx on public.client_issues (client_id);
create index if not exists client_issues_org_idx on public.client_issues (organization_id);
create index if not exists client_issues_created_idx on public.client_issues (created_at desc);

create schema if not exists app;

create or replace function app.set_client_issue_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_org uuid;
begin
  if new.client_id is null then
    raise exception 'client_id is required for client issues';
  end if;

  select organization_id
    into v_org
    from public.clients
   where id = new.client_id;

  new.organization_id := coalesce(new.organization_id, v_org, app.current_user_organization_id());

  if new.created_by is null then
    new.created_by := auth.uid();
  end if;

  if tg_op = 'INSERT' and new.date_opened is null then
    new.date_opened := timezone('utc', now());
  end if;

  if new.last_action is null then
    new.last_action := timezone('utc', now());
  end if;

  if tg_op = 'INSERT' and new.created_at is null then
    new.created_at := timezone('utc', now());
  end if;

  new.updated_at := timezone('utc', now());

  return new;
end;
$$;

drop trigger if exists client_issues_set_defaults on public.client_issues;
create trigger client_issues_set_defaults
before insert or update on public.client_issues
for each row
execute function app.set_client_issue_defaults();

alter table public.client_issues enable row level security;

drop policy if exists client_issues_read_access on public.client_issues;
create policy client_issues_read_access
  on public.client_issues
  for select
  to authenticated
  using (app.can_access_client(client_id));

drop policy if exists client_issues_manage on public.client_issues;
create policy client_issues_manage
  on public.client_issues
  for all
  to authenticated
  using (app.is_admin())
  with check (app.is_admin());

grant select, insert, update, delete on table public.client_issues to authenticated;

