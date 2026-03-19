# Priority 4 Query Plan Evidence

## Scope

Validate booking/session hot-path improvements introduced in:

- `supabase/migrations/20260319110000_priority4_session_query_indexes.sql`
- `src/pages/Schedule.tsx` (single primary schedule query path with fallback-only secondary path)

## Plan checks

Run these statements against staging and attach the output to the deploy ticket:

```sql
explain (analyze, buffers)
select s.id
from public.sessions s
where s.organization_id = '<org-id>'
  and s.therapist_id = '<therapist-id>'
  and s.status <> 'cancelled'
  and tstzrange(s.start_time, s.end_time, '[)') && tstzrange('<start-ts>', '<end-ts>', '[)');
```

```sql
explain (analyze, buffers)
select s.id
from public.sessions s
where s.organization_id = '<org-id>'
  and s.client_id = '<client-id>'
  and s.status <> 'cancelled'
  and tstzrange(s.start_time, s.end_time, '[)') && tstzrange('<start-ts>', '<end-ts>', '[)');
```

```sql
explain (analyze, buffers)
select h.id
from public.session_holds h
where h.organization_id = '<org-id>'
  and h.therapist_id = '<therapist-id>'
  and h.expires_at > now()
  and tstzrange(h.start_time, h.end_time, '[)') && tstzrange('<start-ts>', '<end-ts>', '[)');
```

## Acceptance notes

- Expected index usage:
  - `sessions_org_therapist_active_time_idx`
  - `sessions_org_client_active_time_idx`
  - `session_holds_org_therapist_expires_time_idx`
  - `session_holds_org_client_expires_time_idx`
- Compare p95 latency for `/api/book` and schedule reads before/after migration.
- Keep previous query path available for one release window if regression is detected.
