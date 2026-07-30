# WIN-266 Session-Note Target Hydration Handoff

## Routing

- Linear: [WIN-266](https://linear.app/winningedgeai/issue/WIN-266/preserve-populated-skills-and-behaviors-during-session-note-hydration)
- Classification: `low-risk autonomous`
- Lane: `standard`
- Why: non-trivial UI state and hydration behavior outside protected auth, server, Supabase, CI, and deploy paths.
- Triggering paths: `src/components/SessionModal.tsx`, `src/components/__tests__/SessionModal.test.tsx`

## Scope

- Preserve every populated linked-note target row when goal metadata resolves asynchronously.
- Keep the current plan target as the primary target when it exists without deleting historical target evidence.
- Render persisted non-empty or evidenced rows while suppressing empty placeholders.
- Append or bind `Use plan target` without erasing existing target rows.
- Preserve all target rows in closeout previews and submitted session-note measurements.

## Non-Goals And Stop Conditions

- No API, server, schema, migration, RLS, RPC, auth, billing, tenant, CI, or deploy changes.
- No shared session-note persistence-contract changes.
- Stop and re-route if the fix cannot remain within `SessionModal`, focused tests, and this handoff.

## Required Agents

- Required sequence: `specification-engineer` -> `implementation-engineer` -> `code-review-engineer` -> `test-engineer`
- Specification: completed.
- Implementation: completed by the primary agent.
- Code review: completed; no findings after the legacy target-trial compatibility regression was added.
- Test review: completed; implementation confidence high, with residual risk limited to blocked broad/browser verification.

## Verification Card

- Classification: `low-risk autonomous`
- Lane: `standard`
- Change type: UI/component state hydration and display.
- Required checks:
  - focused `SessionModal` regression
  - full `SessionModal` suite
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run test:routes:tier0`
  - `npm run ci:playwright`
  - `npm run build`
  - `npm run verify:local`
- Executed checks:
  - TDD RED: the new preservation expectation failed because `Legacy freeform target` disappeared after hydration while the other 720 tests passed.
  - Focused target-preservation and blank-evidence regressions: pass (3 tests).
  - Full `SessionModal` suite: pass (158 tests).
  - `npm run ci:check-focused`: pass; database URL, CI branch-protection, and disabled auth-parity checks reported their expected local skips.
  - `npm run lint`: pass.
  - `npm run typecheck`: pass.
  - `npm run build`: pass after the final implementation.
  - `npm run test:routes:tier0`: partial, 219/220 passed; an unrelated `/authorizations` route assertion timed out. A later attempted isolated rerun was invalid because the npm script appended the argument to its built-in suite and is not counted as verification.
  - `npm run test:ci`: changed `SessionModal` tests passed, but the command failed on the unchanged Windows CRLF assertion in `tests/authorizations/authorization-bcba-readonly.test.ts` and later exhausted the Node heap.
  - `npm run verify:local`: policy, lint, and typecheck constituents passed; the command stopped at the same `test:ci` CRLF failure and heap exhaustion.
  - `npm run ci:playwright`: preflight passed; hosted superadmin authentication rejected the configured credentials before session smoke tests ran.
- Blocked checks:
  - Clean `test:ci` / `verify:local`: blocked by an unrelated Windows CRLF assertion and process heap exhaustion.
  - Clean tier-0 route gate: blocked by an unrelated `/authorizations` timeout.
  - Hosted session browser proof: blocked by rejected external test credentials.
- Result: `pass-with-blocked-checks`.
- Residual risk: no authenticated browser smoke reached the changed session UI; focused component coverage verifies the delayed-hydration and submission behavior.

## PR Hygiene

- Branch: `codex/win-266-preserve-session-note-targets`
- Branch-ready: yes.
- Linear-ready: yes, WIN-266 is In Progress.
- Single-purpose diff: yes.
- Protected-path drift: none.
- Unrelated changes: none.
- Generated artifact drift: none.
- Verification summary: present.
- Reviewer: completed with no findings.
- PR-ready: yes, with blocked checks disclosed.
- PR: [#875](https://github.com/Jeduardo622/AllIincompassing/pull/875)
- Live status at open: mergeable, with policy, Lighthouse, and Netlify preview checks pending.
- Required follow-up: complete human review and rerun hosted browser proof when valid credentials are available.

## Handoff Summary

The linked-note hydration path no longer collapses populated measurements to the current plan target after goal metadata resolves. Historical and current target evidence now remains visible and saveable, with focused regression coverage preserving blank-placeholder behavior.
