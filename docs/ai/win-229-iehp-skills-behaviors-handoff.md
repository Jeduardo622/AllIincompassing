# WIN-229 IEHP Skills Behaviors Reconciliation Handoff

- Date: July 20, 2026
- Linear: `WIN-229`
- Branch: `codex/iehp-fba-skills-behaviors-reconcile`
- PR: `#823` (`https://github.com/Jeduardo622/AllIincompassing/pull/823`)
- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Required agents: `specification-engineer` -> `software-architect` -> `implementation-engineer` -> `code-review-engineer` -> `test-engineer` -> `security-engineer` -> `documentation-engineer`
- Files changed: `supabase/functions/extract-assessment-fields/iehp-skills-behaviors.ts`, `supabase/functions/extract-assessment-fields/iehp-skills-behaviors.test.ts`, `supabase/functions/extract-assessment-fields/index.ts`, `supabase/functions/extract-assessment-fields/index.test.ts`, `supabase/config.toml`, `src/server/iehpSkillsBehaviors.ts`, `src/server/api/assessment-checklist.ts`, `src/server/api/assessment-template-layout.ts`, their focused tests, `src/components/ClientDetails/IehpFbaLayoutReview.tsx`, `src/components/__tests__/IehpFbaLayoutReview.test.tsx`, smoke scripts/tests, `.github/workflows/ci.yml`, `package.json`, this handoff, and the implementation plan

## Scope

- Record the WIN-229 reconciliation status without broadening the implementation surface.
- Preserve the existing implementation boundary: no parser framework changes, no promotion semantics changes, no migration changes, no server changes, and no PHI or secrets in the handoff.
- Capture exact proof status from the branch history and the current blocker set.

## Change Summary

- The IEHP skills/behaviors reconciliation work is implemented in prior commits on this branch:
  - pure reconciliation contract
  - extractor integration
  - UI rendering of reconciled items
  - authenticated browser parsing proof
- CI now runs the default phone/provenance smoke before the opt-in skills/behaviors proof and retains unconditional synthetic-admin cleanup.
- The synthetic proof fixture uses the extractor's exact deterministic section anchors.
- `supabase/config.toml` now registers `extract-assessment-fields` with `verify_jwt = true` so a subsequent Supabase PR preview can deploy the reviewed branch function.
- Authenticated checklist and template-layout reads now derive the aggregate from current structured rows, and summary PATCHes strip client-supplied derived data. This prevents clinician edits from leaving the grouped review stale while promotion uses corrected detail rows.
- The review UI accepts only reconciliation schema version `1` and fails closed on unknown versions.
- Unrelated user-owned untracked files `pnpm-lock.yaml` and `pnpm-workspace.yaml` remain excluded from the branch commits.

## Test-First Evidence

- Pure helper RED: missing reconciliation module; GREEN: the initial matrix passed, followed by review-driven RED/GREEN cases for overlapping aliases, targets-only input, and duplicate summary aliases that now both remain ambiguous and untyped.
- Extractor RED: the summary payload lacked `skills_behaviors`; GREEN: the integrated helper/index suite passed and preserved `payload.targets`, exact counts, and parent exclusion.
- UI RED: grouped output and malformed-payload behavior were absent; review RED later exposed typed `detailed_only` mis-grouping, mixed malformed acceptance, and invalid handling of a valid empty result. GREEN: the full component suite passes `18/18`.
- Smoke RED: proof fixture/helper/flag/command were absent; review RED later exposed malformed-item filtering and cleanup-helper contract drift. GREEN: the focused smoke suite passes `64/64`, with assertion failure still entering fail-closed cleanup.
- Hosted provenance RED: CI run `29786127201` proved the synthetic `Waiting` goal was emitted from replacement behaviors, while the smoke incorrectly required a target-behavior ref. The corrected focused fixture failed `1/25` before implementation; GREEN: the assertion now requires `IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS` index `1` and both smoke suites pass `64/64`.
- Preview registration RED: the focused CI smoke contract failed because `supabase/config.toml` lacked `[functions.extract-assessment-fields]`; GREEN: the exact config/JWT assertion passed and the complete focused smoke suite remained `64/64`.
- Review P1 RED: checklist GET returned a deliberately stale stored aggregate; GREEN: current rows replace it in the authenticated response and client PATCH cannot persist a forged aggregate. Template-layout RED then proved the clinician UI read still needed the same adapter; GREEN: both authenticated reads return current reconciliation (`40/40` focused server/UI tests).
- Review P2 RED: an otherwise valid version `2` payload was accepted; GREEN: unsupported versions return the explicit invalid-reconciliation state and the UI suite passes `19/19`.

## Verification / Evidence

