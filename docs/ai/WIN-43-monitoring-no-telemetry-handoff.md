# WIN-43 Monitoring no-telemetry state

## Scope

- classification: non-trivial visible UI correction
- lane: standard
- issue: WIN-43
- intent: distinguish an available realtime channel from unavailable performance telemetry
- allowed files: Monitoring dashboard, focused tests, the in-memory responsive harness route/shim, its Vite aliases, and this handoff
- non-goals: no Supabase schema, RLS, grants, functions, telemetry writers, query contracts, auth, routing, or deployment changes
- stop condition: any fix requiring instrumentation or tenant-scoped persistence moves to a separate critical slice

## Root-cause evidence

Authenticated hosted read-only QA showed the Monitoring route reporting a connected
realtime channel while every health and performance value was rendered as zero.
Hosted read-only counts confirmed that the dashboard's performance metric and alert
tables had no samples. The realtime hook listens for future inserts and does not
hydrate historical samples, so the zero values represented missing evidence rather
than measured zero performance.

The broader instrumentation contract remains a separate critical-lane concern. The
existing database query tracker and Monitoring dashboard use different metric tables,
and a tenant-scoped durable system metric source was not established in this slice.

## Files

- `src/pages/MonitoringDashboard.tsx`
- `src/pages/__tests__/MonitoringDashboard.test.tsx`
- `tests/fixtures/responsive-harness/src/HarnessApp.tsx`
- `tests/fixtures/responsive-harness/src/shims/monitoring.ts`
- `vite.responsive-harness.config.ts`
- `docs/ai/WIN-43-monitoring-no-telemetry-handoff.md`

## Behavior

- A connected channel with no performance samples now renders `Not available` instead of zero
  health, response-time, and cache-hit measurements.
- The overview explains that connection status only confirms channel availability.
- Existing measured values and trend indicators remain unchanged when samples exist.
- Clearing samples also hides stale analytics-derived bottlenecks.
- Active alerts remain visible and counted when performance samples are absent.
- The responsive harness renders the production Monitoring page with fixed empty telemetry and no network or stored session state.

## Verification card

- classification: non-trivial visible UI correction
- lane: standard
- required checks: `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, focused tests, `npm run test:ci`, `npm run build`, `npm run responsive-harness:build`, responsive observer, `npm run verify:local`, `verify-change`, and PR CI
- executed checks:
  - `npx vitest run src/pages/__tests__/MonitoringDashboard.test.tsx --maxWorkers=1 --minWorkers=1 -t "distinguishes a connected channel|preserves measured overview|hides stale analysis|keeps active alerts visible"` -> pass, 4/4
  - `npm run ci:check-focused` -> pass; secret-backed database checks skipped by the command
  - `npm run typecheck` -> pass
  - `npm run lint` -> pass
  - `npm run build` -> pass
  - `npm run responsive-harness:build` -> pass
  - `git diff --check` -> pass
  - `npm run test:ui:responsive -- --base-url=http://127.0.0.1:4173 --route=/monitoring` -> pass at 1440x900 and 390x844 using the in-memory harness
  - desktop screenshot -> `artifacts/responsive-ui-observer/route-46db44f6340ab2be93775acb635dd479f94102df1a0e898199c22a9d0eeb88ab.desktop.1440x900.png`
  - desktop evidence -> `artifacts/responsive-ui-observer/route-46db44f6340ab2be93775acb635dd479f94102df1a0e898199c22a9d0eeb88ab.desktop.1440x900.json`
  - desktop screenshot hash -> `sha256:10b7eb6a094be607534d8fb595bd73ece42c56706ca1c69673dcbe38478e928b`
  - desktop evidence file hash -> `sha256:37e9fbe280a07f1ae27df866d796b04690b95045a8781be47a2a84c6c72436dc`
  - mobile screenshot -> `artifacts/responsive-ui-observer/route-46db44f6340ab2be93775acb635dd479f94102df1a0e898199c22a9d0eeb88ab.mobile.390x844.png`
  - mobile evidence -> `artifacts/responsive-ui-observer/route-46db44f6340ab2be93775acb635dd479f94102df1a0e898199c22a9d0eeb88ab.mobile.390x844.json`
  - mobile screenshot hash -> `sha256:95d95e95a268305b9a45f515bc58f9692491dbfc1e5329191d24cd84eb16be41`
  - mobile evidence file hash -> `sha256:4e7019b742beb07b9dbda12bbb7e53f54d1fff23acd7fdc0289278f76bfc030a`
- blocked checks:
  - `npm run test:ci` -> failed when the Windows Node worker exhausted its approximately 4 GB heap after broad suite progress; no failing assertion was reported
  - `npm run verify:local` -> policy, lint, and typecheck passed, then its `test:ci` stage hit the same Node heap exhaustion before coverage, build, and tier-0 stages
- result: pass-with-blocked-checks pending authoritative exact-head PR CI
- residual risk: deterministic empty-state layout and focused behavior pass locally; the aggregate suite requires CI's authoritative runtime, and hosted behavior remains unchanged until merge and deploy

## Tracking

- WIN-43 returned to In Progress for this additional QA defect.
- A sanitized Linear comment records the hosted reproduction and critical follow-up.
- Linear rejected creation of separate follow-up issues because the workspace is at its issue limit.

## Reviews

- specification-engineer: completed; bounded page/test slice routed `standard`
- software-architect: completed; durable instrumentation remains a separate `critical` slice
- test-engineer: completed; focused behavior and responsive evidence accepted, aggregate CI remains authoritative
- code-review-engineer: approved after stale-analysis, alerts-only wording, and evidence-hash fixes

## PR hygiene

- dedicated branch: `codex/fix-monitoring-no-telemetry-state`
- single purpose: yes
- hosted mutation: none
- protected-path changes: none
- responsive evidence: pass at both required viewports
- generated artifact drift: untracked harness build output is excluded from staging because command policy denied deletion
- pr-ready: yes, pending exact staged-diff inspection and authoritative PR CI
- human review: required before merge
