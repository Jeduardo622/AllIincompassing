# Therapists Supabase Static Assets

| Object | Type | Source Reference | Purpose | Security Controls |
| --- | --- | --- | --- | --- |
| `sessions` table | Postgres table | Read in `supabase/functions/get-schedule-data-batch/index.ts` and `get-sessions-optimized/index.ts`. | Stores canonical appointment records powering schedule matrix, metrics, and cancellations. | Depends on RLS to scope by organization/role; functions assume policies restrict reads/writes appropriately. |
| `session_holds` table | Postgres table | Written by `supabase/functions/sessions-hold/index.ts` and consumed by `sessions-confirm`. | Maintains temporary reservations before confirmation. | Idempotency enforced at application layer; ensure unique constraints prevent reuse of expired holds. |
| `session_cancellations` table | Postgres table | Updated in `supabase/functions/sessions-cancel/index.ts`. | Logs cancellation metadata for audits and follow-up workflows. | Should restrict insert/update to session owners to avoid tampering. |
| `therapists` table | Postgres table | Queried by dropdown/schedule functions and `src/pages/Therapists.tsx`. | Houses therapist demographics, availability JSON, service lines. | Sensitive PII (NPI, medicaid ids) exposed to any authenticated fetcher; rely on RLS to bound organization. |
| `authorizations` table | Postgres table | Joined into schedule/optimized responses. | Provides payer approvals and session quotas. | Contains PHI; only expose to therapists assigned to clients via policies. |

## Security Risks
- `sessions` queries run under request-scoped clients with service role privileges inside edge functions; any SQL injection or parameter bypass could escalate to cross-tenant reads.
- Availability JSON is returned without masking; storing addresses in `therapists` rows may disclose personal contact info if policies misconfigured.
- Lack of server-side TTL enforcement on `session_holds` risks stale rows being re-confirmed when idempotency keys collide. 
