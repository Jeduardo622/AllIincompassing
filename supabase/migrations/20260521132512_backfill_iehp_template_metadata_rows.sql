-- @migration-intent: Backfill missing IEHP assessment checklist and extraction rows from the active template metadata so already-uploaded documents match the DOCX-like review layout.
-- @migration-dependencies: 20260520131400_add_iehp_template_layout_metadata.sql, 20260520193000_extend_iehp_template_mapping_fields.sql
-- @migration-rollback: Delete only rows with review_notes = 'Backfilled empty IEHP review row from active template metadata.' for the affected IEHP documents if this metadata seeding approach is reverted before review use.

begin;

with iehp_template_fields as (
  select
    versions.id as template_version_id,
    fields.section_key,
    fields.field_key,
    fields.label,
    fields.field_type,
    fields.mode,
    fields.source,
    fields.required,
    case
      when fields.source ilike '%uploaded_assessment_document%' then 'deterministic_docx_or_pdf_structured_extract'
      when fields.mode = 'MANUAL' or fields.source ilike '%clinician_manual_entry%' then 'clinician_manual_entry'
      when fields.source ilike '%clients.%'
        or fields.source ilike '%therapists.%'
        or fields.source ilike '%company_settings%'
        or fields.source ilike '%today%' then 'database_prefill'
      when fields.mode = 'ASSISTED' then 'assisted_draft_plus_review'
      else 'database_prefill'
    end as extraction_method,
    case
      when lower(fields.field_type) like '%signature%'
        or lower(fields.field_key) like '%signature%'
        or lower(fields.label) like '%signature%' then 'signature_and_date_present'
      when lower(fields.field_type) like '%table%' or lower(fields.field_type) like '%grid%' then
        case when fields.required then 'structured_payload_required' else 'optional_structured_payload' end
      when lower(fields.field_type) like '%date%' then
        case when fields.required then 'date_mm_dd_yyyy_or_na' else 'optional_date' end
      when lower(fields.field_type) like '%phone%' then
        case when fields.required then 'phone_us_or_e164_or_na' else 'optional_phone' end
      else
        case when fields.required then 'non_empty_text' else 'optional_text' end
    end as validation_rule,
    case when fields.mode = 'AUTO' then 'IntakeCoordinator' else 'ClinicalAuthor' end as extraction_owner,
    case when fields.mode = 'AUTO' then 'ClinicalReviewer' else 'BCBAReviewer' end as review_owner
  from public.assessment_template_versions versions
  join public.assessment_template_fields fields
    on fields.template_version_id = versions.id
  where versions.version_key = 'iehp_fba_updated_fba_11_2026_05'
),
iehp_documents as (
  select
    documents.id,
    documents.organization_id,
    documents.client_id,
    documents.template_version_id
  from public.assessment_documents documents
  join public.assessment_template_versions versions
    on versions.id = documents.template_version_id
  where documents.template_type = 'iehp_fba'
    and versions.version_key = 'iehp_fba_updated_fba_11_2026_05'
)
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
  fields.extraction_method,
  fields.validation_rule,
  'not_started',
  fields.extraction_owner,
  fields.review_owner,
  'Backfilled empty IEHP review row from active template metadata.'
from iehp_documents documents
join iehp_template_fields fields
  on fields.template_version_id = documents.template_version_id
where not exists (
  select 1
  from public.assessment_checklist_items existing
  where existing.assessment_document_id = documents.id
    and existing.organization_id = documents.organization_id
    and existing.placeholder_key = fields.field_key
);

with iehp_template_fields as (
  select
    versions.id as template_version_id,
    fields.section_key,
    fields.field_key,
    fields.label,
    fields.mode,
    fields.required
  from public.assessment_template_versions versions
  join public.assessment_template_fields fields
    on fields.template_version_id = versions.id
  where versions.version_key = 'iehp_fba_updated_fba_11_2026_05'
),
iehp_documents as (
  select
    documents.id,
    documents.organization_id,
    documents.client_id,
    documents.template_version_id
  from public.assessment_documents documents
  join public.assessment_template_versions versions
    on versions.id = documents.template_version_id
  where documents.template_type = 'iehp_fba'
    and versions.version_key = 'iehp_fba_updated_fba_11_2026_05'
)
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
  'Backfilled empty IEHP review row from active template metadata.'
from iehp_documents documents
join iehp_template_fields fields
  on fields.template_version_id = documents.template_version_id
where not exists (
  select 1
  from public.assessment_extractions existing
  where existing.assessment_document_id = documents.id
    and existing.organization_id = documents.organization_id
    and existing.field_key = fields.field_key
);

commit;
