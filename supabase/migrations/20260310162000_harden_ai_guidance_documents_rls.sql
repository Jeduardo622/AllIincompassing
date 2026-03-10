/*
  @migration-intent: Harden ai_guidance_documents access by adding explicit read policy and revoking broad grants.
  @migration-dependencies: 20260225021000_create_ai_guidance_documents.sql
  @migration-rollback: Restore previous grants for anon/authenticated and remove ai_guidance_documents_read policy if rollback is required.
*/

begin;

set search_path = public;

alter table if exists public.ai_guidance_documents enable row level security;

drop policy if exists ai_guidance_documents_read on public.ai_guidance_documents;

create policy ai_guidance_documents_read
  on public.ai_guidance_documents
  for select
  to authenticated
  using (
    app.user_has_role('admin')
    or app.user_has_role('super_admin')
    or app.user_has_role('monitoring')
  );

revoke all on table public.ai_guidance_documents from anon, authenticated;
grant select on table public.ai_guidance_documents to authenticated;

commit;
