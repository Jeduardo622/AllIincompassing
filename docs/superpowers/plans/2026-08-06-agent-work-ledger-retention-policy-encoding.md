# Agent Work Ledger Retention Policy Encoding Plan

**Issue:** WIN-275
**Route:** high-risk human-reviewed, critical lane

1. Add a focused contract test that fails while the forward migration is absent.
2. Generate the migration with `supabase migration new agent_work_retention_policy_encoding`.
3. Create and seed the immutable decision catalog without changing the operational policy registry or prune RPC.
4. Extend the local retention contract to verify the exact decision rows and zero-delete denial for all three categories.
5. Update operator, verification, and handoff documentation.
6. Run focused tests, fresh reset, retention/security/tenant checks, the critical verification matrix, and independent specialist review.
7. Create a local review-ready commit and document the future PR step; do not push, apply the migration to hosted Supabase, or activate deletion.

Stop if implementation requires an `auth.users` seed, a delete statement, prune activation, runtime/scheduler changes, hosted access, or a scope outside the files above.
