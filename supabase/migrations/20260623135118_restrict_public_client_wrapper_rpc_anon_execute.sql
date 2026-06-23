-- @migration-intent: Restrict public client wrapper RPC execute privileges to reviewed authenticated callers only.
-- @migration-dependencies: 20251121103000_public_client_rpc_wrappers
-- @migration-rollback: Re-grant execute to anon only if a reviewed public client-creation caller is introduced.

begin;

revoke execute on function public.create_client(jsonb) from public, anon;
revoke execute on function public.client_email_exists(text) from public, anon;

grant execute on function public.create_client(jsonb) to authenticated, service_role;
grant execute on function public.client_email_exists(text) to authenticated, service_role;

do $$
declare
  target_function regprocedure;
begin
  foreach target_function in array array[
    'public.create_client(jsonb)'::regprocedure,
    'public.client_email_exists(text)'::regprocedure
  ]
  loop
    if has_function_privilege('anon', target_function::oid, 'EXECUTE') then
      raise exception 'Public client wrapper RPC grant hardening failed: % still executable by anon', target_function;
    end if;

    if not has_function_privilege('authenticated', target_function::oid, 'EXECUTE') then
      raise exception 'Public client wrapper RPC grant hardening failed: % not executable by authenticated', target_function;
    end if;

    if not has_function_privilege('service_role', target_function::oid, 'EXECUTE') then
      raise exception 'Public client wrapper RPC grant hardening failed: % not executable by service_role', target_function;
    end if;
  end loop;
end $$;

commit;
