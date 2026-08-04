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

## Tracking

- Linear: [WIN-274](https://linear.app/winningedgeai/issue/WIN-274/link-bcba-staff-roles-to-therapist-records-safely)
- Branch: `codex/win-274-bcba-staff-links`
