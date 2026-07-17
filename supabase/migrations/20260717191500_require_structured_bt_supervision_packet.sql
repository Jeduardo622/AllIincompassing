/*
  @migration-intent: Fail closed unless BCBA supervision review uses the latest immutable structured BT ABA note and BT attestation.
  @migration-dependencies: 20260717163000_route_bt_notes_to_assigned_bcba.sql
  @migration-rollback: Restore the get_pending_supervision_review_packets() and complete_supervision_session_note_request(uuid, uuid, jsonb) definitions from 20260717163000_route_bt_notes_to_assigned_bcba.sql, then drop app.has_complete_bt_review_packet(uuid, uuid).
*/

begin;

create or replace function app.has_complete_bt_review_packet(
  p_organization_id uuid,
  p_session_id uuid
) returns boolean
language sql stable security definer
set search_path = public, app, auth
as $$
  select exists (
    select 1
    from (
      select
        note.id,
        note.bt_aba_responses,
        note.bt_aba_template_snapshot
      from public.client_session_notes note
      where note.organization_id = p_organization_id
        and note.session_id = p_session_id
      order by note.created_at desc, note.id desc
      limit 1
    ) note
    where jsonb_typeof(note.bt_aba_responses) = 'object'
      and jsonb_typeof(note.bt_aba_template_snapshot) = 'object'
      and exists (
        select 1
        from public.session_note_attestations attestation
        where attestation.organization_id = p_organization_id
          and attestation.note_id = note.id
          and attestation.supervision_note_id is null
          and attestation.attestation_role = 'bt'
      )
  );
$$;

revoke all on function app.has_complete_bt_review_packet(uuid, uuid) from public, anon, authenticated;
grant execute on function app.has_complete_bt_review_packet(uuid, uuid) to service_role;

create or replace function public.get_pending_supervision_review_packets()
returns table (
  request_id uuid,
  organization_id uuid,
  session_id uuid,
  client_id uuid,
  bt_therapist_id uuid,
  assigned_reviewer_user_id uuid,
  request_status text,
  request_created_at timestamptz,
  session_start_time timestamptz,
  session_end_time timestamptz,
  place_of_service text,
  client_name text,
  bt_therapist_name text,
  bt_therapist_title text,
  bt_note_id uuid,
  bt_responses jsonb,
  bt_template_snapshot jsonb,
  bt_signature_method text,
  bt_signed_at timestamptz,
  supervision_template_id uuid,
  supervision_template_name text,
  supervision_template_structure jsonb,
  can_complete boolean
)
language plpgsql
security definer
set search_path = public, app, auth
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_org uuid;
begin
  if v_actor is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;

  v_actor_org := app.resolve_user_organization_id(v_actor);
  if v_actor_org is null then
    raise exception using errcode = '42501', message = 'Organization context required';
  end if;

  if exists (
    select 1
    from public.supervision_session_note_requests request
    join public.sessions session
      on session.id = request.session_id
     and session.organization_id = request.organization_id
    join public.clients client
      on client.id = request.client_id
     and client.organization_id = request.organization_id
    join public.therapists therapist
      on therapist.id = request.bt_therapist_id
     and therapist.organization_id = request.organization_id
    left join lateral (
      select note.id
      from public.client_session_notes note
      where note.session_id = request.session_id
        and note.organization_id = request.organization_id
      order by note.created_at desc, note.id desc
      limit 1
    ) bt_note on true
    where request.organization_id = v_actor_org
      and request.status = 'pending'
      and app.has_complete_bt_review_packet(request.organization_id, request.session_id) is not true
      and (
        app.user_has_any_active_role_for_org(
          auth.uid(),
          request.organization_id,
          array['admin', 'super_admin', 'org_admin', 'org_super_admin']
        )
        or (
          request.assigned_admin_user_id = auth.uid()
          and app.user_has_exact_active_role_for_org(
            auth.uid(),
            request.organization_id,
            array['bcba']::text[]
          )
        )
      )
  ) then
    raise exception using errcode = '23514', message = 'Pending supervision request lacks a complete structured BT review packet';
  end if;

  return query
  select
    request.id as request_id,
    request.organization_id,
    request.session_id,
    request.client_id,
    request.bt_therapist_id,
    request.assigned_admin_user_id as assigned_reviewer_user_id,
    request.status as request_status,
    request.created_at as request_created_at,
    session.start_time as session_start_time,
    session.end_time as session_end_time,
    session.location_type as place_of_service,
    client.full_name as client_name,
    therapist.full_name as bt_therapist_name,
    therapist.title as bt_therapist_title,
    bt_note.id as bt_note_id,
    bt_note.bt_aba_responses as bt_responses,
    bt_note.bt_aba_template_snapshot,
    bt_attestation.signature_method as bt_signature_method,
    bt_attestation.signed_at as bt_signed_at,
    template.id as supervision_template_id,
    template.template_name as supervision_template_name,
    template.template_structure as supervision_template_structure,
    (
      v_actor = request.assigned_admin_user_id
      and app.user_has_exact_active_role_for_org(
        v_actor,
        request.organization_id,
        array['bcba']::text[]
      )
    ) as can_complete
  from public.supervision_session_note_requests request
  join public.sessions session
    on session.id = request.session_id
   and session.organization_id = request.organization_id
  join public.clients client
    on client.id = request.client_id
   and client.organization_id = request.organization_id
  join public.therapists therapist
    on therapist.id = request.bt_therapist_id
   and therapist.organization_id = request.organization_id
  left join lateral (
    select note.*
    from public.client_session_notes note
    where note.session_id = request.session_id
      and note.organization_id = request.organization_id
    order by note.created_at desc, note.id desc
    limit 1
  ) bt_note on true
  left join lateral (
    select attestation.signature_method, attestation.signed_at
    from public.session_note_attestations attestation
    where attestation.note_id = bt_note.id
      and attestation.organization_id = request.organization_id
      and attestation.attestation_role = 'bt'
    order by attestation.signed_at desc, attestation.id desc
    limit 1
  ) bt_attestation on true
  left join lateral (
    select seeded_template.id, seeded_template.template_name, seeded_template.template_structure
    from public.session_note_templates seeded_template
    where seeded_template.organization_id = request.organization_id
      and seeded_template.template_type = 'supervision_session_note'
      and seeded_template.template_name = 'Supervision Session Note'
    order by seeded_template.updated_at desc, seeded_template.id desc
    limit 1
  ) template on true
  where request.organization_id = v_actor_org
    and request.status = 'pending'
    and app.has_complete_bt_review_packet(request.organization_id, request.session_id) is true
    and (
      app.user_has_any_active_role_for_org(
        auth.uid(),
        request.organization_id,
        array['admin', 'super_admin', 'org_admin', 'org_super_admin']
      )
      or (
        request.assigned_admin_user_id = auth.uid()
        and app.user_has_exact_active_role_for_org(
          auth.uid(),
          request.organization_id,
          array['bcba']::text[]
        )
      )
    );
