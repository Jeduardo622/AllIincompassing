/*
  @migration-intent: Re-version telemetry grant hardening to resolve local duplicate timestamp collisions while preserving least-privilege function access.
  @migration-dependencies: 20260310162000_harden_ai_guidance_documents_rls.sql
  @migration-rollback: Re-grant anon/public execute if telemetry ingest rollback is required.
*/

do $$
declare
  fn record;
begin
  for fn in
    select
      n.nspname as schema_name,
      p.proname as function_name,
      pg_get_function_identity_arguments(p.oid) as function_args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('log_error_event', 'log_ai_performance')
  loop
    execute format(
      'alter function %I.%I(%s) set search_path = public',
      fn.schema_name,
      fn.function_name,
      fn.function_args
    );

    execute format(
      'revoke execute on function %I.%I(%s) from anon',
      fn.schema_name,
      fn.function_name,
      fn.function_args
    );

    execute format(
      'revoke execute on function %I.%I(%s) from public',
      fn.schema_name,
      fn.function_name,
      fn.function_args
    );

    execute format(
      'grant execute on function %I.%I(%s) to authenticated',
      fn.schema_name,
      fn.function_name,
      fn.function_args
    );

    execute format(
      'grant execute on function %I.%I(%s) to service_role',
      fn.schema_name,
      fn.function_name,
      fn.function_args
    );
  end loop;
end $$;
