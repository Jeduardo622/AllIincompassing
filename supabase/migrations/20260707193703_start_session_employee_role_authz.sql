-- @migration-intent: Align start_session_with_goals authorization with employee role capabilities and linked BT identities.
-- @migration-dependencies: 20260318110000_harden_start_session_with_goals_authz.sql,20260706023600_bcba_exact_capability_matrix.sql
-- @migration-rollback: Re-run 20260318110000_harden_start_session_with_goals_authz.sql to restore admin/same-therapist-only start authorization.

set search_path = public;

create or replace function public.start_session_with_goals(
  p_session_id uuid,
  p_program_id uuid,
  p_goal_id uuid,
  p_goal_ids uuid[] default null,
  p_started_at timestamptz default null,
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_started_at timestamptz;
  v_goal_ids uuid[];
  v_goal_count integer := 0;
  v_goal_id uuid;
  v_goal_match_count integer := 0;
  v_actor_id uuid;
  v_is_super_admin boolean := false;
  v_has_start_authority boolean := false;
begin
  if p_session_id is null or p_program_id is null or p_goal_id is null then
    return jsonb_build_object(
      'success', false,
      'error_code', 'MISSING_FIELDS',
      'error_message', 'session_id, program_id, and goal_id are required'
    );
  end if;

  select
    s.id,
    s.organization_id,
    s.client_id,
    s.therapist_id,
    s.status,
    s.started_at
  into v_session
  from public.sessions s
  where s.id = p_session_id
  for update;

  if v_session.id is null then
    return jsonb_build_object(
      'success', false,
      'error_code', 'SESSION_NOT_FOUND',
      'error_message', 'Session not found'
    );
  end if;

  v_actor_id := auth.uid();
  if v_actor_id is null then
    return jsonb_build_object(
      'success', false,
      'error_code', 'UNAUTHORIZED',
      'error_message', 'Authentication required'
    );
  end if;

  if p_actor_id is not null and p_actor_id <> v_actor_id then
    return jsonb_build_object(
      'success', false,
      'error_code', 'FORBIDDEN',
      'error_message', 'Actor mismatch'
    );
  end if;

  select coalesce(public.current_user_is_super_admin(), false)
    into v_is_super_admin;

  if v_is_super_admin then
    v_has_start_authority := true;
  else
    select coalesce(app.current_user_has_exact_role_for_org(
      v_session.organization_id,
      array['admin', 'admin_schedule', 'midtier', 'bcba']::text[]
    ), false)
      into v_has_start_authority;

    if not v_has_start_authority then
      select exists (
        select 1
        from public.user_therapist_links utl
        where utl.user_id = v_actor_id
          and utl.therapist_id = v_session.therapist_id
      )
      into v_has_start_authority;
    end if;

    if not v_has_start_authority then
      select coalesce(app.current_user_has_exact_role_for_org(
        v_session.organization_id,
        array['therapist', 'bt']::text[]
      ), false)
      and v_session.therapist_id = v_actor_id
      into v_has_start_authority;
    end if;
  end if;

  if not v_has_start_authority then
    return jsonb_build_object(
      'success', false,
      'error_code', 'FORBIDDEN',
      'error_message', 'Not authorized to start this session'
    );
  end if;

  if v_session.started_at is not null then
    return jsonb_build_object(
      'success', false,
      'error_code', 'ALREADY_STARTED',
      'error_message', 'Session already started'
    );
  end if;

  if v_session.status <> 'scheduled' then
    return jsonb_build_object(
      'success', false,
      'error_code', 'INVALID_STATUS',
      'error_message', 'Only scheduled sessions can be started'
    );
  end if;

  v_goal_ids := coalesce(p_goal_ids, array[]::uuid[]);
  v_goal_ids := array_append(v_goal_ids, p_goal_id);
  v_goal_ids := array(select distinct x from unnest(v_goal_ids) as x where x is not null);

  select count(*)
    into v_goal_match_count
  from public.goals g
  where g.id = p_goal_id
    and g.program_id = p_program_id
    and g.client_id = v_session.client_id
    and g.organization_id = v_session.organization_id;

  if v_goal_match_count <> 1 then
    return jsonb_build_object(
      'success', false,
      'error_code', 'GOAL_NOT_FOUND',
      'error_message', 'Goal not found for this program'
    );
  end if;

  if array_length(v_goal_ids, 1) is not null then
    select count(*)
      into v_goal_count
    from public.goals g
    where g.id = any(v_goal_ids)
      and g.program_id = p_program_id
      and g.client_id = v_session.client_id
      and g.organization_id = v_session.organization_id;

    if v_goal_count <> array_length(v_goal_ids, 1) then
      return jsonb_build_object(
        'success', false,
        'error_code', 'INVALID_GOALS',
        'error_message', 'One or more goals are invalid for this session'
      );
    end if;
  end if;

  v_started_at := coalesce(p_started_at, now());

  update public.sessions
  set
    program_id = p_program_id,
    goal_id = p_goal_id,
    started_at = v_started_at,
    status = 'in_progress'
  where id = v_session.id;

  if array_length(v_goal_ids, 1) is not null then
    foreach v_goal_id in array v_goal_ids loop
      insert into public.session_goals (
        session_id,
        goal_id,
        organization_id,
        client_id,
        program_id
      ) values (
        v_session.id,
        v_goal_id,
        v_session.organization_id,
        v_session.client_id,
        p_program_id
      )
      on conflict (session_id, goal_id) do update
      set
        organization_id = excluded.organization_id,
        client_id = excluded.client_id,
        program_id = excluded.program_id;
    end loop;
  end if;

  perform public.record_session_audit(
    v_session.id,
    'session_started',
    v_actor_id,
    jsonb_build_object(
      'programId', p_program_id,
      'goalId', p_goal_id,
      'goalIds', v_goal_ids,
      'startedAt', v_started_at
    )
  );

  return jsonb_build_object(
    'success', true,
    'session', jsonb_build_object(
      'id', v_session.id,
      'started_at', v_started_at
    )
  );
end;
$$;

revoke execute on function public.start_session_with_goals(uuid, uuid, uuid, uuid[], timestamptz, uuid) from public;
revoke execute on function public.start_session_with_goals(uuid, uuid, uuid, uuid[], timestamptz, uuid) from anon;
grant execute on function public.start_session_with_goals(uuid, uuid, uuid, uuid[], timestamptz, uuid) to authenticated;
grant execute on function public.start_session_with_goals(uuid, uuid, uuid, uuid[], timestamptz, uuid) to service_role;

notify pgrst, 'reload schema';
