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
  extraction_started_at timestamptz,
  extraction_completed_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint assessment_documents_file_name_not_blank check (length(trim(file_name)) > 0),
  constraint assessment_documents_mime_type_not_blank check (length(trim(mime_type)) > 0),
  constraint assessment_documents_bucket_not_blank check (length(trim(bucket_id)) > 0),
  constraint assessment_documents_object_path_not_blank check (length(trim(object_path)) > 0)
);

create unique index if not exists assessment_documents_bucket_path_uidx
  on public.assessment_documents (bucket_id, object_path);

create index if not exists assessment_documents_org_client_idx
  on public.assessment_documents (organization_id, client_id, created_at desc);

create index if not exists assessment_documents_org_status_idx
  on public.assessment_documents (organization_id, status, created_at desc);

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
  confidence numeric(5, 4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  source_span jsonb,
  status text not null default 'not_started'
    check (status in ('not_started', 'drafted', 'verified', 'approved')),
  review_notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint assessment_extractions_section_not_blank check (length(trim(section_key)) > 0),
  constraint assessment_extractions_field_not_blank check (length(trim(field_key)) > 0),
  constraint assessment_extractions_label_not_blank check (length(trim(label)) > 0)
);

create unique index if not exists assessment_extractions_document_field_uidx
  on public.assessment_extractions (assessment_document_id, field_key);

create index if not exists assessment_extractions_document_idx
  on public.assessment_extractions (assessment_document_id, section_key);

create index if not exists assessment_extractions_org_client_idx
  on public.assessment_extractions (organization_id, client_id, created_at desc);

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
  extraction_method text not null,
  validation_rule text not null,
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
  updated_at timestamptz not null default timezone('utc', now()),
  constraint assessment_checklist_items_section_not_blank check (length(trim(section_key)) > 0),
  constraint assessment_checklist_items_label_not_blank check (length(trim(label)) > 0),
  constraint assessment_checklist_items_placeholder_not_blank check (length(trim(placeholder_key)) > 0),
  constraint assessment_checklist_items_method_not_blank check (length(trim(extraction_method)) > 0),
  constraint assessment_checklist_items_validation_not_blank check (length(trim(validation_rule)) > 0)
);

create unique index if not exists assessment_checklist_document_placeholder_uidx
  on public.assessment_checklist_items (assessment_document_id, placeholder_key);

create index if not exists assessment_checklist_document_section_idx
  on public.assessment_checklist_items (assessment_document_id, section_key, status);

create index if not exists assessment_checklist_org_client_idx
  on public.assessment_checklist_items (organization_id, client_id, created_at desc);

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
  updated_at timestamptz not null default timezone('utc', now()),
  constraint assessment_draft_programs_name_not_blank check (length(trim(name)) > 0)
);

create index if not exists assessment_draft_programs_document_idx
  on public.assessment_draft_programs (assessment_document_id, accept_state);

create index if not exists assessment_draft_programs_org_client_idx
  on public.assessment_draft_programs (organization_id, client_id, created_at desc);

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
  updated_at timestamptz not null default timezone('utc', now()),
  constraint assessment_draft_goals_title_not_blank check (length(trim(title)) > 0),
  constraint assessment_draft_goals_description_not_blank check (length(trim(description)) > 0),
  constraint assessment_draft_goals_original_not_blank check (length(trim(original_text)) > 0)
);

create index if not exists assessment_draft_goals_document_idx
  on public.assessment_draft_goals (assessment_document_id, accept_state);

create index if not exists assessment_draft_goals_program_idx
  on public.assessment_draft_goals (draft_program_id, accept_state);

create index if not exists assessment_draft_goals_org_client_idx
  on public.assessment_draft_goals (organization_id, client_id, created_at desc);

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
  created_at timestamptz not null default timezone('utc', now()),
  constraint assessment_review_events_action_not_blank check (length(trim(action)) > 0)
);

create index if not exists assessment_review_events_document_idx
  on public.assessment_review_events (assessment_document_id, created_at desc);

create index if not exists assessment_review_events_org_client_idx
  on public.assessment_review_events (organization_id, client_id, created_at desc);

alter table public.assessment_documents enable row level security;
alter table public.assessment_extractions enable row level security;
alter table public.assessment_checklist_items enable row level security;
alter table public.assessment_draft_programs enable row level security;
alter table public.assessment_draft_goals enable row level security;
alter table public.assessment_review_events enable row level security;

drop policy if exists assessment_documents_service_role_all on public.assessment_documents;
create policy assessment_documents_service_role_all
  on public.assessment_documents
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists assessment_extractions_service_role_all on public.assessment_extractions;
create policy assessment_extractions_service_role_all
  on public.assessment_extractions
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists assessment_checklist_items_service_role_all on public.assessment_checklist_items;
create policy assessment_checklist_items_service_role_all
  on public.assessment_checklist_items
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists assessment_draft_programs_service_role_all on public.assessment_draft_programs;
create policy assessment_draft_programs_service_role_all
  on public.assessment_draft_programs
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists assessment_draft_goals_service_role_all on public.assessment_draft_goals;
create policy assessment_draft_goals_service_role_all
  on public.assessment_draft_goals
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists assessment_review_events_service_role_all on public.assessment_review_events;
create policy assessment_review_events_service_role_all
  on public.assessment_review_events
  for all
  to service_role
  using (true)
  with check (true);

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

drop policy if exists assessment_checklist_items_org_manage on public.assessment_checklist_items;
create policy assessment_checklist_items_org_manage
  on public.assessment_checklist_items
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

drop policy if exists assessment_draft_programs_org_manage on public.assessment_draft_programs;
create policy assessment_draft_programs_org_manage
  on public.assessment_draft_programs
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

drop policy if exists assessment_draft_goals_org_manage on public.assessment_draft_goals;
create policy assessment_draft_goals_org_manage
  on public.assessment_draft_goals
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

drop policy if exists assessment_review_events_org_select on public.assessment_review_events;
create policy assessment_review_events_org_select
  on public.assessment_review_events
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

drop policy if exists assessment_review_events_org_insert on public.assessment_review_events;
create policy assessment_review_events_org_insert
  on public.assessment_review_events
  for insert
  to authenticated
  with check (
    organization_id = app.current_user_organization_id()
    and (
      app.user_has_role_for_org('therapist', organization_id)
      or app.user_has_role_for_org('admin', organization_id)
      or app.user_has_role_for_org('super_admin', organization_id)
    )
  );

commit;
