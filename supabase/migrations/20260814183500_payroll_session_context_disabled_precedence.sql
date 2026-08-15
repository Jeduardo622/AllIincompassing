-- @migration-intent: payroll_session_context_disabled_precedence
-- @migration-dependencies: 20260812113000_payroll_session_lifecycle_context_disabled_state.sql
-- @migration-rollback: Restore the prior public.get_session_payroll_context(uuid) body from 20260812113000_payroll_session_lifecycle_context_disabled_state.sql, preserve grants, then reload the PostgREST schema.

begin;

set local search_path = public, app, auth, extensions, pg_catalog;

create or replace function public.get_session_payroll_context(session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_org uuid;
  v_session record;
  v_employment_count bigint;
  v_employment public.employment_profiles%rowtype;
  v_actor_is_assigned_employee boolean := false;
  v_can_record_assigned boolean := false;
  v_can_clock_self boolean := false;
  v_active_shift public.employee_time_events%rowtype;
  v_canonical_work_location public.work_location := 'other';
  v_feature_flag_found boolean := false;
  v_feature_flag_enabled boolean := false;
  v_policy_active boolean := false;
  v_local_policy_date date;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if session_id is null then
    raise exception using errcode = '22023', message = 'session_id is required';
  end if;

  v_actor_org := app.resolve_user_organization_id(v_actor);
  if v_actor_org is null or not app.payroll_actor_in_organization(v_actor_org) then
    raise exception using errcode = '42501', message = 'organization scope mismatch';
  end if;

  select
    session_row.id,
    session_row.organization_id,
    session_row.therapist_id,
    session_row.location_type
  into v_session
  from public.sessions session_row
  where session_row.id = session_id
    and session_row.organization_id = v_actor_org
  limit 1;

  if v_session.id is null or v_session.therapist_id is null then
    raise exception using errcode = '42501', message = 'session is out of scope';
  end if;

  v_actor_is_assigned_employee := v_session.therapist_id = v_actor;
  v_can_clock_self := (
    v_actor_is_assigned_employee
    and app.payroll_actor_has_capability(v_actor_org, 'time.clock_self')
  );
  v_can_record_assigned := app.payroll_actor_has_capability(
    v_actor_org,
    'session_attendance.record_assigned'
  );

  if not v_actor_is_assigned_employee and not v_can_record_assigned then
    raise exception using errcode = '42501', message = 'session attendance actor is out of scope';
  end if;

  select true, coalesce(org_override.is_enabled, flag.default_enabled, false)
  into v_feature_flag_found, v_feature_flag_enabled
  from public.feature_flags flag
  left join public.organization_feature_flags org_override
    on org_override.feature_flag_id = flag.id
   and org_override.organization_id = v_actor_org
  where flag.flag_key = 'payroll_timekeeping_v1'
  limit 1;

  if v_feature_flag_found is true
    and coalesce(v_feature_flag_enabled, false) is not true
    and (v_can_clock_self or v_can_record_assigned)
  then
    return jsonb_build_object(
      'state', 'feature_disabled',
      'sessionId', v_session.id,
      'organizationId', v_actor_org
    );
  end if;

  select count(*)
  into v_employment_count
  from public.employment_profiles employment
  where employment.organization_id = v_actor_org
    and employment.therapist_id = v_session.therapist_id
    and employment.active_from <= ((pg_catalog.now() at time zone employment.timezone)::date)
    and (
      employment.active_through is null
      or employment.active_through >= ((pg_catalog.now() at time zone employment.timezone)::date)
    );

  if v_employment_count <> 1 then
    raise exception using
      errcode = '42501',
      message = 'session assignment must resolve to exactly one active payroll employment profile';
  end if;

  select employment.*
  into v_employment
  from public.employment_profiles employment
  where employment.organization_id = v_actor_org
    and employment.therapist_id = v_session.therapist_id
    and employment.active_from <= ((pg_catalog.now() at time zone employment.timezone)::date)
    and (
      employment.active_through is null
      or employment.active_through >= ((pg_catalog.now() at time zone employment.timezone)::date)
    )
  order by employment.active_from desc
  limit 1;

  if v_feature_flag_found is not true then
    raise exception using errcode = '42501', message = 'payroll timekeeping feature flag is not configured';
  end if;

  if coalesce(v_feature_flag_enabled, false) is not true then
    return jsonb_build_object(
      'state', 'feature_disabled',
      'sessionId', v_session.id,
      'organizationId', v_actor_org
    );
  end if;

  if v_employment.home_jurisdiction <> 'CA' then
    raise exception using errcode = '42501', message = 'unsupported payroll jurisdiction';
  end if;

  v_local_policy_date := ((pg_catalog.now() at time zone v_employment.timezone)::date);

  select exists (
    select 1
    from public.payroll_policy_versions policy
    where (policy.organization_id is null or policy.organization_id = v_actor_org)
      and policy.jurisdiction = v_employment.home_jurisdiction
      and policy.activation_status = 'active'
      and policy.effective_from <= v_local_policy_date
      and (
        policy.effective_through is null
        or policy.effective_through >= v_local_policy_date
      )
  )
  into v_policy_active;

  if v_policy_active is not true then
    raise exception using errcode = '42501', message = 'active payroll policy is required';
  end if;

  select shift_event.*
  into v_active_shift
  from public.employee_time_events shift_event
  where shift_event.organization_id = v_actor_org
    and shift_event.employment_profile_id = v_employment.id
    and shift_event.event_type = 'shift_started'
    and shift_event.event_at <= pg_catalog.now()
    and not exists (
      select 1
      from public.employee_time_events shift_end
      where shift_end.organization_id = shift_event.organization_id
        and shift_end.employment_profile_id = shift_event.employment_profile_id
        and shift_end.event_type = 'shift_ended'
        and shift_end.event_at > shift_event.event_at
        and shift_end.event_at <= pg_catalog.now()
    )
  order by shift_event.event_at desc, shift_event.created_at desc
  limit 1;

  if v_active_shift.id is not null then
    v_canonical_work_location := v_active_shift.work_location;
  else
    v_canonical_work_location := case
      when v_session.location_type is null or btrim(v_session.location_type) = '' then 'other'::public.work_location
      when lower(v_session.location_type) like '%office%'
        or lower(v_session.location_type) like '%clinic%' then 'office'::public.work_location
      when lower(v_session.location_type) like '%home%'
        or lower(v_session.location_type) like '%telehealth%'
        or lower(v_session.location_type) like '%remote%' then 'home'::public.work_location
      when lower(v_session.location_type) like '%community%' then 'community'::public.work_location
      when lower(v_session.location_type) like '%school%'
        or lower(v_session.location_type) like '%campus%'
        or lower(v_session.location_type) like '%client%'
        or lower(v_session.location_type) like '%site%'
        or lower(v_session.location_type) like '%daycare%' then 'client_site'::public.work_location
      else 'other'::public.work_location
    end;
  end if;

  return jsonb_build_object(
    'state', 'ok',
    'sessionId', v_session.id,
    'organizationId', v_actor_org,
    'employmentProfileId', v_employment.id,
    'employmentTimezone', v_employment.timezone,
    'actorIsAssignedEmployee', v_actor_is_assigned_employee,
    'canClockSelf', v_can_clock_self,
    'canonicalWorkLocation', v_canonical_work_location,
    'activeShiftEventId', v_active_shift.id
  );
end;
$$;

revoke all on function public.get_session_payroll_context(uuid) from public, anon, authenticated;
revoke all on function public.get_session_payroll_context(uuid) from service_role;
grant execute on function public.get_session_payroll_context(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
