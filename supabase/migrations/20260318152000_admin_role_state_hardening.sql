-- @migration-intent: Require active, non-expired admin role assignments for admin management RPC authorization.
-- @migration-dependencies: 20251030120000_assign_admin_role_logging.sql
-- @migration-rollback: Re-run 20251030120000_assign_admin_role_logging.sql definitions to restore previous authorization checks.

set search_path = public;

drop function if exists assign_admin_role(text, uuid);

create or replace function assign_admin_role(
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
  v_request_role text := current_setting('request.jwt.claim.role', true);
  v_is_service_role boolean := v_request_role = 'service_role';
  v_caller_id uuid := auth.uid();
  v_caller_org uuid;
  v_target_id uuid;
  v_target_email text;
  v_target_metadata jsonb;
  v_target_org uuid;
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

    if not exists (
      select 1
      from user_roles ur
      join roles r on r.id = ur.role_id
      where ur.user_id = v_caller_id
        and r.name = 'admin'
        and coalesce(ur.is_active, true) = true
        and (ur.expires_at is null or ur.expires_at > now())
    ) then
      raise exception using errcode = '42501', message = 'Only active administrators can assign admin role';
    end if;

    select get_organization_id_from_metadata(u.raw_user_meta_data)
    into v_caller_org
    from auth.users u
    where u.id = v_caller_id;

    if v_caller_org is null then
      raise exception using errcode = '42501', message = 'Caller organization context is required';
    end if;

    if v_caller_org <> organization_id then
      raise exception using errcode = '42501', message = 'Caller organization mismatch';
    end if;
  end if;

  select id, email, raw_user_meta_data
  into v_target_id, v_target_email, v_target_metadata
  from auth.users
  where email = user_email;

  if v_target_id is null then
    raise exception using errcode = 'P0002', message = format('User with email %s not found', user_email);
  end if;

  v_target_org := get_organization_id_from_metadata(v_target_metadata);

  if v_target_org is not null and v_target_org <> organization_id then
    raise exception using errcode = '42501', message = 'Target user belongs to a different organization';
  end if;

  v_target_metadata := coalesce(v_target_metadata, '{}'::jsonb);
  v_target_metadata := jsonb_set(v_target_metadata, '{organization_id}', to_jsonb(organization_id::text), true);
  v_target_metadata := jsonb_set(v_target_metadata, '{organizationId}', to_jsonb(organization_id::text), true);
  v_target_metadata := jsonb_set(v_target_metadata, '{is_admin}', 'true'::jsonb, true);

  update auth.users
  set raw_user_meta_data = v_target_metadata
  where id = v_target_id;

  select id into v_admin_role_id
  from roles
  where name = 'admin';

  if v_admin_role_id is null then
    insert into roles (name, description)
    values ('admin', 'Administrator role with full access')
    returning id into v_admin_role_id;
  end if;

  insert into user_roles (user_id, role_id)
  values (v_target_id, v_admin_role_id)
  on conflict (user_id, role_id) do nothing;

  get diagnostics v_role_rows = row_count;

  begin
    insert into admin_actions (
      admin_user_id,
      target_user_id,
      organization_id,
      action_type,
      action_details
    )
    values (
      v_caller_id,
      v_target_id,
      organization_id,
      'admin_role_added',
      jsonb_build_object(
        'operation', 'add',
        'target_email', v_target_email,
        'service_role', v_is_service_role,
        'role_inserted', v_role_rows > 0,
        'reason', nullif(reason, '')
      )
    );
  exception
    when others then
      raise warning 'Failed to log admin add action via assign_admin_role: %', sqlerrm;
  end;
end;
$$;

grant execute on function assign_admin_role(text, uuid, text) to authenticated;

create or replace function manage_admin_users(
  operation text,
  target_user_id text
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_request_role text := current_setting('request.jwt.claim.role', true);
  v_is_service_role boolean := v_request_role = 'service_role';
  v_admin_role_id uuid;
  v_caller_id uuid := auth.uid();
  v_caller_org uuid;
  v_target_id uuid;
  v_target_email text;
  v_target_metadata jsonb;
  v_target_org uuid;
  v_admin_count integer;
  v_effective_org uuid;
begin
  select id into v_admin_role_id
  from roles
  where name = 'admin';

  if not v_is_service_role then
    if v_caller_id is null then
      raise exception using errcode = '28000', message = 'Authentication required';
    end if;

    if not exists (
      select 1
      from user_roles ur
      join roles r on r.id = ur.role_id
      where ur.user_id = v_caller_id
        and r.name = 'admin'
        and coalesce(ur.is_active, true) = true
        and (ur.expires_at is null or ur.expires_at > now())
    ) then
      raise exception using errcode = '42501', message = 'Only active administrators can manage admin users';
    end if;

    select get_organization_id_from_metadata(u.raw_user_meta_data)
    into v_caller_org
    from auth.users u
    where u.id = v_caller_id;

    if v_caller_org is null then
      raise exception using errcode = '42501', message = 'Caller organization context is required';
    end if;
  end if;

  begin
    v_target_id := target_user_id::uuid;
  exception
    when others then
      select id
      into v_target_id
      from auth.users
      where email = target_user_id;

      if v_target_id is null then
        raise exception using errcode = 'P0002', message = format('User with ID/email %s not found', target_user_id);
      end if;
  end;

  select email, raw_user_meta_data
  into v_target_email, v_target_metadata
  from auth.users
  where id = v_target_id;

  if v_target_email is null then
    raise exception using errcode = 'P0002', message = format('User with ID/email %s not found', target_user_id);
  end if;

  v_target_org := get_organization_id_from_metadata(v_target_metadata);

  if not v_is_service_role then
    if v_target_org is null then
      raise exception using errcode = '42501', message = 'Target user organization metadata is required';
    end if;

    if v_caller_org <> v_target_org then
      raise exception using errcode = '42501', message = 'Target user does not belong to the caller organization';
    end if;
  end if;

  if v_admin_role_id is null then
    insert into roles (name, description)
    values ('admin', 'Administrator role with full access')
    returning id into v_admin_role_id;
  end if;

  case operation
    when 'add' then
      if coalesce(v_target_org, v_caller_org) is null then
        raise exception using errcode = '42501', message = 'Organization context is required to add an admin';
      end if;

      v_effective_org := coalesce(v_target_org, v_caller_org);

      perform assign_admin_role(
        v_target_email,
        v_effective_org,
        'manage_admin_users:add'
      );

      begin
        insert into admin_actions (
          admin_user_id,
          target_user_id,
          organization_id,
          action_type,
          action_details
        )
        values (
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
      if not v_is_service_role then
        select count(*)
        into v_admin_count
        from user_roles ur
        join auth.users au on au.id = ur.user_id
        where ur.role_id = v_admin_role_id
          and get_organization_id_from_metadata(au.raw_user_meta_data) = v_caller_org
          and coalesce(ur.is_active, true) = true
          and (ur.expires_at is null or ur.expires_at > now());

        if v_admin_count <= 1 and v_target_id = v_caller_id then
          raise exception using errcode = '42501', message = 'Cannot remove the last active administrator for the organization';
        end if;
      end if;

      delete from user_roles
      where user_id = v_target_id
        and role_id = v_admin_role_id;

      update auth.users
      set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) - 'is_admin'
      where id = v_target_id;

      v_effective_org := coalesce(v_target_org, v_caller_org);

      begin
        insert into admin_actions (
          admin_user_id,
          target_user_id,
          organization_id,
          action_type,
          action_details
        )
        values (
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

grant execute on function manage_admin_users(text, text) to authenticated;
