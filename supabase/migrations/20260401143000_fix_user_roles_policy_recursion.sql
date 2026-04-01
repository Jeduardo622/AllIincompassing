-- @migration-intent: Remove recursive user_roles policy predicate that triggers 42P17 and breaks role + authorization paths.
-- @migration-dependencies: 20260319222621_forward_fix_user_roles_policy_admin_check.sql
-- @migration-rollback: Restore the previous "User roles access control" policy if role-assignment behavior needs to match pre-fix semantics.

begin;

drop policy if exists "User roles access control" on public.user_roles;

create policy "User roles access control"
on public.user_roles
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

commit;
