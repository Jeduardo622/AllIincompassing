## RLS Proof (New)

Tests executed (see `tests/rls/rls_sessions.spec.ts`):
- Same org therapist can insert via `/rpc/insert_session_with_billing` with headers `apikey: <anon>`, `Authorization: Bearer <user JWT>` → success.
- Cross-org user denied (401/403) → success.

UI tests:
- Booking payload overrides present.
- Basic a11y markers (aria-label/title) present for icon-only buttons.

No service role in client bundle confirmed by static scan of `src/lib/supabaseClient.ts` and related imports.


