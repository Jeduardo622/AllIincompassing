# WIN-133 Super Admin Session Cancel Handoff

## Scope

- Allow `super_admin` users to cancel sessions from the schedule UI using the existing cancellation flow.
- Keep cancellation org-scoped and preserve current audit, status, invalidation, and therapist ownership semantics.

## Route Task

- classification: `high-risk human-reviewed`
- lane: `critical`

## Files In Scope

- `src/pages/Schedule.tsx`
- `src/lib/sessionCancellation.ts`
- `supabase/functions/sessions-cancel/index.ts`
- focused cancellation tests

## Implementation Summary

- Kept the existing schedule UI cancel entry points and `cancelSessions` client contract unchanged for users.
- Extended `sessions-cancel` so that when direct org context is missing, only `super_admin` callers can derive scheduling scope server-side from the targeted session ids, hold key, or therapist scheduling context.
- Preserved existing org-scoped session lookup, therapist self-ownership restrictions, audit writes, mutation summaries, and schedule query invalidation.

## Verification

- Focused tests:
  - `npm test -- --run src/lib/__tests__/sessionCancellation.test.ts`
  - `npm test -- --run src/pages/__tests__/Schedule.orchestration.integration.test.tsx`
  - `npm test -- --run tests/edge/sessions-cancel.org-scope.test.ts`
- Additional checks run:
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run validate:tenant`
  - `npm run build`
  - `npm run test:routes:tier0`
  - `npm run verify:local` (failed due unrelated existing test failures; record exact failures in final verification card)

## Residual Risk

- Full `verify:local` is still red on unrelated pre-existing failures outside this slice.
- I did not add new browser automation specifically for clicking cancel in a live seeded schedule because local verification here relied on existing schedule integration coverage plus the route/browser gates.
