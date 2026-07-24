# WIN-251 Messaging Recipient Error-State Handoff

## Routing

- classification: `low-risk autonomous`
- lane: `standard`
- why: bounded page-state and test changes; no auth, server, schema, or tenant-boundary modification.

## Scope

- task intent: distinguish recipient loading, empty, and backend failure states and provide retry.
- files touched: messaging compose page, page tests, this handoff.
- single-purpose diff: yes

## Verification Card

- executed checks:
  - focused `MessagesNew` tests: pass.
  - `npm run ci:check-focused`: pass.
  - `npm run lint`: pass.
  - `npm run typecheck`: pass.
  - `npm run build`: pass.
- blocked checks:
  - `npm run verify:local`: repo-wide `test:ci` failed in unrelated `tests/workflows/bt-aba-disposable-browser-proof.test.ts`.
- result: pass-with-blocked-checks
- residual risk: the retry UI requires live proof after the paired RPC migration deploys.

## PR Hygiene

- branch-ready: yes
- linear-ready: blocked by expired Linear OAuth grant; issue `WIN-251` exists.
- protected-path drift: none.
- unrelated changes: none.
- generated artifact drift: none.
- verification summary: present.
- pr-ready: yes.

## Handoff Summary

The compose page now renders an explicit retryable failure state instead of masking a recipient RPC error as an empty organization. Focused UI tests, policy, lint, typecheck, and build passed.
