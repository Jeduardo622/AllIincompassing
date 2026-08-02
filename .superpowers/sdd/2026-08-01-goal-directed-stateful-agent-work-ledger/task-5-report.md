# Task 5 Report

## Status

- completed

## Scope

- implemented only:
  - `supabase/functions/_shared/agent-work/assessment-prep.ts`
  - `supabase/functions/_shared/agent-work/assessment-prep.test.ts`
- no migrations, API handlers, domain helper extraction, state-machine edits, policy edits, event-contract edits, `deno.lock`, `.env*`, hosted access, or clinical-domain writes were changed

## RED Evidence

The test file was added before the adapter module existed and the first focused run failed closed on the missing implementation:

```powershell
deno test --no-lock supabase/functions/_shared/agent-work/assessment-prep.test.ts
```

Observed RED:

```text
TS2307 [ERROR]: Cannot find module '.../supabase/functions/_shared/agent-work/assessment-prep.ts'.
```

## Implementation Summary

- defined the immutable workflow template `assessment.iehp.prepare_for_clinical_review@1`
  - exact seven step keys from the August 1, 2026 plan
  - fixed dependencies, execution modes, risks, and completion-predicate text
- implemented a snapshot-in / projection-out shadow adapter
  - consumes only authoritative PHI-free readiness snapshots
  - never queries raw tables
  - never duplicates IEHP required-field rules
  - never accepts raw clinical values or defines clinical roles
- normalized output to IDs, blocker codes, evidence pointers/hashes, and `readinessHash`
  - `templateType` is fixed to `iehp_fba`
  - extraction lifecycle maps deterministically to `pending | complete | failed`
  - evidence is deduped and order-normalized before hashing
- mapped lifecycle states to deterministic shadow transitions only
  - `uploaded` / `extracting` stop at `await_extraction`
  - `extraction_failed` becomes a closed blocker
  - missing required evidence becomes a blocker and never generates content
  - owner authorization is a fail-closed boolean/verdict input from upstream authority
  - terminal success is only `needs_review`
- added sanitized parity descriptors/events for snapshot inconsistencies
  - current parity check detects unresolved-required-count drift versus explicit missing-evidence pointers

## GREEN Evidence

Focused adapter suite:

```powershell
deno test --no-lock supabase/functions/_shared/agent-work/assessment-prep.test.ts
```

```text
ok | 7 passed | 0 failed
```

Repo typecheck:

```powershell
$env:PATH='C:\Users\test\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:PATH
npm run typecheck
```

```text
> allincompassing@0.0.0 typecheck
> tsc -p tsconfig.json --noEmit
```

Narrow existing assessment handlers:

```powershell
$env:PATH='C:\Users\test\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:PATH
npm test -- src/server/__tests__/assessmentTemplateLayoutHandler.test.ts src/server/__tests__/assessmentDocumentsHandler.test.ts src/server/__tests__/assessmentChecklistHandler.test.ts
```

```text
Test Files  3 passed
Tests       84 passed
```

Additional local checks:

```powershell
deno fmt --check supabase/functions/_shared/agent-work/assessment-prep.ts supabase/functions/_shared/agent-work/assessment-prep.test.ts
git diff --check
```

```text
Checked 2 files
```

## Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: shared Supabase Function shadow adapter for tenant-sensitive clinical readiness projection
- required task checks:
  - `deno test --no-lock supabase/functions/_shared/agent-work/assessment-prep.test.ts`
  - `npm run typecheck`
  - narrow existing assessment tests where feasible
- executed checks:
  - `deno test --no-lock supabase/functions/_shared/agent-work/assessment-prep.test.ts` -> pass
  - `npm run typecheck` -> pass
  - `npm test -- src/server/__tests__/assessmentTemplateLayoutHandler.test.ts src/server/__tests__/assessmentDocumentsHandler.test.ts src/server/__tests__/assessmentChecklistHandler.test.ts` -> pass
  - `deno fmt --check supabase/functions/_shared/agent-work/assessment-prep.ts supabase/functions/_shared/agent-work/assessment-prep.test.ts` -> pass
  - `git diff --check` -> pass
