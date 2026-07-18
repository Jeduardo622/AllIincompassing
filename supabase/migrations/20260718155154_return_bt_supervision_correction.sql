-- @migration-intent: Add an append-only, tenant-safe Return to BT correction and resubmission workflow.
-- @migration-dependencies: 20260717235500_align_supervision_request_linked_therapist_authority.sql
-- @migration-rollback: Reviewed forward rollback restores the prior request status constraint and rpc definitions while preserving all signed correction and amendment history, including normalization of correction_required/resubmitted rows before restoring prior constraint.

begin;

alter table public.supervision_session_note_requests
  drop constraint if exists supervision_session_note_requests_status_check;

alter table public.supervision_session_note_requests
  add constraint supervision_session_note_requests_status_check
  check (status in ('pending', 'correction_required', 'resubmitted', 'completed', 'cancelled'));

create unique index if not exists supervision_session_note_requests_id_org_idx
  on public.supervision_session_note_requests (id, organization_id);

create unique index if not exists client_session_notes_id_org_idx
  on public.client_session_notes (id, organization_id);

create table public.supervision_session_note_corrections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null,
  correction_round integer not null,
  reviewer_user_id uuid not null references auth.users(id) on delete restrict,
  correction_reason text not null,
  requested_at timestamptz not null default timezone('utc', now()),
  resolved_at timestamptz,
  resolving_bt_user_id uuid references auth.users(id) on delete set null,
  resulting_amendment_id uuid,
  check (correction_round > 0),
  check (nullif(btrim(correction_reason), '') is not null),
  check (char_length(correction_reason) <= 2000),
  check (num_nonnulls(resolved_at, resolving_bt_user_id, resulting_amendment_id) in (0, 3)),
  foreign key (request_id, organization_id)
    references public.supervision_session_note_requests(id, organization_id)
    on delete cascade,
  unique (request_id, correction_round),
  unique (id, request_id, organization_id, correction_round)
);

create table public.bt_session_note_amendments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null,
  correction_id uuid not null,
  original_bt_note_id uuid not null,
  correction_round integer not null,
  version_number integer not null,
  bt_aba_template_snapshot jsonb not null default '{}'::jsonb,
  bt_aba_responses jsonb not null default '{}'::jsonb,
  signer_user_id uuid not null references auth.users(id) on delete restrict,
  signature_method text not null,
  signature_value text not null,
  signed_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  check (correction_round > 0),
  check (version_number > 1),
  check (signature_method in ('drawn', 'typed')),
  check (nullif(btrim(signature_value), '') is not null),
  check (char_length(signature_value) <= 200),
  foreign key (request_id, organization_id)
    references public.supervision_session_note_requests(id, organization_id)
    on delete cascade,
  foreign key (original_bt_note_id, organization_id)
    references public.client_session_notes(id, organization_id)
    on delete restrict,
  foreign key (correction_id, request_id, organization_id, correction_round)
    references public.supervision_session_note_corrections(id, request_id, organization_id, correction_round)
    on delete restrict,
  -- correction_round mismatches are rejected by the composite correction lineage foreign keys.
  unique (request_id, version_number),
  unique (correction_id),
  unique (id, correction_id)
);

create unique index if not exists supervision_session_note_corrections_id_request_org_round_idx
  on public.supervision_session_note_corrections (id, request_id, organization_id, correction_round);

create unique index if not exists bt_session_note_amendments_id_correction_idx
  on public.bt_session_note_amendments (id, correction_id);

alter table public.supervision_session_note_corrections
  add constraint supervision_session_note_corrections_resulting_amendment_id_fkey
  foreign key (resulting_amendment_id, id)
  references public.bt_session_note_amendments(id, correction_id)
  on delete set null;
-- resulting_amendment_id cannot target a different correction id.

create unique index if not exists supervision_session_note_corrections_one_unresolved_idx
  on public.supervision_session_note_corrections (request_id)
  where resolved_at is null;

