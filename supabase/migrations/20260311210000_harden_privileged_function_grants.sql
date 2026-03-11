-- @migration-intent: Remove anonymous/authenticated execute access from privileged SECURITY DEFINER functions and enforce service_role-only execution.
-- @migration-dependencies: 20260311195000_auth_profile_and_query_metrics_contract.sql
-- @migration-rollback: Re-grant execute selectively for affected privileged functions only if explicitly required by reviewed API paths.
--
-- Harden execute grants for privileged SECURITY DEFINER functions.
-- This migration revokes public/anon/authenticated execute access and limits execution to service_role.

do $$
declare
  target_function record;
begin
  for target_function in
    select p.oid::regprocedure as fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'admin_reset_user_password',
        'assign_user_role',
        'create_admin_invite',
        'create_super_admin',
        'ensure_admin_role'
      ])
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', target_function.fn);
    execute format('grant execute on function %s to service_role', target_function.fn);
  end loop;
end
$$;

do $$
declare
  unsafe_count integer;
begin
  select count(*)
  into unsafe_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = any (array[
      'admin_reset_user_password',
      'assign_user_role',
      'create_admin_invite',
      'create_super_admin',
      'ensure_admin_role'
    ])
    and p.prosecdef = true
    and has_function_privilege('anon', p.oid, 'EXECUTE');

  if unsafe_count > 0 then
    raise exception 'Privilege hardening failed: % privileged function(s) still executable by anon', unsafe_count;
  end if;
end
$$;
