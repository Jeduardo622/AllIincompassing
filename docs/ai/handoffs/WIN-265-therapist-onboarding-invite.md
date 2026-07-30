# WIN-265 Therapist Onboarding Invite Handoff

- classification: high-risk human-reviewed
- lane: critical
- issue: WIN-265
- scope: make therapist onboarding issue a therapist-bound BT invite, persist invite lifecycle state, create the Auth/profile/role/link records on acceptance, and preserve a recoverable resend path when delivery fails
- non-goals: plaintext password storage, immediate admin-created passwords, generic staff-onboarding redesign, unrelated auth or RLS cleanup, and production deployment before human review
- protected paths:
  - `supabase/migrations/20260730170000_therapist_invite_target_lifecycle.sql`
  - `supabase/migrations/20260730183000_preserve_admin_invite_audit_fks.sql`
  - `supabase/functions/admin-invite/index.ts`
  - `supabase/functions/accept-staff-invite/index.ts`
- hosted read-only evidence: the linked Supabase project contained a therapist directory row without the corresponding Auth user, profile, role, or therapist link; no production mutation was performed

## Implemented Behavior

- Therapist onboarding and profile retry pass the exact therapist row ID to `admin-invite`.
- Targeted invites are restricted to `bt`, use canonical database-backed organization context, and validate therapist organization, normalized email, active status, and deletion state.
- Invite tokens record target, accepted, and revoked lifecycle state.
- Acceptance revalidates the target, creates Auth/profile/role/link records, consumes the invite with compare-and-set semantics, and removes the newly created Auth user if protected completion fails.
- Generic and targeted active invites cannot coexist for the same normalized email and organization.
- Staff-management roles admitted to therapist onboarding may issue only exact targeted BT invites; generic staff invites remain limited to `admin` and `super_admin`.
- Deleting an inviter or accepted user preserves the invite audit row by nulling its foreign key. A pending invite whose inviter was deleted fails closed before any acceptance side effect.
- The legacy six-argument invite RPC remains as a service-role-only wrapper around the targeted seven-argument RPC for rollout-order compatibility.
- Email-delivery failure revokes the invite without deleting the valid therapist row; the therapist profile provides the retry action.

## Verification Card