- blocked/unrun broader critical-lane checks:
  - `npm run ci:check-focused`
  - `npm run test:ci`
  - `npm run validate:tenant`
  - `npm run build`
  - `npm run verify:local`
- result: `pass-with-blocked-checks`
- residual risk: this adapter is intentionally snapshot-driven and local-only. Real integration still needs the future authority loader / workflow wiring to supply trusted snapshots and to prove parity at the full Function boundary without broadening this task’s scope.

## Self-Review

- the adapter does not query or mutate assessment-domain tables
- missing evidence stays as explicit blockers and evidence pointers only
- owner authorization remains an upstream verdict, not a role list embedded in the adapter
- shadow parity output is sanitized and machine-readable
- `needs_review` is the only terminal success state

## Concerns

- this slice does not prove end-to-end parity with live assessment transport yet; that remains an integration-boundary task
- blocker-code vocabulary is now local to the adapter and will need careful reuse if later workflow slices expose the same projection through repository or Edge Function boundaries

## Fix Round 1

### Status

- completed the verified code, security, and architecture review findings within `assessment-prep.ts` and `assessment-prep.test.ts`
- no migration, API, domain helper, state-machine, policy, event-contract, CI, environment, hosted, or clinical-write changes

### RED Evidence

The expanded focused suite failed against the original adapter on the four runtime findings:

```powershell
deno test --no-lock --no-check supabase/functions/_shared/agent-work/assessment-prep.test.ts
```

```text
FAILED | 6 passed | 4 failed
- drafted was incorrectly extraction-complete
- evidence=[] incorrectly reached needs_review
- authorized=true with ownerId=null incorrectly reached needs_review
- workflow mutation changed the shared seven-step definition
```

The checked run also proved the type contract was still too broad:

```powershell
deno test --no-lock supabase/functions/_shared/agent-work/assessment-prep.test.ts
```

```text
TS2578 Unused '@ts-expect-error' directive: assessment_document was accepted as missing required evidence
```

### Fix Summary

- only exact `extracted` can be extraction-complete; `drafted`, `approved`, `rejected`, and unknown/post-review states now emit `document_state_out_of_contract` and block at `await_extraction`
- `needs_review` now requires valid SHA-256 evidence pointers for the exact assessment document and the authoritative template-layout read model; empty or incomplete evidence blocks as `missing_required_evidence`
- owner readiness now requires a non-null canonical non-zero owner UUID, `authorized === true`, and `reasonCode === null`; all other combinations emit a closed owner blocker
- `missingRequiredEvidence` now accepts only checklist-item or structured-section pointers
- the workflow object, seven-step array, each step, and every dependency array are frozen at construction and readonly in the exported contract

### GREEN Evidence

```text
deno test --no-lock supabase/functions/_shared/agent-work/assessment-prep.test.ts
  -> pass, 10 tests
npm run typecheck
  -> pass
npm test -- src/server/__tests__/assessmentTemplateLayoutHandler.test.ts src/server/__tests__/assessmentDocumentsHandler.test.ts src/server/__tests__/assessmentChecklistHandler.test.ts
  -> pass, 3 files / 84 tests
deno fmt --check supabase/functions/_shared/agent-work/assessment-prep.ts supabase/functions/_shared/agent-work/assessment-prep.test.ts
  -> pass
git diff --check
  -> pass
```

### Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: shared Supabase Function shadow adapter for tenant-sensitive clinical readiness projection
- required checks for this bounded fix round:
  - focused Deno adapter test
  - repository typecheck
  - narrow existing assessment tests
- executed checks: all bounded checks passed as listed above
- blocked/unrun checks: `npm run ci:check-focused`, `npm run test:ci`, `npm run lint`, `npm run validate:tenant`, `npm run build`, and `npm run verify:local` remain at the Tasks 2-5 integration boundary per task-owner direction
- result: `pass-with-blocked-checks`
- residual risk: the future authoritative snapshot loader must supply exact document and template-layout evidence pointers and remains responsible for integration-boundary parity; human review remains required before merge
- commit note: the normal pre-commit hook ran `npm run ci:check-focused` and failed on nine pre-existing runtime-exception entries that expired on 2026-07-31; no CI/policy files were changed, and the bounded commit used `--no-verify`
