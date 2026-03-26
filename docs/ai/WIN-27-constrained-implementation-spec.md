# WIN-27 Constrained Implementation Spec

## Route-Task (fresh)

- classification: `low-risk autonomous`
- lane: `standard`
- why: non-trivial scheduling refactor in safe frontend paths (`src/pages/**`, `src/features/scheduling/**`) with regression risk if unbounded
- triggering paths:
  - `src/pages/Schedule.tsx`
  - `src/features/scheduling/domain/**`
  - `src/features/scheduling/domain/__tests__/**`
- required agents:
  - `specification-engineer`
  - `implementation-engineer`
  - `code-review-engineer`
  - `test-engineer`
- reviewer required: yes
- verify-change required: yes
- mandatory checks:
  - run the canonical `standard`-lane required check union from `docs/ai/cto-lane-contract.md` (`npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, `npm run test:ci`, `npm run build`)
  - targeted tests (domain helper + existing affected tests when needed) are additive, not a substitute for the canonical union

## Scope Goal

Continue scheduling orchestration split with one strictly bounded extraction:

- move therapist auto-scoping candidate-id collection logic from `Schedule.tsx` into a pure domain helper.
- keep runtime behavior identical.
- add focused unit tests for helper behavior.

## Strict Boundaries

Allowed files in this slice:

- `docs/ai/WIN-27-constrained-implementation-spec.md` (this spec artifact only)
- `src/pages/Schedule.tsx` (replace inline candidate-id assembly with helper call only)
- `src/features/scheduling/domain/sessionScope.ts` (new pure helper)
- `src/features/scheduling/domain/__tests__/sessionScope.test.ts` (new tests)

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

- No UI redesign, no filter UX changes, and no state-machine rewrite.
- No mutation/query contract changes.
- No new scheduling business rules.
- No auth/routing/runtime-config/server/API/deploy/migration/tenant changes.
- No Playwright flow changes.

## Minimal Regression Test Plan

1. Unit tests for `collectTherapistScopeCandidateIds`:
   - includes `profile.id`
   - includes `user_metadata.therapist_id` and `user_metadata.therapistId`
   - includes `preferences.therapist_id` and `preferences.therapistId`
   - trims whitespace and de-duplicates
   - ignores non-string/empty values
2. Unit tests for `resolveScopedTherapistId`:
   - returns matching therapist id when candidate exists
   - returns `null` when no candidate matches
3. Verify no behavior changes in compilation/linting:
   - `npm run lint`
   - `npm run typecheck`
   - targeted tests for new helper

## Containment Gate

Implementation can proceed only if:

- changed files remain inside strict boundaries above
- no protected path is touched
- no behavior beyond extraction/refactor is introduced

If any gate fails, stop and reclassify `WIN-27` to `needs-planning`.
