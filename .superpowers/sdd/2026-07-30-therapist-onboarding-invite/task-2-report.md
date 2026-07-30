## Task 2 Report

- Scope: `supabase/functions/admin-invite/index.ts`, `tests/admins/invite_flow.spec.ts`
- Status: complete
- Summary:
  - `admin-invite` now resolves non-super-admin org scope with `resolveOrgId(adminClient)`.
  - Targeted invites accept `targetTherapistId`, validate therapist org/email/status/deletion before RPC issuance, and pass `p_target_therapist_id` into the seven-argument service-role RPC.
  - Email delivery rollback now revokes the invite row with `revoked_at` instead of deleting it, and audit details capture `target_therapist_id`.
- Verification:
  - `vitest`: `tests/admins/invite_flow.spec.ts` passed with 18/18 tests.
- Residual risk:
  - Validation relies on the edge function and the database RPC staying aligned on target-therapist invariants; broader cross-suite verification remains for the parent flow.
