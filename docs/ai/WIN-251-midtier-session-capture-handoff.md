# WIN-251 Mid Tier Session Capture Handoff

## Routing

- classification: `high-risk human-reviewed`
- lane: `critical`
- why: session-note API authority routing is a protected server boundary.
- triggering paths: `src/server/api/**`

## Scope

- task intent: allow exact Mid Tier session capture without widening exact-BT assignment authority.
- files touched: one handler, its focused test, this handoff.
- single-purpose diff: yes

## Required Agents

- agents used: software architect, implementation engineer, code review engineer, security engineer.
- reviewer: completed; approved after a BCBA-ordering regression was fixed.

## Verification Card

- required checks: focused handler suite, policy checks, tenant safety, build, full CI and route gates.
- executed checks:
  - focused session-notes handler suite: pass, 68 tests.
  - `npm run ci:check-focused`: pass.
  - `npm run validate:tenant`: pass.
  - `npm run build`: pass.
- blocked checks:
  - `npm run test:ci`: exceeded the bounded 300-second local window while external-provider tests attempted unavailable network services.
  - DB-backed policy checks: `SUPABASE_DB_URL` is unavailable locally.
- result: pass-with-blocked-checks
- residual risk: CI and deployed exact Mid Tier capture must be observed before live closure.

## PR Hygiene

- branch-ready: yes
- linear-ready: blocked by expired Linear OAuth grant; issue `WIN-251` exists.
- protected-path drift: only the declared handler.
- unrelated changes: none.
- generated artifact drift: none.
- verification summary: present.
- pr-ready: yes, human review required before merge.

## Handoff Summary

The handler now probes exact Mid Tier capability only after established BCBA authority and before the exact-BT assignment path. This preserves BCBA behavior and BT assignment limits while routing Mid Tier capture correctly; focused tests, policy, tenant safety, and build passed.
