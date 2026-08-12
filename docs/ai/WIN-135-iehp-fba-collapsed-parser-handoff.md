# WIN-135 IEHP FBA Collapsed Target Parser Handoff

## Route And Scope

- classification: `high-risk human-reviewed`
- lane: `critical`
- triggering paths: `supabase/functions/**`, `.github/workflows/**`
- tracking: `WIN-135`
- human review: required before merge

A dedicated child issue could not be created because the Linear workspace reached its free issue limit. The bounded execution is recorded on the existing open FBA follow-up queue with explicit critical-lane scope.

## Problem And Root Cause

Adobe PDF Extract already supplies ordered text to the IEHP parser. When several checkbox labels are returned in one text element, the summary can look like:

```text
[U+2610] Physical Aggression [U+2610] Functional Communication [U+2610] Community Safety
```

The IEHP summary tokenizer split newlines, semicolons, and bullets, but not checkbox/square markers. It therefore emitted one combined `payload.targets` value, and the conservative Skills & Behaviors reconciliation could not match the individual behavior and skill goal blocks.

## Bounded Change

- Treat common checkbox and square glyphs as delimiters in the existing IEHP target-list tokenizer.
- Add a synthetic regression that proves three collapsed targets remain distinct and reconcile as behavior, skill, and summary-only review data.
- Add required, secret-free extractor Deno suites to the existing `unit_tests` CI job, which is already a governed prerequisite for the main-branch Supabase deployment.
- Guard the pre-deploy test ordering with a focused workflow contract and prevent Deno from rewriting `deno.lock`.

No schema, migration, auth, RLS, grant, tenant filter, API response shape, runtime configuration, provider credential, deployment, or production-data behavior changed.

## Tenant And Clinical Safety

- Organization and tenant read/write boundaries are unchanged.
- Cross-tenant access remains impossible through this change because no database access, authorization, or persistence path changed.
- All new parser evidence is synthetic and contains no customer data or PHI.
- Extracted Skills & Behaviors remain review data; existing clinician approval and publish controls are unchanged.

## Verification Evidence

- RED: the synthetic Deno regression returned one combined checkbox target instead of three distinct targets.
- GREEN: focused collapsed-target regression passed.
- GREEN: all four extractor-native Deno suites passed, `67 passed`, `0 failed`.
- GREEN: workflow contract test passed, `1 passed`, `0 failed`.
- GREEN: `npm run validate:tenant` passed.
- GREEN: final `npm run verify:local` passed in 456 seconds, including policy checks, lint, typecheck, `4,217` Vitest tests (`5` skipped), coverage verification, production build, and `220` Tier-0 browser route tests.

### Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- files touched: `.github/workflows/ci.yml`; `supabase/functions/extract-assessment-fields/index.ts`; `supabase/functions/extract-assessment-fields/index.test.ts`; `tests/workflows/iehp-fba-parser-ci.test.ts`; `docs/ai/WIN-135-iehp-fba-collapsed-parser-handoff.md`
- required agents: `specification-engineer` -> `software-architect` -> `implementation-engineer` -> `test-engineer` + `devops-engineer` -> `code-review-engineer` + `security-engineer` + `supabase-reviewer` + `documentation-engineer`
- required checks: focused parser regression; extractor-native Deno suites; CI workflow contract; `npm run validate:tenant`; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run ci:verify-coverage`; `npm run build`; `npm run test:routes:tier0`; `npm run verify:local`
- executed checks: focused parser RED -> failed as expected; focused parser GREEN -> pass; extractor-native Deno suites -> pass (`67/67`); workflow contract -> pass (`1/1`); `npm run validate:tenant` -> pass; post-review workflow contract -> pass (`1/1`); post-review `npm run ci:check-focused` -> pass; final `npm run verify:local` -> pass in 456 seconds
- blocked checks: live branch protection -> CI only; privileged function database grants -> missing protected database URL; Supabase preview drift -> missing `SUPABASE_DB_URL`; hosted function auth parity -> CI-only configuration; no credentials or hosted systems were accessed
- reviewer: completed; initial code/security findings were corrected, and final code, security, Supabase, and documentation reviews found no unresolved implementation defect
- residual risk: the change is proven against synthetic Adobe-collapsed text but has not been deployed or exercised with customer documents; production activation remains outside this slice
- pr handoff: ready at PR `#927` (`https://github.com/Jeduardo622/AllIincompassing/pull/927`); live checks are pending and human review remains required

## Specialist Review

- Specification and architecture reviewers confirmed the existing tokenizer is the smallest safe seam and no payload-schema change is required.
- Implementation and test reviewers confirmed the synthetic reconciliation coverage and the pre-existing CI coverage gap.
- Supabase review found no schema, auth, tenant, persistence, RLS, grant, or RPC drift.
- Documentation review found the handoff accurate before the final CI-order correction.
- Code review identified ambiguous checkbox wording in this handoff; the example now states the tested `U+2610` marker explicitly rather than implying a literal word token.
- Security review identified that a standalone parser job could finish after the main-branch function deployment. The Deno suites now run inside the already-required `unit_tests` job, and the workflow contract proves that deployment depends on that job.

## Pull Request State

- PR: `#927` (`https://github.com/Jeduardo622/AllIincompassing/pull/927`)
- publication head: `07a5001b3c446d945101c506a8b1ff6988381846`
- live checks at publication: CI `change-scope`, `tenant-safety`, Lighthouse, and Netlify deploy preview pending; Supabase Preview skipped
- review decision: no GitHub human review submitted
- merge state: `BLOCKED`
- merge result: not merged; critical-lane human review and exact-head required checks remain mandatory
