-- @migration-intent: Align BT correction amendment storage and resubmission validation with method-aware signature size limits without weakening existing drawn-signature shape checks.
-- @migration-dependencies: 20260718225105_harden_supervision_correction_trigger_functions.sql
-- @migration-rollback: Restore the prior universal 200-character amendment signature constraint and pre-shape RPC limit only if existing hosted data already satisfies that narrower cap.

begin;

do $migration$
declare
  v_constraint record;
begin
  for v_constraint in
    select c.conname
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.bt_session_note_amendments'::regclass
      and c.contype = 'c'
      and (
        c.conname = 'bt_session_note_amendments_signature_value_check'
        or pg_catalog.pg_get_constraintdef(c.oid) ~* 'char_length\(signature_value\)'
      )
  loop
    execute format(
      'alter table public.bt_session_note_amendments drop constraint %I',
      v_constraint.conname
    );
  end loop;
end;
$migration$;

alter table public.bt_session_note_amendments
  add constraint bt_session_note_amendments_signature_value_check
  check (
    (signature_method = 'typed' and char_length(signature_value) <= 200)
    or (signature_method = 'drawn' and char_length(signature_value) <= 20000)
  );

create or replace function public.resubmit_bt_supervision_correction(
  p_request_id uuid,
  p_responses jsonb,
  p_signature_method text,
  p_signature_value text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_org uuid;
  v_request public.supervision_session_note_requests%rowtype;
  v_correction public.supervision_session_note_corrections%rowtype;
  v_original_note public.client_session_notes%rowtype;
  v_original_attestation record;
  v_template jsonb;
  v_responses jsonb := coalesce(p_responses, '{}'::jsonb);
  v_field record;
  v_response jsonb;
  v_missing_key text;
  v_signature_method text := nullif(btrim(coalesce(p_signature_method, '')), '');
  v_signature_value text := nullif(btrim(coalesce(p_signature_value, '')), '');
  v_signature_points jsonb;
  v_next_version integer;
  v_amendment_id uuid;
  v_is_exact_bt boolean := false;
begin
  if v_actor is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'Request id required';
  end if;

  v_actor_org := app.resolve_user_organization_id(v_actor);
  if v_actor_org is null then
    raise exception using errcode = '42501', message = 'Organization context required';
  end if;

  v_is_exact_bt := coalesce(
    app.user_has_exact_active_role_for_org(
      v_actor,
      v_actor_org,
      array['bt']::text[]
    ),
    false
  ) and not coalesce(
    app.user_has_exact_active_role_for_org(
      v_actor,
      v_actor_org,
      array['admin', 'admin_schedule', 'midtier', 'bcba', 'therapist']::text[]
    ),
    false
  );

  if not v_is_exact_bt then
    raise exception using errcode = '42501', message = 'Original BT correction access required';
  end if;
  if jsonb_typeof(v_responses) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid BT ABA finalization payload';
  end if;

  select request.*
  into v_request
  from public.supervision_session_note_requests request
  where request.id = p_request_id
    and request.organization_id = v_actor_org
  for update;

  if v_request.id is null then
    raise exception using errcode = '42501', message = 'Supervision request not found in caller organization';
  end if;
  if v_request.status <> 'correction_required' then
    raise exception using errcode = '23514', message = 'Supervision request is not awaiting BT correction';
  end if;

  select correction.*
  into v_correction
  from public.supervision_session_note_corrections correction
  where correction.request_id = v_request.id
    and correction.organization_id = v_actor_org
    and correction.resolved_at is null
  for update;

  if v_correction.id is null then
    raise exception using errcode = '23514', message = 'Active correction round not found';
  end if;

  select note.*
  into v_original_note
  from public.client_session_notes note
  where note.session_id = v_request.session_id
    and note.organization_id = v_actor_org
    and note.client_id = v_request.client_id
    and note.therapist_id = v_request.bt_therapist_id
  order by note.created_at desc, note.id desc
  limit 1
  for update;

  if v_original_note.id is null then
    raise exception using errcode = '23514', message = 'Original BT session note is unavailable';
  end if;

  select
    attestation.signer_user_id,
    attestation.signature_method,
    attestation.signature_value,
    attestation.signed_at
  into v_original_attestation
  from public.session_note_attestations attestation
  where attestation.note_id = v_original_note.id
    and attestation.organization_id = v_actor_org
    and attestation.attestation_role = 'bt'
    and attestation.supervision_note_id is null
    and attestation.signer_user_id = v_actor
  order by attestation.signed_at desc, attestation.id desc
  limit 1;

  if v_original_attestation.signer_user_id is distinct from v_actor then
    raise exception using errcode = '42501', message = 'Original BT correction access required';
  end if;
  if not exists (
    select 1
    from public.therapists therapist
    where therapist.id = v_request.bt_therapist_id
      and therapist.organization_id = v_actor_org
      and therapist.status = 'active'
      and therapist.deleted_at is null
      and upper(btrim(coalesce(therapist.title, ''))) in ('BT', 'RBT')
      and (
        therapist.id = v_actor
        or exists (
          select 1
          from public.user_therapist_links link
          where link.user_id = v_actor
            and link.therapist_id = therapist.id
        )
      )
  ) then
    raise exception using errcode = '42501', message = 'Original BT correction access required';
  end if;

  v_template := coalesce(v_original_note.bt_aba_template_snapshot, '{}'::jsonb);
  if jsonb_typeof(v_template) <> 'object' then
    raise exception using errcode = '23514', message = 'Immutable BT template snapshot is required';
  end if;

  v_responses := jsonb_set(
    v_responses,
    '{bt_signature}',
    jsonb_build_object('method', v_signature_method, 'value', v_signature_value),
    true
  );

  if exists (
    select 1
    from jsonb_object_keys(v_responses) response_key
    where not exists (
      select 1
      from jsonb_array_elements(v_template->'sections') section(value)
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
    from jsonb_array_elements(v_template->'sections') section(value)
    cross join lateral jsonb_array_elements(coalesce(section.value->'fields', '[]'::jsonb)) item(value)
  loop
    v_response := v_responses->v_field.field_key;
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
           select 1
           from jsonb_object_keys(v_response) signature_key
           where signature_key not in ('method', 'value')
         ) then
        raise exception using errcode = '23514', message = 'invalid BT ABA session note response type or option';
      end if;
    else
      raise exception using errcode = '23514', message = 'invalid BT ABA session note response type or option';
    end if;
  end loop;

  select field.field_key
  into v_missing_key
  from (
    select
      item.value->>'key' as field_key,
      coalesce((item.value->>'required')::boolean, false) as is_required,
      item.value->>'required_when' as required_when
    from jsonb_array_elements(v_template->'sections') section(value)
    cross join lateral jsonb_array_elements(coalesce(section.value->'fields', '[]'::jsonb)) item(value)
  ) field
  where (
      field.is_required
      or (
        field.required_when like '% includes %'
        and case
          when jsonb_typeof(v_responses->btrim(split_part(field.required_when, ' includes ', 1))) = 'array' then
            v_responses->btrim(split_part(field.required_when, ' includes ', 1)) ? btrim(split_part(field.required_when, ' includes ', 2))
          else
            btrim(coalesce(v_responses->>btrim(split_part(field.required_when, ' includes ', 1)), '')) = btrim(split_part(field.required_when, ' includes ', 2))
        end
      )
    )
    and case
      when jsonb_typeof(v_responses->field.field_key) = 'array' then
        jsonb_array_length(v_responses->field.field_key) = 0
      when jsonb_typeof(v_responses->field.field_key) = 'boolean' then
        false
      when jsonb_typeof(v_responses->field.field_key) = 'object' then
        v_responses->field.field_key = '{}'::jsonb
      else
        nullif(btrim(coalesce(v_responses->>field.field_key, '')), '') is null
    end
  limit 1;

  if v_missing_key is not null then
    raise exception using errcode = '23514', message = 'required BT ABA session note response missing';
  end if;
  if (v_responses->'skill_strategies' ? 'N/A' and jsonb_array_length(v_responses->'skill_strategies') > 1)
     or (v_responses->'behavior_strategies' ? 'N/A' and jsonb_array_length(v_responses->'behavior_strategies') > 1) then
    raise exception using errcode = '23514', message = 'N/A must be selected exclusively';
  end if;
  if v_signature_method not in ('drawn', 'typed') or v_signature_value is null then
    raise exception using errcode = '23514', message = 'valid BT signature is required';
  end if;
  if v_signature_method = 'typed' and char_length(v_signature_value) > 200 then
    raise exception using errcode = '23514', message = 'valid BT signature is required';
  end if;
  if v_signature_method = 'drawn' then
    if char_length(v_signature_value) > 20000 then
      raise exception using errcode = '23514', message = 'invalid drawn BT signature serialization';
    end if;
    if left(v_signature_value, 7) <> 'points:' then
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
      raise exception using errcode = '23514', message = 'invalid drawn BT signature serialization';
    end if;
  end if;

  -- version_number advances as coalesce(max(amendment.version_number), 1) + 1 for each request.
  select coalesce(max(amendment.version_number), 1) + 1
  into v_next_version
  from public.bt_session_note_amendments amendment
  where amendment.request_id = v_request.id
    and amendment.organization_id = v_actor_org;

  insert into public.bt_session_note_amendments (
    organization_id,
    request_id,
    correction_id,
    original_bt_note_id,
    correction_round,
    version_number,
    bt_aba_template_snapshot,
    bt_aba_responses,
    signer_user_id,
    signature_method,
    signature_value,
    signed_at
  )
  values (
    v_actor_org,
    v_request.id,
    v_correction.id,
    v_original_note.id,
    v_correction.correction_round,
    v_next_version,
    v_template,
    v_responses,
    v_actor,
    v_signature_method,
    v_signature_value,
    timezone('utc', now())
  )
  returning id into v_amendment_id;

  update public.supervision_session_note_corrections
  set resolved_at = timezone('utc', now()),
      resolving_bt_user_id = v_actor,
      resulting_amendment_id = v_amendment_id
  where id = v_correction.id
    and organization_id = v_actor_org;

  update public.supervision_session_note_requests
  set status = 'resubmitted',
      updated_at = timezone('utc', now())
  where id = v_request.id
    and organization_id = v_actor_org;

  return v_amendment_id;
end;
$$;

revoke all on function public.resubmit_bt_supervision_correction(uuid, jsonb, text, text) from public, anon;
revoke all on function public.resubmit_bt_supervision_correction(uuid, jsonb, text, text) from authenticated;
grant execute on function public.resubmit_bt_supervision_correction(uuid, jsonb, text, text) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
