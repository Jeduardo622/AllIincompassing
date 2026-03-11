-- @migration-intent: Add transactional session confirmation RPC that atomically persists session confirmation, CPT enrichment, goal links, and audit event.
-- @migration-dependencies: 20250711090000_session_holds.sql,20251111130000_therapist_sessions_enforcement.sql,20260310190000_business_logic_lifecycle_hardening.sql
-- @migration-rollback: Drop confirm_session_hold_with_enrichment and revert sessions-confirm to confirm_session_hold if rollback is required.

set search_path = public;

create or replace function public.confirm_session_hold_with_enrichment(
  p_hold_key uuid,
  p_session jsonb,
  p_cpt jsonb default null,
  p_goal_ids uuid[] default null,
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_success boolean;
  v_session jsonb;
  v_session_id uuid;
  v_duration integer;
  v_cpt_code text;
  v_cpt_description text;
  v_modifier_codes text[];
  v_modifier_code text;
  v_modifier_position integer := 1;
  v_cpt_code_id uuid;
  v_entry_id uuid;
  v_modifier_id uuid;
  v_goal_ids uuid[];
  v_goal_id uuid;
  v_session_row record;
begin
  v_result := public.confirm_session_hold(p_hold_key, p_session);
  v_success := coalesce((v_result->>'success')::boolean, false);
  if not v_success then
    return v_result;
  end if;

  v_session := v_result->'session';
  if v_session is null then
    raise exception 'Session response missing from confirm_session_hold';
  end if;

  v_session_id := nullif(v_session->>'id', '')::uuid;
  if v_session_id is null then
    raise exception 'Session identifier missing from confirm_session_hold result';
  end if;

  select
    s.id,
    s.organization_id,
    s.client_id,
    s.program_id,
    s.goal_id,
    s.duration_minutes
  into v_session_row
  from public.sessions s
  where s.id = v_session_id;

  if v_session_row.id is null then
    raise exception 'Session % not found after confirmation', v_session_id;
  end if;

  if p_cpt is not null then
    v_cpt_code := upper(trim(coalesce(p_cpt->>'code', '')));
    v_cpt_description := nullif(trim(coalesce(p_cpt->>'description', '')), '');

    if v_cpt_code <> '' then
      select c.id
        into v_cpt_code_id
      from public.cpt_codes c
      where upper(c.code) = v_cpt_code
      limit 1;

      if v_cpt_code_id is null then
        raise exception 'CPT code % is not registered in cpt_codes', v_cpt_code;
      end if;

      v_duration := coalesce(
        nullif(trim(coalesce(p_cpt->>'durationMinutes', '')), '')::integer,
        v_session_row.duration_minutes,
        60
      );
      if v_duration < 1 then
        v_duration := 60;
      end if;

      delete from public.session_cpt_entries where session_id = v_session_id;

      insert into public.session_cpt_entries (
        session_id,
        cpt_code_id,
        line_number,
        units,
        billed_minutes,
        is_primary,
        notes
      ) values (
        v_session_id,
        v_cpt_code_id,
        1,
        greatest(1, ceil(v_duration::numeric / 15)),
        v_duration,
        true,
        v_cpt_description
      )
      returning id into v_entry_id;

      v_modifier_codes := array(
        select upper(trim(value::text, '"'))
        from jsonb_array_elements(coalesce(p_cpt->'modifiers', '[]'::jsonb)) as value
        where length(trim(value::text, '"')) > 0
      );

      if array_length(v_modifier_codes, 1) is not null then
        foreach v_modifier_code in array v_modifier_codes loop
          select bm.id
            into v_modifier_id
          from public.billing_modifiers bm
          where upper(bm.code) = v_modifier_code
          limit 1;

          if v_modifier_id is null then
            raise exception 'Billing modifier % is not registered', v_modifier_code;
          end if;

          insert into public.session_cpt_modifiers (
            session_cpt_entry_id,
            modifier_id,
            position
          ) values (
            v_entry_id,
            v_modifier_id,
            v_modifier_position
          )
          on conflict (session_cpt_entry_id, modifier_id) do nothing;

          v_modifier_position := v_modifier_position + 1;
        end loop;
      end if;
    end if;
  end if;

  v_goal_ids := coalesce(p_goal_ids, array[]::uuid[]);
  if v_session_row.goal_id is not null then
    v_goal_ids := array_append(v_goal_ids, v_session_row.goal_id);
  end if;

  if array_length(v_goal_ids, 1) is not null then
    foreach v_goal_id in array v_goal_ids loop
      if v_goal_id is null then
        continue;
      end if;

      insert into public.session_goals (
        session_id,
        goal_id,
        organization_id,
        client_id,
        program_id
      ) values (
        v_session_id,
        v_goal_id,
        v_session_row.organization_id,
        v_session_row.client_id,
        v_session_row.program_id
      )
      on conflict (session_id, goal_id) do nothing;
    end loop;
  end if;

  if p_actor_id is not null then
    perform public.record_session_audit(
      v_session_id,
      'session_enrichment_persisted',
      p_actor_id,
      jsonb_build_object(
        'goalCount', coalesce(array_length(v_goal_ids, 1), 0),
        'hasCpt', p_cpt is not null
      )
    );
  end if;

  return v_result;
end;
$$;

revoke execute on function public.confirm_session_hold_with_enrichment(uuid, jsonb, jsonb, uuid[], uuid) from public;
revoke execute on function public.confirm_session_hold_with_enrichment(uuid, jsonb, jsonb, uuid[], uuid) from anon;
revoke execute on function public.confirm_session_hold_with_enrichment(uuid, jsonb, jsonb, uuid[], uuid) from authenticated;
grant execute on function public.confirm_session_hold_with_enrichment(uuid, jsonb, jsonb, uuid[], uuid) to service_role;
