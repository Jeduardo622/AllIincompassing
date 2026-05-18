-- @migration-intent: Explicitly grant authenticated insert/update privileges for structured assessment sections in fresh environments.
-- @migration-dependencies: 20260518072000_assessment_structured_sections_authenticated_write_scope.sql
-- @migration-rollback: Revoke authenticated insert/update privileges on public.assessment_structured_sections if write grants must be removed.

begin;

set local search_path = public;

grant insert, update on table public.assessment_structured_sections to authenticated;

commit;
