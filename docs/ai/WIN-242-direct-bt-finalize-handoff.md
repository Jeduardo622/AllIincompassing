# WIN-242 Direct BT Finalize Handoff

## Routing

- classification: `low-risk autonomous`
- lane: `standard`
- why: the implementation is contained to frontend orchestration and tests while preserving the existing server, authorization, tenant, signature, and progression contracts
- triggering paths: `src/components/SessionModal.tsx`, `src/components/__tests__/SessionModal.test.tsx`
- branch: `codex/win-242-direct-bt-finalize`
- Linear: `WIN-242`

## Scope

- task intent: make direct BT ABA finalization persist the template-backed draft before calling the existing finalize API
- files touched: `src/components/SessionModal.tsx`, targeted component tests, this handoff
- non-goals: no RPC, migration, RLS, grant, billing-policy, assignment-policy, or unrelated audit-finding changes
- stop condition: re-route before touching `src/server/**` or `supabase/**`
- single-purpose diff: yes

## Live Reproduction

- synthetic client: `QA Workflow07232026`
- session: `862ded50-9b5c-4411-bdf6-3e3439c7c79d`
- note: `36d9d14c-5da3-4739-b34c-bbc3c222a8ac`
- failure: direct Finalize returned `403 Forbidden`; Postgres logged `BT ABA template is out of scope`
- root cause: the existing note had `bt_aba_template_id = NULL`; the read RPC still returned the active template as a fallback alongside the generic note ID
- workaround proof: Save Draft attached template `ce4213af-4c00-4a25-a681-9ae6cf11b9e8`; the next Finalize completed and locked the note
- evidence: `.tmp/live-audit-evidence-2026-07-23/05-session-finalize-forbidden.png` and `06-session-completed.png`

## Required Agents

- required sequence: specification-engineer, implementation-engineer, code-review-engineer, test-engineer
- agents used: specification-engineer, software-architect, implementation-engineer, code-review-engineer, test-engineer
- reviewer: completed with no findings after the fallback-template read contract was clarified

## Verification Card

- required checks:
  - targeted `SessionModal` tests
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run test:routes:tier0`
  - `npm run ci:playwright`
  - `npm run build`
  - `npm run verify:local`
- executed checks:
  - targeted `SessionModal` tests: pass, 107/107
  - `npm run ci:check-focused`: pass via direct bundled-Node invocation
  - `npm run lint`: pass via direct bundled-Node invocation
  - `npm run typecheck`: pass via direct bundled-Node invocation
  - `npm run test:ci`: fail on four unrelated baseline tests; the WIN-242 suite passed within the run
  - `npm run test:routes:tier0`: pass, 220/220
  - `npm run ci:playwright`: preflight passed; auth smoke failed because the configured `superadmin@test.com` credential was rejected
  - `npm run build`: pass
- blocked checks:
  - `npm run verify:local`: blocked by the same unrelated `test:ci` baseline failures
  - remaining `npm run ci:playwright` children: blocked after the auth smoke stopped the fail-fast runner
- result: `pass-with-blocked-checks`
- residual risk: the live QA also found schedule/finalize assignment inconsistency and a zero-data-point closeout preview; both remain separate follow-up slices

## PR Hygiene

- branch-ready: yes
- linear-ready: yes
- protected-path drift: none
- unrelated changes: pre-existing untracked `.superpowers/brainstorm/`, `.tmp/`, `pnpm-lock.yaml`, and `pnpm-workspace.yaml` are excluded
- generated artifact drift: none
- verification summary: present
- pr-ready: yes
- required follow-up: push the isolated branch, open the human-reviewed PR, and rely on CI for the credential-backed Playwright rerun
