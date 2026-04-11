# WIN-89 Shell Chat Lazy Handoff

## Routing

- classification: `low-risk autonomous`
- lane: `standard`
- why: non-trivial authenticated-shell component work limited to `src/components/**` without crossing auth, runtime-config, server, tenant, or CI-policy boundaries
- triggering paths:
  - `src/components/Sidebar.tsx`
  - `src/components/ChatBot.tsx`
  - `src/components/__tests__/SidebarNavigation.test.tsx`

## Scope

- task intent: defer chat assistant code from the base authenticated shell until the user explicitly opens chat, while preserving the existing chat experience after first open
- files touched:
  - `src/components/Sidebar.tsx`
  - `src/components/ChatBot.tsx`
  - `src/components/__tests__/SidebarNavigation.test.tsx`
- single-purpose diff: yes

## Required Agents

- required sequence:
  - `specification-engineer`
  - `implementation-engineer`
  - `code-review-engineer`
  - `test-engineer`
- agents used:
  - `tester` (`Curie`) for minimum-sufficient verification planning
  - `worker` (`Sagan`) for the initial implementation pass in the isolated worktree
  - `reviewer` (`Ptolemy`) for final diff review
- reviewer: completed

## Verification Card

- required checks:
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm test -- src/components/__tests__/SidebarNavigation.test.tsx src/components/__tests__/ChatBot.test.tsx src/components/__tests__/LayoutSuspense.test.tsx`
  - `npm run test:ci`
  - `npm run build`
  - `npm run verify:local`
- executed checks:
  - `npm test -- src/components/__tests__/SidebarNavigation.test.tsx src/components/__tests__/ChatBot.test.tsx src/components/__tests__/LayoutSuspense.test.tsx`: pass
  - `npm run ci:check-focused`: pass via `npm run verify:local`
  - `npm run lint`: pass via `npm run verify:local`
  - `npm run typecheck`: pass via `npm run verify:local`
  - `npm run build`: pass
- blocked checks:
  - `npm run test:ci`: repo-wide unrelated timeout failures outside this diff (`ProgramsGoalsTab.test.tsx`, `SchedulingFlow.test.tsx`, `SessionModal.test.tsx`, `Login.recoveryRedirect.test.tsx`, `bookHandler.integration.test.ts`, `bookSession.test.ts`, `AdminSettings.test.tsx`) during `npm run verify:local`
  - `npm run verify:local`: halted at the unrelated `npm run test:ci` failures before reaching `ci:verify-coverage` and `test:routes:tier0`
- result: pass-with-blocked-checks
- residual risk: sidebar tests prove initial deferral and first open, but they do not explicitly assert close-and-reopen reuse; CI should confirm the unrelated repo-wide timeout set remains unchanged

## PR Hygiene

- branch-ready: yes
- linear-ready: yes
- protected-path drift: none
- unrelated changes: none
- generated artifact drift: none
- verification summary: present
- pr-ready: yes
- required follow-up:
  - confirm CI reproduces only the existing unrelated `test:ci` timeout failures, if any

## Handoff Summary

The authenticated shell now lazy-loads the chat assistant instead of pulling it into the base sidebar path. `ChatBot` gained a controlled-open interface so the sidebar can trigger first-load open cleanly, while keeping the prior standalone behavior intact. Focused sidebar/chat tests, policy checks, lint, typecheck, and build passed locally; the repo-wide `test:ci` segment inside `verify:local` failed on unrelated pre-existing timeout tests outside this slice.
