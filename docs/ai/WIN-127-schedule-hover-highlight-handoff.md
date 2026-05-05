# WIN-127 Schedule Appointment Hover Highlight Handoff

## Routing

- classification: `low-risk autonomous`
- lane: `standard`
- why: bounded non-trivial schedule UI behavior and frontend test-stability work, limited to existing React page components and component tests, with no auth, server/API, runtime config, database, CI, or deploy-path changes
- triggering paths:
  - `src/pages/ScheduleCalendarViewShared.tsx`
  - `src/pages/ScheduleDayView.tsx`
  - `src/pages/ScheduleWeekView.tsx`
  - `src/pages/__tests__/ScheduleDayView.dragDrop.test.tsx`
  - `src/pages/__tests__/ScheduleWeekView.dragDrop.test.tsx`
  - `src/pages/__tests__/Schedule.sessionCloseReadiness.test.tsx`
  - `src/components/__tests__/ProgramsGoalsTab.test.tsx`

## Scope

- task intent: make appointment hover and focus states show concise timing context and visually highlight the full visible appointment duration in the schedule grid, then restore full local verification by fixing the interfering frontend tests uncovered by the verification run
- files touched:
  - `src/pages/ScheduleCalendarViewShared.tsx`
  - `src/pages/ScheduleDayView.tsx`
  - `src/pages/ScheduleWeekView.tsx`
  - `src/pages/__tests__/ScheduleDayView.dragDrop.test.tsx`
  - `src/pages/__tests__/ScheduleWeekView.dragDrop.test.tsx`
  - `src/pages/__tests__/Schedule.sessionCloseReadiness.test.tsx`
  - `src/components/__tests__/ProgramsGoalsTab.test.tsx`
  - `docs/ai/WIN-127-schedule-hover-highlight-handoff.md`
- single-purpose diff: yes

## Required Agents

- required sequence:
  - `specification-engineer`
  - `implementation-engineer`
  - `code-review-engineer`
  - `test-engineer`
- agents used:
  - `ui-hardener` for hover/focus resilience, accessible notice wiring, and display safety
  - `tester` for minimum regression coverage selection
  - `reviewer` for final diff review and protected-path/regression checks
- reviewer: completed

## Verification Card

- required checks:
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npx vitest run src/pages/__tests__/ScheduleDayView.dragDrop.test.tsx src/pages/__tests__/ScheduleWeekView.dragDrop.test.tsx`
  - `npx vitest run src/pages/__tests__/Schedule.sessionCloseReadiness.test.tsx`
  - `npx vitest run src/components/__tests__/ProgramsGoalsTab.test.tsx --reporter=verbose`
  - `npm run test:ci`
  - `npm run build`
  - `npm run verify:local`
- executed checks:
  - `npm run ci:check-focused`: pass
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npx vitest run src/pages/__tests__/ScheduleDayView.dragDrop.test.tsx src/pages/__tests__/ScheduleWeekView.dragDrop.test.tsx`: pass
  - `npx vitest run src/pages/__tests__/Schedule.sessionCloseReadiness.test.tsx`: pass
  - `npx vitest run src/components/__tests__/ProgramsGoalsTab.test.tsx --reporter=verbose`: pass
  - `npm run test:ci`: pass
  - `npm run build`: pass
  - `npm run verify:local`: pass
- blocked checks:
  - none
- result: pass
- residual risk: schedule highlight coverage is focused on current day/week slot rendering paths, so any future virtualization or alternate schedule layouts would need their own preview-state wiring and tests

## PR Hygiene

- branch-ready: yes
- linear-ready: yes
- protected-path drift: none
- unrelated changes: none in the PR diff; unrelated local edits were stashed before branch publication
- generated artifact drift: none
- verification summary: present
- pr-ready: yes
- required follow-up:
  - open the PR against `main`
  - wait for required GitHub checks
  - merge when branch protection allows

## Handoff Summary

This slice adds a hover and focus timing notice for schedule appointments and paints the full visible appointment duration across the day and week grids so the entire span is obvious, not just the card body. It also hardens the two frontend tests that were blocking full local verification, allowing `npm run test:ci` and `npm run verify:local` to pass. Residual risk is limited to future schedule render paths that do not yet share this preview-state wiring.
