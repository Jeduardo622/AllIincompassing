## Task 2 Report

- Scope: `supabase/functions/admin-invite/index.ts`, `tests/admins/invite_flow.spec.ts`
- Status: complete
- Summary:
  - `admin-invite` now resolves non-super-admin org scope with `resolveOrgId(adminClient)`.
  - Targeted invites accept `targetTherapistId`, validate therapist org/email/status/deletion before RPC issuance, and pass `p_target_therapist_id` into the seven-argument service-role RPC.
  - Email delivery rollback now revokes the invite row with `revoked_at` instead of deleting it, and audit details capture `target_therapist_id`.
- Verification:
  - `vitest`: `tests/admins/invite_flow.spec.ts` passed with 18/18 tests.
- Review fix evidence:
  - Added an early fail-closed guard for `targetTherapistId` with any non-`bt` role before therapist lookup, RPC issuance, email delivery, or audit insertion.
  - Added focused coverage proving targeted non-`bt` invites return `403 target_therapist_role_forbidden` with no side effects.
  - Renamed rollback-fixture wording from delete semantics to revoke/update semantics for clarity.
- Verification update:
  - `vitest`: `tests/admins/invite_flow.spec.ts` passed with 19/19 tests after the review fix.
- Residual risk:
  - Validation relies on the edge function and the database RPC staying aligned on target-therapist invariants; broader cross-suite verification remains for the parent flow.
