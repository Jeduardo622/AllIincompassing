# WIN-43 Staff Dashboard Responsive Scenario Handoff

## Route

- classification: `low-risk autonomous`
- lane: `standard`
- triggering paths:
  - `scripts/lib/responsive-ui-observer.ts`
  - `scripts/playwright-responsive-ui-observer.ts`
  - `tests/responsiveUiObserver.test.ts`
  - `tests/responsiveUiObserverRuntime.test.ts`
  - `docs/ai/WIN-43-staff-dashboard-responsive-scenario-handoff.md`
- required agents:
  - `specification-engineer`
  - `implementation-engineer`
  - `code-review-engineer`
  - `test-engineer`
  - `security-engineer`
- reviewer required: yes
- verify-change required: yes
- linear: `WIN-43` umbrella issue

## Scope

- Add one fixed `staff-dashboard` observer scenario bound only to the production staff Dashboard route `/`.
- Render the real staff Dashboard route with loopback-only synthetic auth and data.
- Fulfill only exact current auth-hydration, Dashboard, supervision, payroll-read, and report-read requests.
- Require both the generic `Dashboard` heading and the staff-only `Monthly Report Summary` heading so the correction-only root cannot false-pass.
- Preserve the observer's no-external-request and no-mutation policy.
- Emit sanitized evidence at desktop `1440x900` and mobile `390x844`.

Non-goals:

- No production Dashboard, auth, runtime-config, API, server, Supabase, workflow, or deployment changes.
- No real credentials, `.env*` reads, hosted requests, hosted mutations, or provisioned-persona dependency.
- No BT correction-only Dashboard coverage and no broad observer refactor.

Stop conditions:

- Reclassify if the scenario requires a protected path or production behavior change.
- Stop if exact request validation cannot be derived from current source behavior.
- Stop if loopback-only fulfillment cannot render the route without weakening network or mutation guards.

## Security Invariants

- Base URL remains explicit loopback HTTP without credentials, query, or fragment.
- Synthetic app auth remains in localStorage; the matching future-expiry Supabase session is stored under the derived loopback-only sessionStorage key.
- POST-based read models require exact paths and exact JSON bodies; no persisted record or mutation response is produced.
- External origins, unexpected same-origin requests, request-shape drift, and mutation methods fail closed.
- Evidence contains only machine-safe layout results and excludes identities, tokens, raw payloads, UUIDs, emails, and fixture values.

## Verification Card

- classification: `low-risk autonomous`
- lane: `standard`
- change type: local verification tooling and browser fixture
- required checks:
  - focused observer contract/runtime tests
  - actual loopback `staff-dashboard` observer run at both fixed viewports
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run build`
  - `npm run verify:local`
- executed checks:
  - RED: focused runtime pass failed before the exact reconcile RPC no-op was added.
  - RED: focused runtime pass failed before Dashboard payroll/report reads were added.
  - RED: focused runtime pass failed before the derived Supabase session and exact profile/role hydration reads were added.
  - GREEN: `npx vitest run tests/responsiveUiObserver.test.ts tests/responsiveUiObserverRuntime.test.ts -t "staff-dashboard|production staff Dashboard surface|correction Dashboard surface"` (`11 passed`, including the final auth-hydration and staff-surface contract).
  - GREEN: `npx vitest run tests/responsiveUiObserverRuntime.test.ts -t "runs the fixed staff-dashboard scenario with only synthetic loopback reads"` (`1 passed` after removing the fixture's hard-coded loopback host key).
  - GREEN: `npx vitest run tests/responsiveUiObserver.test.ts tests/responsiveUiObserverRuntime.test.ts` (`61 passed` before the final two focused regression additions; the affected final paths were rerun above).
  - LIVE: `staff-dashboard-root-proof-7` rendered `/` at desktop `1440x900` and mobile `390x844`; both had no overflow, clipped-control, touch-target, network-policy, or route-surface failures.
  - LIVE: both viewports failed only with `console-error`, traced to the production reconcile query resolving `undefined`.
  - GREEN: `npm run ci:check-focused`.
  - GREEN: `npm run lint` after final review fixes.
  - GREEN: `npm run typecheck`.
  - GREEN: `npm run build` after final review fixes.
  - FAIL: `NODE_OPTIONS=--max-old-space-size=6144 npm run test:ci` (`573` files and `5167` tests passed; unchanged `tests/scripts/provision-ci-smoke-bcba.test.ts` failed `1/22`, plus one Vitest worker timeout).
  - FAIL: `NODE_OPTIONS=--max-old-space-size=6144 npm run verify:local` stopped at `test:ci`; the same provisioning assertion failed and one unrelated Schedule interaction test failed under aggregate load.
  - GREEN: isolated Schedule aggregate failure rerun (`1 passed`).
  - FAIL: isolated provisioning suite (`21 passed`, `1 failed`) confirms the deterministic unchanged baseline failure.
- blocked checks:
  - passing responsive evidence is blocked by the separately routed production React Query `undefined` defect.
  - aggregate `test:ci` and `verify:local` are blocked by the unchanged deterministic provisioning test; the wrapper also surfaced one worker timeout and one isolated-pass Schedule test.
- result: `fail`; targeted scenario verification passes, but required aggregate and responsive gates remain red.
- residual risk: the scenario is fail-closed and reviewable, but it must remain draft until the production console defect and inherited aggregate baseline are resolved and the real Dashboard observer is rerun.

## Specialist Reviews

- `security-engineer`: approved loopback, auth-session, network, mutation, secret, and evidence-sanitization boundaries.
- `code-review-engineer`: approved after the staff-only surface assertion and correction-only regression resolved the initial finding.
- `test-engineer`: approved after host-independent session-key handling and focused regression reruns resolved the initial findings.

## PR Hygiene

- pr-ready: `no`
- lane: `standard`
- branch-ready: `yes`
- linear-ready: `yes` (`WIN-43`)
- single-purpose: `yes`
- unrelated changes: `none`
- generated artifact drift: `none` (local observer evidence remains untracked)
- protected-path drift: `none`
- change summary: `present`
- verification summary: `present`, with required failures preserved
- pr handoff: `draft-only`
- reviewer: `completed`; code and test rereviews approved with no findings
- required follow-up: repair the production query result, rerun both responsive viewports, resolve or rebase past the aggregate baseline failure, and rerun PR hygiene.

## Stack

- base prerequisite: PR #995, `codex/add-clients-responsive-scenario`
- current branch: `codex/add-dashboard-responsive-scenario`
- dependent UI repair: draft PR #997
