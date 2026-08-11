/*
  @migration-intent: Restore legacy exact therapist compatibility for BT closeout actor checks without widening trial-capture authority.
  @migration-dependencies: 20260717235500_align_supervision_request_linked_therapist_authority.sql, 20260721165120_bt_aba_completed_note_latest_amendment.sql, 20260722181239_resolve_assigned_bt_session_capture_billing.sql
  @migration-rollback: Reapply the prior function definitions from 20260717235500_align_supervision_request_linked_therapist_authority.sql, 20260721165120_bt_aba_completed_note_latest_amendment.sql, 20260722181239_resolve_assigned_bt_session_capture_billing.sql, and 20260716212837_bt_aba_session_note_closeout.sql, then drop app.current_user_can_act_as_bt_closeout_actor(uuid, uuid).
*/

set search_path = public, app, auth;

begin;

create or replace function app.current_user_can_act_as_bt_closeout_actor(
  p_organization_id uuid,
  p_therapist_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or p_organization_id is null or p_therapist_id is null then
    return false;
  end if;

  if p_organization_id <> app.current_user_organization_id() then
    return false;
  end if;

  if not (
    (
      coalesce(
        app.current_user_has_exact_role_for_org(
          p_organization_id,
          array['bt']::text[]
        ),
        false
      )
      and not coalesce(
        app.current_user_has_exact_role_for_org(
          p_organization_id,
          array['admin', 'admin_schedule', 'midtier', 'bcba', 'therapist']::text[]
        ),
        false
      )
    )
    or coalesce(
      app.current_user_has_exact_active_role_for_org(
        p_organization_id,
        array['therapist']::text[]
      ),
      false
    )
  ) then
    return false;
  end if;

  return exists (
    select 1
    from public.therapists therapist
    where therapist.id = p_therapist_id
      and therapist.organization_id = p_organization_id
      and therapist.status = 'active'
      and therapist.deleted_at is null
      and upper(btrim(coalesce(therapist.title, ''))) in ('BT', 'RBT')
      and (
        therapist.id = v_actor
        or exists (
          select 1
          from public.user_therapist_links utl
          where utl.user_id = v_actor
            and utl.therapist_id = therapist.id
        )
      )
  );
end;
$$;

revoke all on function app.current_user_can_act_as_bt_closeout_actor(uuid, uuid) from public, anon, authenticated;
grant execute on function app.current_user_can_act_as_bt_closeout_actor(uuid, uuid) to service_role;

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

  select coalesce(
    app.current_user_can_act_as_bt_closeout_actor(
      v_session.organization_id,
      v_session.therapist_id
    ),
    false
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

create or replace function public.create_supervision_session_note_request_for_completed_session(
  p_session_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_org uuid;
  v_request_id uuid;
  v_session record;
  v_request record;
  v_actor_is_admin boolean := false;
  v_actor_has_schedule_authority boolean := false;
  v_assigned_admin_user_id uuid;
begin
  if v_actor is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;
  if p_session_id is null then
    raise exception using errcode = '22023', message = 'Session id required';
  end if;

  v_actor_org := app.resolve_user_organization_id(v_actor);
  if v_actor_org is null then
    raise exception using errcode = '42501', message = 'Organization context required';
  end if;

  select
    s.id,
    s.organization_id,
    s.client_id,
    s.therapist_id,
    s.status,
    upper(btrim(coalesce(t.title, ''))) in ('BT', 'RBT') as is_bt_rbt
  into v_session
  from public.sessions s
  join public.therapists t
    on t.id = s.therapist_id
   and t.organization_id = s.organization_id
  where s.id = p_session_id
    and s.organization_id = v_actor_org
  for update;

  if v_session.id is null then
    raise exception using errcode = '42501', message = 'Session not found in caller organization';
  end if;
  if v_session.status <> 'completed' then
    return null;
  end if;
  if coalesce(v_session.is_bt_rbt, false) is not true then
    return null;
  end if;
  if app.has_complete_bt_review_packet(v_actor_org, v_session.id) is not true then
    return null;
  end if;

  v_actor_is_admin := app.user_has_any_active_role_for_org(
    v_actor,
    v_actor_org,
    array['admin', 'super_admin', 'org_admin', 'org_super_admin']
  );
  v_actor_has_schedule_authority := app.user_has_any_active_role_for_org(
    v_actor,
    v_actor_org,
    array['admin_schedule', 'midtier', 'bcba']
  );

  if coalesce(v_actor_is_admin, false) is not true
     and coalesce(v_actor_has_schedule_authority, false) is not true
     and not coalesce(
       app.current_user_can_act_as_bt_closeout_actor(
         v_actor_org,
         v_session.therapist_id
       ),
       false
     ) then
    raise exception using errcode = '42501', message = 'Caller cannot create supervision request for this session';
  end if;

  v_assigned_admin_user_id := app.resolve_supervision_bcba_assignee(v_actor_org, v_session.client_id);

  select request.*
  into v_request
  from public.supervision_session_note_requests request
  where request.session_id = v_session.id
    and request.organization_id = v_actor_org
  for update;

  if v_request.id is null then
    insert into public.supervision_session_note_requests (
      organization_id,
      session_id,
      client_id,
      bt_therapist_id,
      assigned_admin_user_id,
      requested_by,
      status
    ) values (
      v_actor_org,
      v_session.id,
      v_session.client_id,
      v_session.therapist_id,
      v_assigned_admin_user_id,
      v_actor,
      'pending'
    )
    on conflict (session_id) do nothing
    returning id into v_request_id;

    if v_request_id is not null then
      return v_request_id;
    end if;

    select request.*
    into v_request
    from public.supervision_session_note_requests request
    where request.session_id = v_session.id
      and request.organization_id = v_actor_org
    for update;

    if v_request.id is null then
      raise exception using errcode = '40001', message = 'Supervision request changed concurrently';
    end if;
  end if;

  if v_request.status = 'completed' then
    return v_request.id;
  end if;

  if v_request.status = 'cancelled' then
    update public.supervision_session_note_requests
    set status = 'pending',
        assigned_admin_user_id = app.resolve_supervision_bcba_assignee(v_actor_org, v_session.client_id),
        requested_by = coalesce(requested_by, v_actor),
        reopened_at = timezone('utc', now()),
        reopened_by = v_actor,
        reopen_source = 'structured_bt_closeout',
        completed_at = null,
        updated_at = timezone('utc', now())
    where id = v_request.id
      and organization_id = v_actor_org
    returning id into v_request_id;

    return v_request_id;
  end if;

  update public.supervision_session_note_requests
  set assigned_admin_user_id = coalesce(
        supervision_session_note_requests.assigned_admin_user_id,
        v_assigned_admin_user_id
      ),
      updated_at = timezone('utc', now())
  where id = v_request.id
    and organization_id = v_actor_org
  returning id into v_request_id;

  return v_request_id;
end;
$$;

create or replace function public.save_bt_aba_session_note_draft(
  p_session_id uuid,
  p_template_id uuid,
  p_note_payload jsonb,
  p_responses jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_session public.sessions;
  v_template public.session_note_templates;
  v_note public.client_session_notes;
  v_authorization public.authorizations;
  v_service_code text;
  v_strict_billing boolean := false;
  v_is_assigned_bt boolean := false;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_session_id is null or p_template_id is null
     or jsonb_typeof(coalesce(p_note_payload, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_responses, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid BT ABA draft payload';
  end if;

  select session.* into v_session
  from public.sessions session
  where session.id = p_session_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'session is out of scope';
  end if;

  select coalesce(
    app.current_user_can_act_as_bt_closeout_actor(
      v_session.organization_id,
      v_session.therapist_id
    ),
    false
  )
  into v_is_assigned_bt;

  if v_session.organization_id <> app.current_user_organization_id()
     or not v_is_assigned_bt
     or not public.current_user_can_capture_trial_event(v_session.organization_id, v_session.client_id) then
    raise exception using errcode = '42501', message = 'caller is not the assigned BT';
  end if;
  if v_session.status <> 'in_progress' then
    raise exception using errcode = '23514', message = 'session is not in progress';
  end if;

  select template.* into v_template
  from public.session_note_templates template
  where template.id = p_template_id
    and template.organization_id = v_session.organization_id
    and template.template_type = 'bt_aba_session_note';
  if not found then
    raise exception using errcode = '42501', message = 'BT ABA template is out of scope';
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

  select note.* into v_note
  from public.client_session_notes note
  where note.session_id = v_session.id
    and note.organization_id = v_session.organization_id
    and note.client_id = v_session.client_id
  order by note.created_at desc, note.id desc
  limit 1
  for update;

  if found and v_note.is_locked then
    raise exception using errcode = '23514', message = 'BT ABA session note is locked';
  end if;

  if v_note.id is null then
    insert into public.client_session_notes (
      authorization_id, client_id, therapist_id, organization_id, session_id,
      service_code, session_date, start_time, end_time, session_duration,
      goals_addressed, goal_ids, goal_measurements, goal_notes, narrative,
      is_locked, signed_at, created_by,
      bt_aba_template_id, bt_aba_template_snapshot, bt_aba_responses
    ) values (
      v_authorization.id, v_session.client_id, v_session.therapist_id,
      v_session.organization_id, v_session.id, coalesce(v_service_code, 'UNSPECIFIED'),
      v_session.start_time::date, v_session.start_time::time, v_session.end_time::time,
      greatest(1, round(extract(epoch from (v_session.end_time - v_session.start_time)) / 60)::integer),
      coalesce(array(select jsonb_array_elements_text(coalesce(p_note_payload->'goals_addressed', '[]'::jsonb))), '{}'::text[]),
      case when p_note_payload->'goal_ids' is null or p_note_payload->'goal_ids' = 'null'::jsonb then null
        else array(select jsonb_array_elements_text(p_note_payload->'goal_ids')) end,
      p_note_payload->'goal_measurements', p_note_payload->'goal_notes',
      coalesce(p_note_payload->>'narrative', ''), false, null, v_actor,
      p_template_id, v_template.template_structure, coalesce(p_responses, '{}'::jsonb)
    ) returning * into v_note;
  else
    update public.client_session_notes note
    set authorization_id = v_authorization.id,
        service_code = v_service_code,
        bt_aba_template_id = p_template_id,
        bt_aba_template_snapshot = v_template.template_structure,
        bt_aba_responses = coalesce(p_responses, '{}'::jsonb)
    where note.id = v_note.id
    returning note.* into v_note;
  end if;

  return jsonb_build_object('status', 'draft', 'note_id', v_note.id);
end;
$$;

create or replace function public.get_bt_aba_session_note(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_session public.sessions;
  v_note public.client_session_notes;
  v_template public.session_note_templates;
  v_request_id uuid;
  v_latest_amendment_responses jsonb;
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
  if not found or v_session.organization_id <> app.current_user_organization_id() then
    raise exception using errcode = '42501', message = 'session is out of scope';
  end if;

  select coalesce(
    app.current_user_can_act_as_bt_closeout_actor(
      v_session.organization_id,
      v_session.therapist_id
    ),
    false
  )
  into v_is_assigned_bt;

  if not v_is_assigned_bt then
    raise exception using errcode = '42501', message = 'caller is not the assigned BT';
  end if;

  select note.* into v_note
  from public.client_session_notes note
  where note.session_id = v_session.id
    and note.organization_id = v_session.organization_id
    and note.client_id = v_session.client_id
    and note.therapist_id = v_session.therapist_id
  order by note.created_at desc, note.id desc
  limit 1;

  select template.* into v_template
  from public.session_note_templates template
  where template.organization_id = v_session.organization_id
    and template.template_type = 'bt_aba_session_note'
    and (v_note.bt_aba_template_id is null or template.id = v_note.bt_aba_template_id)
  order by template.created_at desc, template.id desc
  limit 1;
  if not found then
    raise exception using errcode = '23514', message = 'BT ABA template is unavailable';
  end if;

  select request.id into v_request_id
  from public.supervision_session_note_requests request
  where request.session_id = v_session.id
    and request.organization_id = v_session.organization_id
    and request.client_id = v_session.client_id
    and request.bt_therapist_id = v_session.therapist_id
    and request.status in ('pending', 'correction_required', 'resubmitted', 'completed')
  order by request.created_at desc, request.id desc
  limit 1;

  if v_request_id is not null and v_note.id is not null then
    select amendment.bt_aba_responses into v_latest_amendment_responses
    from public.bt_session_note_amendments amendment
    where amendment.request_id = v_request_id
      and amendment.organization_id = v_session.organization_id
      and amendment.original_bt_note_id = v_note.id
    order by amendment.version_number desc, amendment.created_at desc, amendment.id desc
    limit 1;
  end if;

  return jsonb_build_object(
    'note_id', v_note.id,
    'template_id', v_template.id,
    'responses', case
      when v_note.id is null then null
      else coalesce(v_latest_amendment_responses, v_note.bt_aba_responses, '{}'::jsonb)
    end,
    'status', case when v_note.id is null then null when v_note.is_locked then 'completed' else 'draft' end
  );
end;
$$;

create or replace function public.finalize_bt_aba_session_note(
  p_session_id uuid,
  p_note_id uuid,
  p_note_payload jsonb,
  p_responses jsonb,
  p_trial_events jsonb default '[]'::jsonb,
  p_expected_target_versions jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_session public.sessions;
  v_note public.client_session_notes;
  v_template public.session_note_templates;
  v_missing_key text;
  v_field record;
  v_response jsonb;
  v_signature_method text;
  v_signature_value text;
  v_signature_points jsonb;
  v_note_json jsonb;
  v_progression_results jsonb := '[]'::jsonb;
  v_is_assigned_bt boolean := false;
  v_authorization public.authorizations;
  v_service_code text;
  v_strict_billing boolean := false;
  v_canonical_note_payload jsonb;
  v_result jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_session_id is null or p_note_id is null then
    raise exception using errcode = '22023', message = 'invalid BT ABA finalization payload';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text, 1));
  select session.* into v_session
  from public.sessions session
  where session.id = p_session_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'session is out of scope';
  end if;
  if v_session.organization_id <> app.current_user_organization_id() then
    raise exception using errcode = '42501', message = 'session is out of scope';
  end if;
  if v_session.status <> 'in_progress' and v_session.status <> 'completed' then
    raise exception using errcode = '23514', message = 'session cannot be finalized';
  end if;

  select note.* into v_note
  from public.client_session_notes note
  where note.id = p_note_id
    and note.session_id = v_session.id
    and note.organization_id = v_session.organization_id
    and note.client_id = v_session.client_id
    and note.therapist_id = v_session.therapist_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'BT ABA note is out of scope';
  end if;
  if v_session.status = 'completed' then
    if not v_note.is_locked
       or v_note.signed_at is null
       or v_note.bt_aba_template_id is null
       or v_note.bt_aba_responses is null
       or v_note.bt_aba_finalization_result is null
       or not exists (
         select 1
         from public.session_note_attestations attestation
         where attestation.note_id = v_note.id
           and attestation.organization_id = v_session.organization_id
           and attestation.signer_user_id = v_actor
           and attestation.attestation_role = 'bt'
       ) then
      raise exception using errcode = '23514', message = 'completed session does not have a finalized BT ABA note';
    end if;
    return v_note.bt_aba_finalization_result;
  end if;

  select coalesce(
    app.current_user_can_act_as_bt_closeout_actor(
      v_session.organization_id,
      v_session.therapist_id
    ),
    false
  )
  into v_is_assigned_bt;

  if not v_is_assigned_bt
     or not public.current_user_can_capture_trial_event(v_session.organization_id, v_session.client_id) then
    raise exception using errcode = '42501', message = 'caller is not the assigned BT';
  end if;

  if jsonb_typeof(coalesce(p_note_payload, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_responses, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_trial_events, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_expected_target_versions, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'invalid BT ABA finalization payload';
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
  v_canonical_note_payload :=
    (p_note_payload - 'authorization_id' - 'requested_service_code')
    || jsonb_build_object(
      'authorization_id', v_authorization.id,
      'requested_service_code', v_service_code
    );

  select template.* into v_template
  from public.session_note_templates template
  where template.id = v_note.bt_aba_template_id
    and template.organization_id = v_session.organization_id
    and template.template_type = 'bt_aba_session_note';
  if not found then
    raise exception using errcode = '42501', message = 'BT ABA template is out of scope';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(p_responses) response_key
    where not exists (
      select 1
      from jsonb_array_elements(v_template.template_structure->'sections') section(value)
      cross join lateral jsonb_array_elements(coalesce(section.value->'fields', '[]'::jsonb)) item(value)
      where item.value->>'key' = response_key
    )
  ) then
    raise exception using errcode = '23514', message = 'invalid BT ABA session note response type or option';
  end if;

  for v_field in
    select
      item.value->>'key' as field_key,
      item.value->>'type' as field_type,
      coalesce(item.value->'options', '[]'::jsonb) as options
    from jsonb_array_elements(v_template.template_structure->'sections') section(value)
    cross join lateral jsonb_array_elements(coalesce(section.value->'fields', '[]'::jsonb)) item(value)
  loop
    v_response := p_responses->v_field.field_key;
    if v_response is null then
      continue;
    end if;

    if v_field.field_type = 'multi_select' then
      if jsonb_typeof(v_response) <> 'array'
         or jsonb_array_length(v_response) = 0
         or exists (
           select 1
           from jsonb_array_elements(v_response) option(value)
           where jsonb_typeof(option.value) <> 'string'
             or not (v_field.options ? (option.value #>> '{}'))
         ) then
        raise exception using errcode = '23514', message = 'invalid BT ABA session note response type or option';
      end if;
    elsif v_field.field_type = 'radio' then
      if jsonb_typeof(v_response) <> 'string'
         or not (v_field.options ? (v_response #>> '{}')) then
        raise exception using errcode = '23514', message = 'invalid BT ABA session note response type or option';
      end if;
    elsif v_field.field_type in ('text', 'textarea') then
      if jsonb_typeof(v_response) <> 'string' then
        raise exception using errcode = '23514', message = 'invalid BT ABA session note response type or option';
      end if;
    elsif v_field.field_type = 'boolean' then
      if jsonb_typeof(v_response) <> 'boolean' then
        raise exception using errcode = '23514', message = 'invalid BT ABA session note response type or option';
      end if;
    elsif v_field.field_type = 'signature' then
      if jsonb_typeof(v_response) <> 'object'
         or jsonb_typeof(v_response->'method') <> 'string'
         or jsonb_typeof(v_response->'value') <> 'string'
         or exists (
           select 1 from jsonb_object_keys(v_response) signature_key
           where signature_key not in ('method', 'value')
         ) then
        raise exception using errcode = '23514', message = 'invalid BT ABA session note response type or option';
      end if;
    else
      raise exception using errcode = '23514', message = 'invalid BT ABA session note response type or option';
    end if;
  end loop;

  select field.field_key into v_missing_key
  from (
    select item.value->>'key' as field_key,
      coalesce((item.value->>'required')::boolean, false) as is_required,
      item.value->>'required_when' as required_when
    from jsonb_array_elements(v_template.template_structure->'sections') section(value)
    cross join lateral jsonb_array_elements(coalesce(section.value->'fields', '[]'::jsonb)) item(value)
  ) field
  where (
      field.is_required
      or (
        field.required_when like '% includes %'
        and coalesce(p_responses->btrim(split_part(field.required_when, ' includes ', 1)), '[]'::jsonb)
          ? btrim(split_part(field.required_when, ' includes ', 2))
      )
    )
    and case
      when jsonb_typeof(p_responses->field.field_key) = 'array'
        then jsonb_array_length(p_responses->field.field_key) = 0
      when jsonb_typeof(p_responses->field.field_key) = 'boolean'
        then false
      when jsonb_typeof(p_responses->field.field_key) = 'object'
        then p_responses->field.field_key = '{}'::jsonb
      else nullif(btrim(coalesce(p_responses->>field.field_key, '')), '') is null
    end
  limit 1;
  if v_missing_key is not null then
    raise exception using errcode = '23514', message = 'required BT ABA session note response missing';
  end if;

  if (p_responses->'skill_strategies' ? 'N/A' and jsonb_array_length(p_responses->'skill_strategies') > 1)
     or (p_responses->'behavior_strategies' ? 'N/A' and jsonb_array_length(p_responses->'behavior_strategies') > 1) then
    raise exception using errcode = '23514', message = 'N/A must be selected exclusively';
  end if;
  v_signature_method := nullif(btrim(p_responses->'bt_signature'->>'method'), '');
  v_signature_value := nullif(btrim(p_responses->'bt_signature'->>'value'), '');
  if v_signature_method not in ('drawn', 'typed') or v_signature_value is null then
    raise exception using errcode = '23514', message = 'valid BT signature is required';
  end if;
  if v_signature_method = 'typed' and char_length(v_signature_value) > 200 then
    raise exception using errcode = '23514', message = 'valid BT signature is required';
  end if;
  if v_signature_method = 'drawn' then
    if char_length(v_signature_value) > 20000 or left(v_signature_value, 7) <> 'points:' then
      raise exception using errcode = '23514', message = 'invalid drawn BT signature serialization';
    end if;
    begin
      v_signature_points := substring(v_signature_value from 8)::jsonb;
    exception when others then
      raise exception using errcode = '23514', message = 'invalid drawn BT signature serialization';
    end;
    if jsonb_typeof(v_signature_points) <> 'array'
       or jsonb_array_length(v_signature_points) = 0
       or jsonb_array_length(v_signature_points) > 256
       or not exists (
         select 1 from jsonb_array_elements(v_signature_points) point(value)
         where point.value <> 'null'::jsonb
       )
       or exists (
         select 1
         from jsonb_array_elements(v_signature_points) point(value)
         where case
           when point.value = 'null'::jsonb then false
           when jsonb_typeof(point.value) <> 'array' then true
           when jsonb_array_length(point.value) <> 2 then true
           when jsonb_typeof(point.value->0) <> 'number'
             or jsonb_typeof(point.value->1) <> 'number' then true
           else (point.value->>0)::numeric < 0
             or (point.value->>0)::numeric > 1
             or (point.value->>1)::numeric < 0
             or (point.value->>1)::numeric > 1
         end
       ) then
      raise exception using errcode = '23514', message = 'invalid drawn BT signature serialization';
    end if;
  end if;

  if v_session.status = 'in_progress' then
    update public.client_session_notes note
    set authorization_id = v_authorization.id,
        service_code = v_service_code,
        bt_aba_responses = p_responses,
        bt_aba_template_snapshot = v_template.template_structure
    where note.id = v_note.id;

    update public.sessions session
    set status = 'completed', updated_by = v_actor, updated_at = timezone('utc', now())
    where session.id = v_session.id;
  end if;

  select finalized.note, finalized.progression_results
  into v_note_json, v_progression_results
  from public.finalize_session_note_with_progression(
    v_session.id,
    v_note.id,
    v_canonical_note_payload,
    coalesce(p_trial_events, '[]'::jsonb),
    coalesce(p_expected_target_versions, '[]'::jsonb)
  ) finalized;

  insert into public.session_note_attestations (
    organization_id, note_id, signer_user_id, attestation_role,
    signature_method, signature_value, signed_at
  ) values (
    v_session.organization_id, v_note.id, v_actor, 'bt',
    v_signature_method, v_signature_value, timezone('utc', now())
  ) on conflict (note_id, attestation_role, signer_user_id) do nothing;

  if not exists (
    select 1 from public.session_audit_logs audit
    where audit.session_id = v_session.id
      and audit.event_type = 'session_completed'
  ) then
    perform public.record_session_audit(
      v_session.id,
      'session_completed',
      v_actor,
      jsonb_build_object(
        'outcome', 'completed',
        'startTime', v_session.start_time,
        'endTime', v_session.end_time,
        'notes', coalesce(p_note_payload->>'narrative', ''),
        'noteId', v_note.id,
        'source', 'bt_aba_session_note'
      )
    );
  end if;

  perform public.create_supervision_session_note_request_for_completed_session(v_session.id);

  v_result := jsonb_build_object(
    'status', 'completed',
    'note_id', v_note.id,
    'note', v_note_json,
    'progression_results', coalesce(v_progression_results, '[]'::jsonb)
  );

  update public.client_session_notes
  set bt_aba_finalization_result = v_result
  where id = v_note.id;

  return v_result;
end;
$$;

revoke execute on function public.resolve_assigned_bt_session_capture_billing(uuid) from public, anon;
grant execute on function public.resolve_assigned_bt_session_capture_billing(uuid) to authenticated;
revoke all on function public.create_supervision_session_note_request_for_completed_session(uuid) from public, anon;
grant execute on function public.create_supervision_session_note_request_for_completed_session(uuid) to authenticated, service_role;
revoke execute on function public.save_bt_aba_session_note_draft(uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_bt_aba_session_note_draft(uuid, uuid, jsonb, jsonb) to authenticated, service_role;
revoke execute on function public.get_bt_aba_session_note(uuid) from public, anon;
grant execute on function public.get_bt_aba_session_note(uuid) to authenticated, service_role;
revoke execute on function public.finalize_bt_aba_session_note(uuid, uuid, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.finalize_bt_aba_session_note(uuid, uuid, jsonb, jsonb, jsonb, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
