-- Ensure create_super_admin handles auth identities and nil tokens
set statement_timeout = 0;
set lock_timeout = 0;
set idle_in_transaction_session_timeout = 0;
set client_encoding = 'UTF8';
set standard_conforming_strings = on;

create or replace function public.create_super_admin(user_email text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  v_user auth.users%rowtype;
  v_actor_id uuid;
  v_actor_role text;
  v_super_admin_role_id uuid;
  v_now timestamptz := timezone('utc', now());
  v_original_sub text;
  v_original_role text;
begin
  v_actor_role := current_setting('request.jwt.claim.role', true);
  if v_actor_role is null then
    raise exception using errcode = '42501', message = 'create_super_admin requires a role claim';
  elsif v_actor_role <> 'super_admin' then
    raise exception using errcode = '42501', message = 'Only super_admins may call create_super_admin';
  end if;

  v_actor_id := nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  v_original_sub := current_setting('request.jwt.claim.sub', true);
  v_original_role := current_setting('request.jwt.claim.role', true);

  select *
  into v_user
  from auth.users
  where email = user_email;

  if not found then
    raise exception 'User with email % not found', user_email;
  end if;

  select id
  into v_super_admin_role_id
  from roles
  where name = 'super_admin';

  if v_super_admin_role_id is null then
    raise exception 'Super admin role not found';
  end if;

  perform set_config('request.jwt.claim.sub', 'service_role_user_id', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);

  begin
    update auth.users
    set
      confirmation_token = coalesce(confirmation_token, ''),
      email_change = coalesce(email_change, ''),
      email_change_token_current = coalesce(email_change_token_current, ''),
      email_change_token_new = coalesce(email_change_token_new, ''),
      recovery_token = coalesce(recovery_token, ''),
      instance_id = coalesce(instance_id, '00000000-0000-0000-0000-000000000000'),
      updated_at = v_now
    where id = v_user.id;

    insert into auth.identities (
      id,
      user_id,
      identity_data,
      provider,
      provider_id,
      created_at,
      updated_at
    )
    values (
      gen_random_uuid(),
      v_user.id,
      jsonb_build_object('sub', v_user.id, 'email', v_user.email),
      'email',
      v_user.id,
      v_now,
      v_now
    )
    on conflict (provider, provider_id) do update
    set
      identity_data = excluded.identity_data,
      updated_at = excluded.updated_at;

    insert into profiles (
      id,
      email,
      role,
      is_active,
      created_at,
      updated_at
    )
    values (
      v_user.id,
      v_user.email,
      'super_admin',
      true,
      v_now,
      v_now
    )
    on conflict (id) do update
    set
      email = excluded.email,
      role = 'super_admin',
      is_active = true,
      updated_at = excluded.updated_at;

    delete from user_roles
    where user_id = v_user.id;

    insert into user_roles (user_id, role_id, granted_by, granted_at, is_active)
    values (v_user.id, v_super_admin_role_id, coalesce(v_actor_id, v_user.id), v_now, true)
    on conflict (user_id, role_id) do update
    set
      is_active = true,
      granted_at = excluded.granted_at,
      granted_by = excluded.granted_by;

    insert into admin_actions (
      action_type,
      admin_user_id,
      target_user_id,
      action_details
    )
    values (
      'super_admin_promotion',
      v_actor_id,
      v_user.id,
      jsonb_build_object(
        'reason', format('Manual promotion of %s to super_admin via create_super_admin', user_email),
        'performed_at', v_now
      )
    );
  exception
    when others then
      perform set_config('request.jwt.claim.sub', coalesce(v_original_sub, ''), true);
      perform set_config('request.jwt.claim.role', coalesce(v_original_role, ''), true);
      raise;
  end;

  perform set_config('request.jwt.claim.sub', coalesce(v_original_sub, ''), true);
  perform set_config('request.jwt.claim.role', coalesce(v_original_role, ''), true);
end;
$function$;

revoke execute on function public.create_super_admin(text) from public;
revoke execute on function public.create_super_admin(text) from authenticated;
grant execute on function public.create_super_admin(text) to service_role;

