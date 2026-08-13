# WIN-154 IEHP FBA OCR And Table Matrix Handoff

- Date: August 12, 2026
- Linear: `WIN-154` (new issue creation blocked by the workspace free issue limit)
- Branch: `codex/win-154-fba-ocr-table-matrix`
- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Triggering path: `.github/workflows/iehp-pdf-mini-matrix-proof.yml`
- Required agents: `specification-engineer` -> `software-architect` -> `implementation-engineer` -> `code-review-engineer` -> `test-engineer` -> `security-engineer`

## Route-task Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- rationale: the existing protected hosted proof workflow hard-codes the matrix case order and evidence counts
- allowed files: the existing IEHP PDF smoke helper/runner, their focused tests, the dedicated on-demand proof workflow and test, and this handoff
- non-goals: parser or Adobe configuration changes, server APIs, Supabase functions/migrations, auth, runtime config, production data, PHI, CalOptima, or broad CI changes
- stop conditions: any requirement to change production extraction behavior, widen secret handling, publish raw OCR/table content, or use a real document fixture

## Scope

- Add one deterministic `150 DPI` grayscale JPEG raster case with actual DPI-derived pixel dimensions and reduced JPEG quality.
- Add one deterministic digital PDF case whose asserted referral date and assessor phone are rendered in semantic table cells.
- Keep Adobe as the hosted production extractor by using the existing authenticated upload path and `--pdf-mini-matrix` command.
- Preserve field-level referral-date extraction, assessor-phone snapshot precedence, provenance, zero-draft assertions, redacted evidence, and fail-closed per-case cleanup.
- Expand the hosted proof contract from six to eight evidence objects: seven import cases plus the existing Skills & Behaviors proof.

## TDD Evidence

- RED command: `npm test -- --run tests/scripts/iehp-assessment-import-smoke.test.ts tests/scripts/playwright-iehp-assessment-import-smoke.test.ts tests/workflows/iehp-pdf-mini-matrix-proof.test.ts`
- RED result: expected failure (`7` focused assertions) because the two case definitions, semantic table layout, dynamic raster dimensions/color mode, and eight-case workflow contract did not yet exist.
- GREEN result: pass (`3` files, `119/119` tests).

## Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: protected workflow and synthetic authenticated browser QA harness
- required checks: workflow YAML parse; focused IEHP matrix tests; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run build`; `npm run verify:local`; hosted `.github/workflows/iehp-pdf-mini-matrix-proof.yml` on the exact PR head
- executed checks:
  - workflow YAML parse -> pass
  - focused IEHP matrix tests -> pass (`3` files, `119/119` tests)
  - `npm run ci:check-focused` -> pass; environment-gated database, branch-protection, and hosted auth-parity probes skipped as reported
  - `npm run lint` -> pass
  - `npm run typecheck` -> pass
  - `npm run build` -> pass
  - `npm run test:ci` -> changed IEHP tests passed, but the full run failed on an unrelated `ProgramsGoalsTab` timeout plus a Vitest worker RPC timeout; the file passed `116/116` in isolation
  - `npm run verify:local` -> policy, lint, and typecheck passed; the wrapper then stopped at `test:ci` on unrelated `ClientSessionTrendsTab` and `TherapistOnboarding` contention failures plus a Vitest worker RPC timeout; both files passed in isolation (`14/14` and `7/7`)
- blocked checks:
  - hosted matrix proof -> requires an open same-repository PR, exact preview deployment, and protected GitHub/Supabase credentials
  - repository-wide `test:ci`/`verify:local` clean completion -> blocked locally by reproducible full-suite worker contention outside the changed files; every surfaced failing file passes in isolation
- result: `pass-with-blocked-checks`
- residual risk: the two new fixture shapes require exact-head Adobe-backed hosted proof; local structure and unit tests cannot establish OCR success, and required PR CI must resolve the local full-suite contention result

## Review And PR Hygiene

- specification-engineer: complete; scope limited to exactly two synthetic cases
- software-architect: complete; approved reuse of the existing upload/Adobe/assertion/cleanup flow
- implementation-engineer: complete; changed only the bounded helper, runner, and dedicated workflow
- test-engineer: approved; confirmed seven catalog cases plus the matrix-mode Skills & Behaviors proof produce eight hosted evidence objects
- security-engineer: approved with unchanged secrets, private log, public evidence, and cleanup boundaries
- code-review-engineer: approved after the handoff evidence update; no code findings
- devops-engineer: approved; exact case order/count, immutable PR/preview controls, cleanup, artifact curation, and bounded timeout remain consistent
- pr-ready: yes for human review; exact-head hosted checks remain required before merge
- human review: required before merge
