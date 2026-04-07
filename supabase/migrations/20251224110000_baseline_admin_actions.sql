-- @migration-intent: Baseline public.admin_actions before 20251224120000_metadata_constraints_and_impersonation_queue.sql (prune_admin_actions + org-scoped RLS). Hosted/prod may have created this outside the migration chain; replay requires DDL.
-- @migration-dependencies: auth.users
-- @migration-rollback: DROP TABLE IF EXISTS public.admin_actions;

set search_path = public;

create table if not exists public.admin_actions (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid references auth.users(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  action_type text not null,
  action_details jsonb,
  created_at timestamptz default timezone('utc', now())
);

comment on table public.admin_actions is
  'Administrative audit log; baseline for full migration replay ordering.';
