begin;

set local search_path = public;

alter table if exists public.assessment_documents
  add column if not exists extracted_at timestamptz,
  add column if not exists extraction_error text;

alter table if exists public.assessment_extractions
  add column if not exists extraction_method_detail text;

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
    check (status in ('uploaded', 'extracting', 'extracted', 'drafted', 'approved', 'rejected', 'extraction_failed'));
end
$$;

commit;
