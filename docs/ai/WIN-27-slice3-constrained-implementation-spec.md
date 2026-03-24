# WIN-27 Slice 3 Constrained Implementation Spec

## Route-Task (fresh, slice-only)

- classification: `low-risk autonomous`
- lane: `standard`
- why: non-trivial but behavior-preserving extraction in safe frontend/domain files only
- triggering paths:
  - `src/pages/Schedule.tsx`
  - `src/features/scheduling/domain/sessionFilters.ts`
  - `src/features/scheduling/domain/__tests__/sessionFilters.test.ts`
- required agents:
  - `specification-engineer`
  - `implementation-engineer`
  - `code-review-engineer`
  - `test-engineer`
- reviewer required: yes
- verify-change required: yes
- mandatory checks:
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - targeted tests for changed helper
  - `npm run build`

## Scope Goal

Extract one pure helper from `Schedule.tsx`:

- move batched session filtering predicate into `filterSessionsBySelectedScope`.
- keep runtime behavior identical.
- add focused unit tests for helper behavior.

## Strict Boundaries

Allowed files in this slice:

- `docs/ai/WIN-27-slice3-constrained-implementation-spec.md` (this spec artifact only)
- `src/pages/Schedule.tsx` (replace inline filter predicate with helper call only)
- `src/features/scheduling/domain/sessionFilters.ts` (new pure helper)
- `src/features/scheduling/domain/__tests__/sessionFilters.test.ts` (new tests)

Not allowed in this slice:

- `src/components/SessionModal.tsx`
- `src/server/**`
- `src/lib/auth*`
- `src/lib/runtimeConfig*`
- `scripts/ci/**`
- `.github/workflows/**`
- `supabase/**`
- `netlify.toml`

## Explicit Non-Goals

- No UI redesign, filter UX changes, or state-machine changes.
- No query contract, cache, debounce, or data-fetch changes.
- No auth/routing/runtime-config/server/API/deploy/migration/tenant changes.
- No Playwright flow changes.

## Minimal Regression Test Plan

1. Unit tests for `filterSessionsBySelectedScope`:
   - no filters returns all sessions
   - therapist-only filter
   - client-only filter
   - both filters combined
   - empty input array
2. Verify no behavior changes in compilation/linting:
   - `npm run lint`
   - `npm run typecheck`
   - targeted tests for new helper
3. Lane-required checks:
   - `npm run ci:check-focused`
   - `npm run build`

## Containment Gate

Implementation can proceed only if:

- changed files remain inside strict boundaries above
- no protected path is touched
- no behavior beyond extraction/refactor is introduced

If any gate fails, stop and reclassify remaining `WIN-27` work to `needs-planning`.
