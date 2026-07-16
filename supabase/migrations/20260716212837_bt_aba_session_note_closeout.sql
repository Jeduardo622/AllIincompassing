-- @migration-intent: Add the tenant-safe structured BT ABA Session Note closeout contract defined by WIN-221.
-- @migration-dependencies: 20260711140753_fix_goal_target_draft_version_validation.sql,20260716162434_lock_bt_start_to_scheduled_plan.sql
-- @migration-rollback: Drop WIN-221 RPCs and policies, restore the prior create_supervision_session_note_request_for_completed_session definition from 20260629233000_create_supervision_session_note_workflow.sql, then remove session_note_attestations and the BT ABA columns from client_session_notes after dependent application code is rolled back.

begin;

alter table public.client_session_notes
  add column if not exists bt_aba_template_id uuid references public.session_note_templates(id),
  add column if not exists bt_aba_template_snapshot jsonb,
  add column if not exists bt_aba_responses jsonb,
  add column if not exists bt_aba_finalization_result jsonb;

create table if not exists public.session_note_attestations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  note_id uuid not null references public.client_session_notes(id) on delete cascade,
  signer_user_id uuid not null references auth.users(id),
  attestation_role text not null check (attestation_role in ('bt', 'parent_guardian', 'midtier', 'bcba')),
  signature_method text not null check (signature_method in ('drawn', 'typed')),
  signature_value text not null check (char_length(btrim(signature_value)) > 0),
  signed_at timestamptz not null default timezone('utc', now()),
  unique (note_id, attestation_role, signer_user_id)
);

create index if not exists session_note_attestations_org_note_idx
  on public.session_note_attestations (organization_id, note_id);
create index if not exists session_note_attestations_signer_idx
  on public.session_note_attestations (signer_user_id, signed_at desc);

alter table public.session_note_attestations enable row level security;

drop policy if exists session_note_attestations_service_role_all on public.session_note_attestations;
create policy session_note_attestations_service_role_all
  on public.session_note_attestations for all to service_role
  using (true) with check (true);

drop policy if exists session_note_attestations_authenticated_select on public.session_note_attestations;
create policy session_note_attestations_authenticated_select
  on public.session_note_attestations for select to authenticated
  using (
    organization_id = app.current_user_organization_id()
    and (
      signer_user_id = auth.uid()
      or app.current_user_can_manage_locked_trial_event(organization_id)
    )
  );

drop policy if exists session_note_attestations_authenticated_insert on public.session_note_attestations;

revoke all on table public.session_note_attestations from public, anon;
revoke all on table public.session_note_attestations from authenticated;
grant select on table public.session_note_attestations to authenticated;
grant all on table public.session_note_attestations to service_role;

with bt_template as (
  select
    'BT ABA Session Note'::text as template_name,
    'bt_aba_session_note'::text as template_type,
    $template${
      "version": 1,
      "sections": [
        {
          "key": "purpose",
          "label": "Purpose of Session",
          "fields": [
            {"key":"purpose_of_session","label":"Purpose of Session","type":"multi_select","required":true,"options":["RBT/BT worked on goals as stated in the treatment plan","RBT/BT worked on pairing self with reinforcers","Other"],"other_field_key":"purpose_other"},
            {"key":"purpose_other","label":"Describe Other","type":"text","required_when":"purpose_of_session includes Other"}
          ]
        },
        {
          "key": "interventions",
          "label": "Interventions and Strategies Used",
          "fields": [
            {"key":"client_status","label":"Client Status","type":"textarea","required":true},
            {"key":"skill_strategies","label":"Skill Strategies","type":"multi_select","required":true,"exclusive_options":["N/A"],"options":["Role playing or modeling","Generalization training","Natural environment teaching","Discrete trial training","Shaping/Chaining","Providing support with prompt fading","Behavior Momentum","Other","N/A"],"other_field_key":"skill_strategies_other"},
            {"key":"skill_strategies_other","label":"Describe Other Skill Strategy","type":"text","required_when":"skill_strategies includes Other"},
            {"key":"behavior_strategies","label":"Behavior Strategies","type":"multi_select","required":true,"exclusive_options":["N/A"],"options":["Modeling","Verbal reminders provided","Contingent rewards/reinforcers","Guided Compliance","First/Then statements","Visual supports","Differential Reinforcement","Other","N/A"],"other_field_key":"behavior_strategies_other"},
            {"key":"behavior_strategies_other","label":"Describe Other Behavior Strategy","type":"text","required_when":"behavior_strategies includes Other"}
          ]
        },
        {
          "key": "summary",
          "label": "Supervision and Clinical Summary",
          "fields": [
            {"key":"supervisor_support","label":"Supervisor Support and Discussion Included","type":"multi_select","required":true,"options":["Supervisor did not attend this session","Problem-solved concerns","Supervisor provided some direct support","Modeled strategies/interventions","Discussed programs/progress/data collection","Other"],"other_field_key":"supervisor_support_other"},
            {"key":"supervisor_support_other","label":"Describe Other Supervisor Support","type":"text","required_when":"supervisor_support includes Other"},
            {"key":"progress_toward_goals","label":"Summary of Progress Toward Treatment Goals","type":"textarea","required":true},
            {"key":"client_response_to_treatment","label":"Client's Response to Treatment","type":"textarea","required":true}
          ]
        },
        {
          "key": "daily_summary",
          "label": "Daily Summary Sheet",
          "fields": [
            {"key":"data_point_scope","label":"Data Point Scope","type":"radio","required":true,"options":["linked","all"]},
            {"key":"link_unlinked_data","label":"Link Unlinked Data","type":"boolean","required":true},
            {"key":"bt_signature","label":"Behavior Technician Signature","type":"signature","required":true}
          ]
        }
      ]
    }$template$::jsonb as template_structure
)
insert into public.session_note_templates (
  template_name, template_type, template_structure, description,
  compliance_requirements, is_california_compliant, organization_id,
  created_at, updated_at
)
select
  bt_template.template_name,
  bt_template.template_type,
  bt_template.template_structure,
  'Mandatory structured BT ABA session closeout note.',
  '{"attestations":{"bt":true},"tenant_scoped":true}'::jsonb,
  true,
  organizations.id,
  timezone('utc', now()),
  timezone('utc', now())
