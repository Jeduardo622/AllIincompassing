# WIN-230: ABA Closeout Preflight Guard

Linear: [WIN-230](https://linear.app/winningedgeai/issue/WIN-230/block-aba-closeout-when-assigned-bt-preflight-fails)

## Routing

- classification: `high-risk human-reviewed`
- lane: `critical`
- why: The change controls an authenticated session-lifecycle transition after the assigned-BT note lookup. The implementation is UI-contained, but authorization failure must remain fail-closed.
- triggering paths: `src/components/SessionModal.tsx`, with behavioral dependency on `/api/session-notes/upsert` and `get_bt_aba_session_note` authorization.

## Scope

- task intent: Keep BT capture open when the fresh ABA note preflight fails or lacks a usable template, and surface the preflight failure instead of downstream loading/finalization errors.
- files touched: `src/components/SessionModal.tsx`, `src/components/__tests__/SessionModal.test.tsx`, `docs/ai/WIN-230-aba-closeout-preflight-handoff.md`
- non-goals: No server, RPC, migration, RLS, role, assignment, deployment, production-data, auto-save, or auto-finalize changes.
- stop conditions: Stop if containment requires a backend error-contract or authorization-policy change.
- single-purpose diff: yes

## Required Agents

- required sequence: `specification-engineer` -> `software-architect` -> `implementation-engineer` -> `code-review-engineer` -> `test-engineer` -> `security-engineer`
- agents used: specification, architecture, implementation, code review, test review, and security review complete
- reviewer: completed; code and security verdicts approve after the restore-path readiness finding was fixed

## Verification Card

- required checks: focused `SessionModal` regression; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run build`; `npm run test:routes:tier0`; `npm run ci:playwright`; `npm run verify:local`
- executed checks:
  - `npm ci`: pass
  - focused forbidden-refetch regression before implementation: fail as expected because closeout opened
  - `npx vitest run src/components/__tests__/SessionModal.test.tsx --pool=forks --poolOptions.forks.singleFork`: pass, 93/93
  - `npm run ci:check-focused`: pass; database-backed and branch-protection checks skipped by the command because their local inputs are unavailable
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run test:ci`: fail with 3071 passed, 5 skipped, and 2 out-of-scope local failures: the Windows CRLF workflow-step parser and `Blob.text()` support in `src/lib/__tests__/supabase.edge.test.ts`
  - isolated `src/lib/__tests__/supabase.edge.test.ts`: same `blob.text is not a function` failure, confirming it is independent of the closeout suite
  - `npm run ci:verify-coverage`: pass; line coverage 92.71% exceeds 86%
  - `npm run build`: pass
  - `PREVIEW_PORT=4187 npm run test:routes:tier0`: pass, 220/220
  - `npm run ci:playwright`: blocked safely at credential preflight before browser launch
  - `npm run verify:local`: fail at the chained `test:ci` step with the same two out-of-scope failures after policy, lint, and typecheck passed
  - PR #824 live CI at commit `ac28fffb`: pass, including Linux unit tests, policy, lint/typecheck, build, tenant safety, runtime migration parity, Tier-0 browser, auth browser smoke, optional Playwright smoke, IEHP import smoke, deploy preview, and final `ci-gate`
- blocked checks:
  - `npm run ci:playwright`: missing synthetic `PW_SUPERADMIN_*` or `PW_ADMIN_*` credentials
  - database-backed policy checks: no `SUPABASE_DB_URL` / `DATABASE_URL`; no database surface changed
- result: pass-with-blocked-checks
- residual risk: The focused closeout behavior, route surface, and live Linux CI are green. Human review remains required, and the exact credentialed closeout smoke could not run locally because synthetic credentials were unavailable.

## PR Hygiene

- branch-ready: yes, `codex/fix-aba-closeout-preflight`
- linear-ready: yes, WIN-230 is In Progress
- protected-path drift: none; implementation is UI/test only
- unrelated changes: none in the isolated worktree
- generated artifact drift: none
- verification summary: present
- pr-ready: yes for human review; not merge-ready until required live checks and human approval are complete
- required follow-up: Obtain the mandatory critical-lane human approval before merge.

## Handoff Summary

The modal now enters ABA closeout only after a fresh note lookup succeeds with a usable template; a forbidden lookup or missing template leaves the session in capture and surfaces the lookup error. Persisted draft restoration applies the same readiness rule, and the focused component suite passes 93/93 without changing backend authorization. Local policy, lint, typecheck, build, coverage, and Tier-0 routes pass, and PR #824's complete Linux CI matrix is green; credentialed local smoke remains blocked and critical-lane human approval is still required.
