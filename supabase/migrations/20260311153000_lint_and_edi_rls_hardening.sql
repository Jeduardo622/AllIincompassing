-- @migration-intent: Resolve current Supabase lint blocker functions and enforce RLS policies on EDI persistence tables.
-- @migration-dependencies: 20260311111000_create_edi_persistence_tables.sql
-- @migration-rollback: Revert function bodies to previous definitions and drop EDI RLS policies if emergency rollback is required.

set search_path = public;

create or replace function app.approve_guardian_request(
  p_request_id uuid,
  p_client_ids uuid[],
  p_relationship text default null::text,
  p_resolution_notes text default null::text
) returns table(guardian_id uuid, approved_client_ids uuid[])
language plpgsql
security definer
set search_path = 'public', 'auth'
as $$
declare
  v_request public.guardian_link_queue%rowtype;
  v_org uuid;
  v_actor uuid := app.current_user_id();
  v_now timestamptz := timezone('utc', now());
  v_client_id uuid;
  v_linked_clients uuid[] := '{}'::uuid[];
  v_relationship text := nullif(p_relationship, '');
begin
  if v_actor is null then
    raise exception 'Authentication context required';
  end if;

  select * into v_request
  from public.guardian_link_queue
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Guardian request % not found', p_request_id;
  end if;

  if v_request.status <> 'pending' then
    raise exception 'Guardian request % is not pending', p_request_id;
  end if;

  v_org := v_request.organization_id;

  if (p_client_ids is null or array_length(p_client_ids, 1) = 0) and v_org is null then
    raise exception 'Select at least one client or provide an organization before approval';
  end if;

  if p_client_ids is not null and array_length(p_client_ids, 1) > 0 then
    select distinct organization_id into v_org
    from public.clients
    where id = any(p_client_ids)
    limit 1;

    if v_org is null then
      raise exception 'Unable to resolve organization from selected clients';
    end if;

    if exists (
      select 1
      from public.clients c
      where c.id = any(p_client_ids)
        and c.organization_id <> v_org
    ) then
      raise exception 'All selected clients must belong to the same organization';
    end if;
  end if;

  if v_org is null then
    raise exception 'Organization context could not be resolved for guardian approval';
  end if;

  if not app.user_has_role_for_org(v_actor, v_org, array['org_admin']) then
    raise exception 'Insufficient privileges to approve guardian access for this organization';
  end if;

  if p_client_ids is not null then
    foreach v_client_id in array p_client_ids loop
      update public.client_guardians
      set
        deleted_at = null,
        deleted_by = null,
        updated_at = v_now,
        updated_by = v_actor,
        relationship = coalesce(v_relationship, public.client_guardians.relationship)
      where public.client_guardians.guardian_id = v_request.guardian_id
        and public.client_guardians.client_id = v_client_id
        and public.client_guardians.organization_id = v_org;

      if not found then
        insert into public.client_guardians (
          organization_id,
          client_id,
          guardian_id,
          relationship,
          is_primary,
          metadata,
          created_by,
          updated_by
        )
        values (
          v_org,
          v_client_id,
          v_request.guardian_id,
          coalesce(v_relationship, 'guardian'),
          false,
          jsonb_strip_nulls(jsonb_build_object('source', 'guardian_queue', 'queue_id', p_request_id)),
          v_actor,
          v_actor
        );
      end if;

      v_linked_clients := array_append(v_linked_clients, v_client_id);
    end loop;
  end if;

  update public.guardian_link_queue
  set
    status = 'approved',
    organization_id = v_org,
    approved_client_ids = coalesce(v_linked_clients, '{}'::uuid[]),
    processed_at = v_now,
    processed_by = v_actor,
    resolution_notes = nullif(p_resolution_notes, ''),
    metadata = jsonb_strip_nulls(metadata || jsonb_build_object(
      'approved_client_ids', coalesce(v_linked_clients, '{}'::uuid[]),
      'approved_relationship', v_relationship,
      'resolution_notes', nullif(p_resolution_notes, '')
    ))
  where id = p_request_id;

  perform app.ensure_user_role_by_name(v_request.guardian_id, 'client');
  return query select v_request.guardian_id, coalesce(v_linked_clients, '{}'::uuid[]);
end;
$$;

