begin;

set local search_path = public;

create table if not exists public.assessment_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  uploaded_by uuid,
  template_type text not null default 'caloptima_fba',
  file_name text not null,
  mime_type text not null,
  file_size bigint not null default 0 check (file_size >= 0),
  bucket_id text not null default 'client-documents',
  object_path text not null,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'extracted', 'drafted', 'approved', 'rejected')),
  approved_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists assessment_documents_bucket_path_uidx
  on public.assessment_documents (bucket_id, object_path);

create index if not exists assessment_documents_org_client_idx
  on public.assessment_documents (organization_id, client_id, created_at desc);

create table if not exists public.assessment_extractions (
  id uuid primary key default gen_random_uuid(),
  assessment_document_id uuid not null references public.assessment_documents(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  section_key text not null,
  field_key text not null,
  label text not null,
  mode text not null check (mode in ('AUTO', 'ASSISTED', 'MANUAL')),
  required boolean not null default true,
  value_text text,
  value_json jsonb,
  confidence numeric(5,4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  source_span jsonb,
  status text not null default 'not_started'
    check (status in ('not_started', 'drafted', 'verified', 'approved')),
  review_notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists assessment_extractions_document_field_uidx
  on public.assessment_extractions (assessment_document_id, field_key);

create table if not exists public.assessment_checklist_items (
  id uuid primary key default gen_random_uuid(),
  assessment_document_id uuid not null references public.assessment_documents(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  section_key text not null,
  label text not null,
  placeholder_key text not null,
  mode text not null check (mode in ('AUTO', 'ASSISTED', 'MANUAL')),
  source text not null default 'N/A',
  required boolean not null default true,
  extraction_method text not null default 'manual',
  validation_rule text not null default 'non_empty',
  status text not null default 'not_started'
    check (status in ('not_started', 'drafted', 'verified', 'approved')),
  extraction_owner text,
  review_owner text,
  review_notes text,
  value_text text,
  value_json jsonb,
  last_reviewed_by uuid,
  last_reviewed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists assessment_checklist_document_placeholder_uidx
  on public.assessment_checklist_items (assessment_document_id, placeholder_key);

create table if not exists public.assessment_draft_programs (
  id uuid primary key default gen_random_uuid(),
  assessment_document_id uuid not null references public.assessment_documents(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  description text,
  rationale text,
  accept_state text not null default 'pending'
    check (accept_state in ('pending', 'accepted', 'rejected', 'edited')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.assessment_draft_goals (
  id uuid primary key default gen_random_uuid(),
  assessment_document_id uuid not null references public.assessment_documents(id) on delete cascade,
  draft_program_id uuid references public.assessment_draft_programs(id) on delete set null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  title text not null,
  description text not null,
  original_text text not null,
  target_behavior text,
  measurement_type text,
  baseline_data text,
  target_criteria text,
  accept_state text not null default 'pending'
    check (accept_state in ('pending', 'accepted', 'rejected', 'edited')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.assessment_review_events (
  id uuid primary key default gen_random_uuid(),
  assessment_document_id uuid not null references public.assessment_documents(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  item_type text not null check (item_type in ('document', 'checklist_item', 'draft_program', 'draft_goal')),
  item_id uuid,
  action text not null,
  from_status text,
  to_status text,
  notes text,
  event_payload jsonb not null default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.assessment_documents enable row level security;
alter table public.assessment_extractions enable row level security;
alter table public.assessment_checklist_items enable row level security;
alter table public.assessment_draft_programs enable row level security;
alter table public.assessment_draft_goals enable row level security;
alter table public.assessment_review_events enable row level security;

drop policy if exists assessment_documents_org_manage on public.assessment_documents;
create policy assessment_documents_org_manage
  on public.assessment_documents
  for all
  to authenticated
  using (
    organization_id = app.current_user_organization_id()
    and (
      app.user_has_role_for_org('therapist', organization_id)
      or app.user_has_role_for_org('admin', organization_id)
      or app.user_has_role_for_org('super_admin', organization_id)
    )
  )
  with check (
    organization_id = app.current_user_organization_id()
    and (
      app.user_has_role_for_org('therapist', organization_id)
      or app.user_has_role_for_org('admin', organization_id)
      or app.user_has_role_for_org('super_admin', organization_id)
    )
  );

drop policy if exists assessment_extractions_org_manage on public.assessment_extractions;
create policy assessment_extractions_org_manage
  on public.assessment_extractions
  for all
  to authenticated
  using (organization_id = app.current_user_organization_id())
  with check (organization_id = app.current_user_organization_id());

drop policy if exists assessment_checklist_items_org_manage on public.assessment_checklist_items;
create policy assessment_checklist_items_org_manage
  on public.assessment_checklist_items
  for all
  to authenticated
  using (organization_id = app.current_user_organization_id())
  with check (organization_id = app.current_user_organization_id());

drop policy if exists assessment_draft_programs_org_manage on public.assessment_draft_programs;
create policy assessment_draft_programs_org_manage
  on public.assessment_draft_programs
  for all
  to authenticated
  using (organization_id = app.current_user_organization_id())
  with check (organization_id = app.current_user_organization_id());

drop policy if exists assessment_draft_goals_org_manage on public.assessment_draft_goals;
create policy assessment_draft_goals_org_manage
  on public.assessment_draft_goals
  for all
  to authenticated
  using (organization_id = app.current_user_organization_id())
  with check (organization_id = app.current_user_organization_id());

drop policy if exists assessment_review_events_org_select on public.assessment_review_events;
create policy assessment_review_events_org_select
  on public.assessment_review_events
  for select
  to authenticated
  using (organization_id = app.current_user_organization_id());

drop policy if exists assessment_review_events_org_insert on public.assessment_review_events;
create policy assessment_review_events_org_insert
  on public.assessment_review_events
  for insert
  to authenticated
  with check (organization_id = app.current_user_organization_id());

create or replace function public.can_access_client_documents(client_id uuid)
returns boolean
language plpgsql
security definer
set search_path = 'public', 'auth'
as $function$
declare
  v_requestor uuid := auth.uid();
  v_client uuid := client_id;
begin
  if v_requestor is null then
    return false;
  end if;

  return
    app_auth.user_has_role('super_admin')
    or app_auth.user_has_role('admin')
    or exists (
      select 1
      from public.clients c
      where c.id = v_client
        and c.therapist_id = v_requestor
        and c.deleted_at is null
    )
    or exists (
      select 1
      from public.sessions s
      where s.client_id = v_client
        and s.therapist_id = v_requestor
    )
    or exists (
      select 1
      from public.client_guardians cg
      where cg.client_id = v_client
        and cg.guardian_id = v_requestor
        and cg.deleted_at is null
    );
end;
$function$;

grant execute on function public.can_access_client_documents(uuid) to authenticated;

commit;
