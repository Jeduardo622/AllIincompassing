# WIN-154 IEHP Degraded Skills And Behaviors Proof

- Date: August 13, 2026
- Linear: `WIN-154`
- Branch: `codex/win-154-degraded-skills-behaviors`
- Classification: `high-risk human-reviewed`
- Lane: `critical`

## Objective

Replace the hosted IEHP PDF mini-matrix's clean Skills and Behaviors slot with one synthetic, PHI-free, image-only PDF that is rendered at 300 DPI, converted to monochrome JPEG at quality 85, and rotated exactly 2 degrees before Adobe-backed extraction.

The standalone `--skills-behaviors-proof` command remains a clean digital PDF. The hosted matrix remains eight cases and keeps the exact `8/8/8/1` aggregate contract.

## Scope

Allowed surfaces:

- `scripts/lib/iehp-assessment-import-smoke.ts`
- `scripts/playwright-iehp-assessment-import-smoke.ts`
- `scripts/finalize-iehp-pdf-mini-matrix-evidence.mjs`
- focused tests under `tests/scripts/**`
- this handoff

Protected non-goals:

- no `.github/workflows/**` changes
- no parser, OCR, Supabase function, server, migration, auth, runtime, secret, provisioning, or cleanup changes
- no ninth matrix case
- no weakening of exact-order, redaction, cleanup, or aggregate checks

Stop if hosted extraction requires any protected-path repair. That repair must be isolated and re-routed separately.

## Implementation Contract

- Matrix case ID: `skills-behaviors-proof-300dpi-monochrome-rotated-2deg`
- Source: three generated HTML pages containing synthetic fixture strings only
- Raster dimensions: `2550x3300` per page
- PDF content: one JPEG image per page; no selectable fixture text
- Skills and Behaviors assertions:
  - behavior parsed
  - skill parsed
  - needs-review item preserved
  - detailed-only item preserved
  - parent education goal excluded
  - provenance verified
- Workflow assertions inherited from the existing case runner:
  - extraction reaches `extracted`
  - zero program and goal drafts
  - assessor phone snapshot precedence and provenance
  - cleanup verified
- Public evidence remains counts, booleans, case IDs, and redacted phone fields only.

## Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: hosted CI/workflow evidence contract and synthetic Playwright test harness
- required agents: `specification-engineer`, `software-architect`, `implementation-engineer`, `code-review-engineer`, `test-engineer`, `security-engineer`
- required checks:
  - focused smoke and finalizer tests
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run build`
  - `npm run verify:local`
  - owner-dispatched `.github/workflows/iehp-pdf-mini-matrix-proof.yml` against the exact PR head
- executed checks:
  - focused smoke and finalizer tests: pass, 124 tests
  - unchanged hosted workflow contract test: pass, 3 tests
  - `npm run ci:check-focused`: pass; database-backed advisory checks skipped because no database URL is configured
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run test:ci`: pass with `NODE_OPTIONS=--max-old-space-size=8192`, `VITEST_MAX_THREADS=2`, and `VITEST_MIN_THREADS=1`
  - `npm run ci:verify-coverage`: pass, 92.96 percent line coverage
  - `npm run build`: pass
  - `npm run test:routes:tier0`: pass, 244 tests
  - isolated retry of the schedule assertion that failed inside the exact wrapper: pass, 1 test
- verification exception:
  - the first unbounded `npm run verify:local` attempt exhausted Node's default 4 GB heap during `test:ci`
  - an 8 GB retry without worker limits reached a Vitest worker RPC timeout with no individual test failure
  - the same `test:ci` command passed with two workers; all other `verify:local` constituent commands passed independently
  - the exact wrapper with the two-worker settings later failed one unrelated schedule integration assertion that passed in the preceding successful full `test:ci` run
- blocked checks:
  - `npm run verify:local`: not satisfied because the exact-wrapper retry ended on the unrelated schedule integration failure
  - hosted Adobe proof: pending an open PR and repository-owner dispatch
- reviewer:
  - architecture: approved the matrix-only design
  - security: approved the final diff
  - code review: no script defect; generated report drift removed and verification wording corrected
  - test review: local contract coverage accepted as partial, but final verdict remains fail until the hosted Adobe proof passes
- result: `pass-with-blocked-checks`
- residual risk: local tests cannot prove Adobe OCR preserves all Skills and Behaviors assertions under the degraded image-only input
- PR handoff: ready for an open human-review PR; merge remains blocked on exact-head hosted Adobe proof and human review

## Hosted Acceptance

The PR is not ready to merge until the owner-dispatched workflow succeeds against the exact PR head and curated artifacts prove:

- `totalCases: 8`
- `passedCases: 8`
- `cleanupVerifiedCases: 8`
- `skillsBehaviorsVerifiedCases: 1`
- the canonical eighth case ID is `skills-behaviors-proof-300dpi-monochrome-rotated-2deg`
- the Skills and Behaviors assertion booleans are all true
- public artifacts contain no raw phone values, fixture text, HTML, data URLs, screenshots, private paths, or error logs

Human review remains required before merge.
