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

## Final Hosted Proof Result

- Date: August 14, 2026
- Result: `passed`
- Implementation PR: `#944`, merged as `f682c3d7fd0944e8f70d1237b1183fd52fe548d8`
- Final proof run: `31814785273`
- Validated proof-target PR: `#945`
- Validated SHA: `25f2a2e2a1154bc604a31f4e49080e171a351cae`
- Validated base commit: `03667002b1b27a06bef35cd39c6fa615bc7ab3c8`
- Immutable preview: `https://6a7f327e569d640008745ad3--velvety-cendol-dae4d6.netlify.app`

Final curated evidence proved:

- `totalCases: 8`
- `passedCases: 8`
- `cleanupVerifiedCases: 8`
- `skillsBehaviorsVerifiedCases: 1`
- exact canonical eight-case order
- degraded Skills and Behaviors case ID `skills-behaviors-proof-300dpi-monochrome-rotated-2deg`
- behavior, skill, needs-review, detailed-only, parent exclusion, and provenance assertions all true
- every case reached `extracted` with zero program and goal drafts
- no raw phones, fixture strings, HTML or data URLs, screenshots, private paths, or error fields in curated artifacts

Artifact SHA-256:

- `aggregate.json`: `5ee8d8acbfb684baa7af4ed6048e891f79595c8376f55504279b307493a93a8e`
- `cases.json`: `79e3dfeb06a80fa8dd1ccbf2673e95d2d05dd630d1a293a33c1a72d2a6045312`
- `run-metadata.json`: `9a279b7a833b5e8947728d4eae1993b32fce5960d478345a033b8a34b9c2e63c`
- `run-status.json`: `533f6adfaeb82b0ddbe47f8970b80efc2e2515d88a23b7d42216805518889e2a`

Proof-target PR `#945` was closed without merge after unrelated PR `#947` advanced `main`. The proof run and its immutable artifacts remain valid for the tested implementation. This docs-only evidence update supersedes the pending hosted-proof language above and is not a new Adobe proof target; it does not require another protected workflow dispatch.
