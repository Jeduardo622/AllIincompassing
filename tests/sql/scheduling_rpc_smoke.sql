\echo 'Scheduling RPC smoke checks'

-- Sessions optimized (adjust UUIDs/filters as needed)
select
  (session_data->>'id')::uuid as session_id,
  session_data->>'start_time' as start_time
from public.get_sessions_optimized(
  timezone('utc', now()) - interval '1 day',
  timezone('utc', now()) + interval '1 day'
)
limit 5;

-- Schedule batch payload for dashboard/calendar hydration
select jsonb_pretty(
  public.get_schedule_data_batch(
    timezone('utc', now()) - interval '1 day',
    timezone('utc', now()) + interval '1 day'
  )
);

-- Alternative therapists for a sample client (replace UUIDs)
-- select jsonb_pretty(
--   public.get_alternative_therapists(
--     '<client_id>'::uuid,
--     timezone('utc', now()),
--     timezone('utc', now()) + interval '1 hour'
--   )
-- );

-- Slot recommendations (replace UUIDs as desired)
-- select *
-- from public.get_optimal_time_slots(
--   (select to_jsonb(t) from public.therapists t limit 1),
--   (select to_jsonb(c) from public.clients c limit 1),
--   60,
--   jsonb_build_object('start', current_date::text, 'end', (current_date + 7)::text)
-- )
-- limit 5;

