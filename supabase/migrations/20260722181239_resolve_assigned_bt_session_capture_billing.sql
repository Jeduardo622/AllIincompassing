/*
  @migration-intent: Resolve minimal billing defaults for an exact assigned BT's existing session capture without widening authorization table RLS.
  @migration-dependencies: 20260721165120_bt_aba_completed_note_latest_amendment.sql
  @migration-rollback: Drop public.resolve_assigned_bt_session_capture_billing(uuid) after the client and server callers are rolled back.
*/

set search_path = public, app, auth;

begin;

create or replace function public.resolve_assigned_bt_session_capture_billing(p_session_id uuid)
returns table (
  authorization_id uuid,
  service_code text,
  strict_billing boolean,
  session_client_id uuid,
  session_therapist_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_session public.sessions%rowtype;
  v_authorization public.authorizations%rowtype;
  v_service_code text;
  v_strict_billing boolean := false;
  v_is_assigned_bt boolean := false;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if p_session_id is null then
    raise exception using errcode = '22023', message = 'session id is required';
  end if;

  select session.* into v_session
  from public.sessions session
  where session.id = p_session_id;

  if not found then
    raise exception using errcode = '42501', message = 'session is out of scope';
  end if;

  select
    coalesce(app.current_user_has_exact_role_for_org(
      v_session.organization_id,
      array['bt']::text[]
    ), false)
    and not coalesce(app.current_user_has_exact_role_for_org(
      v_session.organization_id,
      array['admin', 'admin_schedule', 'midtier', 'bcba', 'therapist']::text[]
    ), false)
    and exists (
      select 1
      from public.therapists therapist
      where therapist.id = v_session.therapist_id
        and therapist.organization_id = v_session.organization_id
        and therapist.status = 'active'
        and therapist.deleted_at is null
        and upper(btrim(coalesce(therapist.title, ''))) in ('BT', 'RBT')
        and (
          v_session.therapist_id = v_actor
          or exists (
            select 1
            from public.user_therapist_links utl
            where utl.user_id = v_actor
              and utl.therapist_id = v_session.therapist_id
          )
        )
    )
  into v_is_assigned_bt;

  if v_session.organization_id <> app.current_user_organization_id()
     or not v_is_assigned_bt
     or not public.current_user_can_capture_trial_event(v_session.organization_id, v_session.client_id) then
    raise exception using errcode = '42501', message = 'caller is not the assigned BT';
  end if;

  v_strict_billing := app.session_capture_strict_billing_gate(v_session.organization_id);

  select authz.* into v_authorization
  from public.authorizations authz
  where authz.organization_id = v_session.organization_id
    and authz.client_id = v_session.client_id
    and (
      not v_strict_billing
      or (
        authz.status = 'approved'
        and v_session.start_time::date between authz.start_date and authz.end_date
      )
    )
  order by
    case when authz.status = 'approved'
           and v_session.start_time::date between authz.start_date and authz.end_date then 0 else 1 end,
    authz.updated_at desc,
    authz.id
  limit 1;

  if not found then
    raise exception using errcode = '23514', message = 'no valid authorization is available for this session';
  end if;

  select service.service_code into v_service_code
  from public.authorization_services service
  where service.authorization_id = v_authorization.id
    and service.organization_id = v_session.organization_id
    and (
      not v_strict_billing
      or (
        service.decision_status = 'approved'
        and v_session.start_time::date between service.from_date and service.to_date
        and coalesce(service.approved_units, 0) > 0
      )
    )
  order by
    case when service.decision_status = 'approved'
           and v_session.start_time::date between service.from_date and service.to_date
           and coalesce(service.approved_units, 0) > 0 then 0 else 1 end,
    service.updated_at desc,
    service.id
  limit 1;

  if not found and v_strict_billing then
    raise exception using errcode = '23514', message = 'no valid authorization service is available for this session';
  elsif not found then
    v_service_code := 'UNSPECIFIED';
  end if;

  return query
  select
    v_authorization.id,
    v_service_code,
    v_strict_billing,
    v_session.client_id,
    v_session.therapist_id;
end;
$$;

revoke execute on function public.resolve_assigned_bt_session_capture_billing(uuid) from public, anon;
grant execute on function public.resolve_assigned_bt_session_capture_billing(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
