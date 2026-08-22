# WIN-43 tenant-safety watchdog alignment

## Scope

- Classification: high-risk human-reviewed
- Lane: critical
- Repair surface: the `tenant-safety` full-suite watchdog budget, progress reporting, and their policy contracts
- Non-goals: test selection, test semantics, worker topology, secrets, deployment, application runtime, Supabase runtime, and branch-protection wiring

## Failure evidence

PR #1007 exact head `4f9a2b7f70f414421490498b4589e0991fe3d89b` failed `tenant-safety` run `32566129384` twice. Both attempts completed 580 of 581 Vitest files before `scripts/run-vitest.mjs` killed the process after 45 seconds without reporter output. Comparing the collected file list with both logs identified `tests/responsiveUiObserverRuntime.test.ts` as the only incomplete file.

The same file passed independently with all 66 tests in 463.37 seconds when the existing watchdog was set to 180 seconds and the verbose reporter exposed continuous test-level progress. A complete local replay with the 8 GB workflow heap proved that a 180-second timeout alone remained insufficient: after the ordinary files completed, the healthy browser file stayed silent long enough to trigger the larger watchdog. The failure is therefore an output-cadence mismatch, not an assertion failure or a skipped test.

## Repair

Set `VITEST_HANG_TIMEOUT_MS: '180000'` on the existing `tenant-safety` `Run tests` step and pass `--reporter=verbose` through the same `npm test` wrapper. The wrapper resets its watchdog on every output chunk, so test-level progress remains observable while a genuinely silent process is still terminated. This preserves all 581 collected files, assertions, workers, the watchdog, workflow triggers, job identity, secret inputs, and required-check behavior. The timeout and verbose progress pattern match the existing long-running Vitest approach in `supabase-validate.yml`.

## Verification card

- Classification: high-risk human-reviewed
- Lane: critical
- Change type: CI/workflow/policy
- Required checks: focused workflow and CI-policy contract tests; direct YAML/workflow inspection; full exact-env `npm test -- --reporter=verbose`; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run validate:tenant`; `npm run build`; `npm run verify:local` when locally meaningful; exact-head hosted `tenant-safety`; exact-head aggregate CI
- Executed checks: targeted browser-runtime witness passed, 66/66 in 463.37 seconds; red workflow contract failed before the timeout edit; timeout-only complete replay proved 180 seconds remained insufficient; revised command and policy contracts failed red before implementation; focused workflow/policy suite passed 236/236; direct YAML parse passed; direct session-deploy safety check passed; `npm run ci:check-focused` passed with secret-backed checks explicitly skipped; lint passed; typecheck passed; tenant validation passed; build passed; exact-env verbose full suite completed all 581 files in 637.04 seconds with 573 passed, 7 skipped, all 66 observer-runtime tests passed, and no watchdog kill; `npm run test:ci` completed the same 581 files in 592.59 seconds; coverage verification passed at 93.08%
- Blocked checks: local `npm run test:ci` reports the inherited Windows CRLF-only source-order assertion in `tests/scripts/provision-ci-smoke-bcba.test.ts` plus a Vitest worker update timeout after the long browser file; the corresponding Linux CI suite is required for platform-accurate disposition. `npm run verify:local` was not repeated because it stops at the same deterministic `test:ci` failure. Exact-head hosted `tenant-safety` and aggregate CI remain pending until the branch is pushed.
- Result: pass-with-blocked-checks
- Residual risk: the hosted full suite could expose a different failure after the false-positive watchdog kill is removed; verbose output increases test-name and failure-diff volume but does not add a new secret or PHI emission path

## Reviews

- Specification review: approved the bounded workflow repair and fail-closed stop conditions
- Architecture review: after the timeout-only replay failed, approved verbose progress with the retained 180-second watchdog as safer than a ten-minute blind timeout or splitting the healthy test file
- Test review: approved verbose progress as output-only and requires the complete unfiltered wrapper suite plus exact-head hosted `tenant-safety` as decisive proof
- Implementation review: the initial policy did not pin the timeout; the finding was fixed with exact-value enforcement and missing/drifted negative tests
- Code review: approved after the exact timeout policy gap was fixed; no remaining findings
- Security review: approved after the exact timeout policy gap was fixed; secret mappings are unchanged and no new secret or PHI output path was found
- CI/DevOps review: approved the exact command, retained watchdog, and policy contracts; exact-head hosted `tenant-safety` remains the decisive runtime proof
- Human review: required before merge because `.github/workflows/**` is protected

## PR hygiene

- Linear: WIN-43
- Branch: `codex/fix-tenant-safety-watchdog`
- Single purpose: yes
- Merge authority: repository owner only after exact-head required checks and specialist reviews are complete
