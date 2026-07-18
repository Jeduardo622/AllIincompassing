/*
  @migration-intent: Keep supervision request creation authorization aligned with the sessions-complete linked-therapist closeout path.
  @migration-dependencies: 20260717222331_repair_supervision_request_lifecycle.sql
  @migration-rollback: Reapply the prior create_supervision_session_note_request_for_completed_session(uuid) definition from the preceding migration.
*/

set search_path = public, app, auth;

begin;

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
     and not exists (
       select 1
       from public.user_therapist_links utl
       where utl.user_id = v_actor
         and utl.therapist_id = v_session.therapist_id
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

commit;
