-- @migration-intent: Remove unauthenticated/default execute access from public SECURITY DEFINER functions and lock trigger-backed helpers to service_role.
-- @migration-dependencies: 20260624125902_restrict_staff_message_thread_rpc_anon_execute.sql, 20260627232920_repair_live_authorization_advisor_covering_indexes.sql
-- @migration-rollback: Re-grant execute only to reviewed callers for a specific RPC contract; do not restore public or anon default execute.

do $$
declare
  target_function regprocedure;
begin
  for target_function in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef = true
  loop
    execute format('revoke execute on function %s from public, anon', target_function);
  end loop;
end $$;

do $$
declare
  target_function regprocedure;
begin
  for target_function in
    select distinct p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_trigger t on t.tgfoid = p.oid
    where n.nspname = 'public'
      and p.prosecdef = true
      and t.tgisinternal = false
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', target_function);
    execute format('grant execute on function %s to service_role', target_function);
  end loop;
end $$;

do $$
declare
  unsafe_function_count integer;
begin
  select count(*)
    into unsafe_function_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef = true
    and (
      has_function_privilege('public', p.oid, 'EXECUTE')
      or has_function_privilege('anon', p.oid, 'EXECUTE')
    );

  if unsafe_function_count > 0 then
    raise exception 'Public SECURITY DEFINER grant hardening failed: % public functions remain executable by public or anon', unsafe_function_count;
  end if;

  select count(*)
    into unsafe_function_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_trigger t on t.tgfoid = p.oid
  where n.nspname = 'public'
    and p.prosecdef = true
    and t.tgisinternal = false
    and (
      has_function_privilege('public', p.oid, 'EXECUTE')
      or has_function_privilege('anon', p.oid, 'EXECUTE')
      or has_function_privilege('authenticated', p.oid, 'EXECUTE')
      or not has_function_privilege('service_role', p.oid, 'EXECUTE')
    );

  if unsafe_function_count > 0 then
    raise exception 'Trigger-backed SECURITY DEFINER grant hardening failed: % public trigger functions are not service_role-only', unsafe_function_count;
  end if;
end $$;
