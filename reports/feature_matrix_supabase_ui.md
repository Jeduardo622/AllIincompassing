| Area | Capability | Status (✅/🟧/❌) | Evidence | Gaps/Risks | Proposed Fix | Effort (S/M/L) |
|---|---|---|---|---|---|---|
| Supabase | RLS coverage on PHI tables | ✅ | Policies in `20250923121500_enforce_org_scope.sql` and pg_policies dump | Review performance/logging tables for PHI | Tighten policies if any PHI exposure found | S |
| Supabase | Booking RPC includes CPT/modifiers | 🟧 | CPT derived in `src/server/deriveCpt.ts`, persisted via `session_cpt_entries` | No single insert RPC; uses service role persistence | Propose `rpc_insert_session_with_billing.sql` | S |
| Supabase | No service_role in client | ✅ | `src/lib/supabaseClient.ts` uses anon; service key only in server | None | Keep audits via `scripts/audit-service-role-usage.cjs` | S |
| UI | Auth tokens & headers correct | ✅ | `callEdge` sets Bearer; Supabase-js sets apikey | Ensure runtime config present early | Add retry/backoff on config fetch | S |
| UI | Booking form → API billing fields | 🟧 | UI sends session only; CPT persisted server-side | UI not showing CPT/modifiers confirmation | Add UI review step; optional overrides | S |
| UI | A11y (focus, labels, contrast) | 🟧 | Labels/aria mostly present; modal icons missing aria-label | Modal focus trap/return focus not explicit | Add aria-labels; implement focus trap | S |
| UI | Performance (bundle, waterfalls) | 🟧 | Code-splitting present; batched queries | Unknown asset sizes; improve preloads | Analyze bundle; adjust preloads/caching | S |