create index if not exists supervision_session_note_corrections_request_lookup_idx
  on public.supervision_session_note_corrections (organization_id, request_id, requested_at desc);

create index if not exists supervision_session_note_corrections_reviewer_lookup_idx
  on public.supervision_session_note_corrections (reviewer_user_id, requested_at desc);

create index if not exists bt_session_note_amendments_request_version_idx
  on public.bt_session_note_amendments (organization_id, request_id, version_number desc);

create index if not exists bt_session_note_amendments_correction_idx
  on public.bt_session_note_amendments (correction_id, correction_round);

alter table public.supervision_session_note_corrections enable row level security;
alter table public.bt_session_note_amendments enable row level security;

drop policy if exists supervision_session_note_corrections_service_role_all on public.supervision_session_note_corrections;
create policy supervision_session_note_corrections_service_role_all
  on public.supervision_session_note_corrections
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists bt_session_note_amendments_service_role_all on public.bt_session_note_amendments;
create policy bt_session_note_amendments_service_role_all
  on public.bt_session_note_amendments
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.supervision_session_note_corrections from public, anon;
revoke all on table public.supervision_session_note_corrections from authenticated;
revoke all on table public.bt_session_note_amendments from public, anon;
revoke all on table public.bt_session_note_amendments from authenticated;

grant all on table public.supervision_session_note_corrections to service_role;
grant all on table public.bt_session_note_amendments to service_role;

create or replace function public.guard_supervision_session_note_corrections_update()
returns trigger
language plpgsql
as $$
begin
  if old.organization_id is distinct from new.organization_id
     or old.request_id is distinct from new.request_id
     or old.correction_round is distinct from new.correction_round
     or old.reviewer_user_id is distinct from new.reviewer_user_id
     or old.correction_reason is distinct from new.correction_reason
     or old.requested_at is distinct from new.requested_at then
    raise exception using errcode = '42501', message = 'supervision correction history is immutable';
  end if;

  if old.resolved_at is not null and new.resolved_at is distinct from old.resolved_at then
    raise exception using errcode = '42501', message = 'resolved_at may only transition from null to a timestamp';
  end if;

  if old.resolving_bt_user_id is not null and new.resolving_bt_user_id is distinct from old.resolving_bt_user_id then
    raise exception using errcode = '42501', message = 'resolving_bt_user_id may only transition from null to the resolving signer';
  end if;

  if old.resulting_amendment_id is not null and new.resulting_amendment_id is distinct from old.resulting_amendment_id then
    raise exception using errcode = '42501', message = 'resulting_amendment_id may only transition from null to the resulting amendment';
  end if;

  if new.resolved_at is not null and new.resolving_bt_user_id is null then
    raise exception using errcode = '23514', message = 'resolved corrections require resolving_bt_user_id';
  end if;

  if new.resulting_amendment_id is not null and new.resolved_at is null then
    raise exception using errcode = '23514', message = 'resolved corrections require resolved_at';
  end if;

  if new.resolved_at is not null and new.resulting_amendment_id is null then
    raise exception using errcode = '23514', message = 'resolved corrections require resulting_amendment_id';
  end if;

  return new;
end;
$$;

create or replace function public.prevent_supervision_session_note_corrections_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception using errcode = '42501', message = 'supervision correction history is immutable';
end;
$$;

create or replace function public.prevent_bt_session_note_amendment_mutations()
returns trigger
language plpgsql
as $$
begin
  raise exception using errcode = '42501', message = 'bt session note amendments are immutable';
end;
$$;

drop trigger if exists supervision_session_note_corrections_guard_update on public.supervision_session_note_corrections;
create trigger supervision_session_note_corrections_guard_update
before update on public.supervision_session_note_corrections
for each row
execute function public.guard_supervision_session_note_corrections_update();

drop trigger if exists supervision_session_note_corrections_prevent_delete on public.supervision_session_note_corrections;
create trigger supervision_session_note_corrections_prevent_delete
before delete on public.supervision_session_note_corrections
for each row
execute function public.prevent_supervision_session_note_corrections_delete();

