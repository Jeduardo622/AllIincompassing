-- @migration-intent: Backfill extracted_at for IEHP assessment documents that were successfully drafted before
-- the draft persistence path wrote extraction completion timestamps.
-- @migration-dependencies: 20260520131400_add_iehp_template_layout_metadata.sql, 20260521132512_backfill_iehp_template_metadata_rows.sql
-- @migration-rollback: Set extracted_at back to null only for IEHP drafted assessment_documents that were updated by this backfill and have not been reprocessed.

begin;

update public.assessment_documents documents
set extracted_at = (
  select coalesce(max(events.created_at), documents.created_at)
  from public.assessment_review_events events
  where events.assessment_document_id = documents.id
    and events.organization_id = documents.organization_id
    and events.action = 'extraction_completed'
    and events.to_status in ('drafted', 'extracted')
)
where documents.template_type = 'iehp_fba'
  and documents.status in ('extracted', 'drafted', 'approved', 'rejected')
  and documents.extracted_at is null
  and documents.extraction_error is null
  and exists (
    select 1
    from public.assessment_review_events events
    where events.assessment_document_id = documents.id
      and events.organization_id = documents.organization_id
      and events.action = 'extraction_completed'
      and events.to_status in ('drafted', 'extracted')
  )
  and (
    exists (
      select 1
      from public.assessment_extractions extractions
      where extractions.assessment_document_id = documents.id
        and extractions.organization_id = documents.organization_id
        and (
          extractions.status = 'drafted'
          or extractions.value_text is not null
          or extractions.value_json is not null
        )
    )
    or exists (
      select 1
      from public.assessment_checklist_items checklist
      where checklist.assessment_document_id = documents.id
        and checklist.organization_id = documents.organization_id
        and (
          checklist.status = 'drafted'
          or checklist.value_text is not null
          or checklist.value_json is not null
        )
    )
    or exists (
      select 1
      from public.assessment_structured_sections sections
      where sections.assessment_document_id = documents.id
        and sections.organization_id = documents.organization_id
        and sections.status in ('drafted', 'verified', 'approved')
    )
  );

commit;
