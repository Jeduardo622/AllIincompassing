-- @migration-intent: Preserve ordinary booking participant and expired-hold invariants during cancelled session reactivation.
-- @migration-dependencies: 20260729120000_reactivate_cancelled_session.sql,20260727004500_acquire_session_hold_schedule_staff_authorization.sql
-- @migration-risk: Replaces a privileged tenant-scoped write RPC without widening grants or RLS access.
-- @migration-rollback: Reapply public.reactivate_cancelled_session from 20260729120000_reactivate_cancelled_session.sql.

set search_path = public;

create or replace function public.reactivate_cancelled_session(
  p_session_id uuid,
  p_actor_id uuid,
  p_start_time timestamptz default null,
  p_end_time timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sessions%rowtype;
  v_authorization public.authorizations%rowtype;
  v_prior_cancellation_attribution text;
  v_target_start_time timestamptz;
  v_target_end_time timestamptz;
  v_temp_hold_id uuid;
  v_hold_key uuid;
  v_constraint_name text;
begin
  select s.*
  into v_session
  from public.sessions s
  where s.id = p_session_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'error_code', 'SESSION_NOT_FOUND'
    );
  end if;

  if v_session.status = 'scheduled' then
    return jsonb_build_object(
      'success', true,
      'already_reactivated', true,
      'session_id', v_session.id
    );
  end if;

  if v_session.status <> 'cancelled' then
    return jsonb_build_object(
      'success', false,
      'error_code', 'INVALID_STATUS'
    );
  end if;

  if (p_start_time is null) <> (p_end_time is null) then
    return jsonb_build_object(
      'success', false,
      'error_code', 'INVALID_WINDOW'
    );
  end if;

  if p_end_time <= p_start_time then
    return jsonb_build_object(
      'success', false,
      'error_code', 'INVALID_WINDOW'
    );
  end if;

  v_target_start_time := coalesce(p_start_time, v_session.start_time);
  v_target_end_time := coalesce(p_end_time, v_session.end_time);

  if not exists (
    select 1
    from public.therapists t
    where t.id = v_session.therapist_id
      and t.organization_id = v_session.organization_id
      and t.status = 'active'
      and t.deleted_at is null
  ) or not exists (
    select 1
    from public.clients c
    where c.id = v_session.client_id
      and c.organization_id = v_session.organization_id
      and c.status = 'active'
      and c.deleted_at is null
  ) then
    return jsonb_build_object(
      'success', false,
      'error_code', 'FORBIDDEN'
    );
  end if;

  if v_session.authorization_id is not null then
    select authz.*
    into v_authorization
    from public.authorizations authz
    where authz.id = v_session.authorization_id
      and authz.organization_id = v_session.organization_id
      and authz.client_id = v_session.client_id
      and authz.status = 'approved'
      and v_target_start_time::date between authz.start_date and authz.end_date;

    if not found then
      return jsonb_build_object(
        'success', false,
        'error_code', 'AUTHORIZATION_INVALID'
      );
    end if;
  end if;

  delete from public.session_holds
  where expires_at <= timezone('utc', now());

  v_hold_key := gen_random_uuid();

  begin
    insert into public.session_holds (
      organization_id,
      therapist_id,
      client_id,
      start_time,
      end_time,
      hold_key,
      expires_at
    )
    values (
      v_session.organization_id,
      v_session.therapist_id,
      v_session.client_id,
      v_target_start_time,
      v_target_end_time,
      v_hold_key,
      timezone('utc', now()) + interval '1 minute'
    )
    returning id into v_temp_hold_id;
  exception
    when unique_violation then
      return jsonb_build_object(
        'success', false,
        'error_code', 'HOLD_CONFLICT'
      );
    when exclusion_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name = 'session_holds_therapist_time_excl' then
        return jsonb_build_object(
          'success', false,
          'error_code', 'THERAPIST_CONFLICT'
        );
      end if;

      return jsonb_build_object(
        'success', false,
        'error_code', 'HOLD_CONFLICT'
      );
  end;

  if exists (
    select 1
    from public.sessions s
    where s.therapist_id = v_session.therapist_id
      and s.organization_id = v_session.organization_id
      and s.id <> v_session.id
      and s.status <> 'cancelled'
      and tstzrange(s.start_time, s.end_time, '[)') &&
          tstzrange(v_target_start_time, v_target_end_time, '[)')
  ) then
    delete from public.session_holds where id = v_temp_hold_id;
    return jsonb_build_object(
      'success', false,
      'error_code', 'THERAPIST_CONFLICT'
    );
  end if;

  if exists (
    select 1
    from public.sessions s
    where s.client_id = v_session.client_id
      and s.organization_id = v_session.organization_id
      and s.id <> v_session.id
      and s.status <> 'cancelled'
      and tstzrange(s.start_time, s.end_time, '[)') &&
          tstzrange(v_target_start_time, v_target_end_time, '[)')
  ) then
    delete from public.session_holds where id = v_temp_hold_id;
    return jsonb_build_object(
      'success', false,
      'error_code', 'CLIENT_CONFLICT'
    );
  end if;

  if exists (
    select 1
    from public.session_holds h
    where h.organization_id = v_session.organization_id
      and h.expires_at > timezone('utc', now())
      and h.id <> v_temp_hold_id
      and (
        h.therapist_id = v_session.therapist_id
        or h.client_id = v_session.client_id
      )
      and tstzrange(h.start_time, h.end_time, '[)') &&
          tstzrange(v_target_start_time, v_target_end_time, '[)')
  ) then
    delete from public.session_holds where id = v_temp_hold_id;
    return jsonb_build_object(
      'success', false,
      'error_code', 'HOLD_CONFLICT'
    );
  end if;

  v_prior_cancellation_attribution := v_session.cancellation_attribution;
  perform set_config('app.session_reactivation_authorized', 'true', true);

  update public.sessions
  set status = 'scheduled',
      cancellation_attribution = null,
      start_time = v_target_start_time,
      end_time = v_target_end_time,
      updated_at = timezone('utc', now()),
      updated_by = p_actor_id
  where id = v_session.id;

  delete from public.session_holds where id = v_temp_hold_id;

  perform public.record_session_audit(
    v_session.id,
    'session_reactivated',
    p_actor_id,
    jsonb_build_object(
      'previousStatus', 'cancelled',
      'newStatus', 'scheduled',
      'previousStartTime', v_session.start_time,
      'previousEndTime', v_session.end_time,
      'startTime', v_target_start_time,
      'endTime', v_target_end_time,
      'previousCancellationAttribution', v_prior_cancellation_attribution
    )
  );

  return jsonb_build_object(
    'success', true,
    'already_reactivated', false,
    'session_id', v_session.id,
    'organization_id', v_session.organization_id,
    'start_time', v_target_start_time,
    'end_time', v_target_end_time
  );
end;
$$;

revoke execute on function public.reactivate_cancelled_session(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.reactivate_cancelled_session(uuid, uuid, timestamptz, timestamptz) to service_role;