drop trigger if exists bt_session_note_amendments_prevent_update on public.bt_session_note_amendments;
create trigger bt_session_note_amendments_prevent_update
before update on public.bt_session_note_amendments
for each row
execute function public.prevent_bt_session_note_amendment_mutations();

drop trigger if exists bt_session_note_amendments_prevent_delete on public.bt_session_note_amendments;
create trigger bt_session_note_amendments_prevent_delete
before delete on public.bt_session_note_amendments
for each row
execute function public.prevent_bt_session_note_amendment_mutations();

create or replace function public.return_supervision_session_note_request_to_bt(
  p_request_id uuid,
  p_reason text
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
  v_reason text;
  v_correction_id uuid;
  v_next_round integer;
begin
  if v_actor is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'Request id required';
  end if;
  v_reason := btrim(coalesce(p_reason, ''));

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

  select request.*
  into v_request
  from public.supervision_session_note_requests request
  where request.id = p_request_id
    and request.organization_id = v_actor_org
  for update;

  if v_request.id is null then
    raise exception using errcode = '42501', message = 'Supervision request not found in caller organization';
  end if;
  if v_request.assigned_admin_user_id is distinct from v_actor then
    raise exception using errcode = '42501', message = 'Assigned BCBA supervision note access required';
  end if;
  if v_request.status not in ('pending', 'resubmitted') then
    raise exception using errcode = '23514', message = 'Supervision request is not returnable';
  end if;
  if char_length(v_reason) = 0 or char_length(v_reason) > 2000 then
    raise exception using errcode = '23514', message = 'Correction reason must be between 1 and 2000 characters';
  end if;
  if exists (
    select 1
    from public.supervision_session_note_corrections correction
    where correction.request_id = v_request.id
      and correction.organization_id = v_actor_org
      and correction.resolved_at is null
  ) then
    raise exception using errcode = '23514', message = 'An unresolved correction already exists for this request';
  end if;

  select coalesce(max(correction.correction_round), 0) + 1
  into v_next_round
  from public.supervision_session_note_corrections correction
  where correction.request_id = v_request.id
    and correction.organization_id = v_actor_org;

  insert into public.supervision_session_note_corrections (
    organization_id,
    request_id,
    correction_round,
    reviewer_user_id,
    correction_reason
  )
  values (
    v_actor_org,
    v_request.id,
    v_next_round,
    v_actor,
    v_reason
  )
  returning id into v_correction_id;

  update public.supervision_session_note_requests
  set status = 'correction_required',
      updated_at = timezone('utc', now())
  where id = v_request.id
    and organization_id = v_actor_org;

  return v_correction_id;
end;
$$;

revoke all on function public.return_supervision_session_note_request_to_bt(uuid, text) from public, anon;
revoke all on function public.return_supervision_session_note_request_to_bt(uuid, text) from authenticated;
grant execute on function public.return_supervision_session_note_request_to_bt(uuid, text) to authenticated, service_role;

create or replace function public.get_bt_supervision_correction_tasks()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_org uuid;
  v_is_exact_bt boolean := false;
  v_result jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '28000', message = 'Authentication required';
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
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(task_payload order by correction_requested_at desc), '[]'::jsonb)
  into v_result
  from (
    select
      correction.requested_at as correction_requested_at,
      jsonb_build_object(
        'request_id', request.id,
        'organization_id', request.organization_id,
        'session_id', request.session_id,
        'client_id', request.client_id,
        'bt_therapist_id', request.bt_therapist_id,
        'assigned_reviewer_user_id', request.assigned_admin_user_id,
        'request_status', request.status,
        'request_created_at', request.created_at,
        'client_name', client.full_name,
        'bt_therapist_name', therapist.full_name,
        'bt_therapist_title', therapist.title,
        'correction_id', correction.id,
        'correction_round', correction.correction_round,
        'correction_reason', correction.correction_reason,
        'correction_requested_at', correction.requested_at,
        'correction_reviewer_user_id', correction.reviewer_user_id,
        'original_version', jsonb_build_object(
          'version_number', 1,
          'note_id', original_note.id,
          'source', 'original',
          'responses', original_note.bt_aba_responses,
          'template_snapshot', original_note.bt_aba_template_snapshot,
          'signature_method', original_attestation.signature_method,
          'signature_value', original_attestation.signature_value,
          'signed_at', original_attestation.signed_at
        ),
        'latest_version', coalesce(
          latest_amendment.version_payload,
          jsonb_build_object(
            'version_number', 1,
            'note_id', original_note.id,
            'source', 'original',
            'responses', original_note.bt_aba_responses,
            'template_snapshot', original_note.bt_aba_template_snapshot,
            'signature_method', original_attestation.signature_method,
            'signature_value', original_attestation.signature_value,
            'signed_at', original_attestation.signed_at
          )
        ),
        'review_versions',
        (
          case
            when original_note.id is null then '[]'::jsonb
            else jsonb_build_array(
              jsonb_build_object(
                'version_number', 1,
                'note_id', original_note.id,
                'source', 'original',
                'responses', original_note.bt_aba_responses,
                'template_snapshot', original_note.bt_aba_template_snapshot,
                'signature_method', original_attestation.signature_method,
                'signature_value', original_attestation.signature_value,
                'signed_at', original_attestation.signed_at
              )
            )
          end
        ) || coalesce(amendments.amendment_versions, '[]'::jsonb)
      ) as task_payload
    from public.supervision_session_note_requests request
    join public.supervision_session_note_corrections correction
      on correction.request_id = request.id
     and correction.organization_id = request.organization_id
     and correction.resolved_at is null
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
        and note.client_id = request.client_id
        and note.therapist_id = request.bt_therapist_id
      order by note.created_at desc, note.id desc
      limit 1
    ) original_note on true
    join lateral (
      select attestation.signer_user_id, attestation.signature_method, attestation.signature_value, attestation.signed_at
      from public.session_note_attestations attestation
      where attestation.note_id = original_note.id
        and attestation.organization_id = request.organization_id
        and attestation.attestation_role = 'bt'
        and attestation.supervision_note_id is null
      order by attestation.signed_at desc, attestation.id desc
      limit 1
    ) original_attestation on true
    left join lateral (
      select jsonb_agg(
               jsonb_build_object(
                 'version_number', amendment.version_number,
                 'note_id', amendment.id,
                 'source', 'amendment',
                 'correction_round', amendment.correction_round,
                 'responses', amendment.bt_aba_responses,
                 'template_snapshot', amendment.bt_aba_template_snapshot,
                 'signature_method', amendment.signature_method,
                 'signature_value', amendment.signature_value,
                 'signed_at', amendment.signed_at
               )
               order by amendment.version_number asc
             ) as amendment_versions
      from public.bt_session_note_amendments amendment
      where amendment.request_id = request.id
        and amendment.organization_id = request.organization_id
    ) amendments on true
    left join lateral (
      select jsonb_build_object(
               'version_number', amendment.version_number,
               'note_id', amendment.id,
               'source', 'amendment',
               'correction_round', amendment.correction_round,
               'responses', amendment.bt_aba_responses,
               'template_snapshot', amendment.bt_aba_template_snapshot,
               'signature_method', amendment.signature_method,
               'signature_value', amendment.signature_value,
               'signed_at', amendment.signed_at
             ) as version_payload
      from public.bt_session_note_amendments amendment
      where amendment.request_id = request.id
        and amendment.organization_id = request.organization_id
      order by amendment.version_number desc
      limit 1
    ) latest_amendment on true
    where request.organization_id = v_actor_org
      and request.status = 'correction_required'
      and original_attestation.signer_user_id = v_actor
      and therapist.status = 'active'
      and therapist.deleted_at is null
      and upper(btrim(coalesce(therapist.title, ''))) in ('BT', 'RBT')
      and (
        request.bt_therapist_id = v_actor
        or exists (
          select 1
          from public.user_therapist_links link
          where link.user_id = v_actor
            and link.therapist_id = request.bt_therapist_id
        )
      )
  ) tasks;

  return v_result;