create or replace function public.generate_workload_recommendations(
  p_therapist_id uuid,
  p_actual_hours numeric,
  p_target_hours numeric,
  p_session_count integer
) returns jsonb
language plpgsql
security definer
set search_path = 'public', 'auth'
as $$
declare
  recommendations jsonb := jsonb_build_array();
  utilization_rate numeric;
  avg_session_length numeric;
begin
  if p_target_hours is null or p_target_hours = 0 then
    return '[]'::jsonb;
  end if;

  utilization_rate := (p_actual_hours / nullif(p_target_hours, 0)) * 100;
  avg_session_length := case when p_session_count > 0 then p_actual_hours / p_session_count else null end;

  if utilization_rate < 70 then
    recommendations := recommendations || jsonb_build_array(
      jsonb_build_object(
        'type', 'increase_utilization',
        'priority', 'high',
        'message', 'Utilization at ' || to_char(utilization_rate, 'FM999990D0') || '%.' ||
                   ' Consider adding ' || coalesce(to_char(round(p_target_hours - p_actual_hours, 1), 'FM999990D0'), '0') || ' hours/week',
        'action', 'schedule_more_sessions'
      )
    );
  end if;

  if utilization_rate > 120 then
    recommendations := recommendations || jsonb_build_array(
      jsonb_build_object(
        'type', 'reduce_overload',
        'priority', 'critical',
        'message', 'Overutilized at ' || to_char(utilization_rate, 'FM999990D0') || '%.' ||
                   ' Consider reducing ' || coalesce(to_char(round(p_actual_hours - p_target_hours, 1), 'FM999990D0'), '0') || ' hours/week',
        'action', 'redistribute_sessions'
      )
    );
  end if;

  if avg_session_length is not null and avg_session_length < 0.8 then
    recommendations := recommendations || jsonb_build_array(
      jsonb_build_object(
        'type', 'optimize_scheduling',
        'priority', 'medium',
        'message', 'Many short sessions detected. Consider grouping sessions for efficiency',
        'action', 'optimize_session_blocks'
      )
    );
  end if;

  return recommendations;
end;
$$;

