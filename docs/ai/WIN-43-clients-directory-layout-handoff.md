# WIN-43 Clients Directory Layout Handoff

## Routing

- classification: `low-risk autonomous`
- lane: `standard`
- why: bounded visible page repair outside protected production paths
- triggering paths: `src/pages/Clients.tsx`, `src/pages/__tests__/Clients.test.tsx`

## Scope

- task intent: keep the Clients UNITS summary readable and make the mobile search/filter controls at least 44 px tall
- files touched: `src/pages/Clients.tsx`, its focused test, and this required handoff
- single-purpose diff: yes

## Required Agents

- required sequence: specification-engineer, implementation-engineer, code-review-engineer, test-engineer
- agents used: specification-engineer, implementation-engineer, test-engineer; final code review pending
- reviewer: pending

## Verification Card

- required checks:
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npx vitest run src/pages/__tests__/Clients.test.tsx`
  - `npm run test:ci`
  - `npm run build`
  - `npm run verify:local`
  - `npm run test:ui:responsive -- --base-url=http://127.0.0.1:<port> --route=/clients --scenario=clients-directory`
- executed checks:
  - `npx vitest run src/pages/__tests__/Clients.test.tsx`: pass, 10/10
- blocked checks:
  - remaining standard and responsive checks: pending stacked branch with PR #995 observer prerequisite
- result: fail
- residual risk: real desktop/mobile layout and broad verification remain unproven

## PR Hygiene

- branch-ready: yes
- linear-ready: yes; tracked under WIN-43 because the workspace issue limit blocks a dedicated issue
- protected-path drift: none
- unrelated changes: none
- generated artifact drift: none
- verification summary: present
- pr-ready: no
- required follow-up: stack on PR #995, run the responsive scenario, complete broad checks and review, then push a draft PR

## Handoff Summary

This branch keeps the Clients UNITS column from collapsing and adds a 44 px minimum height to the search input and four filters. Focused page tests pass 10/10. Responsive and broad verification remain pending until the branch is stacked on the observer prerequisite from PR #995.
