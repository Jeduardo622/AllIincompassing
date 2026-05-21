-- @migration-intent: Align IEHP PCP assistance validation for template-metadata uploads and previously backfilled checklist rows.
-- @migration-dependencies: 20260520193000_extend_iehp_template_mapping_fields.sql, 20260521132512_backfill_iehp_template_metadata_rows.sql
-- @migration-rollback: Re-run the checklist backfill migration derivation if this field's validation semantics are intentionally changed away from optional_yes_no.

begin;

update public.assessment_checklist_items items
set validation_rule = 'optional_yes_no'
from public.assessment_documents documents
join public.assessment_template_versions versions
  on versions.id = documents.template_version_id
where items.assessment_document_id = documents.id
  and items.organization_id = documents.organization_id
  and documents.template_type = 'iehp_fba'
  and versions.version_key = 'iehp_fba_updated_fba_11_2026_05'
  and items.placeholder_key = 'IEHP_FBA_PCP_ASSISTANCE_REQUEST'
  and items.validation_rule is distinct from 'optional_yes_no';

commit;
