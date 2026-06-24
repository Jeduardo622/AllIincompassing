-- @migration-intent: Repair staff messaging thread-creation RPC execute grants so only reviewed authenticated callers can create threads.
-- @migration-dependencies: 20260520143000_staff_messaging_tables_and_rls.sql
-- @migration-rollback: Re-grant execute to anon only if a reviewed public staff-messaging caller is introduced.

begin;

revoke execute on function public.create_staff_message_thread(text, uuid[], text) from public, anon;

grant execute on function public.create_staff_message_thread(text, uuid[], text) to authenticated, service_role;

do $$
declare
  target_function regprocedure := 'public.create_staff_message_thread(text, uuid[], text)'::regprocedure;
begin
  if has_function_privilege('anon', target_function::oid, 'EXECUTE') then
    raise exception 'Staff message thread RPC grant hardening failed: % still executable by anon', target_function;
  end if;

  if not has_function_privilege('authenticated', target_function::oid, 'EXECUTE') then
    raise exception 'Staff message thread RPC grant hardening failed: % not executable by authenticated', target_function;
  end if;

  if not has_function_privilege('service_role', target_function::oid, 'EXECUTE') then
    raise exception 'Staff message thread RPC grant hardening failed: % not executable by service_role', target_function;
  end if;
end $$;

commit;
