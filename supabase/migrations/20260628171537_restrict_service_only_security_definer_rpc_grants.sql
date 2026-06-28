-- @migration-intent: Restrict service-only SECURITY DEFINER RPCs that should not be directly callable by signed-in browser users.
-- @migration-dependencies: 20260628165252_harden_public_security_definer_rpc_grants.sql
-- @migration-rollback: Re-grant authenticated only to a reviewed browser RPC with an explicit caller authorization contract.

do $$
declare
  service_only_function regprocedure;
  service_only_function_signature text;
  service_only_functions constant text[] := array[
    'public.assign_admin_role(text, uuid, text)',
    'public.assign_role_on_signup()',
    'public.assign_therapist_role(text, uuid)',
    'public.assign_therapist_role(uuid)',
    'public.check_migration_status()',
    'public.create_admin_invite_token_rate_limited(text, text, uuid, timestamp with time zone, uuid, role_type)',
    'public.create_user_profile()',
    'public.ensure_all_users_admin()',
    'public.ensure_user_has_admin_role()',
    'public.ensure_user_has_admin_role(uuid)',
    'public.prune_admin_actions(integer)',
    'public.prune_admin_invite_tokens()',
    'public.prune_session_transcripts(integer)',
    'public.sync_admin_roles_from_auth_metadata()'
  ];
begin
  foreach service_only_function_signature in array service_only_functions loop
    service_only_function := to_regprocedure(service_only_function_signature);

    if service_only_function is null then
      continue;
    end if;

    execute format(
      'revoke execute on function %s from public, anon, authenticated',
      service_only_function
    );
    execute format(
      'grant execute on function %s to service_role',
      service_only_function
    );
  end loop;
end $$;

do $$
declare
  unsafe_function regprocedure;
  unsafe_function_signature text;
  unsafe_functions text[];
  service_only_functions constant text[] := array[
    'public.assign_admin_role(text, uuid, text)',
    'public.assign_role_on_signup()',
    'public.assign_therapist_role(text, uuid)',
    'public.assign_therapist_role(uuid)',
    'public.check_migration_status()',
    'public.create_admin_invite_token_rate_limited(text, text, uuid, timestamp with time zone, uuid, role_type)',
    'public.create_user_profile()',
    'public.ensure_all_users_admin()',
    'public.ensure_user_has_admin_role()',
    'public.ensure_user_has_admin_role(uuid)',
    'public.prune_admin_actions(integer)',
    'public.prune_admin_invite_tokens()',
    'public.prune_session_transcripts(integer)',
    'public.sync_admin_roles_from_auth_metadata()'
  ];
begin
  foreach unsafe_function_signature in array service_only_functions loop
    unsafe_function := to_regprocedure(unsafe_function_signature);

    if unsafe_function is null then
      continue;
    end if;

    if has_function_privilege('public', unsafe_function, 'EXECUTE')
      or has_function_privilege('anon', unsafe_function, 'EXECUTE')
      or has_function_privilege('authenticated', unsafe_function, 'EXECUTE')
      or not has_function_privilege('service_role', unsafe_function, 'EXECUTE')
    then
      unsafe_functions := array_append(unsafe_functions, unsafe_function::text);
    end if;
  end loop;

  if coalesce(array_length(unsafe_functions, 1), 0) > 0 then
    raise exception 'Service-only SECURITY DEFINER grant hardening failed for: %', array_to_string(unsafe_functions, ', ');
  end if;
end $$;
