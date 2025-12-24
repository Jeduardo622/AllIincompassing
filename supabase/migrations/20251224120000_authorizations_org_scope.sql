/*
  # Authorization org scoping and RLS refresh

  1) Add organization and creator metadata to authorizations/authorization_services.
  2) Backfill from existing client + authorization data.
  3) Replace policies with org-scoped access aligned to app.current_user_organization_id().
*/

begin;

-- Add org + creator columns to authorizations
alter table public.authorizations
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists documents jsonb default '[]'::jsonb;

-- Backfill org/creator for existing rows
update public.authorizations a
set
  organization_id = c.organization_id,
  created_by = coalesce(created_by, a.provider_id)
from public.clients c
where a.client_id = c.id
  and (a.organization_id is null or a.created_by is null);

-- Enforce not null
alter table public.authorizations
  alter column organization_id set not null,
  alter column created_by set not null;

create index if not exists authorizations_org_client_idx
  on public.authorizations (organization_id, client_id);

-- Add org + creator columns to authorization_services
alter table public.authorization_services
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists created_by uuid references auth.users(id);

-- Backfill from parent authorization
update public.authorization_services s
set
  organization_id = a.organization_id,
  created_by = coalesce(created_by, a.created_by)
from public.authorizations a
where s.authorization_id = a.id
  and (s.organization_id is null or s.created_by is null);

alter table public.authorization_services
  alter column organization_id set not null,
  alter column created_by set not null;

create index if not exists authorization_services_org_auth_idx
  on public.authorization_services (organization_id, authorization_id);

-- RLS refresh: authorizations
alter table public.authorizations enable row level security;

drop policy if exists "Authorizations are viewable by admin and assigned therapist" on public.authorizations;
drop policy if exists "Allow inserts for admins and assigned therapists" on public.authorizations;
drop policy if exists "Allow updates for admins and assigned therapists" on public.authorizations;
drop policy if exists "Allow deletes for admins and assigned therapists" on public.authorizations;

create policy authorizations_org_read
  on public.authorizations
  for select
  to authenticated
  using (
    organization_id = app.current_user_organization_id()
    and (
      app.user_has_role_for_org(app.current_user_id(), organization_id, array['org_admin','org_member'])
      or provider_id = app.current_user_id()
    )
  );

create policy authorizations_org_write
  on public.authorizations
  for all
  to authenticated
  using (
    organization_id = app.current_user_organization_id()
    and (
      app.user_has_role_for_org(app.current_user_id(), organization_id, array['org_admin'])
      or provider_id = app.current_user_id()
    )
  )
  with check (
    organization_id = app.current_user_organization_id()
    and (
      app.user_has_role_for_org(app.current_user_id(), organization_id, array['org_admin'])
      or provider_id = app.current_user_id()
    )
  );

create policy authorizations_service_role_all
  on public.authorizations
  for all
  to service_role
  using (true)
  with check (true);

-- RLS refresh: authorization_services
alter table public.authorization_services enable row level security;

drop policy if exists "Authorization services are viewable by admin and assigned therapist" on public.authorization_services;
drop policy if exists "Allow inserts for authorization services" on public.authorization_services;
drop policy if exists "Allow updates for authorization services" on public.authorization_services;
drop policy if exists "Allow deletes for authorization services" on public.authorization_services;

create policy authorization_services_org_read
  on public.authorization_services
  for select
  to authenticated
  using (
    organization_id = app.current_user_organization_id()
    and exists (
      select 1 from public.authorizations a
      where a.id = authorization_id
        and a.organization_id = organization_id
        and (
          app.user_has_role_for_org(app.current_user_id(), organization_id, array['org_admin','org_member'])
          or a.provider_id = app.current_user_id()
        )
    )
  );

create policy authorization_services_org_write
  on public.authorization_services
  for all
  to authenticated
  using (
    organization_id = app.current_user_organization_id()
    and exists (
      select 1 from public.authorizations a
      where a.id = authorization_id
        and a.organization_id = organization_id
        and (
          app.user_has_role_for_org(app.current_user_id(), organization_id, array['org_admin'])
          or a.provider_id = app.current_user_id()
        )
    )
  )
  with check (
    organization_id = app.current_user_organization_id()
    and exists (
      select 1 from public.authorizations a
      where a.id = authorization_id
        and a.organization_id = organization_id
        and (
          app.user_has_role_for_org(app.current_user_id(), organization_id, array['org_admin'])
          or a.provider_id = app.current_user_id()
        )
    )
  );

create policy authorization_services_service_role_all
  on public.authorization_services
  for all
  to service_role
  using (true)
  with check (true);

commit;

