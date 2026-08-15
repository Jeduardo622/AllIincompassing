# Payroll Super-Admin Route Gate Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align payroll route discovery, page access, and review-details loading with the authoritative payroll capabilities already returned for an authorized `super_admin`.

**Architecture:** Add one shared pure predicate for payroll review-route access and consume it everywhere the review route is gated. Extend the existing payroll-administration predicate to recognize export-only authority. Keep role guards, backend authorization, database grants, and `/time` unchanged.

**Tech Stack:** React 18, TypeScript, TanStack Query, Zod, Vitest, React Testing Library, Playwright.

## Global Constraints

- Classification is `high-risk human-reviewed`; lane is `critical`.
- Linear tracking is `WIN-219` because the workspace issue limit blocked a dedicated child issue.
- Branch is `codex/payroll-super-admin-route-gates` in the isolated worktree.
- Do not change `src/server/**`, `supabase/functions/**`, `supabase/migrations/**`, RLS, RPCs, Edge authority, capability grants, feature activation, or deployment configuration.
- Do not add a super-admin bypass or broaden access to other roles.
- `/time` remains employment-profile and `canViewSelf` gated.
- Missing, malformed, feature-disabled, and denied authoritative responses remain fail-closed.

---

### Task 1: Align payroll administration route access

**Files:**
- Modify: `src/features/payroll/__tests__/administrationApi.test.ts`
- Modify: `src/features/payroll/administrationApi.ts:257-265`

**Interfaces:**
- Consumes: `PayrollAdministrationCapabilities`
- Produces: `hasAnyPayrollAdministrationCapability(capabilities): boolean` where `canExportPeriod` is one valid capability

- [ ] **Step 1: Write the failing export-only regression**

Add a test that constructs every administration capability as `false` except `canExportPeriod: true` and expects `hasAnyPayrollAdministrationCapability` to return `true`. Retain a separate all-false expectation of `false`.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/payroll/__tests__/administrationApi.test.ts`

Expected: FAIL because the existing predicate omits `canExportPeriod`.

- [ ] **Step 3: Implement the minimal predicate change**

Add only this branch to the existing OR-chain:

```ts
|| capabilities.canExportPeriod
```

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/payroll/__tests__/administrationApi.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the self-contained change**

```powershell
git add -- src/features/payroll/administrationApi.ts src/features/payroll/__tests__/administrationApi.test.ts
git commit -m "fix(payroll): recognize export-only route access"
```

### Task 2: Define one authoritative review-route predicate

**Files:**
- Modify: `src/features/payroll/__tests__/api.test.ts`
- Modify: `src/features/payroll/api.ts:237-242`

**Interfaces:**
- Consumes: exported `PayrollReviewCapabilities`
- Produces: `hasPayrollReviewRouteAccess(capabilities: PayrollReviewCapabilities): boolean`

- [ ] **Step 1: Write failing predicate regressions**

Import `hasPayrollReviewRouteAccess` and assert `true` separately for `canReviewAssigned`, `canApproveAssigned`, and `hasOrgPayrollAccess`. Assert `false` when all three are false, regardless of `canViewCompensation`.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/payroll/__tests__/api.test.ts`

Expected: FAIL because the helper is not exported.

- [ ] **Step 3: Implement the pure helper**

Export the inferred capability type and helper next to the existing review schemas:

```ts
export type PayrollReviewCapabilities = z.infer<typeof payrollReviewCapabilitiesSchema>;

export const hasPayrollReviewRouteAccess = (
  capabilities: PayrollReviewCapabilities,
): boolean =>
  capabilities.canReviewAssigned
  || capabilities.canApproveAssigned
  || capabilities.hasOrgPayrollAccess;
```

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/payroll/__tests__/api.test.ts`

Expected: PASS.

### Task 3: Use the review predicate in query enablement

**Files:**
- Modify: `src/features/payroll/__tests__/usePayrollApprovals.test.tsx`
- Modify: `src/features/payroll/usePayrollApprovals.ts:82-96`

**Interfaces:**
- Consumes: `hasPayrollReviewRouteAccess`
- Produces: review-details query enablement for assigned-review or organization payroll authority

- [ ] **Step 1: Write the failing org-payroll details regression**

Render the hook with a matching selected snapshot, a queue response whose assigned-review booleans are false and `hasOrgPayrollAccess` is true, and assert the details fetch is enabled/called. Preserve the existing mismatch and capability-denied cases.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/payroll/__tests__/usePayrollApprovals.test.tsx`

Expected: FAIL because `detailsEnabled` ignores `hasOrgPayrollAccess`.

- [ ] **Step 3: Implement the minimal shared-helper use**

