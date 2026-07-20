# IEHP Skills & Behaviors Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile the early IEHP behavior/skill target list with the later authoritative goal blocks into one reviewable result and prove behavior and skill parsing through focused tests and an authenticated synthetic browser smoke.

**Architecture:** Add a pure IEHP reconciliation module beside the existing Edge extractor and attach its versioned result to the existing `IEHP_FBA_BEHAVIOR_SKILL_TARGETS` payload after all IEHP goal sections have been parsed. Preserve all existing payload fields and promotion semantics. Render the derived items in the IEHP document review UI and add an opt-in hosted proof mode that inspects the authenticated structured-section response without publishing live goals.

**Tech Stack:** Deno/TypeScript Edge extraction, React/Vitest, Node/Playwright smoke tooling, Supabase JSONB structured-section payloads.

## Global Constraints

- Detailed child-goal sections are authoritative for `behavior` versus `skill`; never classify from summary wording alone.
- Preserve `payload.targets`, raw text, section status, source spans, detailed goal payloads, and existing IEHP publication gates.
- Match only by case-insensitive, whitespace-collapsed, surrounding-punctuation-normalized exact strings; no fuzzy, substring, semantic, synonym, or model-based matching.
- Unmatched and ambiguous summary targets remain untyped Needs Review items and never create live goals.
- Exclude `goal_type: parent` rows from the child Skills & Behaviors result.
- An explicit supported `clinical_goal_type` wins over field-key fallback.
- Do not change schemas, migrations, IEHP drafts, CalOptima behavior, `src/server/**`, or live promotion semantics.
- Use only synthetic test/smoke data and keep uploaded document/storage cleanup unconditional and fail-closed.

---

### Task 1: Pure reconciliation contract

**Files:**
- Create: `supabase/functions/extract-assessment-fields/iehp-skills-behaviors.ts`
- Create: `supabase/functions/extract-assessment-fields/iehp-skills-behaviors.test.ts`

**Interfaces:**
- Consumes: `readonly IehpSkillsBehaviorsSection[]`, where each section exposes `field_key`, `section_index`, and `payload`.
- Produces: `buildIehpSkillsBehaviorsResult(sections): IehpSkillsBehaviorsResult | null`.
- The result is `{ version: 1, items, counts }`; items use `clinical_goal_type`, `reconciliation_status`, `summary_target_index`, `matched_goal_refs`, and `classification_source` exactly as defined in the approved design.

- [ ] **Step 1: Write the failing contract test**

Create a synthetic section array containing matched behavior and skill targets, an unmatched summary target, a detailed-only child goal, a parent goal, duplicate normalized detailed labels, and an explicit `clinical_goal_type` override. Assert:

```ts
const result = buildIehpSkillsBehaviorsResult(sections);
expect(result?.version).toBe(1);
expect(result?.items.map(({ name, clinical_goal_type, reconciliation_status }) => ({
  name,
  clinical_goal_type,
  reconciliation_status,
}))).toEqual([
  { name: "Physical Aggression", clinical_goal_type: "behavior", reconciliation_status: "matched" },
  { name: "Functional Communication", clinical_goal_type: "skill", reconciliation_status: "matched" },
  { name: "Community Safety", clinical_goal_type: null, reconciliation_status: "summary_only" },
  { name: "Conflicting Target", clinical_goal_type: null, reconciliation_status: "ambiguous" },
  { name: "Waiting", clinical_goal_type: "skill", reconciliation_status: "detailed_only" },
]);
expect(result?.items.some((item) => item.name === "Parent Coaching")).toBe(false);
expect(result?.counts).toEqual({
  total: 5,
  behavior: 1,
  skill: 2,
  summary_only: 1,
  detailed_only: 1,
  ambiguous: 1,
});
```

Also assert exact `{ field_key, section_index }` references, stable summary-first ordering, `null` for an absent summary row, and no mutation of the input sections.

- [ ] **Step 2: Run the focused test and capture RED**

Run:

```powershell
deno test --allow-env --allow-read supabase/functions/extract-assessment-fields/iehp-skills-behaviors.test.ts
```

Expected: FAIL because `iehp-skills-behaviors.ts` or `buildIehpSkillsBehaviorsResult` does not exist.

- [ ] **Step 3: Implement the minimal pure module**

Define the exported result types and implement:

