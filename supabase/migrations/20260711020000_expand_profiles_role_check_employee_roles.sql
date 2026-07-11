-- @migration-intent: Keep profiles.role compatible with every employee role already supported by public.role_type and sync_user_profile().
-- @migration-dependencies: Requires public.profiles and the employee role_type values introduced by 20260701150000_employee_role_capability_matrix.sql.
-- @migration-risk: Replaces one CHECK constraint on public.profiles; no row values, role assignments, grants, or policies are changed.
-- @migration-rollback: Before restoring the former four-role CHECK, remap any bt, midtier, admin_schedule, or bcba profile rows to a legacy role, then drop and recreate profiles_role_check with client, therapist, admin, and super_admin only.

begin;

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (
    role::text = any (
      array[
        'client',
        'therapist',
        'admin',
        'super_admin',
        'bt',
        'midtier',
        'admin_schedule',
        'bcba'
      ]::text[]
    )
  ) not valid;

alter table public.profiles
  validate constraint profiles_role_check;

commit;