- lane: critical
- required checks:
  - focused invite, acceptance, migration, and component regressions
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run validate:tenant`
  - `npm run test:routes:tier0`
  - `npm run build`
  - `npm run verify:local`
  - `npm run ci:playwright` when protected credentials are available
- executed checks:
  - `npx vitest run tests/admins/invite_flow.spec.ts tests/admins/accept_invite_flow.spec.ts tests/admins/therapist_invite_target_migration.spec.ts tests/admins/therapist_invite_fk_lifecycle_migration.spec.ts tests/security/public-security-definer-rpc-grants.security.spec.ts src/components/__tests__/TherapistOnboarding.test.tsx src/components/__tests__/TherapistProfileInvite.test.tsx` -> pass, 7 files / 81 tests after the PR review fixes
  - `npx vitest run tests/admins/invite_flow.spec.ts tests/admins/accept_invite_flow.spec.ts tests/admins/therapist_invite_target_migration.spec.ts src/components/__tests__/TherapistOnboarding.test.tsx src/components/__tests__/TherapistProfileInvite.test.tsx` -> pass, 5 files / 60 tests after synchronizing `origin/main`
  - `npm run ci:check-focused` -> pass; database-backed grant/RLS checks skipped because `SUPABASE_DB_URL` was unavailable, and auth parity was disabled locally
  - `npm run lint` -> pass
  - `npm run typecheck` -> pass
  - `npm run validate:tenant` -> pass
  - `npm run build` -> pass
  - `npm run test:routes:tier0` -> pass, 7 Cypress specs / 220 tests
- blocked or failed checks:
  - `npm run test:ci` -> environment failure during coverage execution: Node heap OOM (`Ineffective mark-compacts near heap limit`, `ERR_IPC_CHANNEL_CLOSED`)
  - `npm run verify:local` -> failed at its inherited `test:ci` phase for the same Node heap OOM
  - `npm run ci:playwright` -> blocked because neither `PW_SUPERADMIN_EMAIL` + `PW_SUPERADMIN_PASSWORD` nor `PW_ADMIN_EMAIL` + `PW_ADMIN_PASSWORD` was available
- result: pass-with-blocked-checks; review-ready, not merge-ready

## Independent Reviews

- code-review-engineer: approve; final whole-branch review clean after RPC rollout compatibility and canonical organization routing fixes
- security-engineer: approve; no authz, token exposure, grant widening, or tenant-isolation regression found
- supabase-reviewer: approve with verification residual risk; both RPC overloads remain service-role-only and the tenant boundary is preserved
- test-engineer: required local matrix executed; full coverage was blocked by process heap exhaustion and credentialed Playwright by missing protected credentials
- resolved review findings:
  - normalized invite-acceptance therapist status consistently with issuance
  - prevented generic and targeted active-invite coexistence in both orderings
  - made mixed-order collision tests preserve the stored target shape
  - restored a backward-compatible six-argument RPC wrapper
  - removed mutable Auth metadata from default super-admin organization resolution
  - aligned the outer invite route with the established staff-management roles while retaining handler-level targeted-BT-only least privilege
  - made both invite audit foreign keys use `ON DELETE SET NULL`, made `created_by` nullable, and rejected pending invites whose inviter no longer exists

## PR Review Follow-Up

- Automated review found that `admin_schedule` and `bcba` could reach therapist onboarding but were rejected by the invite route wrapper before the targeted-invite authorization check.
- The route now uses `RouteOptions.staffAdmin`; handler authorization still restricts `admin_schedule` and `bcba` to exact targeted BT invites, while generic invites remain denied.
- Automated review also found that the existing `created_by` and `accepted_by_user_id` foreign keys could block deletion of inviter or accepted-user Auth records.
- A forward migration changes both audit foreign keys to `ON DELETE SET NULL`, makes `created_by` nullable, and preserves historical invite rows.
- Acceptance rejects a pending invite with a null inviter before creating a user, granting a role, writing a profile, linking a therapist, consuming the token, or inserting an admin action.
- Focused review-fix verification passed, 7 files / 81 tests; the Tier-0 route gate remains passing, 7 Cypress specs / 220 tests.
- Final code, security, and Supabase rereviews approved the complete review-fix diff with no required changes.

## Residual Risk

- The migration contract was checked statically and through focused tests, but was not applied to a live branch database.
- Database-backed grant/RLS policy checks were skipped without `SUPABASE_DB_URL`.
- The aggregate coverage suite did not complete because the local Node process exhausted its heap.
- Credentialed hosted Playwright remains for CI/human-review follow-through.
- Production still requires reviewed migration/function deployment and a new invite for the affected therapist; this branch does not mutate the live account.

## Post-Sync Verification

- merged `origin/main` at `b25b59b7`; the two incoming changes touched unrelated session-modal and test-harness paths
- focused regressions -> pass, 5 files / 60 tests
- `npm run ci:check-focused` -> pass with the same documented database/auth-parity skips
- `npm run lint` -> pass
- `npm run typecheck` -> pass
- `npm run build` -> pass

## PR Hygiene

- pr-ready: yes, for human review
- merge-ready: no
- pull request: #878
- branch: `codex/therapist-onboarding-invite`
- linear-ready: yes, WIN-265
- single-purpose: yes
- unrelated changes: none identified
- protected-path drift: none beyond the routed migration and invite functions
- reviewer status: code, security, and Supabase reviews complete
- required merge blockers:
  - critical-lane human review
  - live CI evaluation of the full coverage and credentialed browser gates
  - reviewed Supabase migration and Edge Function deployment sequence
- post-deploy validation: resend the therapist-bound invite, accept it with a compliant user-chosen password, and verify Auth/profile/role/exact therapist-link creation