```ts
export const buildIehpSkillsBehaviorsResult = (
  sections: readonly IehpSkillsBehaviorsSection[],
): IehpSkillsBehaviorsResult | null => {
  const summary = sections.find((section) => section.field_key === SUMMARY_FIELD_KEY);
  if (!summary) return null;

  const targets = readSummaryTargets(summary.payload);
  const childGoals = sections
    .filter(isDetailedGoalSection)
    .filter((section) => normalizeScalar(section.payload.goal_type) !== "parent")
    .map(toDetailedGoalCandidate)
    .filter((candidate): candidate is DetailedGoalCandidate => candidate !== null);

  return reconcileTargets(targets, childGoals);
};
```

Define these private helpers in the same module:

```ts
const normalizeComparableName = (value: unknown): string;
const readSummaryTargets = (payload: Record<string, unknown>): string[];
const isDetailedGoalSection = (section: IehpSkillsBehaviorsSection): boolean;
const resolveClinicalGoalType = (
  section: IehpSkillsBehaviorsSection,
): { value: "behavior" | "skill"; source: "explicit_goal_type" | "detailed_goal_field_key" } | null;
const toDetailedGoalCandidate = (
  section: IehpSkillsBehaviorsSection,
): DetailedGoalCandidate | null;
const reconcileTargets = (
  targets: readonly string[],
  goals: readonly DetailedGoalCandidate[],
): IehpSkillsBehaviorsResult;
```

`normalizeComparableName` is limited to `trim()`, lowercase, whitespace collapse, and removal of leading/trailing punctuation. Index each detailed goal by normalized `program_name`, `title`, and `target_behavior`. Treat multiple matching section references as ambiguous, including duplicates with the same apparent type. Group duplicate detailed-only names into one ambiguous item instead of emitting duplicate logical targets.

- [ ] **Step 4: Run the focused test and capture GREEN**

Run the same Deno command. Expected: PASS with all reconciliation cases covered.

- [ ] **Step 5: Commit the pure contract**

```powershell
git add supabase/functions/extract-assessment-fields/iehp-skills-behaviors.ts supabase/functions/extract-assessment-fields/iehp-skills-behaviors.test.ts
git commit -m "feat(win-229): define IEHP skills behaviors reconciliation"
```

### Task 2: Attach reconciliation to extracted IEHP sections

**Files:**
- Modify: `supabase/functions/extract-assessment-fields/index.ts`
- Modify: `supabase/functions/extract-assessment-fields/index.test.ts`

**Interfaces:**
- Consumes: `buildIehpSkillsBehaviorsResult` from Task 1.
- Produces: `IEHP_FBA_BEHAVIOR_SKILL_TARGETS.payload.skills_behaviors` while preserving `payload.targets`.

- [ ] **Step 1: Add a failing extraction-level test**

Build one synthetic IEHP document text containing the early mixed list plus later behavior, replacement/skill, detailed-only, and parent blocks. Assert the extracted summary section contains the exact reconciliation statuses/types/counts and still contains the original string array:

```ts
expect(summary?.payload.targets).toEqual([
  "Physical Aggression",
  "Functional Communication",
  "Community Safety",
]);
expect(summary?.payload.skills_behaviors).toMatchObject({
  version: 1,
  counts: { behavior: 1, skill: 2, summary_only: 1 },
});
```

- [ ] **Step 2: Run the extraction test and capture RED**

```powershell
deno test --allow-env --allow-read --allow-net supabase/functions/extract-assessment-fields/index.test.ts --filter "reconciles IEHP summary targets"
```

Expected: FAIL because `skills_behaviors` is absent.

- [ ] **Step 3: Integrate after all IEHP goal extraction**

Import the Task 1 helper. Immediately before `extractStructuredSections` returns its IEHP sections, compute the result and replace only the summary section payload:

```ts
const skillsBehaviors = buildIehpSkillsBehaviorsResult(sections);
const summarySection = sections.find(
  (section) => section.field_key === "IEHP_FBA_BEHAVIOR_SKILL_TARGETS",
);
if (summarySection && skillsBehaviors) {
  summarySection.payload = {
    ...summarySection.payload,
    skills_behaviors: skillsBehaviors,
  };
}
```

Do not change detailed section payloads, statuses, required flags, source spans, review notes, summaries, or promotion inputs.

- [ ] **Step 4: Run focused and full extractor GREEN tests**

