# WIN-217 BCBA Session Auth Recovery Handoff

- classification: `high-risk human-reviewed`
- lane: `critical`
- Linear: `WIN-217`
- branch: `codex/bcba-session-auth-recovery`
- files touched:
  - `src/lib/authContext.tsx`
  - `src/lib/__tests__/authContext.initializeAuth.test.tsx`
  - `src/features/scheduling/domain/sessionStart.ts`
  - `src/features/scheduling/domain/__tests__/sessionStart.test.ts`
  - planning and handoff documentation for WIN-217
- required agents: specification-engineer -> software-architect -> implementation-engineer -> code-review-engineer -> test-engineer -> security-engineer

## Change summary

- Supabase profile and role query results now preserve deterministic HTTP 401 status. Confirmed unauthorized auth queries use the existing fail-closed state, storage, sign-out, and query-cache cleanup path.
- Auth generations prevent delayed bootstrap or refresh responses from clearing or overwriting a newer valid session.
- Session start treats only HTTP 409 plus `rpcCode: "ALREADY_STARTED"` as idempotent success. `INVALID_STATUS` and all other conflicts remain errors.
- No role, tenant, RLS, grant, migration, Edge Function, server authority, billing, or runtime-config behavior changed.

## Verification card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: auth/session lifecycle; UI-to-server API integration
- required checks:
  - focused Vitest regression tests
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run test:routes:tier0`
  - `npm run build`
  - `npm run ci:playwright`
  - `npm run verify:local`
- executed checks:
  - focused Vitest regression tests -> pass, 2 files / 12 tests
  - `npm run ci:check-focused` -> pass
  - `npm run lint` -> pass
  - `npm run typecheck` -> pass
  - `npm run test:routes:tier0` -> pass, 7 specs / 220 tests
  - `npm run build` -> pass
  - `npm run test:ci` with synthetic non-secret Supabase configuration -> fail outside the changed files: `AddSessionNoteModal.test.tsx` cannot find the `Default Goal` checkbox in `locks BT session metadata and goal structure while leaving data collection editable`; the isolated file reproduces 1 failure / 20 passes
  - `npm run ci:playwright` -> blocked at preflight because no `PW_SUPERADMIN_*` or `PW_ADMIN_*` credentials are available
- blocked checks:
  - `npm run verify:local` -> its `test:ci` stage deterministically reaches the unrelated AddSessionNoteModal failure above; remaining constituent checks were run separately
  - secret-backed Playwright smoke -> required in CI
- reviewer: code-review-engineer approved after auth-generation race fix; security-engineer approved with no remaining findings
- result: `pass-with-blocked-checks`
- residual risk: hosted confirmation still depends on CI credentials and a fresh BCBA browser session; human review remains mandatory before merge

## PR hygiene inputs

- single purpose: yes
- unrelated changes: none in this isolated worktree
- protected-path drift: `src/lib/authContext.tsx` is intentionally protected and remains critical-lane
- human merge blocker: required review and CI, including credential-backed auth/session smoke
