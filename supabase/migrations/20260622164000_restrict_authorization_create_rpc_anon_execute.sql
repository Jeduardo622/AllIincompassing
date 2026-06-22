/*
  @migration-intent: Remove unauthenticated/default execute access from the PreAuth authorization-create RPC while preserving reviewed authenticated browser callers.
  @migration-dependencies: 20260105120500_create_authorization_rpc_allowlist.sql, 20260622142046_restrict_authorization_document_rpc_anon_execute.sql
  @migration-rollback: Re-grant execute to anon only if a reviewed public authorization-create caller is introduced.
*/

begin;

revoke execute on function public.create_authorization_with_services(
  uuid,
  uuid,
  text,
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

grant execute on function public.create_authorization_with_services(
  uuid,
  uuid,
  text,
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
    and p.oid = 'public.create_authorization_with_services(uuid, uuid, text, text, text, date, date, text, uuid, text, text, jsonb)'::regprocedure
    and has_function_privilege('anon', p.oid, 'EXECUTE');

  if unsafe_count > 0 then
    raise exception 'Authorization create RPC grant hardening failed: % function(s) still executable by anon', unsafe_count;
  end if;
end
$$;

commit;