```powershell
deno test --allow-env --allow-read --allow-net supabase/functions/extract-assessment-fields/index.test.ts --filter "reconciles IEHP summary targets"
deno test --allow-env --allow-read --allow-net supabase/functions/extract-assessment-fields/iehp-skills-behaviors.test.ts supabase/functions/extract-assessment-fields/index.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit extractor integration**

```powershell
git add supabase/functions/extract-assessment-fields/index.ts supabase/functions/extract-assessment-fields/index.test.ts
git commit -m "feat(win-229): attach IEHP skills behaviors result"
```

### Task 3: Render the one review result

**Files:**
- Modify: `src/components/ClientDetails/IehpFbaLayoutReview.tsx`
- Modify: `src/components/__tests__/IehpFbaLayoutReview.test.tsx`

**Interfaces:**
- Consumes: `payload.skills_behaviors.items` from Task 2, with legacy fallback to `payload.targets`.
- Produces: staff-visible Behavior Reduction, Skill Acquisition, and Needs Review groups.

- [ ] **Step 1: Add failing UI tests**

Render an IEHP summary section with one item in each type/review bucket. Assert all three headings and item names are visible, matched references are not dumped as raw JSON, and copy text includes the grouped labels. Add a second fixture without `skills_behaviors` and assert the existing flat legacy target list remains visible.

- [ ] **Step 2: Run the focused UI test and capture RED**

```powershell
npx vitest run src/components/__tests__/IehpFbaLayoutReview.test.tsx -t "renders reconciled skills and behaviors"
```

Expected: FAIL because the component still renders only `payload.targets`.

- [ ] **Step 3: Implement a defensive payload reader and grouped renderer**

Parse only well-formed items:

```ts
type SkillsBehaviorsPreviewItem = {
  name: string;
  clinicalGoalType: "behavior" | "skill" | null;
  reconciliationStatus: "matched" | "summary_only" | "detailed_only" | "ambiguous";
};

const skillsBehaviorsFromPayload = (payload: Record<string, unknown> | undefined) => {
  const value = payload?.skills_behaviors;
  if (!value || typeof value !== "object" || !Array.isArray((value as { items?: unknown }).items)) return null;
  const statuses = new Set(["matched", "summary_only", "detailed_only", "ambiguous"]);
  const items = (value as { items: unknown[] }).items.flatMap((candidate): SkillsBehaviorsPreviewItem[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const record = candidate as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const type = record.clinical_goal_type === "behavior" || record.clinical_goal_type === "skill"
      ? record.clinical_goal_type
      : null;
    const status = typeof record.reconciliation_status === "string" && statuses.has(record.reconciliation_status)
      ? record.reconciliation_status as SkillsBehaviorsPreviewItem["reconciliationStatus"]
      : null;
    return name && status ? [{ name, clinicalGoalType: type, reconciliationStatus: status }] : [];
  });
  return items.length > 0 ? items : null;
};
```

For valid reconciliation data, render `behavior`, `skill`, then `null`/review items. Label unmatched and ambiguous entries as Needs Review. For missing/malformed data, call the existing legacy `behaviorTargetsFromPayload` path.

- [ ] **Step 4: Run focused UI GREEN tests**

```powershell
npx vitest run src/components/__tests__/IehpFbaLayoutReview.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the review UI**

```powershell
git add src/components/ClientDetails/IehpFbaLayoutReview.tsx src/components/__tests__/IehpFbaLayoutReview.test.tsx
git commit -m "feat(win-229): render reconciled IEHP skills behaviors"
```

### Task 4: Add authenticated browser parsing proof

