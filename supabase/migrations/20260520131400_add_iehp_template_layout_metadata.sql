-- @migration-intent: Add versioned IEHP FBA template layout metadata and link assessment documents to the active template version.
-- @migration-dependencies: 20260518074500_assessment_structured_sections_authenticated_write_grants.sql
-- @migration-rollback: Drop assessment_documents.template_version_id, assessment_template_fields, assessment_template_pages, and assessment_template_versions if the IEHP layout review rollout is reverted before production use.

begin;

set local search_path = public;

create table if not exists public.assessment_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_type text not null,
  version_key text not null unique,
  source_document_name text not null,
  page_count integer not null check (page_count > 0),
  source_sha256 text,
  status text not null default 'active' check (status in ('draft', 'active', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assessment_template_versions_template_type_check
    check (template_type in ('caloptima_fba', 'iehp_fba'))
);

create table if not exists public.assessment_template_pages (
  id uuid primary key default gen_random_uuid(),
  template_version_id uuid not null references public.assessment_template_versions(id) on delete cascade,
  page_number integer not null check (page_number > 0),
  title text not null,
  layout_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (template_version_id, page_number)
);

create table if not exists public.assessment_template_fields (
  id uuid primary key default gen_random_uuid(),
  template_version_id uuid not null references public.assessment_template_versions(id) on delete cascade,
  page_number integer not null check (page_number > 0),
  section_key text not null,
  field_key text not null,
  label text not null,
  field_type text not null,
  mode text not null check (mode in ('AUTO', 'ASSISTED', 'MANUAL')),
  required boolean not null default true,
  source text not null default '',
  layout_json jsonb not null default '{}'::jsonb,
  repeat_group_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (template_version_id, field_key)
);

alter table public.assessment_documents
  add column if not exists template_version_id uuid references public.assessment_template_versions(id);

create index if not exists assessment_template_versions_type_status_idx
  on public.assessment_template_versions (template_type, status);

create unique index if not exists assessment_template_versions_one_active_per_type_idx
  on public.assessment_template_versions (template_type)
  where status = 'active';

create index if not exists assessment_template_pages_version_page_idx
  on public.assessment_template_pages (template_version_id, page_number);

create index if not exists assessment_template_fields_version_page_idx
  on public.assessment_template_fields (template_version_id, page_number);

create index if not exists assessment_template_fields_key_idx
  on public.assessment_template_fields (field_key);

create index if not exists assessment_documents_template_version_idx
  on public.assessment_documents (template_version_id);

alter table public.assessment_template_versions enable row level security;
alter table public.assessment_template_pages enable row level security;
alter table public.assessment_template_fields enable row level security;

drop policy if exists assessment_template_versions_authenticated_read on public.assessment_template_versions;
create policy assessment_template_versions_authenticated_read
  on public.assessment_template_versions
  for select
  to authenticated
  using (true);

drop policy if exists assessment_template_pages_authenticated_read on public.assessment_template_pages;
create policy assessment_template_pages_authenticated_read
  on public.assessment_template_pages
  for select
  to authenticated
  using (true);

drop policy if exists assessment_template_fields_authenticated_read on public.assessment_template_fields;
create policy assessment_template_fields_authenticated_read
  on public.assessment_template_fields
  for select
  to authenticated
  using (true);

grant select on table public.assessment_template_versions to authenticated;
grant select on table public.assessment_template_pages to authenticated;
grant select on table public.assessment_template_fields to authenticated;

grant all on table public.assessment_template_versions to service_role;
grant all on table public.assessment_template_pages to service_role;
grant all on table public.assessment_template_fields to service_role;

with version_seed as (
  insert into public.assessment_template_versions (
    template_type,
    version_key,
    source_document_name,
    page_count,
    source_sha256,
    status
  )
  values (
    'iehp_fba',
    'iehp_fba_updated_fba_11_2026_05',
    'Updated FBA -IEHP (11).docx',
    30,
    '6acabfd7cc5ba287951b671ddbb18fb9424c09a95cc7c2afb487453477b2cb49',
    'active'
  )
  on conflict (version_key) do update set
    template_type = excluded.template_type,
    source_document_name = excluded.source_document_name,
    page_count = excluded.page_count,
    source_sha256 = excluded.source_sha256,
    status = excluded.status,
    updated_at = now()
  returning id
),
pages_seed(page_number, title, layout_json) as (
  values
    (1, 'General Information', '{"sections":["identification_admin"],"docx_page_hint":"General Information"}'::jsonb),
    (2, 'Referral and Target Areas', '{"sections":["identification_admin","behavior_background_services"]}'::jsonb),
    (3, 'Household and School Information', '{"sections":["behavior_background_services"]}'::jsonb),
    (4, 'BHT School Hours and Medical', '{"sections":["behavior_background_services"]}'::jsonb),
    (5, 'Current Services and Intervention History', '{"sections":["behavior_background_services"]}'::jsonb),
    (6, 'BHT Availability', '{"sections":["behavior_background_services"]}'::jsonb),
    (7, 'Environmental Analysis', '{"sections":["behavior_background_services"]}'::jsonb),
    (8, 'Assessment Procedures', '{"sections":["assessment_procedures_testing"]}'::jsonb),
    (9, 'Records Reviewed and Preferences', '{"sections":["assessment_procedures_testing"]}'::jsonb),
    (10, 'Adaptive Measure Summaries', '{"sections":["assessment_procedures_testing"]}'::jsonb),
    (11, 'Target Behavior 1', '{"sections":["treatment_coordination_recommendations"]}'::jsonb),
    (12, 'Target Behavior 2', '{"sections":["treatment_coordination_recommendations"]}'::jsonb),
    (13, 'Target Behavior 3', '{"sections":["treatment_coordination_recommendations"]}'::jsonb),
    (14, 'Behavior Intervention Plan', '{"sections":["treatment_coordination_recommendations"]}'::jsonb),
    (15, 'Skill Acquisition Goals', '{"sections":["treatment_coordination_recommendations"]}'::jsonb),
    (16, 'School Goals', '{"sections":["treatment_coordination_recommendations"]}'::jsonb),
    (17, 'Parent Education Goals', '{"sections":["treatment_coordination_recommendations"]}'::jsonb),
    (18, 'Safety/Crisis Procedure', '{"sections":["treatment_coordination_recommendations"]}'::jsonb),
    (19, 'Coordination of Care', '{"sections":["treatment_coordination_recommendations"]}'::jsonb),
    (20, 'Discharge Criteria', '{"sections":["treatment_coordination_recommendations"]}'::jsonb),
    (21, 'Transition of Care', '{"sections":["treatment_coordination_recommendations"]}'::jsonb),
    (22, 'Recommendations', '{"sections":["treatment_coordination_recommendations"]}'::jsonb),
    (23, 'Clinical Recommendations', '{"sections":["treatment_coordination_recommendations"]}'::jsonb),
    (24, 'Recommendation Notes', '{"sections":["treatment_coordination_recommendations"]}'::jsonb),
    (25, 'Caregiver Participation', '{"sections":["treatment_coordination_recommendations"]}'::jsonb),
    (26, 'Treatment Plan Review', '{"sections":["treatment_coordination_recommendations"]}'::jsonb),
    (27, 'Additional Notes', '{"sections":["treatment_coordination_recommendations"]}'::jsonb),
    (28, 'Appendix and Supporting Information', '{"sections":["treatment_coordination_recommendations"]}'::jsonb),
    (29, 'Report Completed By', '{"sections":["treatment_coordination_recommendations"]}'::jsonb),
    (30, 'Signature Block', '{"sections":["treatment_coordination_recommendations"]}'::jsonb)
)
insert into public.assessment_template_pages (template_version_id, page_number, title, layout_json)
select version_seed.id, pages_seed.page_number, pages_seed.title, pages_seed.layout_json
from version_seed, pages_seed
on conflict (template_version_id, page_number) do update set
  title = excluded.title,
  layout_json = excluded.layout_json,
  updated_at = now();

with version_seed as (
  select id from public.assessment_template_versions
  where version_key = 'iehp_fba_updated_fba_11_2026_05'
),
fields_seed(page_number, section_key, field_key, label, field_type, mode, required, source, layout_json, repeat_group_key) as (
  values
    (1, 'identification_admin', 'IEHP_FBA_FIRST_NAME', 'First Name', 'text', 'AUTO', true, 'clients.first_name', '{"table_index":0,"row":0,"column":1}'::jsonb, null),
    (1, 'identification_admin', 'IEHP_FBA_LAST_NAME', 'Last Name', 'text', 'AUTO', true, 'clients.last_name', '{"table_index":0,"row":0,"column":3}'::jsonb, null),
    (1, 'identification_admin', 'IEHP_FBA_BIRTH_DATE', 'Birth Date', 'date', 'AUTO', true, 'clients.date_of_birth', '{"table_index":0,"row":1,"column":1}'::jsonb, null),
    (1, 'identification_admin', 'IEHP_FBA_MEMBER_ID', 'IEHP Member ID#', 'text', 'AUTO', true, 'authorizations.member_id || clients.cin_number || clients.client_id', '{"table_index":0,"row":1,"column":3}'::jsonb, null),
    (1, 'identification_admin', 'IEHP_FBA_PRESENT_ADDRESS', 'Present Address', 'textarea', 'AUTO', true, 'clients.address_line1/2 + clients.city/state/zip_code', '{"table_index":0,"row":2,"column":1,"col_span":3}'::jsonb, null),
    (1, 'identification_admin', 'IEHP_FBA_PARENT_GUARDIAN', 'Parent/Guardian', 'text', 'AUTO', true, 'clients.parent1_first_name/last_name (fallback parent2)', '{"table_index":0,"row":3,"column":1}'::jsonb, null),
    (1, 'identification_admin', 'IEHP_FBA_CONTACT_PHONE', 'Phone', 'text', 'AUTO', true, 'clients.parent1_phone || clients.phone', '{"table_index":0,"row":3,"column":3}'::jsonb, null),
    (1, 'identification_admin', 'IEHP_FBA_LANGUAGE', 'Language', 'text', 'ASSISTED', true, 'clients.preferred_language', '{"table_index":0,"row":4,"column":1}'::jsonb, null),
    (1, 'identification_admin', 'IEHP_FBA_REFERRAL_DATE', 'Referral Date', 'date', 'ASSISTED', true, 'uploaded_assessment_document', '{"table_index":0,"row":4,"column":3}'::jsonb, null),
    (1, 'identification_admin', 'IEHP_FBA_REPORT_DATE', 'Report Date', 'date', 'AUTO', true, 'today (server)', '{"table_index":0,"row":5,"column":1}'::jsonb, null),
    (1, 'identification_admin', 'IEHP_FBA_ASSESSOR_CERTIFICATION', 'Assessor/Certification', 'textarea', 'ASSISTED', true, 'uploaded_assessment_document or clinician_manual_entry', '{"table_index":0,"row":5,"column":3}'::jsonb, null),
    (1, 'identification_admin', 'IEHP_FBA_ASSESSOR_PHONE', 'Assessor''s phone number', 'text', 'ASSISTED', true, 'therapists.phone || company_settings.phone', '{"table_index":0,"row":6,"column":1}'::jsonb, null),
    (2, 'identification_admin', 'IEHP_FBA_REFERRING_PROVIDER', 'Name of Referring Provider, Credentials', 'textarea', 'MANUAL', true, 'clinician_manual_entry unless present in uploaded document', '{"table_index":1,"row":0,"column":1}'::jsonb, null),
    (2, 'identification_admin', 'IEHP_FBA_REASON_FOR_REFERRAL', 'Reason for Referral', 'textarea', 'MANUAL', true, 'clinician_manual_entry unless present in uploaded document', '{"table_index":1,"row":1,"column":1}'::jsonb, null),
    (2, 'behavior_background_services', 'IEHP_FBA_BEHAVIOR_SKILL_TARGETS', 'Behaviors and Functional Skills to be Addressed', 'checkbox_grid', 'ASSISTED', true, 'uploaded_assessment_document', '{"table_index":2}'::jsonb, null),
    (3, 'behavior_background_services', 'IEHP_FBA_HOUSEHOLD_MEMBERS', 'Persons in Household and Relationship to IEHP Member', 'repeatable_table', 'ASSISTED', true, 'uploaded_assessment_document', '{"table_index":3,"columns":["Name","Relationship"]}'::jsonb, null),
    (3, 'behavior_background_services', 'IEHP_FBA_SCHOOL_INFORMATION_BLOCK', 'School Information Block', 'table', 'ASSISTED', true, 'uploaded_assessment_document', '{"table_index":4}'::jsonb, null),
    (4, 'behavior_background_services', 'IEHP_FBA_BHT_SCHOOL_HOURS_MATRIX', 'BHT School Hours Matrix', 'schedule_table', 'ASSISTED', true, 'uploaded_assessment_document or clinician_manual_entry', '{"table_index":5,"columns":["M","Tu","W","Th","F","Total","Session time"]}'::jsonb, null),
    (4, 'behavior_background_services', 'IEHP_FBA_HEALTH_MEDICAL_SUMMARY', 'Health and Medical Summary', 'textarea', 'ASSISTED', true, 'uploaded_assessment_document', '{"anchors":["Health and Medical","Current Services and Activities"]}'::jsonb, null),
    (5, 'behavior_background_services', 'IEHP_FBA_CURRENT_SERVICES_ACTIVITIES', 'Current Services and Activities', 'repeatable_table', 'ASSISTED', true, 'uploaded_assessment_document', '{"table_index":7}'::jsonb, null),
    (5, 'behavior_background_services', 'IEHP_FBA_INTERVENTION_HISTORY', 'Intervention History', 'repeatable_table', 'ASSISTED', true, 'uploaded_assessment_document', '{"table_index":8}'::jsonb, null),
    (6, 'behavior_background_services', 'IEHP_FBA_BHT_AVAILABILITY_GRID', 'BHT Availability Grid', 'schedule_table', 'ASSISTED', true, 'uploaded_assessment_document', '{"table_index":9}'::jsonb, null),
    (7, 'behavior_background_services', 'IEHP_FBA_ENVIRONMENTAL_ANALYSIS', 'Member Environmental Analysis', 'checkbox_grid', 'ASSISTED', true, 'uploaded_assessment_document', '{"table_index":10}'::jsonb, null),
    (8, 'assessment_procedures_testing', 'IEHP_FBA_ASSESSMENT_PROCEDURES_TABLE', 'Assessment Procedures Table', 'repeatable_table', 'ASSISTED', true, 'uploaded_assessment_document', '{"table_index":11}'::jsonb, null),
    (9, 'assessment_procedures_testing', 'IEHP_FBA_RECORDS_REVIEWED_TABLE', 'Records Reviewed Table', 'repeatable_table', 'ASSISTED', true, 'uploaded_assessment_document', '{"table_index":15}'::jsonb, null),
    (9, 'assessment_procedures_testing', 'IEHP_FBA_PREFERENCE_ASSESSMENT_SUMMARY', 'Preference Assessment Summary', 'textarea', 'ASSISTED', true, 'uploaded_assessment_document', '{"table_index":12}'::jsonb, null),
    (10, 'assessment_procedures_testing', 'IEHP_FBA_ADAPTIVE_MEASURE_SUMMARIES', 'Adaptive and Functional Measure Summaries', 'textarea', 'ASSISTED', true, 'uploaded_assessment_document', '{"table_indices":[13,14,18,19]}'::jsonb, null),
    (11, 'treatment_coordination_recommendations', 'IEHP_FBA_TARGET_BEHAVIOR_INTERVENTION_BLOCKS', 'Target Behavior and Intervention Blocks', 'goal_blocks', 'ASSISTED', true, 'uploaded_assessment_document', '{"table_index":20,"goal_type":"behavior_reduction"}'::jsonb, 'target_behavior_blocks'),
    (15, 'treatment_coordination_recommendations', 'IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS', 'Skill, School, and Parent Education Goal Blocks', 'goal_blocks', 'ASSISTED', true, 'uploaded_assessment_document', '{"goal_types":["skill_acquisition","school","parent"]}'::jsonb, 'iehp_goal_blocks'),
    (18, 'treatment_coordination_recommendations', 'IEHP_FBA_CRISIS_PLAN', 'Safety Procedure / Crisis Plan', 'textarea', 'ASSISTED', true, 'uploaded_assessment_document', '{"anchors":["Safety/Crisis Procedure","Coordination of Care"]}'::jsonb, null),
    (19, 'treatment_coordination_recommendations', 'IEHP_FBA_COORDINATION_OF_CARE', 'Coordination of Care', 'textarea', 'ASSISTED', true, 'uploaded_assessment_document', '{"anchors":["Coordination of Care","Discharge Criteria"]}'::jsonb, null),
    (20, 'treatment_coordination_recommendations', 'IEHP_FBA_DISCHARGE_TRANSITION_EXIT_PLAN', 'Discharge, Transition and Exit Plans', 'textarea', 'ASSISTED', true, 'uploaded_assessment_document', '{"anchors":["Discharge Criteria","Transition of Care","Recommendations"]}'::jsonb, null),
    (23, 'treatment_coordination_recommendations', 'IEHP_FBA_RECOMMENDATIONS_HCPCS_ROWS', 'Recommendations and HCPCS Rows', 'recommendation_table', 'ASSISTED', true, 'authorization/planning payload', '{"table_index":21}'::jsonb, null),
    (30, 'treatment_coordination_recommendations', 'IEHP_FBA_SIGNATURE_BLOCK', 'Signature Block', 'signature', 'ASSISTED', true, 'uploaded_assessment_document', '{"anchors":["Report completed by","Signature","Date","Agency"]}'::jsonb, null)
)
insert into public.assessment_template_fields (
  template_version_id,
  page_number,
  section_key,
  field_key,
  label,
  field_type,
  mode,
  required,
  source,
  layout_json,
  repeat_group_key
)
select
  version_seed.id,
  fields_seed.page_number,
  fields_seed.section_key,
  fields_seed.field_key,
  fields_seed.label,
  fields_seed.field_type,
  fields_seed.mode,
  fields_seed.required,
  fields_seed.source,
  fields_seed.layout_json,
  fields_seed.repeat_group_key
from version_seed, fields_seed
on conflict (template_version_id, field_key) do update set
  page_number = excluded.page_number,
  section_key = excluded.section_key,
  label = excluded.label,
  field_type = excluded.field_type,
  mode = excluded.mode,
  required = excluded.required,
  source = excluded.source,
  layout_json = excluded.layout_json,
  repeat_group_key = excluded.repeat_group_key,
  updated_at = now();

update public.assessment_documents
set template_version_id = (
  select id
  from public.assessment_template_versions
  where version_key = 'iehp_fba_updated_fba_11_2026_05'
  limit 1
)
where template_type = 'iehp_fba'
  and template_version_id is null;

commit;
