-- @migration-intent: Extend the active IEHP FBA template metadata with next-slice review fields and backfill empty review rows for existing IEHP documents.
-- @migration-dependencies: 20260520131400_add_iehp_template_layout_metadata.sql
-- @migration-rollback: Delete the inserted assessment_template_fields and empty backfilled assessment_checklist_items/assessment_extractions rows for these IEHP_FBA_* keys if the mapping slice is reverted before use.

begin;

do $$
begin
  if not exists (
    select 1
    from public.assessment_template_versions
    where version_key = 'iehp_fba_updated_fba_11_2026_05'
  ) then
    raise exception 'Active IEHP FBA template version iehp_fba_updated_fba_11_2026_05 is required before extending IEHP template fields.';
  end if;
end $$;

with version_seed as (
  select id from public.assessment_template_versions
  where version_key = 'iehp_fba_updated_fba_11_2026_05'
),
fields_seed(page_number, section_key, field_key, label, field_type, mode, required, source, layout_json, repeat_group_key) as (
  values
    (4, 'behavior_background_services', 'IEHP_FBA_PCP_VISIT_SUMMARY', 'Primary Care Provider Visit Summary', 'textarea', 'MANUAL', false, 'uploaded_assessment_document when present; otherwise clinician_manual_entry', '{"table_index":6,"anchors":["Member’s last visit to the Primary Care Provider (PCP)"]}'::jsonb, null),
    (4, 'behavior_background_services', 'IEHP_FBA_PCP_ASSISTANCE_REQUEST', 'IEHP Assistance Accessing PCP', 'checkbox_grid', 'MANUAL', false, 'uploaded_assessment_document when present; otherwise clinician_manual_entry', '{"table_index":6,"columns":["Question","Yes","No"],"anchors":["would the Member like assistance from IEHP in accessing care to their PCP"]}'::jsonb, null),
    (8, 'assessment_procedures_testing', 'IEHP_FBA_CLINICAL_INTERVIEW_NARRATIVE', 'Clinical Interview Narrative', 'textarea', 'ASSISTED', true, 'uploaded_assessment_document', '{"anchors":["Clinical Interview"]}'::jsonb, null),
    (8, 'assessment_procedures_testing', 'IEHP_FBA_FIRST_MEMBER_OBSERVATION', 'First Member Observation Narrative', 'textarea', 'ASSISTED', true, 'uploaded_assessment_document', '{"anchors":["First Member Observation","1st Member Observation"]}'::jsonb, null),
    (8, 'assessment_procedures_testing', 'IEHP_FBA_SECOND_MEMBER_OBSERVATION', 'Second Member Observation Narrative', 'textarea', 'ASSISTED', true, 'uploaded_assessment_document', '{"anchors":["Second Member Observation","2nd Member Observation"]}'::jsonb, null),
    (9, 'assessment_procedures_testing', 'IEHP_FBA_PREFERENCE_REINFORCERS_TABLE', 'Preference Areas and Potential Reinforcers', 'repeatable_table', 'ASSISTED', true, 'uploaded_assessment_document', '{"table_index":17,"columns":["Preference Areas","Potential Reinforcers"]}'::jsonb, null),
    (10, 'assessment_procedures_testing', 'IEHP_FBA_SKILL_BASELINE_LOCATION_TABLE', 'Skill / Data Collected / Baseline / Location', 'repeatable_table', 'ASSISTED', false, 'uploaded_assessment_document when present; otherwise clinician_manual_entry', '{"table_index":16,"columns":["Skill","Data Collected/Baseline","Location"]}'::jsonb, null),
    (22, 'treatment_coordination_recommendations', 'IEHP_FBA_TEACHING_INTERVENTION_STRATEGIES', 'Teaching Intervention Strategies', 'textarea', 'ASSISTED', true, 'uploaded_assessment_document', '{"anchors":["Teaching Intervention Strategies"]}'::jsonb, null),
    (22, 'treatment_coordination_recommendations', 'IEHP_FBA_FAMILY_INVOLVEMENT', 'Family Involvement', 'textarea', 'ASSISTED', true, 'uploaded_assessment_document', '{"anchors":["Family Involvement"]}'::jsonb, null),
    (24, 'treatment_coordination_recommendations', 'IEHP_FBA_RECOMMENDATION_NOTES', 'Recommendation Notes', 'textarea', 'MANUAL', false, 'clinician_manual_entry when template page is used', '{"docx_page_hint":"Recommendation narrative continuation"}'::jsonb, null),
    (25, 'treatment_coordination_recommendations', 'IEHP_FBA_CAREGIVER_PARTICIPATION', 'Caregiver Participation', 'textarea', 'MANUAL', false, 'clinician_manual_entry when template page is used', '{"docx_page_hint":"Caregiver participation and training narrative"}'::jsonb, null),
    (26, 'treatment_coordination_recommendations', 'IEHP_FBA_TREATMENT_PLAN_REVIEW', 'Treatment Plan Review', 'textarea', 'MANUAL', false, 'clinician_manual_entry when template page is used', '{"docx_page_hint":"Treatment plan review continuation"}'::jsonb, null),
    (27, 'treatment_coordination_recommendations', 'IEHP_FBA_ADDITIONAL_NOTES', 'Additional Notes', 'textarea', 'MANUAL', false, 'clinician_manual_entry when template page is used', '{"docx_page_hint":"Additional notes continuation"}'::jsonb, null),
    (28, 'treatment_coordination_recommendations', 'IEHP_FBA_APPENDIX_SUPPORTING_INFORMATION', 'Appendix and Supporting Information', 'textarea', 'MANUAL', false, 'clinician_manual_entry when template page is used', '{"docx_page_hint":"Appendix/supporting information"}'::jsonb, null)
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

insert into public.assessment_checklist_items (
  assessment_document_id,
  organization_id,
  client_id,
  section_key,
  label,
  placeholder_key,
  mode,
  source,
  required,
  extraction_method,
  validation_rule,
  status,
  extraction_owner,
  review_owner,
  review_notes
)
select
  documents.id,
  documents.organization_id,
  documents.client_id,
  fields.section_key,
  fields.label,
  fields.field_key,
  fields.mode,
  fields.source,
  fields.required,
  metadata.extraction_method,
  metadata.validation_rule,
  'not_started',
  'ClinicalAuthor',
  'BCBAReviewer',
  'Backfilled empty IEHP review row for expanded template mapping.'
from public.assessment_documents documents
join public.assessment_template_versions versions
  on versions.id = documents.template_version_id
join public.assessment_template_fields fields
  on fields.template_version_id = versions.id
join (
  values
    ('IEHP_FBA_PCP_VISIT_SUMMARY', 'deterministic_docx_or_pdf_structured_extract', 'optional_text'),
    ('IEHP_FBA_PCP_ASSISTANCE_REQUEST', 'deterministic_docx_or_pdf_structured_extract', 'optional_yes_no'),
    ('IEHP_FBA_CLINICAL_INTERVIEW_NARRATIVE', 'deterministic_docx_or_pdf_structured_extract', 'non_empty_text'),
    ('IEHP_FBA_FIRST_MEMBER_OBSERVATION', 'deterministic_docx_or_pdf_structured_extract', 'non_empty_text'),
    ('IEHP_FBA_SECOND_MEMBER_OBSERVATION', 'deterministic_docx_or_pdf_structured_extract', 'non_empty_text'),
    ('IEHP_FBA_PREFERENCE_REINFORCERS_TABLE', 'deterministic_docx_or_pdf_structured_extract', 'structured_payload_required'),
    ('IEHP_FBA_SKILL_BASELINE_LOCATION_TABLE', 'deterministic_docx_or_pdf_structured_extract', 'optional_structured_payload'),
    ('IEHP_FBA_TEACHING_INTERVENTION_STRATEGIES', 'deterministic_docx_or_pdf_structured_extract', 'non_empty_text'),
    ('IEHP_FBA_FAMILY_INVOLVEMENT', 'deterministic_docx_or_pdf_structured_extract', 'non_empty_text'),
    ('IEHP_FBA_RECOMMENDATION_NOTES', 'manual_or_template_continuation', 'optional_text'),
    ('IEHP_FBA_CAREGIVER_PARTICIPATION', 'manual_or_template_continuation', 'optional_text'),
    ('IEHP_FBA_TREATMENT_PLAN_REVIEW', 'manual_or_template_continuation', 'optional_text'),
    ('IEHP_FBA_ADDITIONAL_NOTES', 'manual_or_template_continuation', 'optional_text'),
    ('IEHP_FBA_APPENDIX_SUPPORTING_INFORMATION', 'manual_or_template_continuation', 'optional_text')
) as metadata(field_key, extraction_method, validation_rule)
  on metadata.field_key = fields.field_key
where documents.template_type = 'iehp_fba'
  and versions.version_key = 'iehp_fba_updated_fba_11_2026_05'
  and fields.field_key in (
    'IEHP_FBA_PCP_VISIT_SUMMARY',
    'IEHP_FBA_PCP_ASSISTANCE_REQUEST',
    'IEHP_FBA_CLINICAL_INTERVIEW_NARRATIVE',
    'IEHP_FBA_FIRST_MEMBER_OBSERVATION',
    'IEHP_FBA_SECOND_MEMBER_OBSERVATION',
    'IEHP_FBA_PREFERENCE_REINFORCERS_TABLE',
    'IEHP_FBA_SKILL_BASELINE_LOCATION_TABLE',
    'IEHP_FBA_TEACHING_INTERVENTION_STRATEGIES',
    'IEHP_FBA_FAMILY_INVOLVEMENT',
    'IEHP_FBA_RECOMMENDATION_NOTES',
    'IEHP_FBA_CAREGIVER_PARTICIPATION',
    'IEHP_FBA_TREATMENT_PLAN_REVIEW',
    'IEHP_FBA_ADDITIONAL_NOTES',
    'IEHP_FBA_APPENDIX_SUPPORTING_INFORMATION'
  )
  and not exists (
    select 1
    from public.assessment_checklist_items existing
    where existing.assessment_document_id = documents.id
      and existing.organization_id = documents.organization_id
      and existing.placeholder_key = fields.field_key
  );

insert into public.assessment_extractions (
  assessment_document_id,
  organization_id,
  client_id,
  section_key,
  field_key,
  label,
  mode,
  required,
  status,
  review_notes
)
select
  documents.id,
  documents.organization_id,
  documents.client_id,
  fields.section_key,
  fields.field_key,
  fields.label,
  fields.mode,
  fields.required,
  'not_started',
  'Backfilled empty IEHP extraction row for expanded template mapping.'
from public.assessment_documents documents
join public.assessment_template_versions versions
  on versions.id = documents.template_version_id
join public.assessment_template_fields fields
  on fields.template_version_id = versions.id
where documents.template_type = 'iehp_fba'
  and versions.version_key = 'iehp_fba_updated_fba_11_2026_05'
  and fields.field_key in (
    'IEHP_FBA_PCP_VISIT_SUMMARY',
    'IEHP_FBA_PCP_ASSISTANCE_REQUEST',
    'IEHP_FBA_CLINICAL_INTERVIEW_NARRATIVE',
    'IEHP_FBA_FIRST_MEMBER_OBSERVATION',
    'IEHP_FBA_SECOND_MEMBER_OBSERVATION',
    'IEHP_FBA_PREFERENCE_REINFORCERS_TABLE',
    'IEHP_FBA_SKILL_BASELINE_LOCATION_TABLE',
    'IEHP_FBA_TEACHING_INTERVENTION_STRATEGIES',
    'IEHP_FBA_FAMILY_INVOLVEMENT',
    'IEHP_FBA_RECOMMENDATION_NOTES',
    'IEHP_FBA_CAREGIVER_PARTICIPATION',
    'IEHP_FBA_TREATMENT_PLAN_REVIEW',
    'IEHP_FBA_ADDITIONAL_NOTES',
    'IEHP_FBA_APPENDIX_SUPPORTING_INFORMATION'
  )
  and not exists (
    select 1
    from public.assessment_extractions existing
    where existing.assessment_document_id = documents.id
      and existing.organization_id = documents.organization_id
      and existing.field_key = fields.field_key
  );

commit;
