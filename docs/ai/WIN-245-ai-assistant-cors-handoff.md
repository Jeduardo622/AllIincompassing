# WIN-245 AI Assistant CORS Handoff

## Routing

- classification: high-risk human-reviewed
- lane: critical
- issue: WIN-245
- triggering path: `supabase/functions/ai-agent-optimized/index.ts`
- tenant boundary: unchanged; authenticated user and organization resolution still occur after preflight
- scope: align the function's browser CORS headers with the existing shared helper while preserving its `POST, OPTIONS` method contract
- non-goals: no client, auth, tenant query, AI prompt/tool, persistence, shared CORS policy, secret, or deploy-config changes
- stop condition: any fix requiring shared policy changes or changes outside the function and focused contract

## Live Evidence

Chrome DevTools reproduced the production BCBA Assistant failure on the Fill Docs route. The browser blocked the `ai-agent-optimized` preflight because the client sends `x-request-id`, but the function allowed only `Content-Type, Authorization`. The same client request also sends `apikey` and `x-correlation-id`.

## Changed Surfaces

- Use `corsHeadersForRequest(req)` for request-scoped origin and allowed-header handling
- Preserve the function-specific `POST, OPTIONS` method contract
- Add a focused contract for helper consumption and the complete browser caller header set

## Verification Card

- required checks:
  - focused CORS and client-header tests
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run validate:tenant`
  - `npm run build`
  - `npm run verify:local`
  - `npm run test:routes:tier0`
  - `npm run ci:playwright`
  - Supabase preview deployment and hosted browser preflight proof
- executed checks:
  - focused Vitest, 12 tests including runtime `OPTIONS` handler execution: pass
  - `npm run ci:check-focused`: pass
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run validate:tenant`: pass
  - `npm run build`: pass
  - `npm run test:routes:tier0`: pass, 220 tests
- blocked checks:
  - `npm run test:ci`: blocked by four unrelated baseline failures, including the existing async PDF Blob mock, stale BT browser-proof workflow contract, and synthetic BCBA provisioning key expectation
  - `npm run verify:local`: reached and failed at the same unrelated `test:ci` baseline after policy, lint, and typecheck passed
  - `npm run ci:playwright`: requires protected browser credentials; defer to CI
- pending checks:
  - Supabase preview deployment and hosted browser preflight proof
- result: pass with blocked local full-suite checks; pending critical-lane hosted verification
- residual risk: static contracts cannot prove the deployed Edge preflight; hosted browser evidence is required before merge

## Review

- specification-engineer: approved the bounded function-and-contract scope
- software-architect: approved with the `POST, OPTIONS` containment requirement
- implementation-engineer: approved the implemented diff with no defect
- code-review-engineer: approved after executable `OPTIONS` coverage and verification-card corrections
- test-engineer: local contract coverage is sufficient but hosted proof remains mandatory
- security-engineer: approved; auth and tenant boundaries are unchanged
- supabase-reviewer: approved for human review; hosted Edge proof remains mandatory before merge
- human review: mandatory before merge

## PR Hygiene

- pr-ready: yes, for human review and hosted Edge verification
- branch: `codex/win-245-ai-cors`
- linear: WIN-245
- unrelated changes: none
- protected-path drift: none beyond the routed Edge function
- merge: prohibited until hosted preflight proof and human review are complete