- PASS evidence already recorded in branch history:
  - Deno helper + index: `48` focused tests
  - UI: `18` focused tests
  - smoke: `64` focused tests
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run validate:tenant`
  - `npm run build`
  - tier-0 browser gate: `220` tests
  - final code review: approve
  - final test review: approve
  - final security review: approve
  - git diff check: pass
- FAIL / BLOCKED evidence already recorded in branch history:
  - latest local `npm run test:ci`: `3085` pass / `3` unrelated failures: the pre-existing BCBA workflow env assertion, `supabase.edge.test.ts` (`blob.text is not a function`, also fails alone), and one `AppNavigation` failure that passed immediately in isolation
  - `npm run verify:local`: earlier run reached the unrelated BCBA workflow env assertion after policy, lint, and typecheck passed
  - live DB policy checks: skipped because `SUPABASE_DB_URL` / `DATABASE_URL` were unavailable
  - auth parity: disabled outside CI
- Hosted evidence:
  - CI run `29783353571`: generated synthetic admin authenticated; default DOCX phone/provenance proof passed; first skills/behaviors attempt failed because the fixture summary heading did not match the deterministic parser anchor; both per-upload cleanup and unconditional admin cleanup succeeded.
  - CI run `29784074398`, job `88491826711`: corrected fixture reached `IEHP_FBA_BEHAVIOR_SKILL_TARGETS`; proof then failed because `payload.skills_behaviors` was absent from the main-project function response. Default DOCX phone/provenance proof again passed, evidence uploaded, and unconditional admin cleanup succeeded.
  - CI run `29786127201`, job `88501613796`: authenticated derive-on-read exposed the current reconciliation payload. Default phone/provenance proof passed with one row, accepted format, snapshot precedence, and `client_snapshot` / `primary_therapist_phone` provenance. Skills/behaviors then failed only because the smoke expected `Waiting` to reference the target-behavior field instead of the replacement-behavior skill field. Document/storage cleanup, synthetic-admin cleanup, evidence recording, and artifact upload all succeeded.
  - CI run `29787876724`, job `88506488261`, head `9c656428`: current-head hosted proof passed. JSON evidence reported `status: extracted`, exactly one version-1 reconciliation row, exact total counts, `behaviorParsed`, `skillParsed`, `needsReviewPreserved`, `detailedOnlyPreserved`, `parentExcluded`, `provenanceVerified`, and `cleanupVerified` all `true`; draft programs/goals remained zero. Default phone evidence also passed one-row, accepted-format, snapshot-precedence, and `client_snapshot` provenance assertions. Job-level synthetic-admin cleanup, evidence recording, and artifact upload all passed.
  - Supabase preview project `ywqpvpvlcqvykombolus` initially lacked `extract-assessment-fields`; after commit `7e1f0752`, live inventory confirmed `extract-assessment-fields` version `1` active with `verify_jwt=true`. The Netlify preview and CI credentials still target the main Supabase project, so the browser gate does not yet invoke that branch function.
- Cleanup evidence:
  - local seam proves assertion failure still runs document/storage cleanup and cleanup failure fails closed
  - both hosted attempts reached upload and completed document/storage cleanup; job-level synthetic admin cleanup also completed successfully

## Required Lane Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- changed files / surfaces: protected Edge Function code and deployment config, IEHP review UI, smoke scripts/tests, CI workflow, package command, and handoff/plan documentation
- required agents: `specification-engineer`, `software-architect`, `implementation-engineer`, `code-review-engineer`, `test-engineer`, `security-engineer`, `documentation-engineer`
- stop conditions: no parser framework changes, no promotion semantics changes, no schema or migration changes, no server/auth surface widening, no secrets, no PHI

## Verify-Change Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- required checks:
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run build`
  - `npm run verify:local`
  - `npm run ci:playwright` when valid credentials are available
  - hosted `playwright:iehp-assessment-import-skills-behaviors` against a deployment containing the branch Edge Function
- executed checks:
  - `deno test --allow-env --allow-read --allow-net supabase/functions/extract-assessment-fields/iehp-skills-behaviors.test.ts supabase/functions/extract-assessment-fields/index.test.ts` -> pass (`48`)
  - focused UI -> pass (`18`); focused smoke -> pass (`64`)
  - `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run validate:tenant`, `npm run build` -> pass
  - `npm run test:routes:tier0` -> pass (`220`)
  - latest `npm run test:ci` -> fail at the three unrelated cases listed above; CI `unit-tests` on head `f206721e` -> pass
  - hosted default phone/provenance smoke -> pass three times; latest hosted skills/behaviors smoke -> authenticated derive-on-read returned the reconciliation payload and exposed the corrected proof-only provenance mismatch
  - review-thread focused server/UI tests -> pass (`40/40`); strict UI version test -> RED then pass; `npm run ci:check-focused`, lint, typecheck, and build -> pass after review fixes
  - hosted-provenance fix -> RED (`1/25` focused helper failure), then GREEN (`64/64` smoke tests); `npm run ci:check-focused`, lint, typecheck, and build -> pass
- blocked checks:
  - local `npm run test:ci` and `npm run verify:local` remain blocked by unrelated baseline/runtime failures; the live PR `unit-tests` check passes
  - no IEHP hosted check is blocked: run `29787876724`, job `88506488261` passed with cleanup and JSON evidence
  - live DB policy checks remain blocked by missing database environment variables
- result: `pass-with-blocked-checks`
- residual risk: reconciliation and parsing are proven locally and in the hosted authenticated path. Human review and the remaining required PR checks are still required because the slice touches protected paths.

## Review Findings

- `code-review-engineer`: approve
- `test-engineer`: approve
- `security-engineer`: approve
- preview-registration `specification-engineer`, `code-review-engineer`, `test-engineer`, and `security-engineer`: approve
- review-thread `software-architect`, `specification-engineer`, `code-review-engineer`, and `security-engineer`: derive-on-read/strip-client-data approach approved; final test review pending at this update
- `pr-hygiene`: `pr-ready: yes` for continued human review; `merge-ready: no` while the required IEHP smoke is red and human approval is absent
- PR opening: complete; PR `#823` remains blocked by the required IEHP smoke and human review

## Handoff Summary

- The branch contains the reconciliation implementation, strict synthetic proof, CI gate, and the smallest preview-function registration needed to deploy the reviewed extractor.
- The hosted gate now proves credentials, upload, phone precedence/provenance, authenticated derive-on-read, one reconciled Skills & Behaviors result, behavior and skill parsing, Needs Review preservation, detailed-only preservation, parent exclusion, provenance, zero drafts, evidence capture, and cleanup.
- Next practical step: obtain the mandatory human approval after the remaining required PR checks finish. Do not merge critical-lane work without that review.
