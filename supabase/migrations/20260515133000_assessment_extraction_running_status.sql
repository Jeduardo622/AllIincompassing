-- @migration-intent: Add a transient assessment extraction worker status for atomic background claims.
-- @migration-dependencies: 20260220103000_assessment_extraction_lifecycle_fields.sql
-- @migration-rollback: Re-run the assessment_documents_status_check constraint without extraction_running after all rows leave that status.

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'assessment_documents_status_check'
      and conrelid = 'public.assessment_documents'::regclass
  ) then
    alter table public.assessment_documents drop constraint assessment_documents_status_check;
  end if;

  alter table public.assessment_documents
    add constraint assessment_documents_status_check
    check (status in ('uploaded', 'extracting', 'extraction_running', 'extracted', 'drafted', 'approved', 'rejected', 'extraction_failed'));
end $$;
