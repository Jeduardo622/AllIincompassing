# WIN-274 BCBA Staff Therapist Links

## Classification

- lane: `critical`
- reason: Supabase migration plus record-level authorization behavior
- merge requirement: human review

## Scope

- Allow super admins to link therapist records to supported staff-tree roles.
- Keep ordinary admins limited to admin-family link targets.
- Preserve same-organization checks and existing grants.
- Self-scope BT and legacy therapist users to canonical `user_therapist_links` before fetching therapist details.
- Stabilize the browser checks needed to verify the workflow.

## Non-goals

- No broad role-model refactor.
- No hosted migration, deployment, or production data mutation.
- No changes to unrelated session lifecycle APIs.

## Verification

- `npm run verify:local`: passed.
- Focused therapist-details authorization tests: 5 passed.
- Local Playwright therapist authorization smoke: passed with configured credentials.
- Aggregate browser sequence: preflight, auth, schedule conflict, onboarding, and therapist authorization passed; the next session lifecycle check stopped on an unrelated local `/api/book` 404.
- Independent security re-review: no remaining findings.

## Residual Risk

- RLS remains the authoritative backend boundary for therapist and child-tab data.
- The migration has not been applied to hosted Supabase.
- The configured `PW_SUPERADMIN` credential is stale; verification used the valid `PW_ADMIN` account that resolves to `super_admin`.
- The branch requires human review before migration or merge.

## PR Review Follow-up

- Codex P1 `discussion_r3716230635` was validated against Supabase Preview: the legacy self-read policy checked `therapist_id = auth.uid()` and could not expose canonical links whose therapist row ID differs from the Auth user ID.
- Added a forward migration granting authenticated users `SELECT` visibility only for `user_therapist_links.user_id = auth.uid()`; write grants and admin management authority are unchanged.
- Reworked the tsx page-context regression fixture to serialize and execute the evaluated callback without launching Chromium, because ordinary unit-test and tenant-safety jobs intentionally do not install Playwright browsers.
- Supabase Preview should apply the new forward migration through the PR pipeline after the follow-up commit; no production migration was applied manually.

## Tracking

- Linear: [WIN-274](https://linear.app/winningedgeai/issue/WIN-274/link-bcba-staff-roles-to-therapist-records-safely)
- Branch: `codex/win-274-bcba-staff-links`

## Production Link-Mutation Follow-up

- Production `set_admin_therapist_link` returned HTTP 400 after the original merge.
- Live Postgres logs and the deployed function definition confirmed `column reference "user_id" is ambiguous` at the insert conflict target.
- Cause: the RPC returns output columns named `user_id` and `therapist_id`, which collide with `on conflict (user_id, therapist_id)` inside PL/pgSQL.
- Forward repair: redefine only `set_admin_therapist_link` and target the confirmed `user_therapist_links_user_id_therapist_id_key` constraint explicitly.
- Migration application fails closed unless that named unique constraint covers exactly `(user_id, therapist_id)` in order.
- Caller authentication, role allowlists, tenant checks, function signature, return shape, and execute grants remain unchanged.
- Follow-up branch: `codex/win-274-link-rpc-followup`.
- Local proof: focused contracts `5/5`, full suite `3999/3999`, policy checks, tenant safety, lint, typecheck, and production build pass.
- Hosted read-only proof: the migration's exact constraint-shape guard evaluates true against the production schema.
- Preview runtime proof: migration `20260805160000` applied; the function uses the named constraint; grants remain denied to `anon` and allowed to `authenticated`/`service_role`; two transactional calls returned one row each and left exactly one link row; rollback restored the seeded fixture and removed the temp proof table.
- Remaining closure proof: human review, merge, production migration confirmation, and a successful hosted link mutation.

### Verification Card

- Classification: high-risk human-reviewed
- Lane: critical
- Change type: database migration, tenant-scoped security-definer RPC
- Required checks: `npm run ci:check-focused`, `npm run test:ci`, `npm run validate:tenant`, `npm run build`, focused migration contracts, hosted schema-shape preflight, `npm run verify:local`
- Executed checks: policy pass; full suite pass (`472` files, `3999` tests); tenant validation pass; build pass; focused contracts pass (`5/5`); hosted schema-shape preflight pass; aggregate `verify:local` pass, including `220/220` Tier-0 route checks
- Blocked checks: none; local migration runtime was unavailable, so the equivalent isolated replay and rollback-safe mutation proof ran on the PR Supabase preview branch
- Result: pass
- Residual risk: critical-lane human review remains mandatory before merge, followed by production migration and hosted UI mutation confirmation
