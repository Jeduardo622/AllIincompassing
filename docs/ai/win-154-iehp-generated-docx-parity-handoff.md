# WIN-154 IEHP Generated DOCX Parity Handoff

- Date: August 12, 2026
- Linear: `WIN-154`
- Branch: `codex/win-154-fba-output-parity`
- PR: `#930`
- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Triggering path: `.github/workflows/ci.yml`
- Required agents: `specification-engineer` -> `software-architect` -> `implementation-engineer` -> `code-review-engineer` -> `test-engineer` -> `security-engineer`

## Route-task Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- rationale: the slice adds a hosted Adobe-backed browser command to the required CI workflow
- allowed files: the existing IEHP assessment-import smoke runner/helpers/tests, `package.json`, one CI command, and this handoff
- non-goals: parser behavior, Adobe functions, server APIs, Supabase/schema changes, production data, secrets, and publish semantics
- stop conditions: any fix requiring parser/server semantics or a broader protected surface

## Scope

- Generate a complete synthetic IEHP FBA PDF in memory and upload it through the existing authenticated Programs & Goals workflow.
- Require Adobe-backed extraction to finish at `extracted`, with zero draft programs/goals and a complete required checklist/structured-section set.
- Derive behavior/skill expectations from `IEHP_FBA_BEHAVIOR_SKILL_TARGETS`, reject unresolved reconciliation, approve only reviewable synthetic required rows, generate the IEHP DOCX, and compare output text against all parsed names plus representative headings and narratives.
- Require an explicitly marked smoke/synthetic/test client, exact assessment response identity, exact private generated-object scope, redacted evidence, and fail-closed source/generated cleanup.
- Parse the downloaded synthetic DOCX only from an auto-deleted OS temp directory; do not retain it in uploaded CI artifacts.

## Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: CI/workflow policy and authenticated synthetic browser verification harness
- required checks: workflow YAML parse; focused IEHP/parity tests; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run ci:verify-coverage`; `npm run build`; `npm run test:routes:tier0`; `npm run verify:local`; hosted `npm run playwright:iehp-assessment-import-generated-docx-parity`
- executed checks:
  - workflow YAML parse -> pass
  - focused IEHP/parity suite -> pass (`132/132`)
  - `npm run ci:check-focused` -> pass; environment-dependent DB, preview-drift, branch-protection, and auth-parity probes skipped as reported
  - `npm run lint` -> pass
  - `npm run typecheck` -> pass
  - `NODE_OPTIONS=--max-old-space-size=8192 npm run test:ci` -> pass (`492` files, `4261` tests; `5` environment-gated tests skipped)
  - `npm run ci:verify-coverage` -> pass (`92.81%` line coverage; all module thresholds pass)
  - `npm run build` -> pass
  - `npm run test:routes:tier0` -> pass (`220/220`)
  - `npm run verify:local` -> first attempt exhausted the default Node heap; later attempts reached two different unrelated async UI timeouts, while the scheduling timeout passed `4/4` in isolation and one separate full `test:ci` run passed all `4261` tests; all remaining constituent gates passed independently
- blocked checks:
  - hosted `npm run playwright:iehp-assessment-import-generated-docx-parity` -> local process has no Playwright/Supabase credentials; the command is wired into required PR CI for decisive Adobe-backed proof
- result: `pass-with-blocked-checks`
- residual risk: hosted extraction/template latency and contract drift can only be resolved by the required PR CI run; the expanded job retains its existing 25-minute timeout

## Hosted Failure Triage

- Exact-head CI run `31653029750` on commit `3abf5c5fd40e09397bf9ccc786d83312c6b375ab` cleared the prior checklist approval HTTP `400` and passed the default DOCX and skills/behaviors modes.
- Generated DOCX parity then reached the post-approval reload and failed because the smoke unconditionally clicked the uploaded filename after the app had already restored the IEHP FBA review.
- The runner now waits on the restored review when it is already visible and selects the uploaded assessment only when restoration did not occur.
- Exact-head CI run `31654537699` confirmed the immediate branch was still too early because the assessment queue could remain in its loading state after reload.
- The runner now waits for either the restored review or the specific uploaded assessment before branching, and fails closed if neither appears within the bounded wait.
- Focused regression coverage executes both restoration branches, delayed queue readiness, and the fail-closed timeout; `109/109` focused tests pass.
- The next exact-head hosted run remains the decisive Adobe-backed verification for this fix.

## Review and PR Hygiene

- `code-review-engineer`: approve after requested output-parity and assessment-binding fixes; no findings
- `security-engineer`: approve after smoke-client, temp-artifact, storage-scope, and review-state containment fixes; no findings
- `devops-engineer`: approve; the command remains inside the IEHP smoke job required by `ci-gate`; no findings
- `test-engineer`: required focused, full-suite, hosted, and cleanup evidence identified before implementation
- `pr-ready`: yes, pending the next exact-head live hosted checks
- `branch-ready`: yes
- `linear-ready`: yes (`WIN-154`)
- `single-purpose`: yes
- `unrelated changes`: none
- `generated artifact drift`: none; the test reliability timestamp-only output was restored
- `protected-path drift`: `.github/workflows/ci.yml` only, already routed `critical`
- `change summary`: present
- `verification summary`: present
- `pr handoff`: ready; human review remains required before merge
- `reviewer`: completed
- `required follow-up`: open the PR, run the hosted Adobe-backed parity command through required CI, and fix only slice-related failures
