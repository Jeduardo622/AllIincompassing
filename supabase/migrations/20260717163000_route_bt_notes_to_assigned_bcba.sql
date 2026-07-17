/*
  @migration-intent: Route BT supervision reviews to a deterministically assigned BCBA, expose pending BT review packets, and require an assigned exact-BCBA completion attestation.
  @migration-dependencies: 20260629233000_create_supervision_session_note_workflow.sql,20260716212837_bt_aba_session_note_closeout.sql,20260717144005_require_supervision_session_note_fields.sql
  @migration-rollback: Restore the prior supervision request select policies and request/completion RPC definitions from 20260629233000_create_supervision_session_note_workflow.sql, then drop public.get_pending_supervision_review_packets() and app.resolve_supervision_bcba_assignee(uuid, uuid) if this routing contract is intentionally reverted.
*/

begin;

create or replace function app.resolve_supervision_bcba_assignee(
  p_organization_id uuid,
  p_client_id uuid
) returns uuid
language plpgsql stable security definer
set search_path = public, app, auth
as $$
declare
  v_linked_count integer := 0;
  v_linked_user_id uuid;
  v_org_count integer := 0;
  v_org_user_id uuid;
begin
  if p_organization_id is null or p_client_id is null
     or not exists (
       select 1 from public.clients c
       where c.id = p_client_id and c.organization_id = p_organization_id
     ) then
    return null;
  end if;

  select count(distinct utl.user_id),
         (array_agg(distinct utl.user_id order by utl.user_id))[1]
    into v_linked_count, v_linked_user_id
  from public.client_therapist_links ctl
  join public.therapists t
    on t.id = ctl.therapist_id
   and t.organization_id = p_organization_id
   and lower(coalesce(t.status, 'active')) = 'active'
   and t.deleted_at is null
  join public.user_therapist_links utl
    on utl.therapist_id = t.id
  join public.profiles p
    on p.id = utl.user_id
   and p.organization_id = p_organization_id
  where ctl.client_id = p_client_id
    and ctl.organization_id = p_organization_id
    and exists (
      select 1
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      where ur.user_id = utl.user_id
        and r.name = 'bcba'
        and coalesce(ur.is_active, true)
        and (ur.expires_at is null or ur.expires_at > now())
    );

  if v_linked_count = 1 then
    return v_linked_user_id;
  end if;

  select count(distinct p.id),
         (array_agg(distinct p.id order by p.id))[1]
    into v_org_count, v_org_user_id
  from public.profiles p
  where p.organization_id = p_organization_id
    and exists (
      select 1
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      where ur.user_id = p.id
        and r.name = 'bcba'
        and coalesce(ur.is_active, true)
        and (ur.expires_at is null or ur.expires_at > now())
    );

  if v_org_count = 1 then
    return v_org_user_id;
  end if;

  return null;
end;
$$;

revoke all on function app.resolve_supervision_bcba_assignee(uuid, uuid) from public, anon, authenticated;
grant execute on function app.resolve_supervision_bcba_assignee(uuid, uuid) to service_role;

drop policy if exists supervision_session_note_requests_admin_select on public.supervision_session_note_requests;
drop policy if exists supervision_session_note_requests_admin_or_assigned_bcba_select on public.supervision_session_note_requests;
create policy supervision_session_note_requests_admin_or_assigned_bcba_select
  on public.supervision_session_note_requests
  for select
  to authenticated
  using (
    app.user_has_role_for_org(
      auth.uid(),
      organization_id,
      array['admin', 'super_admin', 'org_admin', 'org_super_admin']
    )
    or (
      assigned_admin_user_id = auth.uid()
      and app.user_has_role_for_org(
        auth.uid(),
        organization_id,
        array['bcba']
      )
    )
  );

drop policy if exists supervision_session_notes_admin_select on public.supervision_session_notes;
drop policy if exists supervision_session_notes_admin_or_assigned_bcba_select on public.supervision_session_notes;
create policy supervision_session_notes_admin_or_assigned_bcba_select
  on public.supervision_session_notes
  for select
  to authenticated
  using (
    app.user_has_role_for_org(
      auth.uid(),
      organization_id,
      array['admin', 'super_admin', 'org_admin', 'org_super_admin']
    )
    or exists (
      select 1
      from public.supervision_session_note_requests request
      where request.id = supervision_session_notes.request_id
        and request.organization_id = supervision_session_notes.organization_id
        and request.assigned_admin_user_id = auth.uid()
        and app.user_has_role_for_org(
          auth.uid(),
          request.organization_id,
          array['bcba']
        )
    )
  );

