-- @migration-intent: Restore the PostgREST client archive RPC without duplicating tenant authorization logic.
-- @migration-dependencies: 20251101100000_soft_delete_archival
-- @migration-rollback: Drop public.set_client_archive_state(uuid, boolean); the app-schema authority remains unchanged.

begin;

create or replace function public.set_client_archive_state(
  p_client_id uuid,
  p_restore boolean default false
)
returns public.clients
language sql
security definer
set search_path = ''
as $function$
  select app.set_client_archive_state(p_client_id, p_restore);
$function$;

revoke execute on function public.set_client_archive_state(uuid, boolean) from public, anon;
grant execute on function public.set_client_archive_state(uuid, boolean) to authenticated;

do $$
declare
  target_function regprocedure :=
    'public.set_client_archive_state(uuid,boolean)'::regprocedure;
begin
  if has_function_privilege('public', target_function::oid, 'EXECUTE')
     or has_function_privilege('anon', target_function::oid, 'EXECUTE') then
    raise exception 'Client archive RPC exposure failed: % is executable by an unauthenticated role',
      target_function;
  end if;

  if not has_function_privilege('authenticated', target_function::oid, 'EXECUTE') then
    raise exception 'Client archive RPC exposure failed: % is unavailable to authenticated callers',
      target_function;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
