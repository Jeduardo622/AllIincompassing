# WIN-265 Admin Invite CORS Handoff

- classification: high-risk human-reviewed
- lane: critical
- issue: WIN-265
- scope: fix the admin-invite request-scoped CORS behavior so production admin invite submission can complete without a static-response CORS failure, while preserving the invite flow and existing authorization boundaries
- allowed files:
  - `supabase/functions/admin-invite/index.ts`
  - `tests/admins/invite_flow.spec.ts`
  - `docs/ai/handoffs/WIN-265-admin-invite-cors.md`
- non-goals: production mail configuration changes, new invite UX, broader auth/routing refactors, unrelated Supabase or Netlify work, and any secret-value disclosure
- required agents: `specification-engineer`, `software-architect`, `implementation-engineer`, `code-review-engineer`, `test-engineer`, `security-engineer`

## Triggering Evidence

- production admin invite submit reproduced `FunctionsFetchError`
- no invite row was created after the failed submit
- hosted secret names showed `ADMIN_INVITE_EMAIL_URL` and `ADMIN_PORTAL_URL` absent
- code root cause is a static response CORS path in the admin-invite function
- the follow-up fix is request-scoped CORS for admin-invite plus TDD coverage in `tests/admins/invite_flow.spec.ts`
- a separate Netlify secret incident is involved and remains critical, but values are intentionally omitted here

## Current Decision

- keep the fix tightly scoped to the admin-invite request path
- do not broaden into general CORS middleware, mail provider migration, or environment rewiring
- stop if the fix requires touching shared runtime config, deploy config, or any secret-bearing surface

## Verification Card

- lane: critical
- required checks:
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run validate:tenant`
  - `npm run build`
  - `npm run test:routes:tier0`
  - `npm run ci:playwright`
  - `npm run verify:local`
- executed checks:
  - targeted `tests/admins/invite_flow.spec.ts`: pass, 27/27
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run build`: pass
  - `npm run validate:tenant`: pass
  - `git diff --check`: pass
  - stacked-branch targeted `tests/admins/invite_flow.spec.ts`: pass, 27/27
  - base policy PR `#879`: all live required checks pass, including policy, unit tests, build, Tier-0, auth browser smoke, tenant safety, and the final CI gate
  - code-review-engineer: approve, no required fixes
  - security-engineer: approve, no authz, tenant, or business-logic drift
- blocked checks:
  - the earlier `npm run verify:local` policy blocker is resolved on the stacked base by PR `#879`; the complete composite command has not yet been rerun on this stacked branch
  - `npm run ci:playwright`: blocked in preflight because the required Playwright admin or super-admin test credentials are unavailable
  - `npm run ci:verify-coverage`: blocked because the composite run stopped before producing `coverage/coverage-summary.json`; no coverage-threshold regression was reported
  - `npm run test:ci`: inconclusive after two runs emitted only passing assertions, including the WIN-265 invite coverage, but exited without a final Vitest summary or recoverable exit code
  - `npm run test:routes:tier0`: bounded timeout after the preview server and Cypress launched but before a spec result was emitted
  - production invite issuance: Supabase Edge secrets `ADMIN_INVITE_EMAIL_URL` and `ADMIN_PORTAL_URL` are absent
  - production deployment: paused pending human review and the separate Netlify secret incident
- result: implementation complete and ready for a stacked human-review PR; production rollout still requires both critical PRs to merge

## Residual Risk

- production invite submission will continue to hide handler errors until the request-scoped CORS fix is merged and deployed
- invite creation remains blocked if the missing production mail config is not corrected separately
- the separate Netlify secret incident requires rotation and scope remediation outside this branch; no values are recorded here
- any broader CORS or runtime-config change would increase blast radius and should be re-routed before implementation

## PR And Review Requirements

- PR required before merge
- human review required because this is critical-lane work
- reviewer approval required before closure
- tester verification required before closure
- do not merge until the branch carries the bounded request-scoped CORS fix and the invite-flow regression coverage
- keep the change reviewable and isolated from the separate secret incident

## PR Hygiene Verdict

- pr-ready: yes, as a stacked PR based on `codex/win-270-api-exception-renewal`
- lane: critical
- branch-ready: yes, `codex/win-265-admin-invite-cors-stacked`
- linear-ready: yes, `WIN-265`
- single-purpose: yes
- unrelated changes: none
- generated artifact drift: none
- protected-path drift: none; the Supabase function path is correctly routed as critical
- change summary: present
- verification summary: present, including blocked and inconclusive checks
- reviewer: completed and approved
- security review: completed and approved
- required follow-up: open the stacked PR against policy PR `#879`, obtain human review for both critical changes, merge `#879` first, retarget this PR to `main`, rerun live checks, resolve the separate production configuration and secret-remediation blockers, then deploy and re-run the invite lifecycle