create or replace function public.create_supervision_session_note_request_for_completed_session(
  p_session_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, app, auth
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_org uuid;
  v_request_id uuid;
  v_session record;
  v_actor_is_admin boolean := false;
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
    session.id,
    session.organization_id,
    session.client_id,
    session.therapist_id,
    session.status,
    upper(btrim(coalesce(therapist.title, ''))) in ('BT', 'RBT') as is_bt_rbt
  into v_session
  from public.sessions session
  join public.therapists therapist
    on therapist.id = session.therapist_id
   and therapist.organization_id = session.organization_id
  where session.id = p_session_id
    and session.organization_id = v_actor_org;

  if v_session.id is null then
    raise exception using errcode = '42501', message = 'Session not found in caller organization';
  end if;

  if v_session.status <> 'completed' then
    return null;
  end if;

  if coalesce(v_session.is_bt_rbt, false) is not true then
    return null;
  end if;

  v_actor_is_admin := app.user_has_role_for_org(
    v_actor,
    v_actor_org,
    array['admin', 'super_admin', 'org_admin', 'org_super_admin']
  );

  if coalesce(v_actor_is_admin, false) is not true
     and v_session.therapist_id <> v_actor
     and not (
       coalesce(app.current_user_has_exact_role_for_org(
         v_actor_org,
         array['bt']::text[]
       ), false)
       and not coalesce(app.current_user_has_exact_role_for_org(
         v_actor_org,
         array['admin', 'admin_schedule', 'midtier', 'bcba', 'therapist']::text[]
       ), false)
       and exists (
         select 1
         from public.user_therapist_links utl
         where utl.user_id = v_actor
           and utl.therapist_id = v_session.therapist_id
       )
     ) then
    raise exception using errcode = '42501', message = 'Caller cannot create supervision request for this session';
  end if;

  insert into public.supervision_session_note_requests (
    organization_id,
    session_id,
    client_id,
    bt_therapist_id,
    assigned_admin_user_id,
    requested_by,
    status
  )
  values (
    v_actor_org,
    v_session.id,
    v_session.client_id,
    v_session.therapist_id,
    app.resolve_supervision_bcba_assignee(v_actor_org, v_session.client_id),
    v_actor,
    'pending'
  )
  on conflict (session_id) do update
    set updated_at = timezone('utc', now()),
        assigned_admin_user_id = coalesce(
          supervision_session_note_requests.assigned_admin_user_id,
          excluded.assigned_admin_user_id
        )
  returning id into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.create_supervision_session_note_request_for_completed_session(uuid) from public, anon;
grant execute on function public.create_supervision_session_note_request_for_completed_session(uuid) to authenticated, service_role;

create or replace function public.reconcile_supervision_session_note_requests(
  p_since timestamptz default timezone('utc', now()) - interval '14 days'
)
returns integer
language plpgsql
security definer
set search_path = public, app, auth
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_org uuid;
  v_actor_is_admin boolean := false;
  v_actor_is_bcba boolean := false;
  v_inserted integer := 0;
  v_backfilled integer := 0;
begin
  if v_actor is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;

  v_actor_org := app.resolve_user_organization_id(v_actor);
  if v_actor_org is null then
    raise exception using errcode = '42501', message = 'Organization context required';
  end if;

  v_actor_is_admin := app.user_has_role_for_org(
    v_actor,
    v_actor_org,
    array['admin', 'super_admin', 'org_admin', 'org_super_admin']
  );
  v_actor_is_bcba := coalesce(app.current_user_has_exact_role_for_org(
    v_actor_org,
    array['bcba']::text[]
  ), false);

  if coalesce(v_actor_is_admin, false) is not true
     and coalesce(v_actor_is_bcba, false) is not true then
    raise exception using errcode = '42501', message = 'BCBA or admin supervision note access required';
  end if;

  insert into public.supervision_session_note_requests (
    organization_id,
    session_id,
    client_id,
    bt_therapist_id,
    assigned_admin_user_id,
    requested_by,
    status
  )
  select
    s.organization_id,
    s.id,
    s.client_id,
    s.therapist_id,
    app.resolve_supervision_bcba_assignee(s.organization_id, s.client_id),
    v_actor,
    'pending'
  from public.sessions s
  join public.therapists t
    on t.id = s.therapist_id
   and t.organization_id = s.organization_id
  left join public.supervision_session_note_requests existing
    on existing.session_id = s.id
  where s.organization_id = v_actor_org
    and s.status = 'completed'
    and s.therapist_id is not null
    and upper(btrim(coalesce(t.title, ''))) in ('BT', 'RBT')
    and coalesce(s.end_time, s.start_time, s.created_at) >= coalesce(p_since, timezone('utc', now()) - interval '14 days')
    and existing.id is null
  on conflict (session_id) do update
    set updated_at = timezone('utc', now()),
        assigned_admin_user_id = coalesce(
          supervision_session_note_requests.assigned_admin_user_id,
          excluded.assigned_admin_user_id
        );

  get diagnostics v_inserted = row_count;

  with resolved as (
    select
      request.id,
      app.resolve_supervision_bcba_assignee(request.organization_id, request.client_id) as assigned_user_id
    from public.supervision_session_note_requests request
    where request.organization_id = v_actor_org
      and request.status = 'pending'
      and request.assigned_admin_user_id is null
  )
  update public.supervision_session_note_requests request
  set assigned_admin_user_id = resolved.assigned_user_id,
      updated_at = timezone('utc', now())
  from resolved
  where request.id = resolved.id
    and request.status = 'pending'
    and request.assigned_admin_user_id is null
    and resolved.assigned_user_id is not null;

  get diagnostics v_backfilled = row_count;

  return v_inserted + v_backfilled;
end;
$$;

revoke all on function public.reconcile_supervision_session_note_requests(timestamptz) from public, anon;
grant execute on function public.reconcile_supervision_session_note_requests(timestamptz) to authenticated, service_role;

update public.session_note_templates as template
set
  template_structure = jsonb_set(
    template.template_structure,
    '{sections}',
    (
      select jsonb_agg(
        case
          when section.value ? 'fields' then jsonb_set(
            section.value,
            '{fields}',
            (
              select jsonb_agg(
                case
                  when field.value->>'key' in (
                    'bcba_supervisor_signature',
                    'bcba_licensure_credential'
                  ) then jsonb_set(field.value, '{required}', 'true'::jsonb, true)
                  else field.value
                end
                order by field.ordinality
              )
              from jsonb_array_elements(coalesce(section.value->'fields', '[]'::jsonb)) with ordinality as field(value, ordinality)
            ),
            true
          )
          else section.value
        end
        order by section.ordinality
      )
      from jsonb_array_elements(coalesce(template.template_structure->'sections', '[]'::jsonb)) with ordinality as section(value, ordinality)
    ),
    true
  ),
  updated_at = timezone('utc', now())
where template.template_type = 'supervision_session_note'
  and template.template_name = 'Supervision Session Note';

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
    therapist.name as bt_therapist_name,
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
      and coalesce(app.current_user_has_exact_role_for_org(
        request.organization_id,
        array['bcba']::text[]
      ), false)
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
  join lateral (
    select note.*
    from public.client_session_notes note
    where note.session_id = request.session_id
      and note.organization_id = request.organization_id
    order by note.updated_at desc, note.id
    limit 1
  ) bt_note on true
  left join public.session_note_attestations bt_attestation
    on bt_attestation.note_id = bt_note.id
   and bt_attestation.organization_id = request.organization_id
   and bt_attestation.attestation_role = 'bt'
  left join lateral (
    select seeded_template.id, seeded_template.template_name, seeded_template.template_structure
    from public.session_note_templates seeded_template
    where seeded_template.organization_id = request.organization_id
      and seeded_template.template_type = 'supervision_session_note'
    order by seeded_template.updated_at desc, seeded_template.id desc
    limit 1
  ) template on true
  where request.organization_id = v_actor_org
    and request.status = 'pending'
    and (
      app.user_has_role_for_org(
        auth.uid(),
        request.organization_id,
        array['admin', 'super_admin', 'org_admin', 'org_super_admin']
      )
      or (
        request.assigned_admin_user_id = auth.uid()
        and app.user_has_role_for_org(
          auth.uid(),
          request.organization_id,
          array['bcba']
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

  if coalesce(app.current_user_has_exact_role_for_org(
    v_actor_org,
    array['bcba']::text[]
  ), false) is not true then
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

  select
    t.id,
    t.template_structure
  into v_template
  from public.session_note_templates t
  where t.id = p_template_id
    and t.organization_id = v_actor_org
    and t.template_type = 'supervision_session_note';

  if v_template.id is null then
    raise exception using errcode = '42501', message = 'Supervision template not found in caller organization';
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

  v_signature_method := btrim(coalesce(p_responses #>> '{bcba_supervisor_signature,method}', ''));
  v_signature_value := btrim(coalesce(p_responses #>> '{bcba_supervisor_signature,value}', ''));
  if v_signature_method not in ('typed', 'drawn')
     or v_signature_value = ''
     or char_length(v_signature_value) > 4096 then
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
  order by note.updated_at desc, note.id
  limit 1;

  if v_bt_note_id is null then
    raise exception using errcode = '23514', message = 'BT session note is required before supervision completion';
  end if;

  insert into public.session_note_attestations (
    organization_id, note_id, signer_user_id, attestation_role,
    signature_method, signature_value, signed_at
  ) values (
    v_actor_org, v_bt_note_id, v_actor, 'bcba',
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
