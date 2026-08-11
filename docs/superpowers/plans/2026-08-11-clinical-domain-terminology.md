# Clinical Domain Terminology Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all user-facing clinical care-plan `Program` terminology with `Domain` across client, assessment, schedule, session, and session-note UI surfaces.

**Architecture:** This is a presentation-only change in existing React components. Update rendered copy and user-visible messages in place while preserving every internal `program*` table, API, type, route ID, capability, query key, and persisted field so no data flow or authorization behavior changes.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, Testing Library, Playwright responsive observer

## Global Constraints

- User-facing clinical care-plan terminology maps `Program` to `Domain` and `Programs` to `Domains`, preserving capitalization and plurality.
- Combined labels map `Program & Goals` to `Domain & Goals` and `Programs & Goals` to `Domains & Goals`.
- Notes and draft labels map `Program Notes` to `Domain Notes`, `program note` to `domain note`, and `draft program` to `draft domain`.
- Internal `program`, `programs`, `program_id`, route IDs, capabilities, query keys, API fields, database fields, and TypeScript names remain unchanged.
- Uploaded or extracted source-document wording and user-supplied clinical names remain unchanged.
- Insurance and software meanings of `program` remain unchanged.
- No schema, migration, API, server, auth, routing, tenant, or deployment behavior changes are allowed.

---

### Task 1: Client Record And Care-Plan Management Copy

**Files:**
- Modify: `src/pages/__tests__/ClientDetails.test.tsx`
- Modify: `src/components/__tests__/ProgramsGoalsTab.test.tsx`
- Modify: `src/pages/ClientDetails.tsx`
- Modify: `src/components/ClientDetails/ProgramsGoalsTab.tsx`

**Interfaces:**
- Consumes: existing `programs-goals` tab ID, `ProgramsGoalsTab` props, and `program*` API responses unchanged
- Produces: `Domains & Goals` navigation plus Domain terminology for live care plans, assessment drafts, promotion, notes, validation, empty states, and toasts

- [ ] **Step 1: Change focused assertions to the required terminology**

Update existing tests so representative navigation, management, draft-review, and note copy asserts the new contract:

```tsx
expect(screen.getByRole('button', { name: /Domains & Goals/i })).toBeInTheDocument();
expect(screen.getByRole('heading', { name: 'Domains' })).toBeInTheDocument();
expect(screen.getByRole('button', { name: 'Add Domain' })).toBeInTheDocument();
expect(screen.getByPlaceholderText('Domain name')).toBeInTheDocument();
expect(screen.getByText('Domain Notes')).toBeInTheDocument();
expect(screen.queryByRole('button', { name: /Programs & Goals/i })).not.toBeInTheDocument();
```

