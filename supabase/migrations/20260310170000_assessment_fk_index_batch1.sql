-- @migration-intent: Add first-batch covering indexes for assessment-domain foreign keys flagged by Supabase advisors.
-- @migration-dependencies: 20260220103000_assessment_extraction_lifecycle_fields.sql,20260310162000_harden_ai_guidance_documents_rls.sql
-- @migration-rollback: Drop newly added idx_assessment_* indexes if query planner regressions are observed.

begin;

set search_path = public;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'assessment_checklist_items' and column_name = 'client_id'
  ) then
    execute 'create index if not exists idx_assessment_checklist_items_client_id on public.assessment_checklist_items (client_id)';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'assessment_checklist_items' and column_name = 'organization_id'
  ) then
    execute 'create index if not exists idx_assessment_checklist_items_org_id on public.assessment_checklist_items (organization_id)';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'assessment_documents' and column_name = 'client_id'
  ) then
    execute 'create index if not exists idx_assessment_documents_client_id on public.assessment_documents (client_id)';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'assessment_draft_goals' and column_name = 'client_id'
  ) then
    execute 'create index if not exists idx_assessment_draft_goals_client_id on public.assessment_draft_goals (client_id)';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'assessment_draft_goals' and column_name = 'draft_program_id'
  ) then
    execute 'create index if not exists idx_assessment_draft_goals_draft_program_id on public.assessment_draft_goals (draft_program_id)';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'assessment_draft_goals' and column_name = 'organization_id'
  ) then
    execute 'create index if not exists idx_assessment_draft_goals_org_id on public.assessment_draft_goals (organization_id)';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'assessment_draft_programs' and column_name = 'assessment_document_id'
  ) then
    execute 'create index if not exists idx_assessment_draft_programs_doc_id on public.assessment_draft_programs (assessment_document_id)';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'assessment_draft_programs' and column_name = 'client_id'
  ) then
    execute 'create index if not exists idx_assessment_draft_programs_client_id on public.assessment_draft_programs (client_id)';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'assessment_draft_programs' and column_name = 'organization_id'
  ) then
    execute 'create index if not exists idx_assessment_draft_programs_org_id on public.assessment_draft_programs (organization_id)';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'assessment_extractions' and column_name = 'client_id'
  ) then
    execute 'create index if not exists idx_assessment_extractions_client_id on public.assessment_extractions (client_id)';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'assessment_extractions' and column_name = 'organization_id'
  ) then
    execute 'create index if not exists idx_assessment_extractions_org_id on public.assessment_extractions (organization_id)';
  end if;
end
$$;

commit;
