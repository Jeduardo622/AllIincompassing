-- @migration-intent: Repair the live Supabase performance advisor drift for the unindexed admin_actions.admin_user_id foreign key.
-- @migration-dependencies: 20260414153000_unused_index_drop_batch3.sql
-- @migration-scope: Index-only; no table, RLS, grant, RPC, or data changes.
-- @migration-rollback: drop index if exists public.admin_actions_admin_user_id_idx;

begin;

set search_path = public;

create index if not exists admin_actions_admin_user_id_idx
  on public.admin_actions (admin_user_id);

commit;
