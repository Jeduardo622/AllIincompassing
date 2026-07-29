-- @migration-intent: Add a service-role-only RPC for conflict-safe cancelled session reactivation.
-- @migration-dependencies: 20260316153000_allow_session_in_progress_transitions.sql,20260707152000_session_cancellation_attribution.sql,20251111130500_session_audit_rpc_wrapper.sql
-- @migration-risk: Adjusts session lifecycle transition guard and adds a privileged tenant-scoped write RPC.
-- @migration-rollback: Restore the previous enforce_session_status_transition body and drop public.reactivate_cancelled_session(uuid, uuid, timestamptz, timestamptz).

set search_path = public;

create or replace function public.enforce_session_status_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.status = old.status then
    return new;
  end if;

  if old.status = 'cancelled'
     and new.status = 'scheduled'
     and current_setting('app.session_reactivation_authorized', true) = 'true' then
    return new;
  end if;

  if old.status = 'scheduled' and new.status in ('in_progress', 'completed', 'cancelled', 'no-show') then
    return new;
  end if;

  if old.status = 'in_progress' and new.status in ('completed', 'cancelled', 'no-show') then
    return new;
  end if;

  raise exception 'Invalid sessions.status transition from % to %', old.status, new.status
    using errcode = '23514';
end;
$$;

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
