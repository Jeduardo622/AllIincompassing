-- @migration-intent: Allow authenticated staff to read only their own canonical user-to-therapist links for record-level self-authorization.
-- @migration-dependencies: public.user_therapist_links, auth.uid
-- @migration-rollback: Drop policy public.user_therapist_links_self_select from public.user_therapist_links.

begin;

drop policy if exists user_therapist_links_self_select
  on public.user_therapist_links;

create policy user_therapist_links_self_select
  on public.user_therapist_links
  for select
  to authenticated
  using (user_id = (select auth.uid()));

commit;