end;
$$;

revoke all on function public.get_bt_supervision_correction_tasks() from public, anon;
revoke all on function public.get_bt_supervision_correction_tasks() from authenticated;
grant execute on function public.get_bt_supervision_correction_tasks() to authenticated, service_role;

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
  if char_length(v_signature_value) > 200 then
    raise exception using errcode = '23514', message = 'valid BT signature is required';
  end if;
  if v_signature_method = 'drawn' then
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

revoke all on function public.get_pending_supervision_review_packets() from public, anon;
revoke all on function public.get_pending_supervision_review_packets() from authenticated;
drop function if exists public.get_pending_supervision_review_packets();

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
  can_complete boolean,
  can_return boolean,
  correction_id uuid,
  correction_round integer,
  correction_reason text,
  correction_requested_at timestamptz,
  correction_reviewer_user_id uuid,
  latest_version_number integer,
  review_versions jsonb
)
language plpgsql
security definer
set search_path = ''
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
    therapist.full_name as bt_therapist_name,
    therapist.title as bt_therapist_title,
    coalesce(latest_amendment.note_id, original_note.id) as bt_note_id,
    coalesce(latest_amendment.responses, original_note.bt_aba_responses) as bt_responses,
    coalesce(latest_amendment.template_snapshot, original_note.bt_aba_template_snapshot) as bt_template_snapshot,
    coalesce(latest_amendment.signature_method, original_attestation.signature_method) as bt_signature_method,
    coalesce(latest_amendment.signed_at, original_attestation.signed_at) as bt_signed_at,
    template.id as supervision_template_id,
    template.template_name as supervision_template_name,
    template.template_structure as supervision_template_structure,
    (
      request.assigned_admin_user_id = v_actor
      and app.user_has_exact_active_role_for_org(
        v_actor,
        request.organization_id,
        array['bcba']::text[]
      )
      and request.status in ('pending', 'resubmitted')
      and jsonb_typeof(coalesce(coalesce(latest_amendment.responses, original_note.bt_aba_responses), '{}'::jsonb)) = 'object'
      and jsonb_typeof(coalesce(coalesce(latest_amendment.template_snapshot, original_note.bt_aba_template_snapshot), '{}'::jsonb)) = 'object'
      and coalesce(latest_amendment.signature_method, original_attestation.signature_method) in ('typed', 'drawn')
    ) as can_complete,
    (
      request.assigned_admin_user_id = v_actor
      and app.user_has_exact_active_role_for_org(
        v_actor,
        request.organization_id,
        array['bcba']::text[]
      )
      and request.status in ('pending', 'resubmitted')
      and request.status <> 'correction_required'
    ) as can_return,
    correction.id as correction_id,
    correction.correction_round,
    correction.correction_reason,
    correction.requested_at as correction_requested_at,
    correction.reviewer_user_id as correction_reviewer_user_id,
    coalesce(latest_amendment.version_number, 1) as latest_version_number,
    (
      case
        when original_note.id is null then '[]'::jsonb
        else jsonb_build_array(
          jsonb_build_object(
            'version_number', 1,
            'note_id', original_note.id,
            'source', 'original',
            'responses', original_note.bt_aba_responses,
            'template_snapshot', original_note.bt_aba_template_snapshot,
            'signature_method', original_attestation.signature_method,
            'signature_value', original_attestation.signature_value,
            'signed_at', original_attestation.signed_at
          )
        )
      end
    ) || coalesce(amendments.amendment_versions, '[]'::jsonb) as review_versions
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
      and note.client_id = request.client_id
      and note.therapist_id = request.bt_therapist_id
    order by note.created_at desc, note.id desc
    limit 1
  ) original_note on true
  left join lateral (
    select attestation.signature_method, attestation.signature_value, attestation.signed_at
    from public.session_note_attestations attestation
    where attestation.note_id = original_note.id
      and attestation.organization_id = request.organization_id
      and attestation.attestation_role = 'bt'
      and attestation.supervision_note_id is null
    order by attestation.signed_at desc, attestation.id desc
    limit 1
  ) original_attestation on true
  left join lateral (
    select
      amendment.id as note_id,
      amendment.version_number,
      amendment.bt_aba_responses as responses,
      amendment.bt_aba_template_snapshot as template_snapshot,
      amendment.signature_method,
      amendment.signed_at
    from public.bt_session_note_amendments amendment
    where amendment.request_id = request.id
      and amendment.organization_id = request.organization_id
    order by amendment.version_number desc
    limit 1
  ) latest_amendment on true
  left join lateral (
    select jsonb_agg(
             jsonb_build_object(
               'version_number', amendment.version_number,
               'note_id', amendment.id,
               'source', 'amendment',
               'correction_round', amendment.correction_round,
               'responses', amendment.bt_aba_responses,
               'template_snapshot', amendment.bt_aba_template_snapshot,
               'signature_method', amendment.signature_method,
               'signature_value', amendment.signature_value,
               'signed_at', amendment.signed_at
             )
             order by amendment.version_number asc
           ) as amendment_versions
    from public.bt_session_note_amendments amendment
    where amendment.request_id = request.id
      and amendment.organization_id = request.organization_id
  ) amendments on true
  left join lateral (
    select unresolved.*
    from public.supervision_session_note_corrections unresolved
    where unresolved.request_id = request.id
      and unresolved.organization_id = request.organization_id
      and unresolved.resolved_at is null
    order by unresolved.correction_round desc
    limit 1
  ) correction on true
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
    and request.status in ('pending', 'correction_required', 'resubmitted', 'completed')
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

