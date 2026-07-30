-- @migration-intent: Forward-fix admin_invite_tokens invite audit foreign keys to preserve admin invite audit rows when inviter or accepter auth users are deleted.
-- @migration-dependencies: 20260730170000_therapist_invite_target_lifecycle.sql
-- @migration-rollback: restore the prior admin_invite_tokens created_by and accepted_by_user_id foreign keys without ON DELETE SET NULL after reviewed downstream code no longer depends on nullable inviter audit references.

begin;

alter table public.admin_invite_tokens
  alter column created_by drop not null;

alter table public.admin_invite_tokens
  drop constraint if exists admin_invite_tokens_created_by_fkey,
  drop constraint if exists admin_invite_tokens_accepted_by_user_id_fkey;

alter table public.admin_invite_tokens
  add constraint admin_invite_tokens_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null,
  add constraint admin_invite_tokens_accepted_by_user_id_fkey
    foreign key (accepted_by_user_id) references auth.users(id) on delete set null;

commit;
