-- @migration-intent: Add tenant-scoped structured CalOptima FBA assessment section storage for full mapping review.
-- @migration-dependencies: 20260212120000_caloptima_assessment_staging.sql
-- @migration-rollback: Drop public.assessment_structured_sections and its policies/grants if structured section mapping is reverted.

begin;

set local search_path = public;

create table if not exists public.assessment_structured_sections (
  id uuid primary key default gen_random_uuid(),
  assessment_document_id uuid not null references public.assessment_documents(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  section_key text not null,
  field_key text not null,
  section_index integer not null default 0 check (section_index >= 0),
  payload jsonb not null default '{}'::jsonb,
  source_span jsonb,
  status text not null default 'not_started'
    check (status in ('not_started', 'drafted', 'verified', 'approved', 'rejected')),
  required boolean not null default true,
  review_notes text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint assessment_structured_sections_section_not_blank check (length(trim(section_key)) > 0),
  constraint assessment_structured_sections_field_not_blank check (length(trim(field_key)) > 0)
);

create index if not exists assessment_structured_sections_org_client_doc_idx
  on public.assessment_structured_sections (organization_id, client_id, assessment_document_id);

create index if not exists assessment_structured_sections_document_field_idx
  on public.assessment_structured_sections (
    assessment_document_id,
    section_key,
    field_key,
    section_index
  );

alter table public.assessment_review_events
  drop constraint if exists assessment_review_events_item_type_check;

alter table public.assessment_review_events
  add constraint assessment_review_events_item_type_check
  check (item_type in ('document', 'checklist_item', 'structured_section', 'draft_program', 'draft_goal'));

alter table public.assessment_structured_sections enable row level security;

drop policy if exists assessment_structured_sections_service_role_all
  on public.assessment_structured_sections;
create policy assessment_structured_sections_service_role_all
  on public.assessment_structured_sections
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists assessment_structured_sections_org_select
  on public.assessment_structured_sections;
drop policy if exists assessment_structured_sections_org_manage
  on public.assessment_structured_sections;
create policy assessment_structured_sections_org_select
  on public.assessment_structured_sections
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

grant select on table public.assessment_structured_sections to authenticated;
grant all on table public.assessment_structured_sections to service_role;

commit;
