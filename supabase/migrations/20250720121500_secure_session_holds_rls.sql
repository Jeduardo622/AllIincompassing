-- Adjust session_holds RLS to allow admins full access and therapists scoped to their holds
set search_path = public;

drop policy if exists "session_holds_disallow_select" on session_holds;
drop policy if exists "session_holds_disallow_insert" on session_holds;
drop policy if exists "session_holds_disallow_update" on session_holds;
drop policy if exists "session_holds_disallow_delete" on session_holds;

create policy "session_holds_select_access"
  on session_holds
  for select
  to authenticated
  using (
    auth.user_has_role('admin')
    or (auth.user_has_role('therapist') and therapist_id = auth.uid())
  );

create policy "session_holds_insert_access"
  on session_holds
  for insert
  to authenticated
  with check (
    auth.user_has_role('admin')
    or (auth.user_has_role('therapist') and therapist_id = auth.uid())
  );

create policy "session_holds_update_access"
  on session_holds
  for update
  to authenticated
  using (
    auth.user_has_role('admin')
    or (auth.user_has_role('therapist') and therapist_id = auth.uid())
  )
  with check (
    auth.user_has_role('admin')
    or (auth.user_has_role('therapist') and therapist_id = auth.uid())
  );

create policy "session_holds_delete_access"
  on session_holds
  for delete
  to authenticated
  using (
    auth.user_has_role('admin')
    or (auth.user_has_role('therapist') and therapist_id = auth.uid())
  );
