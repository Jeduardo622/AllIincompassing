# WIN-154 IEHP Skills And Behaviors Parser Repair Handoff

- Date: August 12, 2026
- Linear: `WIN-154`
- Branch: `codex/win-154-iehp-parser-repair`
- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Required agents: `specification-engineer` -> `software-architect` -> `implementation-engineer` -> `code-review-engineer` -> `test-engineer` -> `security-engineer`

## Scope

- Remove a Roman-numeral section heading from the IEHP behavior/skill summary target list.
- Prevent generic Behavior Intervention Plan strategy narrative from creating a fake `Behavior Treatment` detailed goal.
- Preserve explicitly labeled legacy IEHP goal subsections.
- Keep the repair limited to the extractor, focused tests, and this handoff.

## Non-Goals

- No auth, organization, client, storage, RLS, grant, RPC, schema, migration, deployment, Adobe, upload, review UI, generated DOCX, or workflow changes.
- No broad parser rewrite, fuzzy matching, alias expansion, unresolved-row suppression, or hosted data backfill.

## Route Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- triggering path: `supabase/functions/extract-assessment-fields/index.ts`
- why: the parser is implemented in a protected Supabase Edge Function path.
- required agents: `specification-engineer`, `software-architect`, `implementation-engineer`, `code-review-engineer`, `test-engineer`, `security-engineer`
- reviewer required: yes
- verify-change required: yes
- Linear required: yes
- stop conditions: stop if the repair requires another production surface, changes tenant authority, weakens reconciliation, or requires a production deploy before human review.

## Tenant Safety Card

- High-risk surface: extraction behavior inside `extract-assessment-fields`.
- Existing authenticated organization, client, storage, and write-boundary checks remain unchanged.
- No read or write scope changes; cross-tenant access must remain impossible.
- No schema, RLS, grant, RPC exposure, service-role, or secret-handling changes.

## Failure Evidence

- PR `#930` added a strict synthetic Adobe-backed upload-to-generated-DOCX parity gate.
- The existing upload smoke and skills/behaviors smoke passed.
- The generated DOCX parity gate failed before auto-approval because reconciliation contained unresolved skills/behaviors.
- Direct parser reproduction isolated two deterministic false items:
  - summary-only `III`, retained from the next `III. BACKGROUND INFORMATION` heading
  - detailed-only `Behavior Treatment`, synthesized from generic Behavior Intervention Plan strategy narrative
- Cleanup and redacted evidence capture passed, so the failure is parser behavior rather than fixture cleanup or credential setup.

## Rollout Ordering

- PR `#930` runs Playwright against a Netlify deploy preview.
- The preview calls the currently deployed hosted `extract-assessment-fields` Edge Function; PR CI does not deploy the branch function.
- This parser-only predecessor PR must merge and deploy through the protected main-branch workflow before PR `#930` can provide decisive hosted end-to-end proof.
- Codex must not merge or deploy this critical-lane repair; human review and merge are required.

## Required Verification

- Focused red/green Deno parser tests.
- Full extractor Deno tests covering IEHP skills/behaviors.
- `npm run ci:check-focused`
- `npm run lint`
- `npm run typecheck`
- `npm run test:ci`
- `npm run validate:tenant`
- `npm run build`
- `npm run verify:local` when the local environment supports the wrapper reliably.
- Exact-head hosted PR checks and mandatory human review.

## Verify-Change Card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: server/API Edge Function parser behavior and tenant-sensitive Supabase function
- required checks:
  - focused and full extractor Deno tests
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run validate:tenant`
  - `npm run build`
  - `npm run verify:local` when reliable locally
- executed checks:
  - focused red test -> failed before implementation because targets contained `III`
  - focused green parser tests -> pass
  - full Adobe/extractor/reconciliation/structured-goals Deno suite -> pass (`69/69`)
  - `npm run ci:check-focused` -> pass; DB-backed grant/drift checks and branch protection were skipped because local DB/CI context was unavailable
  - `npm run lint` -> pass
  - `npm run typecheck` -> pass
  - `npm run validate:tenant` -> pass
  - `npm run build` -> pass
  - `npm run test:ci` -> one unrelated `AppNavigation` async landing failure; the exact file passed immediately in isolation (`31/31`)
- blocked checks:
  - `npm run verify:local` -> not rerun because its included full `test:ci` breadth gate is already documented as locally flaky and the direct required constituents were run separately
  - hosted upload-to-generated-DOCX parity -> intentionally pending until this predecessor repair is human-merged and the protected main-branch workflow deploys the Edge Function
- result: `pass-with-blocked-checks`
- residual risk: local parser proof cannot establish hosted deployment parity; PR `#930` provides the decisive Adobe-backed upload-to-generated-DOCX proof after deployment.

## PR Hygiene

- Allowed production surface: `supabase/functions/extract-assessment-fields/index.ts`
- Allowed test surface: `supabase/functions/extract-assessment-fields/index.test.ts`
- Allowed documentation surface: this handoff
- Expected PR relationship: predecessor to `#930`
- pr-ready: yes after the focused reviewer finding is resolved, the branch is committed and pushed, and a PR is opened
- branch-ready: yes
- Linear-ready: yes, linked to `WIN-154`
- single-purpose: yes
- unrelated changes: none
- generated artifact drift: none
- protected-path drift: expected `supabase/functions/**`, correctly routed `critical`
- verification summary: present; local breadth check has one isolated flaky failure
- reviewer: completed; code correctness approved after documentation findings are resolved, security approved, and Supabase tenant review approved
- Human review required: yes
- Merge-ready: no until exact-head checks pass and the required human review is recorded.
