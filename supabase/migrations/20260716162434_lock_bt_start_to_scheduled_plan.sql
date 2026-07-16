-- @migration-intent: Allow assigned BTs to start scheduled sessions without permitting client-supplied program or goal linkage changes.
-- @migration-dependencies: 20260709162000_harden_goal_domain_and_session_link_authz.sql
-- @migration-rollback: Re-run 20260709162000_harden_goal_domain_and_session_link_authz.sql to restore the prior start-session behavior.

begin;

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
set search_path = ''
as $$
declare
  v_session record;
  v_started_at timestamptz;
  v_goal_ids uuid[];
  v_submitted_goal_ids uuid[];
  v_stored_goal_ids uuid[];
  v_goal_count integer := 0;
  v_goal_id uuid;
  v_goal_match_count integer := 0;
  v_stored_session_goal_count integer := 0;
  v_valid_stored_session_goal_count integer := 0;
  v_actor_id uuid;
  v_is_super_admin boolean := false;
  v_has_start_authority boolean := false;
  v_is_restricted_bt_actor boolean := false;
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
    s.program_id,
    s.goal_id,
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
      select coalesce(app.current_user_has_exact_role_for_org(
        v_session.organization_id,
        array['therapist', 'bt']::text[]
      ), false)
      and exists (
        select 1
        from public.user_therapist_links utl
        join public.therapists t on t.id = utl.therapist_id
        where utl.user_id = v_actor_id
          and utl.therapist_id = v_session.therapist_id
          and t.organization_id = v_session.organization_id
          and t.deleted_at is null
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

  select
    not v_is_super_admin
    and coalesce(app.current_user_has_exact_role_for_org(
      v_session.organization_id,
      array['bt']::text[]
    ), false)
    and not coalesce(app.current_user_has_exact_role_for_org(
      v_session.organization_id,
      array['admin', 'admin_schedule', 'midtier', 'bcba', 'therapist']::text[]
    ), false)
  into v_is_restricted_bt_actor;

  v_submitted_goal_ids := coalesce(p_goal_ids, array[]::uuid[]);
  v_submitted_goal_ids := array_append(v_submitted_goal_ids, p_goal_id);
  v_submitted_goal_ids := array(select distinct x from unnest(v_submitted_goal_ids) as x
    where x is not null
    order by x);
  v_goal_ids := v_submitted_goal_ids;

  case
  when v_is_restricted_bt_actor then
    select array_agg(sg.goal_id order by sg.goal_id)
      into v_stored_goal_ids
    from public.session_goals sg
    where sg.session_id = v_session.id;

    v_stored_goal_ids := array_append(
      coalesce(v_stored_goal_ids, array[]::uuid[]),
      v_session.goal_id
    );
    v_stored_goal_ids := array(select distinct x
      from unnest(v_stored_goal_ids) as x
      where x is not null
      order by x
    );

    if array_length(v_stored_goal_ids, 1) is null
      or not (v_session.goal_id = any(v_stored_goal_ids)) then
      return jsonb_build_object(
        'success', false,
        'error_code', 'INVALID_STORED_PLAN',
        'error_message', 'The scheduled session does not have a canonical primary goal plan'
      );
    end if;

    select count(*)
      into v_goal_match_count
    from public.programs p
    where p.id = v_session.program_id
      and p.client_id = v_session.client_id
      and p.organization_id = v_session.organization_id
      and p.status = 'active';

    if v_goal_match_count <> 1 then
      return jsonb_build_object(
        'success', false,
        'error_code', 'INVALID_STORED_PLAN',
        'error_message', 'The scheduled session program is missing, inactive, or outside the session tenant'
      );
    end if;

    select count(*)
      into v_goal_match_count
    from public.goals g
    where g.id = v_session.goal_id
      and g.program_id = v_session.program_id
      and g.client_id = v_session.client_id
      and g.organization_id = v_session.organization_id
      and g.status = 'active';

    if v_goal_match_count <> 1 then
      return jsonb_build_object(
        'success', false,
        'error_code', 'INVALID_STORED_PLAN',
        'error_message', 'The scheduled session primary goal is missing, inactive, or outside the stored program'
      );
    end if;

    select count(*)
      into v_stored_session_goal_count
    from public.session_goals sg
    where sg.session_id = v_session.id;

    select count(*)
      into v_valid_stored_session_goal_count
    from public.session_goals sg
    join public.goals g
      on g.id = sg.goal_id
    join public.programs p
      on p.id = sg.program_id
    where sg.session_id = v_session.id
      and sg.client_id = v_session.client_id
      and sg.organization_id = v_session.organization_id
      and sg.program_id = v_session.program_id
      and g.program_id = sg.program_id
      and g.client_id = v_session.client_id
      and g.organization_id = v_session.organization_id
      and g.status = 'active'
      and p.client_id = v_session.client_id
      and p.organization_id = v_session.organization_id
      and p.status = 'active';

    if v_valid_stored_session_goal_count <> v_stored_session_goal_count then
      return jsonb_build_object(
        'success', false,
        'error_code', 'INVALID_STORED_PLAN',
        'error_message', 'One or more scheduled session goals are inactive or outside their stored tenant plan'
      );
    end if;

    if p_program_id is distinct from v_session.program_id
      or p_goal_id is distinct from v_session.goal_id
      or v_submitted_goal_ids is distinct from v_stored_goal_ids then
      return jsonb_build_object(
        'success', false,
        'error_code', 'PLAN_MISMATCH',
        'error_message', 'BT session start cannot change the scheduled program or goals'
      );
    end if;
  else
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
  end case;

  v_started_at := coalesce(p_started_at, now());

  if v_is_restricted_bt_actor then
    update public.sessions
    set
      started_at = v_started_at,
      status = 'in_progress'
    where id = v_session.id;
  else
    null;
  end if;

  if not v_is_restricted_bt_actor then
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

commit;