grant execute on function public.get_pending_supervision_review_packets() to authenticated, service_role;

create or replace function public.get_supervision_session_note_action_count()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_org uuid;
  v_count integer := 0;
  v_is_exact_bt boolean := false;
begin
  if v_actor is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;

  v_actor_org := app.resolve_user_organization_id(v_actor);
  if v_actor_org is null then
    raise exception using errcode = '42501', message = 'Organization context required';
  end if;

  if app.user_has_exact_active_role_for_org(
    v_actor,
    v_actor_org,
    array['bcba']::text[]
  ) then
    select count(*)
    into v_count
    from public.supervision_session_note_requests request
    where request.organization_id = v_actor_org
      and request.assigned_admin_user_id = v_actor
      and request.status in ('pending', 'resubmitted');

    return coalesce(v_count, 0);
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
    return 0;
  end if;

  select count(*)
  into v_count
  from public.supervision_session_note_requests request
  join public.supervision_session_note_corrections correction
    on correction.request_id = request.id
   and correction.organization_id = request.organization_id
   and correction.resolved_at is null
  join public.therapists therapist
    on therapist.id = request.bt_therapist_id
   and therapist.organization_id = request.organization_id
  join lateral (
    select note.id
    from public.client_session_notes note
    where note.session_id = request.session_id
      and note.organization_id = request.organization_id
      and note.client_id = request.client_id
      and note.therapist_id = request.bt_therapist_id
    order by note.created_at desc, note.id desc
    limit 1
  ) note on true
  join public.session_note_attestations attestation
    on attestation.note_id = note.id
   and attestation.organization_id = request.organization_id
   and attestation.attestation_role = 'bt'
   and attestation.supervision_note_id is null
  where request.organization_id = v_actor_org
    and request.status = 'correction_required'
    and attestation.signer_user_id = v_actor
    and therapist.status = 'active'
    and therapist.deleted_at is null
    and upper(btrim(coalesce(therapist.title, ''))) in ('BT', 'RBT')
    and (
      request.bt_therapist_id = v_actor
      or exists (
        select 1
        from public.user_therapist_links link
        where link.user_id = v_actor
          and link.therapist_id = request.bt_therapist_id
      )
    );

  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.get_supervision_session_note_action_count() from public, anon;
