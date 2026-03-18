-- @migration-intent: Add async session-notes PDF export job state, storage bucket controls, and org-scoped access policies for deterministic export lifecycle handling.
-- @migration-dependencies: 20251203123000_client_session_notes.sql,20260313123000_profiles_org_immutability_guard.sql
-- @migration-rollback: Drop session_note_pdf_exports table/policies/indexes, remove session-note-exports storage policies, and remove the session-note-exports bucket if rollback is required.

begin;

set local search_path = public;

create table if not exists public.session_note_pdf_exports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  requested_by uuid not null,
  note_ids uuid[] not null,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'ready', 'failed', 'expired')),
  error text,
  storage_bucket text not null default 'session-note-exports',
  storage_path text,
  request_id text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  started_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz,
  constraint session_note_pdf_exports_note_ids_not_empty check (coalesce(array_length(note_ids, 1), 0) > 0),
  constraint session_note_pdf_exports_storage_bucket_not_blank check (length(trim(storage_bucket)) > 0)
);

create index if not exists session_note_pdf_exports_org_created_idx
  on public.session_note_pdf_exports (organization_id, created_at desc);

create index if not exists session_note_pdf_exports_status_created_idx
  on public.session_note_pdf_exports (status, created_at);

create index if not exists session_note_pdf_exports_requester_created_idx
  on public.session_note_pdf_exports (requested_by, created_at desc);

create index if not exists session_note_pdf_exports_client_created_idx
  on public.session_note_pdf_exports (client_id, created_at desc);

drop trigger if exists session_note_pdf_exports_set_updated_at on public.session_note_pdf_exports;
create trigger session_note_pdf_exports_set_updated_at
  before update on public.session_note_pdf_exports
  for each row
  execute function public.set_updated_at();

alter table public.session_note_pdf_exports enable row level security;

drop policy if exists session_note_pdf_exports_service_role_all on public.session_note_pdf_exports;
create policy session_note_pdf_exports_service_role_all
  on public.session_note_pdf_exports
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists session_note_pdf_exports_org_select on public.session_note_pdf_exports;
create policy session_note_pdf_exports_org_select
  on public.session_note_pdf_exports
  for select
  to authenticated
  using (
    organization_id = app.current_user_organization_id()
    and (
      requested_by = auth.uid()
      or app.user_has_role_for_org('admin', organization_id)
      or app.user_has_role_for_org('super_admin', organization_id)
    )
  );

drop policy if exists session_note_pdf_exports_org_insert on public.session_note_pdf_exports;
create policy session_note_pdf_exports_org_insert
  on public.session_note_pdf_exports
  for insert
  to authenticated
  with check (
    organization_id = app.current_user_organization_id()
    and requested_by = auth.uid()
    and (
      app.user_has_role_for_org('therapist', organization_id)
      or app.user_has_role_for_org('admin', organization_id)
      or app.user_has_role_for_org('super_admin', organization_id)
    )
  );

insert into storage.buckets (id, name, public)
values ('session-note-exports', 'session-note-exports', false)
on conflict (id) do nothing;

do $$
begin
  begin
    execute 'alter table storage.objects enable row level security';
  exception
    when insufficient_privilege then
      raise notice 'insufficient privileges to alter storage.objects';
  end;
end $$;

drop policy if exists storage_session_note_exports_service_manage on storage.objects;
create policy storage_session_note_exports_service_manage
  on storage.objects
  for all
  to service_role
  using (bucket_id = 'session-note-exports')
  with check (bucket_id = 'session-note-exports');

drop policy if exists storage_session_note_exports_select_scoped on storage.objects;
create policy storage_session_note_exports_select_scoped
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'session-note-exports'
    and exists (
      select 1
      from public.session_note_pdf_exports exports
      where exports.storage_path = storage.objects.name
        and exports.storage_bucket = storage.objects.bucket_id
        and exports.status = 'ready'
        and exports.organization_id = app.current_user_organization_id()
        and (
          exports.requested_by = auth.uid()
          or app.user_has_role_for_org('admin', exports.organization_id)
          or app.user_has_role_for_org('super_admin', exports.organization_id)
        )
    )
  );

commit;
