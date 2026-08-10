# WIN-240 BT Session Closeout Recovery

## Scope

- Restore BT session capture and closeout mode for users whose normalized effective role is `bt`.
- Keep the scheduled-session start exception restricted to exact `bt` role assignments.
- Add orchestration coverage for the legacy-normalized BT path.

## Routing

- Classification: `low-risk autonomous`
- Lane: `standard`
- Triggering paths: `src/pages/Schedule.tsx` and its integration test
- Protected-path drift: none

## Verification

- Focused Schedule orchestration tests pass for legacy BT capture mode and atomic closeout completion (`2/2`).
- Focused `SessionModal` tests pass for capture-before-closeout, data-only closeout progression, and closeout refetch failure containment (`3/3`).
- `npm run lint`, `npm run typecheck`, and `npm run build` pass.
- Authenticated local `/schedule` smoke passes with no Schedule-phase console errors or failed requests.
- Sanitized responsive observation passes at desktop `1440x900`.
- Mobile responsive observation is blocked by a pre-existing undersized control on the unauthenticated login shell.
- The configured `PW_THERAPIST_*` credentials are stale, so a real BT-authenticated closeout browser proof remains blocked.

## Residual Risk

The effective-role gate is covered by integration tests, but the recovered popup still needs one browser confirmation with a valid legacy-normalized BT test account.
