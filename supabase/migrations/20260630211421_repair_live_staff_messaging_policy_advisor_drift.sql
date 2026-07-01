/*
  @migration-intent: Repair live auth_rls_initplan advisor drift for the two
    staff messaging policies that still inline auth.uid() in hosted policy text.
  @migration-dependencies: 20260520143000_staff_messaging_tables_and_rls.sql
  @migration-rollback: Recreate the prior policy bodies from
    20260520143000_staff_messaging_tables_and_rls.sql only if the wrapped
    auth.uid() form causes an unexpected policy regression.
*/

begin;

drop policy if exists message_thread_participants_self_update
  on public.message_thread_participants;
create policy message_thread_participants_self_update
  on public.message_thread_participants
  for update
  to authenticated
  using ((user_id = (select auth.uid())) and app.is_staff_message_thread_participant(thread_id))
  with check ((user_id = (select auth.uid())) and app.is_staff_message_thread_participant(thread_id));

drop policy if exists messages_participant_insert
  on public.messages;
create policy messages_participant_insert
  on public.messages
  for insert
  to authenticated
  with check (
    (sender_id = (select auth.uid()))
    and app.is_staff_message_thread_participant(thread_id)
  );

commit;
