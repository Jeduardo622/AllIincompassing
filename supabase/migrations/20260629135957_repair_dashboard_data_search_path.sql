/*
  @migration-intent: Repair Supabase advisor function_search_path_mutable for the legacy direct dashboard RPC without changing dashboard authority grants.
  @migration-dependencies: 20260429142000_dashboard_service_authority_rpc.sql
  @migration-rollback: ALTER FUNCTION public.get_dashboard_data() RESET search_path; only if a reviewed emergency rollback accepts restoring the advisor finding.
*/

set search_path = public;

begin;

alter function public.get_dashboard_data()
  set search_path = public, app, auth;

-- Preserve the dashboard authority contract: browser-authenticated users cannot call the legacy aggregate RPC directly.
revoke execute on function public.get_dashboard_data() from public;
revoke execute on function public.get_dashboard_data() from anon;
revoke execute on function public.get_dashboard_data() from authenticated;
grant execute on function public.get_dashboard_data() to dashboard_consumer;
grant execute on function public.get_dashboard_data() to service_role;

do $$
declare
  dashboard_function oid := 'public.get_dashboard_data()'::regprocedure;
  dashboard_search_path text;
begin
  select array_to_string(p.proconfig, ',')
  into dashboard_search_path
  from pg_proc p
  where p.oid = dashboard_function;

  if dashboard_search_path is distinct from 'search_path=public, app, auth' then
    raise exception 'public.get_dashboard_data() search_path repair failed: %', dashboard_search_path;
  end if;

  if has_function_privilege('public', dashboard_function, 'EXECUTE')
    or has_function_privilege('anon', dashboard_function, 'EXECUTE')
    or has_function_privilege('authenticated', dashboard_function, 'EXECUTE')
    or not has_function_privilege('dashboard_consumer', dashboard_function, 'EXECUTE')
    or not has_function_privilege('service_role', dashboard_function, 'EXECUTE') then
    raise exception 'public.get_dashboard_data() dashboard authority grants drifted during search_path repair';
  end if;
end
$$;

notify pgrst, 'reload schema';

commit;
