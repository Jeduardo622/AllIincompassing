# WIN-203 BT Schedule Therapist Scope

## Classification

- classification: `high-risk human-reviewed`
- lane: `critical`
- trigger: tenant-sensitive schedule authorization in `supabase/migrations/**`
- merge requirement: human review

## Scope

- Restrict BT and legacy therapist schedule RPC rows to the caller's linked therapist identity.
- Preserve full-schedule access for `admin`, `admin_schedule`, `midtier`, `bcba`, and super-admin behavior.
- Keep assigned-client dropdown visibility and direct clinical session reads unchanged.
- Make the locked mobile schedule summary identify the scoped therapist instead of claiming `All therapists`.

## Non-goals

- No direct-session RLS redesign or clinical caseload capability change.
- No auth, role-model, session lifecycle, or deployment configuration change.
- No production migration application or hosted data mutation.
- Stop and re-route if safe containment requires changing direct clinical session policies.

## Evidence

- Aggregate-only hosted inspection for the reported account and day found one linked therapist, three therapist-owned appointments, and five appointments owned by other therapists among assigned-client schedule rows.
- The deployed client-scope migrations were present, ruling out a missing production migration as the cause.
- Root cause: both schedule RPCs authorized assigned clients without also matching `sessions.therapist_id` to the caller's linked therapist identity.

## Change

- Add a fail-closed schedule-session authorization helper.
- Apply it to `get_sessions_optimized` and `get_schedule_data_batch` without changing their signatures or payloads.
- Extend synthetic SQL smoke coverage for full-schedule, therapist-owned, BT-owned, and foreign-therapist rows.
- Correct the locked schedule-options summary and add a focused UI regression assertion.

## Verification Card

- required checks: focused migration/UI contracts; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run validate:tenant`; `npm run build`; `npm run test:routes:tier0`; `npm run ci:playwright`; responsive `/schedule` observer; runtime SQL smoke; `npm run verify:local`
- executed checks: focused contracts passed (`40/40`); strengthened migration contracts passed (`42/42`); policy checks passed; lint passed; typecheck passed; full test suite passed (`491` files passed, `2` skipped; `4223` tests passed, `5` skipped); tenant validation passed; build passed; Tier-0 route gate passed (`220/220`); responsive observer passed at `1440x900` and `390x844`
- blocked checks: authenticated Playwright stopped at preflight because no `PW_SUPERADMIN_*` or `PW_ADMIN_*` credentials were available; runtime SQL smoke awaits an isolated Supabase preview containing the new migration
- aggregate check: `npm run verify:local` passed in 418.7 seconds, including coverage verification and `220/220` Tier-0 routes
- result: pass locally; preview SQL and credentialed hosted browser checks remain blocked as stated above

## Review

- Specification, architecture, implementation, test, Supabase, security, performance, and code-review agents reviewed the bounded slice.
- Supabase review found no migration, grant, RLS, or tenant-isolation defect.
- Security re-review approved the explicit boundary: assigned-client direct session reads remain a separate clinical capability, while schedule loading is RPC-only and now therapist-owned. Human review must confirm that boundary.
- Performance re-review found no blocker because the therapist lookup remains index-assisted by the existing unique `(user_id, therapist_id)` constraint and both RPCs are date-bounded; representative preview query-plan timing remains residual risk.
- Final code re-review found no defects and returned `pr-ready: yes` for critical-lane human review after the lane artifacts were added and diagnostic/generated drift was removed.

## Responsive Evidence

- desktop screenshot: `sha256:1aeed981ffec70f8d9592ea95b190db35c9b4dd7efad71c0c972f2e71cc4f473`
- desktop evidence: `sha256:5896d04ec3f52219e67097a228b121a7b653fb9f02c2413bcf0d65a56af03960`
- mobile screenshot: `sha256:1344e6e7b69fdab4e21aafc8bbb42d61251c40c0c7db01eddd6d2b45800828e9`
- mobile evidence: `sha256:655087507cd14ea7db702daade75a24eb2eee117decb5acdd16eb7aef626abed`

## Residual Risk

- The migration and runtime SQL smoke have not run on an isolated Supabase preview yet.
- Authenticated hosted browser smoke is blocked locally by missing test credentials.
- Direct assigned-client clinical reads remain broader than the schedule presentation scope by design.
- Critical-lane human review remains mandatory before merge or production migration.

## Tracking

- Linear: [WIN-203](https://linear.app/winningedgeai/issue/WIN-203)
- Branch: `codex/bt-owned-schedule-scope`
