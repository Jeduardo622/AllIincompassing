-- @migration-intent: Add auditable cancellation and packet-gated reopen behavior to the one-request-per-session BCBA review queue, and keep reconciliation create-only.
-- @migration-dependencies: 20260717191500_require_structured_bt_supervision_packet.sql
-- @migration-rollback: Restore the creator and reconcile RPC definitions from 20260717163000_route_bt_notes_to_assigned_bcba.sql and the completion RPC definition from 20260717191500_require_structured_bt_supervision_packet.sql, drop the two lifecycle provenance constraints, then drop reopened_at, reopened_by, reopen_source, cancelled_at, cancelled_by, cancellation_reason, and cancellation_source after application code no longer depends on them.

begin;

alter table public.supervision_session_note_requests
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references auth.users(id) on delete set null,
  add column if not exists cancellation_reason text,
  add column if not exists cancellation_source text,
  add column if not exists reopened_at timestamptz,
  add column if not exists reopened_by uuid references auth.users(id) on delete set null,
  add column if not exists reopen_source text;

update public.supervision_session_note_requests
set cancellation_reason = left(coalesce(nullif(btrim(cancellation_reason), ''), 'cancelled'), 512),
    cancellation_source = coalesce(nullif(btrim(cancellation_source), ''), 'legacy_cancel'),
    cancelled_at = coalesce(cancelled_at, updated_at, created_at)
where status = 'cancelled';

create index if not exists supervision_session_note_requests_cancelled_by_idx
  on public.supervision_session_note_requests (cancelled_by)
  where cancelled_by is not null;

create index if not exists supervision_session_note_requests_reopened_by_idx
  on public.supervision_session_note_requests (reopened_by)
  where reopened_by is not null;

alter table public.supervision_session_note_requests
  drop constraint if exists supervision_session_note_requests_cancelled_provenance_chk;

alter table public.supervision_session_note_requests
  add constraint supervision_session_note_requests_cancelled_provenance_chk
  check (
    status <> 'cancelled'
    or (
      cancelled_at is not null
      and nullif(btrim(cancellation_reason), '') is not null
      and char_length(cancellation_reason) <= 512
      and nullif(btrim(cancellation_source), '') is not null
    )
  );

alter table public.supervision_session_note_requests
  drop constraint if exists supervision_session_note_requests_reopen_provenance_chk;

alter table public.supervision_session_note_requests
  add constraint supervision_session_note_requests_reopen_provenance_chk
  check (
    num_nonnulls(reopened_at, reopen_source) in (0, 2)
    and num_nonnulls(reopened_at, reopened_by, reopen_source) in (0, 3)
  );

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

revoke all on function public.create_supervision_session_note_request_for_completed_session(uuid) from public, anon;
grant execute on function public.create_supervision_session_note_request_for_completed_session(uuid) to authenticated, service_role;

create or replace function public.complete_supervision_session_note_request(
  p_request_id uuid,
  p_template_id uuid,
  p_responses jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
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
  from public.sessions session
  join public.supervision_session_note_requests r
    on r.session_id = session.id
   and r.organization_id = session.organization_id
  where session.organization_id = v_actor_org
    and r.id = p_request_id
  for update of session;

  if v_request.id is null then
    raise exception using errcode = '42501', message = 'Supervision request not found in caller organization';
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

create or replace function public.reconcile_supervision_session_note_requests(
  p_since timestamptz default timezone('utc', now()) - interval '14 days'
)
returns integer
language plpgsql
security definer
set search_path = ''
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

  v_actor_is_admin := app.user_has_any_active_role_for_org(
    v_actor,
    v_actor_org,
    array['admin', 'super_admin', 'org_admin', 'org_super_admin']
  );
  v_actor_is_bcba := app.user_has_exact_active_role_for_org(
    v_actor,
    v_actor_org,
    array['bcba']::text[]
  );

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
   and existing.organization_id = s.organization_id
  where s.organization_id = v_actor_org
    and s.status = 'completed'
    and s.therapist_id is not null
    and upper(btrim(coalesce(t.title, ''))) in ('BT', 'RBT')
    and coalesce(s.end_time, s.start_time, s.created_at) >= coalesce(p_since, timezone('utc', now()) - interval '14 days')
    and app.has_complete_bt_review_packet(s.organization_id, s.id) is true
    and existing.id is null
  on conflict (session_id) do nothing;

  get diagnostics v_inserted = row_count;

  with resolved as (
    select
      request.id,
      app.resolve_supervision_bcba_assignee(request.organization_id, request.client_id) as assigned_user_id
    from public.supervision_session_note_requests request
    where request.organization_id = v_actor_org
      and request.status = 'pending'
      and request.assigned_admin_user_id is null
      and app.has_complete_bt_review_packet(request.organization_id, request.session_id) is true
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

notify pgrst, 'reload schema';

commit;