from public.organizations organizations
cross join bt_template
where not exists (
  select 1
  from public.session_note_templates existing
  where existing.organization_id = organizations.id
    and existing.template_type = bt_template.template_type
    and existing.template_name = bt_template.template_name
);

-- Keep the canonical idempotent supervision-request creator compatible with
-- deployments where auth users and therapist profile IDs are distinct.
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
    requested_by,
    status
  ) values (
    v_actor_org,
    v_session.id,
    v_session.client_id,
    v_session.therapist_id,
    v_actor,
    'pending'
  )
  on conflict (session_id) do update
    set updated_at = timezone('utc', now())
  returning id into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.create_supervision_session_note_request_for_completed_session(uuid) from public, anon;
grant execute on function public.create_supervision_session_note_request_for_completed_session(uuid) to authenticated, service_role;

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

  select authorization.* into v_authorization
  from public.authorizations authorization
  where authorization.id = nullif(p_note_payload->>'authorization_id', '')::uuid
    and authorization.organization_id = v_session.organization_id
    and authorization.client_id = v_session.client_id;
  if not found then
    raise exception using errcode = '42501', message = 'authorization is out of scope';
  end if;
  select service.service_code into v_service_code
  from public.authorization_services service
  where service.authorization_id = v_authorization.id
  order by case when service.service_code = nullif(p_note_payload->>'requested_service_code', '') then 0 else 1 end,
    service.created_at, service.id
  limit 1;

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
    set bt_aba_template_id = p_template_id,
        bt_aba_template_snapshot = v_template.template_structure,
        bt_aba_responses = coalesce(p_responses, '{}'::jsonb)
    where note.id = v_note.id
    returning note.* into v_note;
  end if;

  return jsonb_build_object('status', 'draft', 'note_id', v_note.id);
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
  v_signature_method text;
  v_signature_value text;
  v_note_json jsonb;
  v_progression_results jsonb := '[]'::jsonb;
  v_is_assigned_bt boolean := false;
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

  select template.* into v_template
  from public.session_note_templates template
  where template.id = v_note.bt_aba_template_id
    and template.organization_id = v_session.organization_id
    and template.template_type = 'bt_aba_session_note';
  if not found then
    raise exception using errcode = '42501', message = 'BT ABA template is out of scope';
  end if;

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

  if v_session.status = 'in_progress' then
    update public.client_session_notes note
    set bt_aba_responses = p_responses,
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
    p_note_payload,
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

revoke execute on function public.save_bt_aba_session_note_draft(uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_bt_aba_session_note_draft(uuid, uuid, jsonb, jsonb) to authenticated, service_role;
revoke execute on function public.finalize_bt_aba_session_note(uuid, uuid, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.finalize_bt_aba_session_note(uuid, uuid, jsonb, jsonb, jsonb, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