grant execute on function public.get_supervision_session_note_action_count() to authenticated, service_role;

create or replace function public.complete_supervision_session_note_request(uuid, uuid, jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  p_request_id alias for $1;
  p_template_id alias for $2;
  p_responses alias for $3;
  v_actor uuid := auth.uid();
  v_actor_org uuid;
  v_request public.supervision_session_note_requests%rowtype;
  v_template record;
  v_responses jsonb := coalesce(p_responses, '{}'::jsonb);
  v_missing_key text;
  v_note_id uuid;
  v_signature_method text;
  v_signature_value text;
  v_signature_points jsonb;
  v_original_note public.client_session_notes%rowtype;
  v_original_attestation record;
  v_latest_amendment record;
  v_latest_template_snapshot jsonb;
  v_latest_responses jsonb;
  v_latest_signature_method text;
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

  select request.*
  into v_request
  from public.supervision_session_note_requests request
  where request.id = p_request_id
    and request.organization_id = v_actor_org
  for update;

  if v_request.id is null then
    raise exception using errcode = '42501', message = 'Supervision request not found in caller organization';
  end if;
  if v_request.assigned_admin_user_id is distinct from v_actor then
    raise exception using errcode = '42501', message = 'Assigned BCBA supervision note access required';
  end if;
  if v_request.status not in ('pending', 'resubmitted') then
    raise exception using errcode = '23514', message = 'Supervision request is not completable';
  end if;

  select
    template.id,
    template.template_structure
  into v_template
  from public.session_note_templates template
  where template.id = p_template_id
    and template.organization_id = v_actor_org
    and template.template_type = 'supervision_session_note'
    and template.template_name = 'Supervision Session Note';

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

  v_signature_method := btrim(coalesce(v_responses #>> '{bcba_supervisor_signature,method}', ''));
  v_signature_value := btrim(coalesce(v_responses #>> '{bcba_supervisor_signature,value}', ''));
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

  select note.*
  into v_original_note
  from public.client_session_notes note
  where note.session_id = v_request.session_id
    and note.organization_id = v_actor_org
    and note.client_id = v_request.client_id
    and note.therapist_id = v_request.bt_therapist_id
  order by note.created_at desc, note.id desc
  limit 1;

  if v_original_note.id is null then
    raise exception using errcode = '23514', message = 'Complete structured BT session note and attestation required before supervision completion';
  end if;

  select
    attestation.signature_method,
    attestation.signature_value,
    attestation.signed_at
  into v_original_attestation
  from public.session_note_attestations attestation
  where attestation.note_id = v_original_note.id
    and attestation.organization_id = v_actor_org
    and attestation.attestation_role = 'bt'
    and attestation.supervision_note_id is null
  order by attestation.signed_at desc, attestation.id desc
  limit 1;

  select
    amendment.version_number,
    amendment.bt_aba_template_snapshot as template_snapshot,
    amendment.bt_aba_responses as responses,
    amendment.signature_method,
    amendment.signature_value,
    amendment.signed_at
  into v_latest_amendment
  from public.bt_session_note_amendments amendment
  where amendment.request_id = v_request.id
    and amendment.organization_id = v_actor_org
  order by amendment.version_number desc
  limit 1;

  v_latest_template_snapshot := coalesce(v_latest_amendment.template_snapshot, v_original_note.bt_aba_template_snapshot);
  v_latest_responses := coalesce(v_latest_amendment.responses, v_original_note.bt_aba_responses);
  v_latest_signature_method := coalesce(v_latest_amendment.signature_method, v_original_attestation.signature_method);

  if jsonb_typeof(coalesce(v_latest_template_snapshot, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(v_latest_responses, '{}'::jsonb)) <> 'object'
     or v_latest_signature_method not in ('typed', 'drawn') then
    raise exception using errcode = '23514', message = 'Complete structured BT session note and attestation required before supervision completion';
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
    raise exception using errcode = '23514', message = 'Supervision request is not completable';
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