Update assertions covering draft review and promotion to expect `Draft Domain`, `Save Domain Draft`, and `Publish to Live Domains + Goals`. Keep fixture object fields such as `program_id` and `programs` unchanged.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npx vitest run src/pages/__tests__/ClientDetails.test.tsx src/components/__tests__/ProgramsGoalsTab.test.tsx
```

Expected: FAIL because production UI still renders `Programs & Goals`, `Programs`, `Add Program`, `Program Notes`, and draft-program copy.

- [ ] **Step 3: Update client-record and care-plan production copy**

In `ClientDetails.tsx`, change only rendered labels:

```tsx
name: 'Domains & Goals',
mobileName: 'Domains',
```

In `ProgramsGoalsTab.tsx`, replace all user-facing clinical copy, including headings, help text, placeholders, button text, accessibility labels, confirmations, validation/errors, empty states, loading text, and success toasts. Representative results must include:

```tsx
<h3>Domains</h3>
<span>Add Domain</span>
<input placeholder="Domain name" />
<h3>Domain Notes</h3>
```

Keep implementation identifiers such as `ProgramsGoalsTab`, `programs`, `program.id`, `program_id`, `createProgram`, API URLs, and query keys unchanged.

- [ ] **Step 4: Re-run focused tests and verify GREEN**

Run:

```bash
npx vitest run src/pages/__tests__/ClientDetails.test.tsx src/components/__tests__/ProgramsGoalsTab.test.tsx
```

Expected: PASS with no assertion failures or runtime warnings introduced by the copy change.

- [ ] **Step 5: Commit the client-record terminology slice**

```bash
git add src/pages/ClientDetails.tsx src/pages/__tests__/ClientDetails.test.tsx src/components/ClientDetails/ProgramsGoalsTab.tsx src/components/__tests__/ProgramsGoalsTab.test.tsx
git commit -m "fix: rename clinical programs to domains in client records"
```

### Task 2: Session And Session-Note Copy

**Files:**
- Modify: `src/components/__tests__/SessionModal.test.tsx`
- Modify: `src/components/__tests__/AddSessionNoteModal.test.tsx`
- Modify: `src/components/session-notes/__tests__/BtAbaSessionNoteForm.test.tsx`
- Modify: `src/components/SessionModal.tsx`
- Modify: `src/components/AddSessionNoteModal.tsx`
- Modify: `src/components/session-notes/BtAbaSessionNoteForm.tsx`

**Interfaces:**
- Consumes: existing session `program_id`, selected program IDs, program records, goals, and note context unchanged
- Produces: Domain terminology in session selection, validation, loading/error states, guidance, and note summaries

- [ ] **Step 1: Change session-focused assertions to Domain terminology**

Update representative existing assertions without renaming fixture data:

```tsx
expect(screen.getByText('Domains in this session')).toBeVisible();
expect(screen.getByText('Selected domains')).toBeVisible();
expect(screen.getByText(/Select at least one domain to choose goals/i)).toBeVisible();
expect(screen.getByText('Domains and Goals')).toBeVisible();
expect(screen.queryByText('Programs in this session')).not.toBeInTheDocument();
```

Update retry, empty-state, validation, and guidance assertions to expect `domain`/`domains`, including `Could not load domains.`, `Retry domains`, and `No active domains found for this client.`

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npx vitest run src/components/__tests__/SessionModal.test.tsx src/components/__tests__/AddSessionNoteModal.test.tsx src/components/session-notes/__tests__/BtAbaSessionNoteForm.test.tsx
```

Expected: FAIL because the rendered session and note copy still uses Program terminology.

- [ ] **Step 3: Update session and note production copy**

In the three production components, replace only user-facing clinical terminology. Representative results must include:

```tsx
<p>Domains in this session</p>
<span>Selected domains</span>
<h4>Domains and Goals</h4>
```

Validation and guidance must say `Select an active domain`, `Select a domain and primary goal`, `Add goals to a domain`, and `Add goals in Domains & Goals`. Keep state names, React Query keys, Supabase table names, form field names, and context property names unchanged.

- [ ] **Step 4: Re-run focused tests and verify GREEN**

Run:

```bash
npx vitest run src/components/__tests__/SessionModal.test.tsx src/components/__tests__/AddSessionNoteModal.test.tsx src/components/session-notes/__tests__/BtAbaSessionNoteForm.test.tsx
```

Expected: PASS with all existing session behavior preserved.

- [ ] **Step 5: Commit the session terminology slice**

```bash
git add src/components/SessionModal.tsx src/components/__tests__/SessionModal.test.tsx src/components/AddSessionNoteModal.tsx src/components/__tests__/AddSessionNoteModal.test.tsx src/components/session-notes/BtAbaSessionNoteForm.tsx src/components/session-notes/__tests__/BtAbaSessionNoteForm.test.tsx
git commit -m "fix: use domain terminology in session workflows"
```

### Task 3: Scheduler Messages And Terminology Audit

**Files:**
- Modify: `src/components/__tests__/AutoScheduleModalWarnings.test.tsx`
- Modify: `src/components/AutoScheduleModal.tsx`
- Inspect: `src/components/**/*.tsx`
- Inspect: `src/pages/**/*.tsx`

**Interfaces:**
- Consumes: existing auto-schedule program and goal lookup behavior unchanged
- Produces: Domain terminology in scheduler errors plus a reviewed allowlist of remaining internal/source `program*` occurrences

- [ ] **Step 1: Add assertions for scheduler Domain messages**

Use the existing warning/error setup to assert the displayed failure uses Domain terminology:

```tsx
expect(await screen.findByText(/Failed to load domains for client/i)).toBeInTheDocument();
expect(screen.queryByText(/Failed to load programs for client/i)).not.toBeInTheDocument();
```

Cover `No active domain found` and `Missing domain/goal` if those thrown messages reach the rendered warning surface in the existing tests.

- [ ] **Step 2: Run the focused scheduler test and verify RED**

Run:

```bash
npx vitest run src/components/__tests__/AutoScheduleModalWarnings.test.tsx
```

