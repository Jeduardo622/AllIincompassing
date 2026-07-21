/*
  @migration-intent: Return the latest finalized BT ABA correction from the assigned-BT session-note read RPC.
  @migration-dependencies: 20260719000630_align_bt_correction_signature_limits.sql
  @migration-rollback: Reapply get_bt_aba_session_note from 20260716212837_bt_aba_session_note_closeout.sql.
*/

set search_path = public, app, auth;

begin;

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

revoke execute on function public.get_bt_aba_session_note(uuid) from public, anon;
grant execute on function public.get_bt_aba_session_note(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
