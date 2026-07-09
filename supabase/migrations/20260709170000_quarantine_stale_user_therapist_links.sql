-- @migration-intent: Quarantine and remove objectively stale user_therapist_links rows without hardcoded production IDs.
-- @migration-dependencies: public.user_therapist_links, public.therapists, public.user_roles, public.roles, app.resolve_user_organization_id
-- @migration-rollback: Reinsert rows from public.user_therapist_links_quarantine where quarantine_batch = '20260709170000_quarantine_stale_user_therapist_links' if a reviewed restore is required.

begin;

create table if not exists public.user_therapist_links_quarantine (
  id uuid primary key default gen_random_uuid(),
  quarantine_batch text not null,
  quarantined_at timestamptz not null default now(),
  link_id uuid not null,
  user_id uuid not null,
  therapist_id uuid not null,
  link_created_at timestamptz not null,
  reason text not null,
  user_organization_id uuid,
  therapist_organization_id uuid,
  therapist_status text,
  therapist_deleted_at timestamptz,
  had_supported_active_role boolean not null,
  unique (quarantine_batch, link_id)
);

alter table public.user_therapist_links_quarantine enable row level security;
alter table public.user_therapist_links_quarantine force row level security;

drop policy if exists user_therapist_links_quarantine_service_role_all
  on public.user_therapist_links_quarantine;
drop policy if exists user_therapist_links_quarantine_service_role_select
  on public.user_therapist_links_quarantine;
create policy user_therapist_links_quarantine_service_role_select
  on public.user_therapist_links_quarantine
  for select
  to service_role
  using (true);

revoke all on table public.user_therapist_links_quarantine from public;
revoke all on table public.user_therapist_links_quarantine from anon;
revoke all on table public.user_therapist_links_quarantine from authenticated;
revoke all on table public.user_therapist_links_quarantine from service_role;
grant select on table public.user_therapist_links_quarantine to service_role;

with stale_links as (
  select
    evaluated.*,
    evaluated.user_organization_id is null
      or evaluated.therapist_organization_id is null
      or evaluated.user_organization_id is distinct from evaluated.therapist_organization_id
      or lower(coalesce(evaluated.therapist_status, 'active')) <> 'active'
      or evaluated.therapist_deleted_at is not null
      or not evaluated.had_supported_active_role as is_stale
  from (
    select
      utl.id as link_id,
      utl.user_id,
      utl.therapist_id,
      utl.created_at as link_created_at,
      app.resolve_user_organization_id(utl.user_id) as user_organization_id,
      t.organization_id as therapist_organization_id,
      t.status as therapist_status,
      t.deleted_at as therapist_deleted_at,
      exists (
        select 1
        from public.user_roles ur
        join public.roles r on r.id = ur.role_id
        where ur.user_id = utl.user_id
          and coalesce(ur.is_active, true) = true
          and (ur.expires_at is null or ur.expires_at > now())
          and r.name in (
            'therapist',
            'bt',
            'midtier',
            'admin_schedule',
            'admin',
            'bcba',
            'super_admin',
            'org_admin',
            'org_super_admin'
          )
      ) as had_supported_active_role
    from public.user_therapist_links utl
    left join public.therapists t on t.id = utl.therapist_id
  ) evaluated
), quarantined as (
  insert into public.user_therapist_links_quarantine (
    quarantine_batch,
    link_id,
    user_id,
    therapist_id,
    link_created_at,
    reason,
    user_organization_id,
    therapist_organization_id,
    therapist_status,
    therapist_deleted_at,
    had_supported_active_role
  )
  select
    '20260709170000_quarantine_stale_user_therapist_links',
    link_id,
    user_id,
    therapist_id,
    link_created_at,
    concat_ws(
      ';',
      case when user_organization_id is null then 'missing_user_organization' end,
      case when therapist_organization_id is null then 'missing_therapist' end,
      case
        when user_organization_id is not null
          and therapist_organization_id is not null
          and user_organization_id is distinct from therapist_organization_id
        then 'organization_mismatch'
      end,
      case when lower(coalesce(therapist_status, 'active')) <> 'active' then 'inactive_therapist' end,
      case when therapist_deleted_at is not null then 'deleted_therapist' end,
      case when not had_supported_active_role then 'missing_supported_active_role' end
    ) as reason,
    user_organization_id,
    therapist_organization_id,
    therapist_status,
    therapist_deleted_at,
    had_supported_active_role
  from stale_links
  where is_stale
  on conflict (quarantine_batch, link_id) do nothing
  returning link_id
), quarantined_links as (
  select link_id from quarantined
  union
  select q.link_id
  from public.user_therapist_links_quarantine q
  join stale_links sl on sl.link_id = q.link_id
  where q.quarantine_batch = '20260709170000_quarantine_stale_user_therapist_links'
    and sl.is_stale
)
delete from public.user_therapist_links utl
using quarantined_links q
where utl.id = q.link_id;

notify pgrst, 'reload schema';

commit;
