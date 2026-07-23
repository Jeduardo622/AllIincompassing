-- @migration-intent: Align the supervision review packet template name projection with the RPC's declared text return type without changing tenant scope, role checks, or execute boundaries.
-- @migration-dependencies: 20260718155154_return_bt_supervision_correction.sql
-- @migration-rollback: Restore public.get_pending_supervision_review_packets() from 20260718155154_return_bt_supervision_correction.sql if this cast-only compatibility fix must be reverted.

begin;

revoke all on function public.get_pending_supervision_review_packets() from public, anon;
revoke all on function public.get_pending_supervision_review_packets() from authenticated;

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
    template.template_name::text as supervision_template_name,
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

notify pgrst, 'reload schema';

commit;