Import `hasPayrollReviewRouteAccess` from `./api` and replace the inline two-boolean expression in `detailsEnabled` with it.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/payroll/__tests__/usePayrollApprovals.test.tsx`

Expected: PASS.

### Task 4: Align Time Review navigation and page access

**Files:**
- Modify: `src/components/__tests__/SidebarNavigation.test.tsx`
- Modify: `src/components/Sidebar.tsx:84-100`
- Modify: `src/pages/__tests__/TimeReview.test.tsx`
- Modify: `src/pages/TimeReview.tsx:101-109`

**Interfaces:**
- Consumes: `hasPayrollReviewRouteAccess`
- Produces: consistent navigation and direct-route behavior for authoritative organization payroll access

- [ ] **Step 1: Write the failing sidebar super-admin regression**

Set `effectiveRole: "super_admin"` and return an authoritative queue with assigned-review booleans false and `hasOrgPayrollAccess: true`; assert the Time Review link is visible. Keep the all-false response hidden.

- [ ] **Step 2: Write the failing page regression**

Return an `ok` queue with `hasOrgPayrollAccess: true`, assigned-review booleans false, and an empty queue; assert the page renders the empty review state rather than the access-denied panel. Keep the all-false response denied.

- [ ] **Step 3: Verify RED**

Run: `npx vitest run src/components/__tests__/SidebarNavigation.test.tsx src/pages/__tests__/TimeReview.test.tsx`

Expected: both new regressions FAIL because the inline gates ignore organization payroll access.

- [ ] **Step 4: Implement shared-helper consumption**

Import `hasPayrollReviewRouteAccess` in both production files and replace their inline two-boolean gates. Do not change static role arrays or failure panels.

- [ ] **Step 5: Verify GREEN and the focused behavior set**

Run:

```powershell
npx vitest run src/features/payroll/__tests__/api.test.ts src/features/payroll/__tests__/usePayrollApprovals.test.tsx src/features/payroll/__tests__/administrationApi.test.ts src/components/__tests__/SidebarNavigation.test.tsx src/pages/__tests__/TimeReview.test.tsx src/pages/__tests__/Payroll.test.tsx
```

Expected: all focused tests PASS.

- [ ] **Step 6: Commit the review-route alignment**

```powershell
git add -- src/features/payroll/api.ts src/features/payroll/usePayrollApprovals.ts src/features/payroll/__tests__/api.test.ts src/features/payroll/__tests__/usePayrollApprovals.test.tsx src/components/Sidebar.tsx src/components/__tests__/SidebarNavigation.test.tsx src/pages/TimeReview.tsx src/pages/__tests__/TimeReview.test.tsx
git commit -m "fix(payroll): align super-admin review route gates"
```

### Task 5: Verify, review, and prepare the critical-lane PR

**Files:**
- Modify: `docs/ai/handoffs/WIN-219-payroll-timekeeping-foundation.md` with the bounded slice, checks, blockers, and residual risk
- Generated evidence only: `artifacts/responsive-ui-observer/**`

**Interfaces:**
- Consumes: completed Tasks 1-4
- Produces: verification card, specialist findings, PR-hygiene verdict, pushed branch, and human-review PR

- [ ] **Step 1: Run required static and aggregate checks**

```powershell
npm run ci:check-focused
npm run lint
npm run typecheck
npm run test:ci
npm run test:routes:tier0
npm run build
npm run verify:local
```

- [ ] **Step 2: Run the credential-backed browser gate**

Run: `npm run ci:playwright`

Record a pass, or the exact secret/environment blocker without treating it as a pass.

- [ ] **Step 3: Capture sanitized responsive evidence**

Start the production preview on an explicit loopback port and run:

```powershell
npm run test:ui:responsive -- --base-url=http://127.0.0.1:4173 --route=/time/review --route=/payroll
```

Require passing desktop `1440x900` and mobile `390x844` results for both routes.

- [ ] **Step 4: Complete critical specialist review**

Require `software-architect`, `code-review-engineer`, `test-engineer`, and `security-engineer` findings against the exact diff and verification output. Fix all in-scope findings through fresh RED/GREEN cycles and re-run affected checks.

- [ ] **Step 5: Update the markdown handoff**

Append the exact scope, commits, executed and blocked checks, reviewer outcomes, Linear linkage, and residual risk to `docs/ai/handoffs/WIN-219-payroll-timekeeping-foundation.md`.

- [ ] **Step 6: Run verify-change and pr-hygiene**

Produce the required critical-lane verification card and require `pr-ready: yes` before pushing.

- [ ] **Step 7: Commit, push, and open the PR**

```powershell
git add -- docs/ai/handoffs/WIN-219-payroll-timekeeping-foundation.md
git commit -m "docs(payroll): record route gate verification"
git push -u origin codex/payroll-super-admin-route-gates
gh pr create --base main --head codex/payroll-super-admin-route-gates --title "fix(payroll): align super-admin route gates" --body "## Summary`n- honor authoritative organization payroll access across Time Review navigation, page, and details loading`n- recognize export-only authority for Payroll route access`n- preserve fail-closed payroll grants and self-timekeeping boundaries`n`n## Tracking`n- WIN-219`n`n## Verification`n- include the exact verification card and responsive evidence paths from this run"
```

Link `WIN-219`, move it to In Review, report live checks, and stop at human-review-ready closure. Do not merge critical work autonomously.
