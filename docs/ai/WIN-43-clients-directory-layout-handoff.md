# WIN-43 Clients Directory Layout Handoff

## Routing

- classification: `low-risk autonomous`
- lane: `standard`
- why: bounded visible page repair outside protected production paths
- triggering paths: `src/pages/Clients.tsx`, `src/pages/__tests__/Clients.test.tsx`

## Scope

- task intent: keep the Clients UNITS summary readable and make visible mobile controls, including client-name links, at least 44 px in both dimensions
- files touched: `src/pages/Clients.tsx`, its focused test, and this required handoff
- single-purpose diff: yes

## Required Agents

- required sequence: specification-engineer, implementation-engineer, code-review-engineer, test-engineer
- agents used: specification-engineer, implementation-engineer, code-review-engineer, test-engineer
- reviewer: approved with no findings; independently reran the focused Clients suite at 10/10

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
  - `npm run ci:check-focused`: pass; database-dependent subchecks skipped because no database URL is configured
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npx vitest run src/pages/__tests__/Clients.test.tsx`: pass, 10/10
  - `npm run test:ci` with `NODE_OPTIONS=--max-old-space-size=6144`: 573 files and 5,159 tests passed; one unchanged provisioning-contract test failed and Vitest reported one `onTaskUpdate` timeout
  - `npx vitest run tests/scripts/provision-ci-smoke-bcba.test.ts`: reproduced the same unchanged failure, 21/22; implicated source and test have no diff from either `origin/main` or the stacked base
  - `npm run build`: pass
  - `npm run test:ui:responsive -- --base-url=http://127.0.0.1:4183 --route=/clients --scenario=clients-directory --artifact-run-id=clients-directory-layout-fix-v2`: pass at desktop `1440x900` and mobile `390x844`
- blocked checks:
  - `npm run test:ci`: blocked from a clean result by the deterministic unchanged failure in `tests/scripts/provision-ci-smoke-bcba.test.ts`; the isolated rerun reproduced it
  - `npm run verify:local`: not rerun because it includes the same failing `test:ci` gate and cannot produce a clean result until that inherited contract drift is repaired
- result: pass-with-blocked-checks
- residual risk: exact-head CI must confirm the slice after push; merge remains dependent on the responsive observer prerequisite and human review

### Responsive Evidence

- desktop screenshot: `artifacts/responsive-ui-observer/clients-directory-layout-fix-v2/route-fc61159bd2e09d4e8c0498e551c4fb44161c3bdadac0cff433c590640f6b62c1.desktop.1440x900.png`
- desktop card: `artifacts/responsive-ui-observer/clients-directory-layout-fix-v2/route-fc61159bd2e09d4e8c0498e551c4fb44161c3bdadac0cff433c590640f6b62c1.desktop.1440x900.json`
- mobile screenshot: `artifacts/responsive-ui-observer/clients-directory-layout-fix-v2/route-fc61159bd2e09d4e8c0498e551c4fb44161c3bdadac0cff433c590640f6b62c1.mobile.390x844.png`
- mobile card: `artifacts/responsive-ui-observer/clients-directory-layout-fix-v2/route-fc61159bd2e09d4e8c0498e551c4fb44161c3bdadac0cff433c590640f6b62c1.mobile.390x844.json`

## PR Hygiene

- branch-ready: yes
- linear-ready: yes; tracked under WIN-43 because the workspace issue limit blocks a dedicated issue
- protected-path drift: none
- unrelated changes: none
- generated artifact drift: none
- verification summary: present
- pr-ready: yes for a stacked draft PR; not merge-ready until exact-head checks and prerequisite PR #995 complete
- required follow-up: open the stacked draft PR, inspect exact-head checks, and keep merge blocked on prerequisite PR #995 and human review

## Handoff Summary

This branch keeps the Clients UNITS column from collapsing and gives the search input, four filters, and client-name links a 44 px minimum touch target. Focused page tests and both required responsive viewports pass. Broad verification is blocked only by one deterministic provisioning-contract failure in unchanged files; exact-head CI and the stacked prerequisite remain pending.
