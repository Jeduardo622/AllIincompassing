# Scheduling RPC Smoke Tests

Manual verification steps executed after restoring the scheduling SQL functions.

## Supabase lint

```bash
npx supabase db lint --db-url "postgresql://postgres.wnnjeqheqxxyrgsjmygy:Allincompassing.123@aws-0-us-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
```

Only legacy “unused parameter” warnings remain.

## SQL sanity checks

```sql
select count(*)
from get_sessions_optimized(now() - interval '7 days', now() + interval '7 days');

select jsonb_pretty(get_schedule_data_batch(now() - interval '1 day', now() + interval '1 day'));

select jsonb_pretty(
  get_alternative_times(
    '<therapist-id>'::uuid,
    '<client-id>'::uuid,
    now()
  )
);

select *
from get_optimal_time_slots(
  (select to_jsonb(t) from therapists t limit 1),
  (select to_jsonb(c) from clients c limit 1),
  60,
  jsonb_build_object('start', current_date::text, 'end', (current_date + 7)::text)
);

select confirm_session_hold(hold_key, session_payload)
from session_holds
limit 1;
```

Replace IDs with real UUIDs from the target environment when running interactively.

