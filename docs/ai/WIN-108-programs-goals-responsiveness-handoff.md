# WIN-108 Programs & Goals Responsiveness Handoff

## Scope

- Classification: `low-risk autonomous`
- Lane: `standard`
- Allowed surfaces used:
  - `src/components/ClientDetails/ProgramsGoalsTab.tsx`
  - `src/components/__tests__/ProgramsGoalsTab.test.tsx`

## What Changed

- Replaced several post-mutation refetches in `ProgramsGoalsTab` with cache-aware updates for:
  - program create
  - goal create
  - note create
  - program archive
  - goal archive
- Added bounded query `staleTime` to reduce needless remount churn for programs, goals, notes, and assessment documents.
- Replaced unconditional 3-second assessment queue polling with conditional polling that runs only while:
  - an upload is actively processing
  - the queue contains `uploaded` or `extracting` assessment rows
  - a transient assessment queue fetch failure still needs retry recovery
- Kept existing workflow semantics intact after reviewer follow-up:
  - removed the temporary empty-cache seeding for new-program goal/note queries
  - added retry recovery for transient empty-state assessment queue failures

## Verification

- Passed:
  - `npm test -- --run src/components/__tests__/ProgramsGoalsTab.test.tsx`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run build`
- Attempted but not authoritative:
  - `npm run verify:local`
    - timed out locally after broader repo checks
    - emitted unrelated warnings and external/network-related failures outside this slice

## Reviewer Notes

- Initial reviewer findings on empty seeded caches and assessment retry recovery were addressed in the final diff.
- Final reviewer re-check requested before PR handoff.

## Residual Risk

- This slice improves perceived responsiveness and avoids avoidable tab-local refetch churn, but it does not change edge/API latency itself.
- Broader repo-level `verify:local` remains noisy and is not a reliable signal for this bounded UI slice without separate repo follow-up.