end;
$$;

revoke all on function public.get_pending_supervision_review_packets() from public, anon;
grant execute on function public.get_pending_supervision_review_packets() to authenticated, service_role;

create or replace function public.complete_supervision_session_note_request(
  p_request_id uuid,
  p_template_id uuid,
  p_responses jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, app, auth
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_org uuid;
  v_request record;
  v_template record;
  v_responses jsonb := coalesce(p_responses, '{}'::jsonb);
  v_missing_key text;
  v_note_id uuid;
  v_bt_note_id uuid;
  v_signature_method text;
  v_signature_value text;
  v_signature_points jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;

  if p_request_id is null or p_template_id is null then
    raise exception using errcode = '22023', message = 'Request and template are required';
  end if;

  v_actor_org := app.resolve_user_organization_id(v_actor);
  if v_actor_org is null then
    raise exception using errcode = '42501', message = 'Organization context required';
  end if;

  if app.user_has_exact_active_role_for_org(
    v_actor,
    v_actor_org,
    array['bcba']::text[]
  ) is not true then
    raise exception using errcode = '42501', message = 'Assigned BCBA supervision note access required';
  end if;

  select
    r.id,
    r.organization_id,
    r.session_id,
    r.status,
    r.assigned_admin_user_id
  into v_request
  from public.supervision_session_note_requests r
  where r.id = p_request_id
    and r.organization_id = v_actor_org
  for update;

  if v_request.id is null then
    raise exception using errcode = '42501', message = 'Supervision request not found in caller organization';
  end if;

  if v_request.assigned_admin_user_id is distinct from v_actor then
    raise exception using errcode = '42501', message = 'Assigned BCBA supervision note access required';
  end if;

  if v_request.status <> 'pending' then
    raise exception using errcode = '23514', message = 'Supervision request is not pending';
  end if;

  perform 1
  from public.sessions session
  where session.id = v_request.session_id
    and session.organization_id = v_actor_org
  for update;

  select
    t.id,
    t.template_structure
  into v_template
  from public.session_note_templates t
  where t.id = p_template_id
    and t.organization_id = v_actor_org
    and t.template_type = 'supervision_session_note'
    and t.template_name = 'Supervision Session Note';

  if v_template.id is null then
    raise exception using errcode = '42501', message = 'Canonical supervision template not found in caller organization';
  end if;

  select template_field.field_key
  into v_missing_key
  from (
    select
      field.value->>'key' as field_key,
      coalesce((field.value->>'required')::boolean, false) as is_required,
      field.value->>'required_when' as required_when
    from jsonb_array_elements(v_template.template_structure->'sections') section(value)
    cross join lateral jsonb_array_elements(coalesce(section.value->'fields', '[]'::jsonb)) field(value)
    where field.value ? 'key'
  ) template_field
  where (
      template_field.is_required is true
      or (
        template_field.required_when like '% includes %'
        and case
          when jsonb_typeof(v_responses->btrim(split_part(template_field.required_when, ' includes ', 1))) = 'array' then
            v_responses->btrim(split_part(template_field.required_when, ' includes ', 1)) ? btrim(split_part(template_field.required_when, ' includes ', 2))
          else
            btrim(coalesce(v_responses->>btrim(split_part(template_field.required_when, ' includes ', 1)), '')) = btrim(split_part(template_field.required_when, ' includes ', 2))
        end
      )
    )
    and case
      when jsonb_typeof(v_responses->template_field.field_key) = 'array' then
        jsonb_array_length(coalesce(v_responses->template_field.field_key, '[]'::jsonb)) = 0
      when jsonb_typeof(v_responses->template_field.field_key) = 'boolean' then
        coalesce((v_responses->>template_field.field_key)::boolean, false) is false
      when jsonb_typeof(v_responses->template_field.field_key) = 'object' then
        v_responses->template_field.field_key = '{}'::jsonb
      else
        nullif(btrim(coalesce(v_responses->>template_field.field_key, '')), '') is null
    end
  limit 1;

  if v_missing_key is not null then
    raise exception using errcode = '23514', message = 'Required supervision note response missing';
  end if;

  if nullif(btrim(coalesce(v_responses->>'bcba_licensure_credential', '')), '') is null then
    raise exception using errcode = '23514', message = 'Required supervision note response missing';
  end if;

  v_signature_method := btrim(coalesce(p_responses #>> '{bcba_supervisor_signature,method}', ''));
  v_signature_value := btrim(coalesce(p_responses #>> '{bcba_supervisor_signature,value}', ''));
  if v_signature_method not in ('typed', 'drawn')
     or v_signature_value = ''
     or char_length(v_signature_value) > 16384 then
    raise exception using errcode = '23514', message = 'invalid BCBA signature';
  end if;

  if v_signature_method = 'drawn' then
    if left(v_signature_value, 7) <> 'points:' then
      raise exception using errcode = '23514', message = 'invalid BCBA signature';
    end if;

    begin
      v_signature_points := substring(v_signature_value from 8)::jsonb;
    exception when others then
      raise exception using errcode = '23514', message = 'invalid BCBA signature';
    end;

    if jsonb_typeof(v_signature_points) <> 'array'
       or jsonb_array_length(v_signature_points) = 0
       or jsonb_array_length(v_signature_points) > 256
       or not exists (
         select 1
         from jsonb_array_elements(v_signature_points) point(value)
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
      raise exception using errcode = '23514', message = 'invalid BCBA signature';
    end if;
  end if;

  insert into public.supervision_session_notes (
    organization_id,
    request_id,
    session_id,
    template_id,
    completed_by,
    responses,
    signed_at
  )
  values (
    v_actor_org,
    v_request.id,
    v_request.session_id,
    p_template_id,
    v_actor,
    v_responses,
    timezone('utc', now())
  )
  on conflict (request_id) do nothing
  returning id into v_note_id;

  if v_note_id is null then
    raise exception using errcode = '23514', message = 'Supervision request is not pending';
  end if;

  select note.id
  into v_bt_note_id
  from public.client_session_notes note
  where note.session_id = v_request.session_id
    and note.organization_id = v_actor_org
  order by note.created_at desc, note.id desc
  limit 1;

  if v_bt_note_id is null
     or app.has_complete_bt_review_packet(v_actor_org, v_request.session_id) is not true then
    raise exception using errcode = '23514', message = 'Complete structured BT session note and attestation required before supervision completion';
  end if;

  insert into public.session_note_attestations (
    organization_id, note_id, supervision_note_id, signer_user_id, attestation_role,
    signature_method, signature_value, signed_at
  ) values (
    v_actor_org, null, v_note_id, v_actor, 'bcba',
    v_signature_method, v_signature_value, timezone('utc', now())
  );

  update public.supervision_session_note_requests
  set status = 'completed',
      completed_at = coalesce(completed_at, timezone('utc', now())),
      updated_at = timezone('utc', now())
  where id = v_request.id
    and organization_id = v_actor_org;

  return v_note_id;
end;
$$;

revoke all on function public.complete_supervision_session_note_request(uuid, uuid, jsonb) from public, anon;
grant execute on function public.complete_supervision_session_note_request(uuid, uuid, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
