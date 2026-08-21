# WIN-43 session browser failure repair

## Scope

- Classification: high-risk human-reviewed
- Lane: critical (PR #994 also contains a protected workflow change)
- Repair surface: shared Playwright Schedule modal helper and its unit contract
- Non-goals: application behavior, CI/workflow policy, timeout budgets, secrets, schema, and tenant authorization

## Failure evidence

GitHub Actions run `32453301542` stalled in the shared Schedule modal-opening path during both session measurement and ad-hoc capture coverage. The helper used three swallowed `page.waitForLoadState("networkidle")` waits with 30-second budgets while the live Schedule maintains realtime network traffic. Repeated period traversal could therefore consume most of the child timeout without establishing any additional UI readiness.

## Repair

Removed the three global network-idle waits. Existing exact readiness checks remain in place for Week view state, exact therapist/client filters, session-card visibility, and dialog visibility. A regression assertion now requires the shared helper to complete without calling `page.waitForLoadState`.

The first exact-head replay (`32487449522`) confirmed that the global-idle stall was removed: the gate exited in 21 minutes instead of being cancelled at the 35-minute ceiling. It then exposed a separate fixture-contention failure. The measurement child received five `409` conflicts across five distinct future rendered days on the same shared therapist/client pair, followed by seven rapid `502` responses from the booking edge. The helper now rotates to the next already-authorized target pair after five distinct-day conflicts instead of continuing to pressure the same stale pair. It does not broaden eligible actors, tenants, or fallback behavior.

## Verification card

- Classification: high-risk human-reviewed
- Lane: critical
- Change type: hosted auth/session browser harness
- Required checks: targeted helper and reliability tests; `npm run lint`; `npm run typecheck`; `npm run build`; `npm run ci:check-focused`; `npm run test:ci`; `npm run test:routes:tier0`; exact-head hosted `auth-browser-smoke`; `ci-gate`
- Executed checks: targeted modal/reliability suite, 64 passed; targeted pair-rotation/session suite, 55 passed; lint passed; typecheck passed; build passed; focused policy checks passed; tenant validation passed; Tier-0 browser suite, 250 passed; `git diff --check` passed
- Blocked checks: exact-head hosted `auth-browser-smoke` and `ci-gate` remain pending until the commit is pushed
- Local aggregate note: `npm run test:ci` first reached the default 4 GB Node heap limit. With an 8 GB heap it completed 5,150 passing tests and one unrelated Windows-only static source assertion failure in `tests/scripts/provision-ci-smoke-bcba.test.ts`; the assertion searches for LF-only source text while this checkout uses CRLF. The corresponding Linux PR unit job was green.
- Result: pass with hosted checks pending
- Residual risk: only another credentialed hosted replay can prove both the realtime Schedule stall and stale-pair collision pressure are resolved end to end

## Reviews

- Code review: approved with no findings
- Test review: no findings; hosted replay required
- Security review: approved; no auth, tenant, secret, fixture-cleanup, or protected-path widening

## PR hygiene

- PR: #994
- Branch: `codex/win-43-qa-operational-readiness`
- Linear: WIN-43
- Single purpose: yes; removes redundant global-idle waits from the common session modal opener
- Human action: do not merge until exact-head `auth-browser-smoke` and `ci-gate` are green
