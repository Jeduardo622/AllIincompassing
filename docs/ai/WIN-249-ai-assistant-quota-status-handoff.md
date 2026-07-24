# WIN-249 AI Assistant Quota Status Handoff

## Route

- classification: `high-risk human-reviewed`
- lane: `critical`
- triggering paths:
  - `supabase/functions/ai-agent-optimized/index.ts`
- risk rationale:
  - protected Supabase Edge Function
  - app-to-edge HTTP contract
- required agents:
  - `specification-engineer`
  - `software-architect`
  - `implementation-engineer`
  - `code-review-engineer`
  - `test-engineer`
  - `security-engineer`
  - `supabase-reviewer`
- human review required: yes
- linear: [WIN-249](https://linear.app/winningedgeai/issue/WIN-249/fix-ai-assistant-role-downgrade-and-surface-upstream-quota-failures)

## Scope

- Detect only OpenAI `429` errors identified as `insufficient_quota`.
- Return the existing `upstream_unavailable` error envelope with HTTP 503.
- Preserve CORS, request ID, correlation ID, and no-store headers.
- Prove the production browser client degrades safely after the optimized endpoint retries.

Non-goals:

- No secret, provider key, billing, provider selection, or retry-policy changes.
- No auth, role, tool, persistence, migration, RLS, grant, or tenant-scope changes.
- No legacy `process-message` deployment or behavior changes.

Stop conditions:

- Stop if the provider error cannot be distinguished from a generic 429.
- Stop if the fix requires shared error taxonomy, auth, tenant, or secret changes.

## Live Evidence

- Production route: `https://app.allincompassing.ai/schedule`
- Hosted function: `ai-agent-optimized` version 23 with `verify_jwt=true`
- Fresh request/correlation ID: `a5040b7c-03e4-4385-9003-b6429e6b66c6`
- Trace role: `bcba`
- Provider failure: OpenAI `429`, code/type `insufficient_quota`
- Provider request ID: `req_48ff46f705af4a4ca80b8f1c3769bb95`
- Current hosted response: HTTP 200 with a generic technical-difficulties assistant payload
- Screenshots:
  - `.tmp/live-bcba-route-audit-2026-07-23/72-bcba-assistant-fresh-retry-failed.png`
  - `.tmp/live-bcba-route-audit-2026-07-23/73-bcba-assistant-fresh-retry-quota-log.png`

Restoring generated Assistant responses still requires an account-level OpenAI
quota or key operation. This code slice makes the transport contract honest but
does not claim to restore provider availability.

## Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- required checks:
  - focused edge and caller tests
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run validate:tenant`
  - `npm run build`
  - `npm run test:routes:tier0`
  - secret-backed CI browser checks
- executed checks:
  - focused edge and caller tests: pass, 19 tests
  - `npm run ci:check-focused`: pass
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run validate:tenant`: pass
  - `npm run build`: pass
  - `npm run test:routes:tier0`: pass, 220 tests
  - `npm run test:ci`: fail in four unrelated baseline tests from untouched files
  - `npm run verify:local`: fail at `npm run test:ci` on the same four
    unrelated baseline tests; policy, lint, and typecheck passed before the stop
- blocked or failing checks:
  - `tests/ci/check-e2e-reliability-gates.test.ts`: expected workflow secret text is absent
  - `tests/scripts/playwright-iehp-assessment-import-smoke.test.ts`: expected function config text is absent
  - `tests/workflows/bt-aba-disposable-browser-proof.test.ts`: expected branch-specific workflow text is absent
  - `src/lib/__tests__/supabase.edge.test.ts`: local Blob implementation has no `text()` method
  - local secret-backed Playwright: requires CI credentials
- result: `fail`
- residual risk:
  - HTTP 503 behavior is not live until human review, merge, and governed deployment
  - successful Assistant-response proof remains blocked by external OpenAI quota

## Reviews

- specification: complete
- architecture: approved
- implementation: approved
- code review: approved after production caller coverage
- security review: approved, no findings
- Supabase review: approved, no tenant or JWT changes
- test review: focused contract covers the reproduced provider error shape

## PR Hygiene

- pr-ready: yes, subject to required CI and human review
- lane: `critical`
- branch-ready: yes, `codex/win-249-ai-assistant-quota-status`
- linear-ready: yes, WIN-249 is In Review
- single-purpose: yes
- unrelated changes: none
- generated artifact drift: none
- protected-path drift: none beyond the routed Edge Function
- change summary: present
- verification summary: present
- pr handoff: ready after rebasing onto current `origin/main`
- reviewer: completed
- required follow-up:
  - rebase onto current `origin/main`
  - require green branch CI and human review
  - verify governed deployment retains `verify_jwt=true`
  - repeat the live BCBA Assistant request with Computer
