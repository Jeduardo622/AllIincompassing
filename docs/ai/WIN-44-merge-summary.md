# WIN-44 Merge Summary (PR #277)

Status: Merged  
PR: https://github.com/Jeduardo622/AllIincompassing/pull/277  
Date: 2026-03-26

## Scope Landed

The WIN-44 lineage changes are merged and now represent the canonical Programs browser-contract behavior for this repository.

Included slices:

- WIN-46A: Programs client target alignment (canonical edge path semantics)
- WIN-47A.2: shared preflight/auth-bypass contract coverage
- WIN-47A.3: Programs non-`OPTIONS` response-header CORS conformance fix
- WIN-48B: regression coverage for Programs preflight and live-load behavior

## Files Landed

- `src/components/ClientDetails/ProgramsGoalsTab.tsx`
- `src/components/__tests__/ProgramsGoalsTab.test.tsx`
- `supabase/functions/programs/index.ts`
- `tests/edge/auth-middleware.cors.test.ts`
- `tests/edge/programs.cors.contract.test.ts`

## Behavior and Contract Outcomes

- Programs client calls are aligned to edge `programs` path semantics in touched code/tests.
- Protected-route `OPTIONS` behavior is explicitly locked to bypass auth and return CORS headers.
- Programs non-`OPTIONS` JSON responses include request-scoped CORS headers.
- Frontend regression coverage explicitly verifies:
  - canonical live-load target behavior
  - visible failure behavior when Programs loading fails

## Verification Snapshot

Checks executed for this sprint slice:

- `npm run ci:check-focused`
- `npm run lint`
- `npm run typecheck`
- `npm run test:ci`
- `npm run validate:tenant`
- `npm run build`

Additional note:

- `npm run verify:local` was attempted and blocked at `npm run test:routes:tier0` due to local port contention (`EADDRINUSE 127.0.0.1:4173`) during local execution.
- PR CI `ci-gate` and core required checks passed prior to merge.

## Residual Notes

- A non-required `Supabase Preview` check showed failure in PR status history; merge proceeded because required gate checks passed.
- WIN-33 remains evidence-driven and is not currently justified for runtime auth/guard fixes based on latest reconciled route/account truth.
