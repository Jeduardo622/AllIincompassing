/*
  @migration-intent: Remove unauthenticated/default execute access from authorization-adjacent document RPCs while preserving reviewed authenticated browser callers.
  @migration-dependencies: 20260105121500_authorization_update_rpc_allowlist.sql, 20260105124500_harden_update_client_documents_path_allowlist.sql
  @migration-rollback: Re-grant execute to anon only for a specific RPC if a reviewed public caller is introduced.
*/

begin;

revoke execute on function public.can_access_client_documents(uuid) from public, anon;
revoke execute on function public.update_client_documents(uuid, jsonb) from public, anon;
revoke execute on function public.update_authorization_documents(uuid, jsonb) from public, anon;
revoke execute on function public.update_authorization_with_services(
  uuid,
  text,
  uuid,
  uuid,
  text,
  text,
  date,
  date,
  text,
  uuid,
  text,
  text,
  jsonb
) from public, anon;

grant execute on function public.can_access_client_documents(uuid) to authenticated, service_role;
grant execute on function public.update_client_documents(uuid, jsonb) to authenticated, service_role;
grant execute on function public.update_authorization_documents(uuid, jsonb) to authenticated, service_role;
grant execute on function public.update_authorization_with_services(
  uuid,
  text,
  uuid,
  uuid,
  text,
  text,
  date,
  date,
  text,
  uuid,
  text,
  text,
  jsonb
) to authenticated, service_role;

do $$
declare
  unsafe_count integer;
begin
  select count(*)
  into unsafe_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.oid in (
      'public.can_access_client_documents(uuid)'::regprocedure,
      'public.update_client_documents(uuid, jsonb)'::regprocedure,
      'public.update_authorization_documents(uuid, jsonb)'::regprocedure,
      'public.update_authorization_with_services(uuid, text, uuid, uuid, text, text, date, date, text, uuid, text, text, jsonb)'::regprocedure
    )
    and has_function_privilege('anon', p.oid, 'EXECUTE');

  if unsafe_count > 0 then
    raise exception 'Authorization document RPC grant hardening failed: % function(s) still executable by anon', unsafe_count;
  end if;
end
$$;

commit;
