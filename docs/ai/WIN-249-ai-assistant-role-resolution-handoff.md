# WIN-249 AI Assistant Role Resolution Handoff

## Route

- classification: `high-risk human-reviewed`
- lane: `critical`
- triggering paths:
  - `supabase/functions/ai-agent-optimized/**`
- risk rationale:
  - protected Supabase Edge Function
  - role-based assistant tool authorization
  - organization-scoped authorization
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

- Resolve the AI agent actor role from active, authoritative, organization-scoped role checks.
- Preserve role precedence as `super_admin > bcba > admin > therapist > client`.
- Preserve BCBA identity in traces while granting the same current assistant tools as admin.
- Fail closed to `client` when an authoritative role check fails.

Non-goals:

- No provider key, secret, billing, migration, RLS, grant, or deployment changes.
- No changes to OpenAI request, retry, or fallback behavior.
- No changes to client-side routing or role resolution.

Stop conditions:

- Stop if the fix requires schema, RPC, shared auth, or deployment changes.
- Keep the OpenAI quota outage separate from this role-authorization fix.

## Live Evidence

- Production route: `https://app.allincompassing.ai/schedule`
- Actor: audited BCBA account
- Hosted function: `ai-agent-optimized` version 22
- Live trace before fix:
  - actor role: `client`
  - upstream result: OpenAI `429` quota exceeded
  - function response: HTTP 200 with a technical-difficulties message
- Hosted account state:
  - active authoritative roles include `admin` and `bcba`
  - the prior function used the unscoped `get_user_roles` payload incorrectly
- Screenshot:
  - `.tmp/live-bcba-route-audit-2026-07-23/70-production-bcba-chat-assistant-failure-confirmed.jpg`

The OpenAI quota failure remains an external operational blocker. This slice fixes the independently confirmed role downgrade and does not claim to restore generated assistant responses.

## Verification Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type:
  - auth/role handling
  - Supabase Edge integration
  - tenant/org-scoped authorization
- required checks:
  - focused role/CORS/guardrail tests
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run validate:tenant`
  - `npm run build`
  - `npm run test:routes:tier0`
  - `npm run ci:playwright`
- executed checks:
  - focused role/CORS/guardrail tests: pass, 18 tests
  - final focused role test: pass, 5 tests
  - `npm run ci:check-focused`: pass
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run validate:tenant`: pass
  - `npm run build`: pass
  - `npm run test:routes:tier0`: pass, 220 tests
  - `npm run test:ci`: fail in three reproducible unrelated tests from untouched files
  - `npm run ci:playwright`: blocked at preflight
- blocked checks:
  - `npm run test:ci`: existing failures in `src/lib/__tests__/supabase.edge.test.ts`, `tests/workflows/bt-aba-disposable-browser-proof.test.ts`, and `tests/ci/check-e2e-reliability-gates.test.ts`; this branch does not modify their source or fixtures
  - `npm run ci:playwright`: missing local `PW_SUPERADMIN_*` or `PW_ADMIN_*` credentials
  - `npm run verify:local`: blocked by the same `test:ci` failures and Playwright credential prerequisite
- result: `pass-with-blocked-checks`
- residual risk:
  - hosted role behavior is not fixed until the protected Edge Function change is reviewed, merged, and deployed
  - generated assistant responses remain blocked by the production OpenAI quota

## PR Hygiene

- pr-ready: yes for critical-lane human review; merge remains gated on required CI and human approval
- lane: `critical`
- branch-ready: yes
- linear-ready: yes
- single-purpose: yes
- unrelated changes: none
- generated artifact drift: none
- protected-path drift: none outside the routed function
- change summary: present
- verification summary: present
- reviewer: implementation, security, Supabase, and code reviews completed with no remaining findings
- required follow-up:
  - push and open a human-reviewed PR
  - rely on secret-backed CI for the Playwright gate
  - deploy only after required human approval and green required checks
  - rerun the live BCBA Chat Assistant proof after quota restoration
