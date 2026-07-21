# WIN-233 BT Prompt Outcomes and Graph Alignment

## Routing

- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Linear: [WIN-233](https://linear.app/winningedgeai/issue/WIN-233/track-bt-prompt-outcomes-and-align-outcome-graphs)
- Related issues: WIN-218, WIN-183
- Triggering boundaries: `src/server/api/trial-events.ts` and the persisted `goal_measurements` JSON contract
- Merge requirement: human approval after required verification and PR hygiene

## Scope

1. Define the shared `PromptOutcome` contract and preserve optional legacy `no_response_trials` values.
2. Replace prompt correctness checkboxes with a sticky per-target three-outcome radio group in `SessionModal`.
3. Add the bounded, RLS-backed `view=prompt_outcomes` trial-event read mode.
4. Add aligned 100% stacked prompt-outcome charts to Programs & Goals and Client Session Trends without changing the existing percent-correct trend.
5. Preserve combined target-level unsuccessful counts and existing automatic-progression behavior.

## Non-goals and stop conditions

- No schema migration, RPC, RLS, grant, role, index, or progression SQL change.
- No historical backfill or reinterpretation of legacy unsuccessful trials.
- No raw metadata, audit identity, or unrelated clinical-field exposure.
- No PDF or generated-note analytics expansion.
- Stop and split the work if the hosted query needs a database/index change or the protected boundary cannot remain tenant-scoped and RLS-backed.

## Parallel ownership

- Shared contract gate: `src/types/index.ts`, `src/lib/goal-measurements.ts`, focused tests.
- Capture lane: `SessionModal` and focused tests.
- API lane: `trial-events` handler and security-focused tests.
- Analytics lane: shared outcome helper, both graph surfaces, and focused tests.
- Integration gate: code, test, security, and performance reviews against the combined diff.

## Verification contract

- Focused Vitest suites for every affected surface.
- `npm run ci:check-focused`
- `npm run lint`
- `npm run typecheck`
- `npm run test:ci`
- `npm run validate:tenant`
- `npm run test:routes:tier0`
- `npm run build`
- `npm run ci:playwright` when local credentials are available; otherwise required in PR CI.
- `npm run verify:local` when prerequisites are available.
- Read-only hosted Supabase constraint, index, and query-plan verification.
