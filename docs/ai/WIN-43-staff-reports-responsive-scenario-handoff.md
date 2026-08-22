# WIN-43 Staff Reports Responsive Scenario Handoff

## Routing

- classification: `low-risk autonomous`
- lane: `standard`
- why: non-trivial local observer tooling and tests outside protected production paths
- triggering paths:
  - `scripts/lib/responsive-ui-observer.ts`
  - `scripts/playwright-responsive-ui-observer.ts`
  - `tests/responsiveUiObserver.test.ts`
  - `tests/responsiveUiObserverRuntime.test.ts`
  - `docs/ai/WIN-43-staff-reports-responsive-scenario-handoff.md`

## Scope

- task intent: add one fixed `staff-reports` responsive observer scenario bound exactly to `/reports`
- files touched: only the four allowed observer script/test files plus this handoff
- single-purpose diff: yes
- non-goals:
  - no `src/**`, auth, server, Supabase, workflow, or deploy changes
  - no `.env*` reads, hosted requests, or hosted mutations
  - no generic observer refactor beyond the new fixed scenario

## Scenario Contract

- synthetic auth/runtime reuses the existing `staff-dashboard` `super_admin` localStorage and loopback sessionStorage pattern
- Playwright fixes `Date.now()` and `new Date()` at `2026-08-12T16:00:00.000Z` before route code runs while leaving application timers active
- observer rewrites only exact same-origin Reports read RPC POSTs into loopback GETs before network dispatch
- fulfilled read contracts are exact-match only for:
  - `GET /api/runtime-config`
  - `GET /rest/v1/profiles?select=id,email,role,organization_id,first_name,last_name,full_name,phone,avatar_url,time_zone,preferences,is_active,last_login_at,created_at,updated_at&id=eq.observer-super-admin`
  - `GET /rest/v1/user_roles?select=is_active,expires_at,roles(name)&user_id=eq.observer-super-admin`
  - `GET /rest/v1/message_thread_participants?select=thread_id,last_read_at,archived_at,muted_at,joined_at,organization_id,user_id&user_id=eq.observer-super-admin&organization_id=eq.observer-local-org&archived_at=is.null`
  - `POST /api/payroll-time-events` with exactly `{ "action": "get_day", "localDate": "2026-08-12" }`
  - `POST /api/payroll-approvals` with exactly `{ "action": "review_queue", "selectedLocalDate": "2026-08-12" }`
  - `POST /api/payroll-administration` with exactly `{ "action": "get_administration", "selectedLocalDate": "2026-08-12" }`
  - `POST /rest/v1/rpc/get_supervision_session_note_action_count` with exactly `{}`
  - `GET /rest/v1/rpc/get_dropdown_data`
  - `GET /rest/v1/rpc/get_session_metrics?p_start_date=2026-08-01&p_end_date=2026-08-31&p_therapist_id=is.null&p_client_id=is.null`
  - `GET /rest/v1/sessions?select=id,start_time,status,therapist:therapists(id,full_name),client:clients(id,full_name)&start_time=gte.2026-08-01T00:00:00&start_time=lte.2026-08-31T23:59:59`
- all external origins, mutation requests, non-enumerated POSTs, and query/body drift remain fail-closed
- pass condition requires:
  - visible `Reports` heading
  - click on `Generate Report`
  - visible `Sessions Report` generated surface
- evidence remains machine-safe and excludes raw route text, tokens, UUIDs, emails, and payload bodies

## Verification Card

- classification: `low-risk autonomous`
- lane: `standard`
- change type: auth/routing-adjacent local verification tooling and browser fixture
- required checks:
  - `npm run verify:local`
  - focused observer contract tests
  - real Vite `/reports` responsive observer execution at desktop `1440x900` and mobile `390x844`
