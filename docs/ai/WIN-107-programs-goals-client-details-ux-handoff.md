# WIN-107 Programs & Goals Client Details UX Handoff

## Routing

- classification: `low-risk autonomous`
- lane: `standard`
- why: bounded non-trivial UI/page behavior change inside Client Details and Programs & Goals, with no auth/session, server, runtime config, database, CI, or deploy-path changes
- triggering paths:
  - `src/pages/ClientDetails.tsx`
  - `src/components/ClientDetails/ProgramsGoalsTab.tsx`
  - `src/pages/__tests__/ClientDetails.test.tsx`
  - `src/components/__tests__/ProgramsGoalsTab.test.tsx`

## Scope

- task intent: fix the Programs & Goals tab so `/clients/:clientId?tab=programs-goals` deep-links correctly, the tab stays usable while programs load, and the no-program / required-field UX is explicit
- files touched:
  - `src/pages/ClientDetails.tsx`
  - `src/components/ClientDetails/ProgramsGoalsTab.tsx`
  - `src/pages/__tests__/ClientDetails.test.tsx`
  - `src/components/__tests__/ProgramsGoalsTab.test.tsx`
- single-purpose diff: yes

## Required Agents

- required sequence:
  - `specification-engineer`
  - `implementation-engineer`
  - `code-review-engineer`
  - `test-engineer`
- agents used:
  - `ui-hardener` for empty/loading/disabled/deep-link UX review
  - `tester` for minimum regression coverage selection
  - `reviewer` requested for final diff review
- reviewer: completed

## Verification Card

- required checks:
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm test -- --run src/components/__tests__/ProgramsGoalsTab.test.tsx src/pages/__tests__/ClientDetails.test.tsx`
  - `npm run test:ci`
  - `npm run test:routes:tier0`
  - `npm run ci:playwright`
  - `npm run build`
  - `npm run verify:local`
- executed checks:
  - `npm run ci:check-focused`: pass
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm test -- --run src/components/__tests__/ProgramsGoalsTab.test.tsx src/pages/__tests__/ClientDetails.test.tsx`: pass
  - `npm run build`: pass
  - `npm run test:ci`: fail
  - `npm run test:routes:tier0`: fail
  - `npm run verify:local`: fail
- blocked checks:
  - `npm run ci:playwright`: local run timed out after 5 minutes without a usable result
- result: fail
- residual risk: the shipped slice is covered by targeted tests for deep-linking, loading, create-while-loading, and disabled-state UX, but repo-wide Schedule regressions and local browser-gate instability prevented a fully green verification card

## PR Hygiene

- branch-ready: yes
- linear-ready: yes
- protected-path drift: none
- unrelated changes: none
- generated artifact drift: none
- verification summary: present
- pr-ready: no
- required follow-up:
  - review and resolve repo-wide `Schedule.sessionCloseReadiness` failures before merge
  - stabilize or triage local `npm run test:routes:tier0` Cypress `EPIPE` failure
  - rerun `npm run ci:playwright` with a usable local/CI browser environment

## Handoff Summary

This slice keeps the Programs & Goals tab usable while programs are loading, adds explicit no-program guidance for goals and notes, makes required goal fields obvious, and honors `?tab=programs-goals` on Client Details. Focused Programs & Goals and Client Details tests pass, along with policy checks, lint, typecheck, and build. Repo-wide verification is not green because unrelated Schedule tests fail in `test:ci`, the tier-0 route suite crashes locally with Cypress `EPIPE`, and local Playwright coverage did not complete within the timeout.
