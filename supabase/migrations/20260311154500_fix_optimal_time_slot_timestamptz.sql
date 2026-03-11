-- @migration-intent: Align get_optimal_time_slots return type with timestamptz output to clear Supabase lint error.
-- @migration-dependencies: 20260311153000_lint_and_edi_rls_hardening.sql
-- @migration-rollback: Restore prior get_optimal_time_slots body if time zone handling regressions appear.

set search_path = public;

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
      (start_date::timestamptz + interval '8 hours'),
      (end_date::timestamptz + interval '17 hours'),
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