- executed checks:
  - RED: `npm test -- --run tests/responsiveUiObserver.test.ts`
    - `1 failed | 33 passed`; exact staff auth predicate contract was unavailable
  - RED: `npx vitest run tests/responsiveUiObserverRuntime.test.ts -t "pins the staff-reports clock"`
    - `1 failed | 38 skipped`; fixed Reports clock was unavailable
  - RED diagnostic: `npx vitest run tests/responsiveUiObserverRuntime.test.ts -t "runs the fixed staff-reports scenario"`
    - failed with machine-safe `page-error` and `route-surface-missing`; investigation confirmed an installed clock advanced before route code observed it
  - RED: `npx vitest run tests/responsiveUiObserverRuntime.test.ts -t "runs the fixed staff-reports scenario"`
    - failed at both viewports with `unexpected-scenario-request` and `non-read-method` after the fixture reproduced the shared Sidebar reads
  - GREEN: `npm test -- --run tests/responsiveUiObserver.test.ts`
    - pass, `34/34`
  - GREEN: `npx vitest run tests/responsiveUiObserverRuntime.test.ts -t "pins the staff-reports clock"`
    - pass, `1 passed | 38 skipped`; a simulated 2042 wall clock still resolves the scenario helper to fixed August 2026
  - GREEN: `npx vitest run tests/responsiveUiObserverRuntime.test.ts -t "runs the fixed staff-reports scenario"`
    - pass, `1 passed | 38 skipped`
  - GREEN: `npx vitest run tests/responsiveUiObserverRuntime.test.ts -t "runs the fixed staff-reports scenario"`
    - pass, `1 passed | 43 skipped`; exact shared Sidebar reads are fulfilled without reaching the loopback server
  - GREEN: `npx vitest run tests/responsiveUiObserverRuntime.test.ts -t "sidebar-"`
    - pass, `5 passed | 39 skipped`; participant query drift and all four POST body/date drifts fail closed
  - GREEN: `npx vitest run tests/responsiveUiObserverRuntime.test.ts -t "Reports|staff-reports"`
    - pass, `8 passed | 31 skipped`
  - REVIEW FIX: the synthetic Reports runtime fixture now issues the same RPC POST bodies as `supabase.rpc(...)` instead of bypassing the rewrite with direct GETs
    - exact `{}` dropdown body and exact four-field metrics body are rewritten and fulfilled
    - dropdown or metrics body drift remains fail-closed as `non-read-method`
  - GREEN: `npx vitest run tests/responsiveUiObserver.test.ts tests/responsiveUiObserverRuntime.test.ts -t "Reports|staff-reports"`
    - pass, `17 passed | 62 skipped` across both focused contract files
  - EXPECTED PRE-FIX: `npm run test:ui:responsive -- --base-url=http://127.0.0.1:4175 --route=/reports --scenario=staff-reports --artifact-run-id=reports-real-route-3`
    - desktop `1440x900`: pass with no failure codes
    - mobile `390x844`: fail only with `undersized-mobile-touch-target`
    - no network-contract, console, route-surface, overflow, or fixed-control-bounds failure remained
  - GREEN: `npm run ci:check-focused`
    - all secret-free policy checks passed; database-backed checks were explicitly skipped because no connection string is configured
  - GREEN: `npm run lint`
  - GREEN: `npm run typecheck`
  - GREEN: `npm run build`
  - BLOCKED BY BASELINE: `npm run verify:local`
    - policy, lint, and typecheck stages passed
    - `test:ci` reproduced the unchanged `tests/scripts/provision-ci-smoke-bcba.test.ts` canonical mapping order assertion failure
    - a Vitest worker later exhausted the local 4 GB heap and closed its IPC channel
    - the Reports observer runtime happy path passed inside the aggregate before the worker failure
    - coverage verification, build, and tier-0 stages in the chained command did not run after `test:ci` failed; build passed independently above
- evidence boundary:
  - the focused runtime suite serves a synthetic HTML fixture at `/reports`; it verifies the production-shaped RPC POST rewrites plus observer request, clock, interaction, evidence, and fail-closed contracts
  - it does not prove that the actual Vite React `/reports` route currently boots through `PrivateRoute`/`RoleGuard` and renders the production Reports component
- debugger-confirmed real-route diagnosis:
  - the production shared Sidebar issued the exact participant, payroll day, payroll review queue, payroll administration, and supervision-count reads before the Reports surface settled
  - `staff-reports` previously rejected the participant GET as `unexpected-scenario-request` and the four read-semantic POSTs as `non-read-method`; this observer-only change enumerates those exact contracts
  - a separate real-route mobile `undersized-mobile-touch-target` result remains pending after shared-shell bootstrap; identifying and fixing the production control requires a later authorized `src/**` UI slice
- pending checks:
  - exact-head CI is required to distinguish the inherited local aggregate failure from this isolated observer diff
  - the separately routed production Reports UI fix must pass this same real-route observer at both viewports
- result: `focused-contract-and-desktop-real-route-pass; expected pre-fix mobile touch-target failure isolated`
- residual risk: the mobile touch-target issue remains pending in the separate production slice, and the exact auth/Sidebar/report allowlist must be maintained if production request shapes change

## PR Hygiene

- branch-ready: yes
- linear-ready: yes; scoped under `WIN-43`
- protected-path drift: none
- unrelated changes: none observed in this worktree
- generated artifact drift: none tracked
- pr-ready: yes for human review with the local aggregate limitation disclosed; exact-head CI and the stacked production all-green responsive proof remain pending

## Handoff Summary

This slice adds a fixed local-only `staff-reports` observer scenario for `/reports` that reuses the exact staff profile, role, and shared Sidebar read contracts, fixes the clock in August 2026, clicks `Generate Report`, and requires the generated `Sessions Report` surface. Focused fixture-backed contracts pass for exact auth/Sidebar/report reads and fail-closed drift, missing-surface, unexpected-read, and mutation behavior. The actual Vite route now passes desktop and isolates mobile to the expected pre-fix touch-target failure; standard verification and the stacked production all-green proof remain pending.