create or replace function public.get_optimal_time_slots(
  p_therapist_preferences jsonb,
  p_client_preferences jsonb,
  p_duration integer default 60,
  p_date_range jsonb default '{"end": "+7 days", "start": "today"}'::jsonb
) returns table(suggested_time timestamptz, optimality_score numeric, reasoning jsonb, availability_data jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app.current_user_organization_id();
  start_date date;
  end_date date;
  v_therapist_id uuid := (p_therapist_preferences->>'id')::uuid;
  v_client_id uuid := (p_client_preferences->>'id')::uuid;
begin
  if v_org is null or v_therapist_id is null or v_client_id is null then
    return;
  end if;

  if not exists (
    select 1 from public.therapists t where t.id = v_therapist_id and t.organization_id = v_org
  ) then
    return;
  end if;

  if not exists (
    select 1 from public.clients c where c.id = v_client_id and c.organization_id = v_org
  ) then
    return;
  end if;

  start_date := case
    when p_date_range->>'start' = 'today' then current_date
    when p_date_range->>'start' ~ '^\+\d+\s+days?$' then current_date + (regexp_replace(p_date_range->>'start', '\+(\d+)\s+days?', '\1'))::integer
    else (p_date_range->>'start')::date
  end;

  end_date := case
    when p_date_range->>'end' = '+7 days' then (start_date + interval '7 days')::date
    when p_date_range->>'end' ~ '^\+\d+\s+days?$' then (start_date + (regexp_replace(p_date_range->>'end', '\+(\d+)\s+days?', '\1'))::integer)::date
    else (p_date_range->>'end')::date
  end;

  return query
  with business_hours as (
    select generate_series(
      start_date::timestamp + interval '8 hours',
      end_date::timestamp + interval '17 hours',
      interval '30 minutes'
    ) as slot_time
  ),
  available_slots as (
    select
      bh.slot_time,
      extract(dow from bh.slot_time) as day_of_week,
      extract(hour from bh.slot_time) as hour_of_day
    from business_hours bh
    where bh.slot_time + interval '1 minute' * p_duration <= date_trunc('day', bh.slot_time) + interval '18 hours'
      and not exists (
        select 1
        from public.sessions s
        where s.organization_id = v_org
          and (s.therapist_id = v_therapist_id or s.client_id = v_client_id)
          and s.status = 'scheduled'
          and tstzrange(s.start_time, s.end_time, '[)') &&
              tstzrange(bh.slot_time, bh.slot_time + interval '1 minute' * p_duration, '[)')
      )
  ),
  scored_slots as (
    select
      avs.slot_time,
      public.calculate_time_slot_score(
        avs.slot_time,
        avs.day_of_week,
        avs.hour_of_day,
        p_therapist_preferences,
        p_client_preferences,
        v_therapist_id,
        v_client_id
      ) as score
    from available_slots avs
  )
  select
    ss.slot_time,
    ss.score,
    public.generate_slot_reasoning(
      ss.slot_time,
      p_therapist_preferences,
      p_client_preferences,
      v_therapist_id,
      v_client_id
    ) as reasoning,
    public.get_slot_availability_context(ss.slot_time, v_therapist_id, v_client_id) as availability_data
  from scored_slots ss
  where ss.score > 0.3
  order by ss.score desc
  limit 10;
end;
$$;

create or replace function public.get_alternative_times(
  p_therapist_id uuid,
  p_client_id uuid,
  p_original_time timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app.current_user_organization_id();
  date_range_start date := p_original_time::date;
  date_range_end date := (p_original_time::date + interval '7 days')::date;
  alternative_slots jsonb;
begin
  if v_org is null then
    return jsonb_build_array();
  end if;

  if not exists (
    select 1 from public.therapists t where t.id = p_therapist_id and t.organization_id = v_org
  ) then
    return jsonb_build_array();
  end if;

  if not exists (
    select 1 from public.clients c where c.id = p_client_id and c.organization_id = v_org
  ) then
    return jsonb_build_array();
  end if;

  with top_slots as (
    select
      slots.suggested_time,
      slots.optimality_score,
      slots.reasoning
    from public.get_optimal_time_slots(
      (select to_jsonb(t) from public.therapists t where t.id = p_therapist_id),
      (select to_jsonb(c) from public.clients c where c.id = p_client_id),
      60,
      jsonb_build_object('start', date_range_start, 'end', date_range_end)
    ) as slots(suggested_time, optimality_score, reasoning, availability_data)
    where slots.optimality_score > 0.6
    order by slots.optimality_score desc
    limit 5
  )
  select jsonb_agg(
    jsonb_build_object(
      'suggested_time', t.suggested_time,
      'optimality_score', t.optimality_score,
      'reasoning', t.reasoning
    ) order by t.optimality_score desc
  )
  into alternative_slots
  from top_slots t;

  return coalesce(alternative_slots, jsonb_build_array());
end;
$$;

create or replace function public.calculate_therapist_client_compatibility(
  p_therapist_id uuid,
  p_client_id uuid
) returns numeric
language plpgsql
security definer
set search_path = 'public', 'auth'
as $$
declare
  compatibility_score numeric := 0;
  therapist_data record;
  client_data record;
  v_primary_diagnosis text;
begin
  select * into therapist_data from public.therapists where id = p_therapist_id;
  select * into client_data from public.clients where id = p_client_id;

  if therapist_data is null or client_data is null then
    return 0;
  end if;

  if coalesce(therapist_data.service_type, array[]::text[]) && coalesce(client_data.service_preference, array[]::text[]) then
    compatibility_score := compatibility_score + 0.4;
  end if;

  v_primary_diagnosis := coalesce((client_data.diagnosis::text[])[1], null);
  if v_primary_diagnosis is not null
     and coalesce(therapist_data.specialties, array[]::text[]) && array[v_primary_diagnosis]::text[] then
    compatibility_score := compatibility_score + 0.3;
  end if;

  compatibility_score := compatibility_score + coalesce((select get_historical_success_rate(p_therapist_id, p_client_id)), 0.2);
  return least(compatibility_score, 1.0);
end;
$$;

create or replace function public.analyze_therapist_workload(
  p_therapist_id uuid default null::uuid,
  p_analysis_period integer default 30
) returns table(
  therapist_id uuid,
  therapist_name text,
  utilization_rate numeric,
  total_hours numeric,
  target_hours numeric,
  efficiency_score numeric,
  recommendations jsonb,
  workload_distribution jsonb
)
language plpgsql
security definer
set search_path = 'public', 'app', 'auth'
as $$
begin
  return query
  with daily_counts as (
    select
      s.therapist_id,
      extract(dow from s.start_time)::int as day_of_week,
      count(*)::int as day_count
    from public.sessions s
    where s.start_time >= current_date - interval '1 day' * p_analysis_period
      and s.status in ('scheduled', 'completed')
      and (p_therapist_id is null or s.therapist_id = p_therapist_id)
    group by s.therapist_id, extract(dow from s.start_time)::int
  ),
  session_hours as (
    select
      s.therapist_id,
      sum(extract(epoch from (s.end_time - s.start_time)) / 3600) as total_hours,
      count(*)::int as session_count,
      (
        select jsonb_object_agg(dc.day_of_week, dc.day_count)
        from daily_counts dc
        where dc.therapist_id = s.therapist_id
      ) as daily_distribution
    from public.sessions s
    where s.start_time >= current_date - interval '1 day' * p_analysis_period
      and s.status in ('scheduled', 'completed')
      and (p_therapist_id is null or s.therapist_id = p_therapist_id)
    group by s.therapist_id
  ),
  therapist_stats as (
    select
      t.id,
      t.full_name,
      t.weekly_hours_min,
      t.weekly_hours_max,
      coalesce(sh.total_hours, 0) as actual_hours,
      coalesce(sh.session_count, 0) as session_count,
      sh.daily_distribution
    from public.therapists t
    left join session_hours sh on t.id = sh.therapist_id
    where t.status = 'active'
      and (p_therapist_id is null or t.id = p_therapist_id)
  )
  select
    ts.id,
    ts.full_name,
    round((ts.actual_hours * 4) / nullif((ts.weekly_hours_min + ts.weekly_hours_max), 0) * 100, 2) as utilization_rate,
    ts.actual_hours,
    (ts.weekly_hours_min + ts.weekly_hours_max) / 2.0 as target_hours,
    calculate_efficiency_score(ts.id, ts.actual_hours, ts.session_count) as efficiency_score,
    generate_workload_recommendations(ts.id, ts.actual_hours, (ts.weekly_hours_min + ts.weekly_hours_max) / 2.0, ts.session_count) as recommendations,
    ts.daily_distribution as workload_distribution
  from therapist_stats ts;
end;
$$;

create or replace function public.get_sessions_report(
  p_start_date date,
  p_end_date date,
  p_therapist_id uuid,
  p_client_id uuid,
  p_status text
) returns table(session_id uuid, client_name text, therapist_name text, session_day date, session_type text, status text)
language plpgsql
security definer
set search_path = 'public', 'auth'
as $$
begin
  return query
  select
    s.id,
    c.full_name,
    t.full_name,
    coalesce(s.session_date, s.start_time::date),
    s.session_type,
    s.status
  from public.sessions s
  join public.clients c on s.client_id = c.id
  join public.therapists t on s.therapist_id = t.id
  where coalesce(s.session_date, s.start_time::date) between p_start_date and p_end_date
    and (p_therapist_id is null or s.therapist_id = p_therapist_id)
    and (p_client_id is null or s.client_id = p_client_id)
    and (p_status is null or s.status = p_status);
end;
$$;

alter table if exists public.edi_export_files enable row level security;
alter table if exists public.edi_claim_statuses enable row level security;
alter table if exists public.edi_claim_denials enable row level security;

drop policy if exists edi_export_files_service_role_all on public.edi_export_files;
create policy edi_export_files_service_role_all
on public.edi_export_files
as permissive
for all
to public
using ((select auth.role()) = 'service_role')
with check ((select auth.role()) = 'service_role');

drop policy if exists edi_claim_statuses_service_role_all on public.edi_claim_statuses;
create policy edi_claim_statuses_service_role_all
on public.edi_claim_statuses
as permissive
for all
to public
using ((select auth.role()) = 'service_role')
with check ((select auth.role()) = 'service_role');

drop policy if exists edi_claim_denials_service_role_all on public.edi_claim_denials;
create policy edi_claim_denials_service_role_all
on public.edi_claim_denials
as permissive
for all
to public
using ((select auth.role()) = 'service_role')
with check ((select auth.role()) = 'service_role');
