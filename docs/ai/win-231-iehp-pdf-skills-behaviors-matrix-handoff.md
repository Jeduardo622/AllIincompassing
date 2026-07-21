# WIN-231 IEHP PDF Skills & Behaviors Matrix Handoff

- Date: July 21, 2026
- Linear: `WIN-231`
- Branch: `codex/win-231-iehp-pdf-skills-behaviors-matrix`
- Classification: `low-risk autonomous`
- Lane: `standard`
- Triggering paths: `scripts/playwright-iehp-assessment-import-smoke.ts`, its focused structure test, and this handoff
- Required agents: `specification-engineer` -> `implementation-engineer` -> `code-review-engineer` -> `test-engineer`

## Route-task Card

- classification: `low-risk autonomous`
- lane: `standard`
- rationale: non-sensitive browser smoke-runner and focused-test changes outside protected paths
- allowed files: `scripts/playwright-iehp-assessment-import-smoke.ts`, the narrowest `tests/scripts/**` test, and one `docs/ai/**` handoff
- stop conditions: any parser, server/API, Supabase, workflow, auth, credential, migration, package-command, production-data, OCR, scanned-PDF, or rotation change

## Scope

- Reuse the existing deterministic Skills & Behaviors PDF proof as one fourth case in the on-demand IEHP PDF mini-matrix.
- Preserve the three existing phone/referral cases, the standalone Skills & Behaviors command, extracted status, zero drafts, per-upload cleanup, and synthetic-admin cleanup.
- Report and fail closed unless exactly one matrix case returns Skills & Behaviors proof evidence.

## Non-goals

- No parser, extraction field, reconciliation, API/server, Supabase, workflow, auth, credential, migration, package-command, OCR, scanned-PDF, or rotation changes.
- No PHI, production data, or real phone values.

## Test-first Evidence

- RED 1: the focused regression could not find a reusable `runSkillsBehaviorsProofCase` or a matrix invocation.
- RED 2: after reuse was introduced, the focused regression rejected a hardcoded Skills & Behaviors aggregate count.
- GREEN: the runner computes the verified-case count from returned case evidence, requires exactly one, and the focused structure suite passes `6/6`.

## Verification Card

- classification: `low-risk autonomous`
- lane: `standard`
- change type: non-sensitive test harness and focused regression test
- required checks: focused script tests; `npm run ci:check-focused`; `npm run lint`; `npm run typecheck`; `npm run test:ci`; `npm run build`; `npm run verify:local`; hosted `npm run playwright:iehp-assessment-import-pdf-mini-matrix` when credentials are available
- executed checks:
  - focused structure suite -> pass (`6/6`)
  - `npx vitest run tests/scripts/iehp-assessment-import-smoke.test.ts` -> pass (`25/25`)
  - full focused runner file -> `39/40` pass; only the unchanged Windows CRLF-sensitive `supabase/config.toml` assertion failed
  - `npm run ci:check-focused` -> pass; environment-dependent DB, branch-protection, and auth-parity probes skipped as reported by the command
  - `npm run lint` -> pass
  - `npm run typecheck` -> pass
  - `npm run test:ci` -> `3093` pass / `3` unrelated baseline failures: BCBA workflow expectation, Windows CRLF-sensitive IEHP config assertion, and Windows `Blob.text()` runtime behavior
  - `npm run build` -> pass
  - `npm run verify:local` -> policy, lint, and typecheck passed; stopped at the same three unrelated `test:ci` failures, so its downstream coverage/build/tier-0 stages did not run
- blocked checks:
  - hosted `npm run playwright:iehp-assessment-import-pdf-mini-matrix` -> required Playwright/Supabase credentials are absent from the current process; no credentials or workflow were changed
- result: `pass-with-blocked-checks`
- residual risk: local structure proof cannot replace the authenticated hosted four-upload extraction and cleanup proof; unrelated Windows baselines keep the aggregate local gate red

## Review and PR Hygiene

- `test-engineer`: approve; three directly affected focused cases passed, with hosted proof remaining the decisive blocked check
- `code-review-engineer`: approve; no correctness, regression, or protected-path defect found
- `pr-ready`: yes; branch, Linear linkage, route card, verification card, focused review, and PR summary are ready
- `branch-ready`: yes
- `linear-ready`: yes (`WIN-231`)
- `single-purpose`: yes
- `unrelated changes`: none
- `generated artifact drift`: none
- `protected-path drift`: none
- `change summary`: present
- `verification summary`: present
- `pr handoff`: ready; add the created PR URL and live checks after push
- `reviewer`: completed
- `required follow-up`: run the authenticated four-case hosted matrix when credentials are available and resolve only slice-related PR failures

## Handoff

- PR and live-check evidence will be added after verification, review, push, and PR creation.
