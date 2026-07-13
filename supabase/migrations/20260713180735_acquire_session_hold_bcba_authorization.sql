-- @migration-intent: Carry exact persisted BCBA booking authority through the privileged session-hold RPC after the edge authorization check.
-- @migration-dependencies: 20251201090000_session_hold_authorization.sql,20260706023600_bcba_exact_capability_matrix.sql
-- @migration-rollback: Reapply this function without the exact bcba user_has_role_for_org branch.

begin;

create or replace function public.acquire_session_hold(
  p_therapist_id uuid,
  p_client_id uuid,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_session_id uuid default null,
  p_hold_seconds integer default 300,
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hold session_holds;
  v_constraint_name text;
  v_original_sub text;
  v_original_role text;
  v_actor_is_authorized boolean;
  v_target_organization_id uuid;
begin
  delete from session_holds where expires_at <= timezone('utc', now());

  if p_actor_id is null then
    return jsonb_build_object(
      'success', false,
      'error_code', 'FORBIDDEN',
      'error_message', 'Actor is required to manage session holds.'
    );
  end if;

  v_original_sub := current_setting('request.jwt.claim.sub', true);
  v_original_role := current_setting('request.jwt.claim.role', true);

  perform set_config('request.jwt.claim.sub', p_actor_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  v_actor_is_authorized := (
    app.user_has_role_for_org('therapist', null, p_therapist_id, null, p_session_id)
    or app.user_has_role_for_org('admin', null, p_therapist_id, null, p_session_id)
    or app.user_has_role_for_org('super_admin', null, p_therapist_id, null, p_session_id)
    or app.user_has_role_for_org('bcba', null, p_therapist_id, null, p_session_id)
  );

  perform set_config('request.jwt.claim.sub', coalesce(v_original_sub, ''), true);
  perform set_config('request.jwt.claim.role', coalesce(v_original_role, ''), true);

  if not v_actor_is_authorized then
    return jsonb_build_object(
      'success', false,
      'error_code', 'FORBIDDEN',
      'error_message', 'Actor is not permitted to manage holds for this therapist.'
    );
  end if;

  select t.organization_id into v_target_organization_id
  from therapists t
  where t.id = p_therapist_id
    and t.deleted_at is null;

  if v_target_organization_id is null
     or not exists (
       select 1
       from clients c
       where c.id = p_client_id
         and c.organization_id = v_target_organization_id
         and c.deleted_at is null
     ) then
    return jsonb_build_object(
      'success', false,
      'error_code', 'FORBIDDEN',
      'error_message', 'Therapist and client must share an active organization boundary.'
    );
  end if;

  if p_session_id is not null
     and not exists (
       select 1
       from sessions s
       where s.id = p_session_id
         and s.organization_id = v_target_organization_id
     ) then
    return jsonb_build_object(
      'success', false,
      'error_code', 'FORBIDDEN',
      'error_message', 'Session does not match the active organization boundary.'
    );
  end if;

  if p_start_time >= p_end_time then
    return jsonb_build_object(
      'success', false,
      'error_code', 'INVALID_RANGE',
      'error_message', 'End time must be after start time.'
    );
  end if;

  if exists (
    select 1
    from sessions s
    where s.therapist_id = p_therapist_id
      and (p_session_id is null or s.id <> p_session_id)
      and s.status <> 'cancelled'
      and tstzrange(s.start_time, s.end_time, '[)') && tstzrange(p_start_time, p_end_time, '[)')
  ) then
    return jsonb_build_object(
      'success', false,
      'error_code', 'THERAPIST_CONFLICT',
      'error_message', 'Therapist already has a session during this time.'
    );
  end if;

  if exists (
    select 1
    from sessions s
    where s.client_id = p_client_id
      and (p_session_id is null or s.id <> p_session_id)
      and s.status <> 'cancelled'
      and tstzrange(s.start_time, s.end_time, '[)') && tstzrange(p_start_time, p_end_time, '[)')
  ) then
    return jsonb_build_object(
      'success', false,
      'error_code', 'CLIENT_CONFLICT',
      'error_message', 'Client already has a session during this time.'
    );
  end if;

  if exists (
    select 1
    from session_holds h
    where h.therapist_id = p_therapist_id
      and h.expires_at > timezone('utc', now())
      and tstzrange(h.start_time, h.end_time, '[)') && tstzrange(p_start_time, p_end_time, '[)')
  ) then
    return jsonb_build_object(
      'success', false,
      'error_code', 'THERAPIST_HOLD_CONFLICT',
      'error_message', 'Therapist already has a hold during this time.'
    );
  end if;

  if exists (
    select 1
    from session_holds h
    where h.client_id = p_client_id
      and h.expires_at > timezone('utc', now())
      and tstzrange(h.start_time, h.end_time, '[)') && tstzrange(p_start_time, p_end_time, '[)')
  ) then
    return jsonb_build_object(
      'success', false,
      'error_code', 'CLIENT_HOLD_CONFLICT',
      'error_message', 'Client already has a hold during this time.'
    );
  end if;

  begin
    insert into session_holds (
      therapist_id,
      client_id,
      start_time,
      end_time,
      session_id,
      expires_at
    )
    values (
      p_therapist_id,
      p_client_id,
      p_start_time,
      p_end_time,
      p_session_id,
      timezone('utc', now()) + make_interval(secs => coalesce(p_hold_seconds, 300))
    )
    returning * into v_hold;
  exception
    when unique_violation then
      return jsonb_build_object(
        'success', false,
        'error_code', 'HOLD_EXISTS',
        'error_message', 'A hold already exists for this time.'
      );
    when exclusion_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name = 'session_holds_therapist_time_excl' then
        return jsonb_build_object(
          'success', false,
          'error_code', 'THERAPIST_HOLD_CONFLICT',
          'error_message', 'Therapist already has a hold during this time.'
        );
      elsif v_constraint_name = 'session_holds_client_time_excl' then
        return jsonb_build_object(
          'success', false,
          'error_code', 'CLIENT_HOLD_CONFLICT',
          'error_message', 'Client already has a hold during this time.'
        );
      else
        raise;
      end if;
  end;

  return jsonb_build_object(
    'success', true,
    'hold', row_to_json(v_hold)
  );
end;
$$;

revoke execute on function public.acquire_session_hold(uuid, uuid, timestamptz, timestamptz, uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.acquire_session_hold(uuid, uuid, timestamptz, timestamptz, uuid, integer, uuid) to service_role;

commit;