Expected: FAIL because `AutoScheduleModal.tsx` still throws user-visible Program messages.

- [ ] **Step 3: Update scheduler user-visible messages**

Change only error message text:

```ts
throw new Error(`Failed to load domains for client ${clientId}`);
throw new Error(`No active domain found for client ${clientId}`);
throw new Error(`Missing domain/goal for client ${slot.client.id}`);
```

Keep variables, endpoint paths, payload fields, and lookup behavior unchanged.

- [ ] **Step 4: Re-run the scheduler test and verify GREEN**

Run:

```bash
npx vitest run src/components/__tests__/AutoScheduleModalWarnings.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Audit remaining UI source occurrences**

Run:

```bash
rg -n -i "programs?|program &amp; goals|program & goals" src/components src/pages -g "*.tsx"
```

Classify every remaining match. Allowed matches are limited to internal identifiers/contracts, comments that describe internal contracts, imported/exported type names, API paths, route/tab IDs, capabilities, test fixtures or user-supplied names, and preserved uploaded/extracted source text. Change any remaining user-facing clinical care-plan copy to Domain and update its focused test before proceeding.

- [ ] **Step 6: Commit scheduler copy and audit fixes**

```bash
git add src/components/AutoScheduleModal.tsx src/components/__tests__/AutoScheduleModalWarnings.test.tsx
git add src/components src/pages
git commit -m "fix: complete clinical domain terminology"
```

### Task 4: Repository Verification And Responsive Evidence

**Files:**
- Verify: all changed production and test files
- Generate: sanitized artifacts under `artifacts/responsive-ui-observer/`

**Interfaces:**
- Consumes: completed copy-only implementation
- Produces: standard-lane verification card, responsive evidence, reviewer verdict, and PR-ready diff

- [ ] **Step 1: Run required static and focused checks**

```bash
npm run lint
npm run typecheck
npx vitest run src/pages/__tests__/ClientDetails.test.tsx src/components/__tests__/ProgramsGoalsTab.test.tsx src/components/__tests__/SessionModal.test.tsx src/components/__tests__/AddSessionNoteModal.test.tsx src/components/session-notes/__tests__/BtAbaSessionNoteForm.test.tsx src/components/__tests__/AutoScheduleModalWarnings.test.tsx
npm run build
```

Expected: all commands PASS.

- [ ] **Step 2: Run standard-lane repository checks**

```bash
npm run ci:check-focused
npm run test:ci
npm run verify:local
```

Expected: all commands PASS. If the existing Vitest no-output watchdog recurs, preserve exact output, investigate the affected command, and record it as failed or blocked rather than claiming a pass.

- [ ] **Step 3: Start the local preview server**

```bash
npm run dev -- --host 127.0.0.1 --port 4173
```

Expected: Vite listens on `http://127.0.0.1:4173`.

- [ ] **Step 4: Run responsive observation on every affected route**

```bash
npm run test:ui:responsive -- --base-url=http://127.0.0.1:4173 --route=/clients/test-client?tab=programs-goals --route=/clients/test-client?tab=session-notes --route=/schedule
```

Expected: machine-safe JSON reports `ok: true` for desktop `1440x900` and mobile `390x844`, with sanitized screenshot and evidence paths for every route.

- [ ] **Step 5: Review the final diff and terminology audit**

```bash
git diff --check
git status --short
git diff main...HEAD --stat
rg -n -i "programs?|program &amp; goals|program & goals" src/components src/pages -g "*.tsx"
```

Expected: no whitespace errors, only scoped files changed, and every remaining Program match is an allowed internal/source occurrence.

- [ ] **Step 6: Run required specialist review and PR hygiene**

Dispatch `code-review-engineer` for correctness and scope review and `test-engineer` for verification adequacy. Run repo-local `verify-change` and `pr-hygiene`; resolve every blocking finding before push.

- [ ] **Step 7: Push and open the review PR**

```bash
git push -u origin codex/clinical-domain-terminology
gh pr create --base main --head codex/clinical-domain-terminology --title "Use Domain terminology for clinical care plans" --body "## Summary
- replace user-facing clinical Program terminology with Domain
- preserve internal program APIs, fields, and data contracts

## Verification
- focused component/page tests
- lint, typecheck, test:ci, build, verify:local
- responsive observer for client and schedule routes"
```

Expected: branch push succeeds and a PR URL is returned with exact verification status and the baseline watchdog issue disclosed if unresolved.
