-- @migration-intent: Fail closed on the current JWT and canonical tenant identity when authenticated admins manage admin roles.
-- @migration-dependencies: 20260506170000_super_admin_admin_management_authz.sql,20260709172500_harden_admin_users_rpc_exposure.sql,20260714153227_decompose_ci_rls_fixture_profile_guard.sql
-- @migration-rollback: Forward recovery only. Do not restore metadata-derived tenant authorization; replace these functions with a reviewed canonical-profile implementation.

begin;

create or replace function public.assign_admin_role(
  user_email text,
  organization_id uuid,
  reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_request_role text := coalesce(auth.jwt() ->> 'role', '');
  v_is_service_role boolean := v_request_role = 'service_role';
  v_is_super_admin boolean := public.current_user_is_super_admin();
  v_caller_id uuid := auth.uid();
  v_caller_org uuid;
  v_caller_active boolean;
  v_target_id uuid;
  v_target_org uuid;
  v_target_active boolean;
  v_target_metadata jsonb;
  v_admin_role_id uuid;
  v_role_rows integer := 0;
begin
  if organization_id is null then
    raise exception using errcode = '22023', message = 'Organization ID is required';
  end if;

  if not v_is_service_role then
    if v_caller_id is null then
      raise exception using errcode = '28000', message = 'Authentication required';
    end if;

    select p.organization_id, p.is_active
    into v_caller_org, v_caller_active
    from public.profiles p
    where p.id = v_caller_id;

    if coalesce(v_caller_active, false) is not true then
      raise exception using errcode = '42501', message = 'Active caller profile is required';
    end if;

    if not v_is_super_admin and not exists (
      select 1
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      where ur.user_id = v_caller_id
        and r.name = 'admin'
        and coalesce(ur.is_active, true) = true
        and (ur.expires_at is null or ur.expires_at > now())
    ) then
      raise exception using errcode = '42501', message = 'Only active administrators can assign admin role';
    end if;

    if not v_is_super_admin and v_caller_org is distinct from organization_id then
      raise exception using errcode = '42501', message = 'Caller organization mismatch';
    end if;
  end if;

  select u.id, p.organization_id, p.is_active, u.raw_user_meta_data
  into v_target_id, v_target_org, v_target_active, v_target_metadata
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.email = user_email;

  if v_target_id is null then
    raise exception using errcode = 'P0002', message = format('User with email %s not found', user_email);
  end if;

  if not v_is_service_role and coalesce(v_target_active, false) is not true then
    raise exception using errcode = '42501', message = 'Active target profile is required';
  end if;

  if v_target_org is distinct from organization_id then
    raise exception using errcode = '42501', message = 'Target user canonical organization mismatch';
  end if;

  select id into v_admin_role_id
  from public.roles
  where name = 'admin';

  if v_admin_role_id is null then
    insert into public.roles (name, description)
    values ('admin', 'Administrator role with full access')
    returning id into v_admin_role_id;
  end if;

  insert into public.user_roles (user_id, role_id, is_active, expires_at)
  values (v_target_id, v_admin_role_id, true, null)
  on conflict (user_id, role_id) do update
  set is_active = true,
      expires_at = null;

  get diagnostics v_role_rows = row_count;

  v_target_metadata := coalesce(v_target_metadata, '{}'::jsonb);
  v_target_metadata := jsonb_set(v_target_metadata, '{organization_id}', to_jsonb(organization_id::text), true);
  v_target_metadata := jsonb_set(v_target_metadata, '{organizationId}', to_jsonb(organization_id::text), true);
  v_target_metadata := jsonb_set(v_target_metadata, '{is_admin}', 'true'::jsonb, true);

  update auth.users
  set raw_user_meta_data = v_target_metadata
  where id = v_target_id;

  begin
    insert into public.admin_actions (
      admin_user_id,
      target_user_id,
      organization_id,
      action_type,
      action_details
    ) values (
      v_caller_id,
      v_target_id,
      organization_id,
      'admin_role_added',
      jsonb_build_object(
        'operation', 'add',
        'target_email', user_email,
        'service_role', v_is_service_role,
        'role_upserted', v_role_rows > 0,
        'reason', nullif(reason, '')
      )
    );
  exception
    when others then
      raise warning 'Failed to log admin add action via assign_admin_role: %', sqlerrm;
  end;
end;
$$;

revoke execute on function public.assign_admin_role(text, uuid, text) from public;
revoke execute on function public.assign_admin_role(text, uuid, text) from anon;
revoke execute on function public.assign_admin_role(text, uuid, text) from authenticated;
grant execute on function public.assign_admin_role(text, uuid, text) to service_role;

create or replace function public.manage_admin_users(
  operation text,
  target_user_id text
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_request_role text := coalesce(auth.jwt() ->> 'role', '');
  v_is_service_role boolean := v_request_role = 'service_role';
  v_is_super_admin boolean := public.current_user_is_super_admin();
  v_admin_role_id uuid;
  v_caller_id uuid := auth.uid();
  v_caller_org uuid;
  v_caller_active boolean;
  v_target_id uuid;
  v_target_email text;
  v_target_org uuid;
  v_admin_count integer;
  v_effective_org uuid;
begin
  select id into v_admin_role_id
  from public.roles
  where name = 'admin';

  if not v_is_service_role then
    if v_caller_id is null then
      raise exception using errcode = '28000', message = 'Authentication required';
    end if;

    select p.organization_id, p.is_active
    into v_caller_org, v_caller_active
    from public.profiles p
    where p.id = v_caller_id;

    if coalesce(v_caller_active, false) is not true then
      raise exception using errcode = '42501', message = 'Active caller profile is required';
    end if;

    if not v_is_super_admin and not exists (
      select 1
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      where ur.user_id = v_caller_id
        and r.name = 'admin'
        and coalesce(ur.is_active, true) = true
        and (ur.expires_at is null or ur.expires_at > now())
    ) then
      raise exception using errcode = '42501', message = 'Only active administrators can manage admin users';
    end if;

    if not v_is_super_admin then
      if v_caller_org is null then
        raise exception using errcode = '42501', message = 'Caller organization context is required';
      end if;
    end if;
  end if;

  begin
    v_target_id := target_user_id::uuid;
  exception
    when others then
      select id into v_target_id
      from auth.users
      where email = target_user_id;
  end;

  select email into v_target_email
  from auth.users
  where id = v_target_id;

  if v_target_id is null or v_target_email is null then
    raise exception using errcode = 'P0002', message = format('User with ID/email %s not found', target_user_id);
  end if;

  v_target_org := app.resolve_user_organization_id(v_target_id);

  if not v_is_service_role and not v_is_super_admin then
    if v_target_org is null then
      raise exception using errcode = '42501', message = 'Target user organization context is required';
    end if;

    if v_caller_org <> v_target_org then
      raise exception using errcode = '42501', message = 'Target user does not belong to the caller organization';
    end if;
  end if;

  if v_admin_role_id is null then
    insert into public.roles (name, description)
    values ('admin', 'Administrator role with full access')
    returning id into v_admin_role_id;
  end if;

  case operation
    when 'add' then
      if coalesce(v_target_org, v_caller_org) is null then
        raise exception using errcode = '42501', message = 'Organization context is required to add an admin';
      end if;

      v_effective_org := coalesce(v_target_org, v_caller_org);
      perform public.assign_admin_role(v_target_email, v_effective_org, 'manage_admin_users:add');

      begin
        insert into public.admin_actions (
          admin_user_id,
          target_user_id,
          organization_id,
          action_type,
          action_details
        ) values (
          v_caller_id,
          v_target_id,
          v_effective_org,
          'admin_role_added',
          jsonb_build_object(
            'operation', 'add',
            'target_email', v_target_email,
            'service_role', v_is_service_role
          )
        );
      exception
        when others then
          raise warning 'Failed to log admin add action: %', sqlerrm;
      end;

    when 'remove' then
      if not v_is_service_role and not v_is_super_admin then
        select count(*) into v_admin_count
        from public.user_roles ur
        where ur.role_id = v_admin_role_id
          and app.resolve_user_organization_id(ur.user_id) = v_caller_org
          and coalesce(ur.is_active, true) = true
          and (ur.expires_at is null or ur.expires_at > now());

        if v_admin_count <= 1 and v_target_id = v_caller_id then
          raise exception using errcode = '42501', message = 'Cannot remove the last active administrator for the organization';
        end if;
      end if;

      delete from public.user_roles
      where user_id = v_target_id
        and role_id = v_admin_role_id;

      update auth.users
      set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) - 'is_admin'
      where id = v_target_id;

      v_effective_org := coalesce(v_target_org, v_caller_org);

      begin
        insert into public.admin_actions (
          admin_user_id,
          target_user_id,
          organization_id,
          action_type,
          action_details
        ) values (
          v_caller_id,
          v_target_id,
          v_effective_org,
          'admin_role_removed',
          jsonb_build_object(
            'operation', 'remove',
            'target_email', v_target_email,
            'service_role', v_is_service_role
          )
        );
      exception
        when others then
          raise warning 'Failed to log admin remove action: %', sqlerrm;
      end;

    else
      raise exception using errcode = '22023', message = format('Invalid operation: %s', operation);
  end case;
end;
$$;

revoke execute on function public.manage_admin_users(text, text) from public;
revoke execute on function public.manage_admin_users(text, text) from anon;
grant execute on function public.manage_admin_users(text, text) to authenticated;
grant execute on function public.manage_admin_users(text, text) to service_role;

commit;