**Files:**
- Modify: `scripts/lib/iehp-assessment-import-smoke.ts`
- Modify: `scripts/playwright-iehp-assessment-import-smoke.ts`
- Modify: `tests/scripts/iehp-assessment-import-smoke.test.ts`
- Modify: `tests/scripts/playwright-iehp-assessment-import-smoke.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: authenticated checklist response `structured_sections` and the Task 2 payload contract.
- Produces: opt-in `playwright:iehp-assessment-import-skills-behaviors` JSON evidence with counts/type/status booleans and cleanup outcome.

- [ ] **Step 1: Add failing helper and script-contract tests**

Define a single synthetic proof case with early-list behavior/skill/unmatched targets, later matching typed goal blocks, one detailed-only child goal, and one parent goal. Test an assertion helper that fails clearly for a missing/duplicate summary row, malformed result, wrong count, wrong type, unexpected parent inclusion, or missing reference. Test that the runtime script exposes a dedicated opt-in flag/package command and retains its `try`/`finally` cleanup boundary.

- [ ] **Step 2: Run smoke tests and capture RED**

```powershell
npx vitest run tests/scripts/iehp-assessment-import-smoke.test.ts tests/scripts/playwright-iehp-assessment-import-smoke.test.ts
```

Expected: FAIL because the proof case, assertion helper, flag, and evidence do not exist.

- [ ] **Step 3: Implement the opt-in synthetic proof**

Add `--skills-behaviors-proof` without changing the existing default DOCX or three-case PDF mini-matrix semantics. Generate a synthetic PDF through the existing Chromium `page.pdf()` path. After status reaches `extracted`, reuse `fetchAssessmentChecklist` and assert exactly one `IEHP_FBA_BEHAVIOR_SKILL_TARGETS` structured row with the expected version, item counts, behavior/skill classifications, Needs Review result, detailed-only item, parent exclusion, and references.

Return only redacted evidence:

```ts
skillsBehaviorsAssertion: {
  rowCount: 1,
  version: 1,
  totalCountMatched: true,
  behaviorParsed: true,
  skillParsed: true,
  needsReviewPreserved: true,
  detailedOnlyPreserved: true,
  parentExcluded: true,
  provenanceVerified: true,
}
```

Keep upload/storage cleanup in the existing unconditional `finally`. Any assertion or cleanup failure must fail the run; never log raw target names, document/client IDs, credentials, or storage paths in JSON evidence.

- [ ] **Step 4: Run focused smoke GREEN tests**

Run the same Vitest command. Expected: PASS.

- [ ] **Step 5: Run hosted proof when a compatible deployment and credentials are available**

```powershell
npm run playwright:iehp-assessment-import-skills-behaviors
```

Expected: one cleanup-verified synthetic case with both behavior and skill parsing booleans true. If the configured host does not contain this branch's Edge parser or credentials are unavailable, record the check as blocked; do not claim it passed.

- [ ] **Step 6: Commit the browser proof**

```powershell
git add scripts/lib/iehp-assessment-import-smoke.ts scripts/playwright-iehp-assessment-import-smoke.ts tests/scripts/iehp-assessment-import-smoke.test.ts tests/scripts/playwright-iehp-assessment-import-smoke.test.ts package.json
git commit -m "test(win-229): prove IEHP skills behaviors parsing"
```

### Task 5: Verification, handoff, and PR readiness

**Files:**
- Create: `docs/ai/win-229-iehp-skills-behaviors-handoff.md`
- Modify: `docs/superpowers/plans/2026-07-20-iehp-skills-behaviors-reconciliation.md` only to check completed steps and record deviations

**Interfaces:**
- Consumes: exact command output, hosted evidence, specialist findings, and final diff.
- Produces: verification card, PR hygiene verdict, Linear evidence update, and review-ready PR.

- [ ] **Step 1: Run mandatory verification**

```powershell
npm run ci:check-focused
npm run lint
npm run typecheck
npm run test:ci
npm run build
npm run verify:local
```

Run `verify:local` only when its environment requirements are available. Record every skipped/blocked subcheck exactly, especially DB-backed checks and hosted proof.

- [ ] **Step 2: Run critical-lane reviews**

Use `code-review-engineer`, `test-engineer`, and `security-engineer` against the final diff. Resolve all actionable findings in scope and rerun affected checks.

- [ ] **Step 3: Write the concise handoff**

Record issue/route, files changed, exact RED/GREEN proof, mandatory verification results, hosted proof or blocker, cleanup evidence, review findings, residual risk, and next slice. Do not include PHI or secrets.

- [ ] **Step 4: Run workflow closure skills**

Use `verify-change` to produce the verification card and `pr-hygiene` to produce the `pr-ready` verdict.

- [ ] **Step 5: Commit, update Linear, push, and open the PR**

```powershell
git add docs/ai/win-229-iehp-skills-behaviors-handoff.md docs/superpowers/plans/2026-07-20-iehp-skills-behaviors-reconciliation.md
git commit -m "docs(win-229): record skills behaviors proof"
git push -u origin codex/iehp-fba-skills-behaviors-reconcile
```

Open a PR linked to WIN-229 for human review. Report live required checks and exact merge blockers; do not merge without the required human review.
