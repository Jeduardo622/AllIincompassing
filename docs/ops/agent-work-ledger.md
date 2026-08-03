# Agent Work Ledger Ops

## Local Command

Run `npm run agent-work:shadow-parity`.

The package command always goes through `scripts/agent-work-ledger-local-env.ts run -- ...`, then launches `node scripts/agent-work-ledger-shadow-parity.mjs`. The script independently rejects non-loopback URLs, requires the URLs to exactly match the running stack discovered from the pinned local Supabase CLI, defaults the runtime to `shadow`, and fails if `AGENT_WORK_LEDGER_RUNTIME_MODE` is set to anything else.

Run `npm run test:agent-work:chaos`.

The package command also goes through `scripts/agent-work-ledger-local-env.ts run -- ...`, then launches `node scripts/agent-work-ledger-chaos.mjs`. The chaos wrapper executes the focused Deno chaos harness for the real runner handler with deterministic crash injection and local-only process values. Override seed or isolate one crash point with:

```powershell
npm run test:agent-work:chaos -- --seed task10-repro-001
npm run test:agent-work:chaos -- --crash-point after_record_before_transition --seed task10-repro-001
```

## Architecture

`scripts/agent-work-ledger-shadow-parity.mjs` is the local parity proof for WIN-271 Task 8.

It:

- seeds synthetic IEHP assessment rows inside one transaction per fixture
- derives the authoritative snapshot from local assessment-domain rows
- calls the shared `assessment-prep.ts` adapter through a `tsx` subprocess bridge instead of reimplementing the shadow rules
- creates and rereads the supported queued ledger skeleton for the same tenant/document scope
- compares the adapter projection with independent fixture state/reason expectations and exact authoritative evidence pointer identity, locator, and hash
- proves an isolated structured-section payload change changes the readiness hash without changing state/blockers
- stores and separately rereads a rollback-only expired approval as a persistence guard; approval state is not an input to the pre-runner adapter and this fixture does not claim approval-sensitive projection behavior
- prints one PHI-free JSON line per fixture, then rolls the transaction back

This command tests the pre-runner shadow adapter and supported work-item creation boundary. It does not fabricate final ledger step state or claim to exercise the durable queue, runner, sweeper, or local scheduler/Vault path planned for Task 9.

## Fixtures

The six deterministic fixtures are:

- `success_extraction`
- `extraction_failure`
- `missing_checklist_evidence`
- `stale_approval`
- `changed_structured_section`
- `owner_removal`

Each fixture uses fixed IDs, fixed hashes, synthetic-only rows, and rollback-only writes.

## Output Contract

Each fixture line contains only:

- `fixture_id`
- `projection_count`
- `mismatch_reason_code`
- `authoritative_state`
- `projected_state`
- `state_transition`
- `evidence_pointer_coverage_rate`
- `runtime_mode`
- `workflow_version`
- `duration_ms`

The final line is an aggregate summary with safety counts and rates only.

The fixed output schema contains no clinical-value fields. A second sanitizer rejects UUIDs, filenames, paths, emails, URLs, tokens, and raw-row-shaped output; it is not a clinical-text classifier.

## Mismatch Interpretation

`mismatch_reason_code` is `null` only when the normalized ledger projection matches the authoritative shadow result.

Hard nonzero mismatch classes:

- `false_ready`
- `false_complete`
- `tenant_mismatch`
- `missing_evidence_pointer`
- `state_regression`
- `unexplained_projection_mismatch`
- `sanitizer_violation`

Interpret them strictly:

- `false_ready`: projected ledger advanced to `needs_review` while the authoritative state was still blocked
- `false_complete`: projected ledger reached `completed`; IEHP workflow v1 must never do that
- `tenant_mismatch`: projected ledger scope drifted from the authoritative assessment scope
- `missing_evidence_pointer`: any projected evidence pointer identity, locator, or hash differs from the authoritative set
- `state_regression`: projected ledger fell behind the authoritative terminal state
- `unexplained_projection_mismatch`: normalized state differed without matching a stricter failure class
- `sanitizer_violation`: output or summary leaked a forbidden token pattern or field

## Internal Negative Probes

The script contains deterministic internal probes that must prove detection of every hard failure class above. Those probes run during the normal command, but the command still exits `0` when all six valid fixtures match and every negative probe is caught as expected.

## Runtime And Disablement

This slice stays `shadow` only.

- no hosted calls
- no `.env*` reads
- no production runtime changes
- no assessment-domain persistence beyond rollback-only fixture transactions
- no approval, promotion, publication, billing, or signature behavior

If local preconditions are not met, disable the proof by not running it. Do not relax the loopback or runtime-mode guards.

To disable the ledger locally without changing assessment behavior, run the application/Edge Function authority with ledger runtime policy `disabled` and do not run worker commands. Assessment domain tables and the existing upload/review/promotion workflow remain authoritative and independent of this parity command.

## Retention Contract And Blocker

Task 14 remains unconfigured for retention enforcement until category-specific periods are approved and introduced by a separately reviewed policy migration. The current local surfaces prove only the fail-closed retention foundation, not a live retention policy:

- `supabase/migrations/20260801100000_agent_work_ledger_retention.sql`
- `npm run agent-work:retention-contract`
- no approved ledger retention periods exist
- three distinct categories exist: `ledger_history`, `queue_archive`, and `execution_trace`
- no policy rows are seeded
- service-role-only sanitized exact-work-item export returns the canonical hash
- holds are machine-coded and org/work-item/category scoped
- prune RPC has no deletion path and always denies with `policy_unapproved` and `deleted_count=0`
- no queue archive or trace deletion is implemented
- no domain cascade exists

Ownership for this slice is the policy-neutral migration, local contracts, documentation, and policy clarification. Do not infer production retention approval, prune authority, or deletion readiness from the foundation state.

## Export, Prune, And Recovery Contract

The export path is the recovery primitive. The exact-work-item export must remain service-role only, sanitized, PHI-free, and hash-stable for the authoritative work-item payload. The documented contract is:

- export takes a database-side share lock across every exported ledger surface before its first read, so the manifest is internally consistent and ledger writes remain blocked until the export transaction ends
- export returns the canonical hash for the exact work item scope
- export output is countable and tenant-scoped
- export output must reflect any active hold state
- export output must not imply domain deletion
- prune remains a policy check only until a policy row exists
- prune must not delete queue archive, execution trace, or assessment-domain records
- prune must fail closed when retention is unconfigured

Post-restore validation must reconcile the ledger against the authoritative assessment domain before any operator treats the restored state as usable. That reconciliation should compare the authoritative assessment records, the export hash, the item counts, the hold state, and the tenant scope. The assessment domain remains the source of truth after restore; the ledger is a replay and reconciliation surface, not the primary record.

## Disaster Recovery

Recovery procedures stay local-only and PHI-free.

- disable workers and schedulers before restore or replay
- drain or quarantine any queued poison messages before resuming reads
- rotate keys or secrets without naming them in artifacts or logs
- keep backup and restore validation local
- preserve sanitized exports, hashes, and counts only
- do not capture hosted action or active mode transitions in the handoff
- record disaster-recovery ownership across ops, app, and database roles before attempting replay

The operator sequence is:

1. stop worker and scheduler activity
2. confirm the ledger runtime policy is `disabled`
3. export the exact work item with the service-role-only path
4. restore from local backup
5. reconcile the restored ledger against the authoritative assessment domain
6. verify holds, counts, and tenant scope before any re-enable decision

Keep the export transaction short. The consistency lock is intentionally global to the ledger surfaces and is suitable only after workers and schedulers are disabled; it is not a background reporting path.

## Local Commands

Use only local commands for proof and recovery documentation:

```powershell
npm run agent-work:retention-contract
npm run agent-work:shadow-parity
npm run test:agent-work:chaos
```

Do not add hosted commands, deployment steps, or active-mode instructions to this doc. Any future retention enablement requires a new approved policy row and a fresh route.

## Task 9 Local-Only Direction

Task 9 extends the local-first ledger into a durable `pgmq` queue plus runner/sweeper coordination, but only within the local stack. Host-side Supabase/database configuration is loopback-only; Postgres uses fixed `host.docker.internal` callbacks to the loopback-bound host workers.

- allowed runtime modes remain `disabled`, `shadow`, and `advisory`
- no clinical mutations are allowed
- no hosted Supabase, Netlify, or remote queue/scheduler access is allowed
- scheduler/Vault setup must stay local, with fixed container-to-host callback targets
- any worker or scheduler proof must remain local-only until a fresh route says otherwise

Task 9 is implemented and verified locally. It is not authorized for hosted execution, deployment, push, or merge, and its critical-lane changes still require human review.

Run the local queue/scheduler proof only after the complete local Supabase stack is healthy:

```powershell
npm run agent-work:queue-scheduler:smoke
```

The command is wrapped by the repository local-environment preflight. It rejects non-loopback Supabase and database URLs, generates process-only runner/sweeper secrets, serves both functions as host Deno handlers, enables only the required local scheduler extensions, stores three fixed-name local Vault entries, creates two fixed-name cron jobs, verifies direct worker calls and cron responses, then removes the jobs, Vault entries, and host processes on success or failure. Set `DENO_BIN` to an explicit local Deno executable only when `deno` is not already on `PATH`.

## Hosted Command

Hosted parity or hosted assessment smoke remains authorization-gated and blocked in this task.

Documented for later, but not permitted here:

- `npm run playwright:iehp-assessment-import-smoke`

Do not run a hosted version of the parity script without a fresh route and explicit authorization.

## Artifact Handling

If a sanitized artifact needs retention outside the terminal stream, export only the PHI-free JSON output from the command, then perform retention cleanup on the local temp files. Success and failure paths delete the bridge temp directory; failure output is restricted to fixed reason codes.

## Exit Criteria

The command exits `0` only when:

- all six valid fixtures match
- every fixture prints a sanitized JSON record
- every aggregate field is sanitized
- evidence coverage is `1.0` for every valid fixture
- evidence pointer identity, locator, and hash match exactly
- an isolated changed structured section changes the readiness hash without changing state/blockers
- a separately reread stale approval remains expired; independently, no IEHP v1 projection reaches `completed`
- every internal negative probe detects the expected hard failure class
- runtime mode remains `shadow`
- both Supabase URLs exactly match the CLI-discovered running local stack

The command exits nonzero on the first parity, scope, runtime, sanitizer, or schema failure.

## Proven Checks

The following checks prove the local Task 9 implementation:

- local preflight
- clean db reset
- migration static `23/23`
- local scheduler guard `9/9`
- security contract pass
- durable queue, exact-string message id, deterministic-only claim, authoritative scope/hash, stale lease, wait, approval-expiry, poison, retry-ceiling, duplicate-effect, domain-drift rejection, and authoritative-finalization SQL probes
- runner `18/18`
- sweeper `8/8`
- policy `18/18`
- local Deno direct smoke: runner defined fail-closed/empty outcomes; sweeper `200/success`
- local pg_cron/pg_net smoke: fixed runner and sweeper jobs returned `200/200`, followed by zero remaining jobs, Vault entries, or listeners
- `npm run validate:tenant`, `npm run lint`, `npm run typecheck`, `npm run build`
- ledger-disabled `npm run test:ci`: 442 files and 3,679 tests passed; two files and five environment-gated tests skipped
- `npm run ci:verify-coverage`: 92.88% line coverage

`supabase functions serve` is not used for the Task 9 proof on this Windows Docker setup. The CLI stops the stack-managed Edge Runtime and leaves Kong with stale container DNS. The stack was rebuilt cleanly afterward, and both functions are instead imported as host Deno handlers with process-injected loopback-only values and generated synthetic invocation secrets.

`npm run ci:check-focused` and therefore `npm run verify:local` remain blocked by nine unrelated API-convergence exceptions that expired on 2026-07-31.

## Task 14 Retention Documentation Guardrails

Task 14 implements only a fail-closed foundation until retention policy approval exists.

- no active mode
- no hosted action
- no invented retention periods
- no claim of actual prune deletion
- no claim of queue archive or trace deletion
- no claim of domain cascade behavior
- no claim of hosted backup/restore execution
- no claim of production readiness beyond the scaffolded contract

The docs should continue to state the blocking condition plainly: retention is unconfigured until category-specific periods are approved and introduced by a separately reviewed migration, and the assessment domain remains authoritative for reconciliation after any restore.

## Task 10 Chaos Contract

The Task 10 chaos harness proves crash-safe idempotent convergence for the advisory projection runner without touching hosted systems or `.env*` files.

Crash boundaries:

- `before_claim`
- `after_claim`
- `before_effect`
- `after_effect_before_record`
- `after_record_before_transition`
- `after_transition_before_archive`
- `during_event_append`

The harness uses deterministic synthetic IDs, a seedable scenario order, and in-memory/local-only dependency injection around the real `createAgentWorkRunnerHandler` path. The `--seed` value deterministically reorders the crash scenarios through `AGENT_WORK_CHAOS_CRASH_POINTS`, and `--crash-point` narrows execution to one named boundary for exact local reproduction. It requires:

- one verified effect at convergence for duplicate delivery, retries, worker restarts, and stale-lease recovery paths
- no verified effect before the authoritative postcondition is observed
- post-transition completion-event failures to stay redeliverable until a replayed `agent_work_runner.completed` append succeeds and the stale message archives with `effect_already_applied`
- backward-compatible replay against pre-canonical legacy `projection:v<version>:<workItemId>:<stepId>` effect rows during local upgrade/retry scenarios
- different target or payload values producing different canonical effect keys and invalidating hash-bound approval bindings in the synthetic approval probe

The command exits nonzero on the first failed crash scenario, postcondition gate, duplicate-effect regression, or approval-binding regression.

## Task 12 Human Handoff Contract

Durable human handoffs are ledger-only and available only when the `agent-work-items` authority is in `advisory` mode. `shadow` remains read-only.

- the handoff RPC derives canonical SHA-256 input, evidence-set, and approval binding hashes from current ledger authority
- the assigned owner must have an active same-organization profile, an active unexpired exact `user_roles` assignment, and current client access under repository policy; assignment-bound BT access is re-read at handoff, decision, and sweep time
- approval handoff and decisions share the item-to-step-to-approval lock order; decisions re-read current tenant/role/hash/workflow/current-step authority and allow one compare-and-swap winner
- an identical replay returns the stored decision; a different second decision records a sanitized conflict and returns `409`
- expiry is distinct from revocation; owner loss, owner change, non-current step, input/evidence drift, cancellation, and workflow-version drift revoke the binding
- consumed approvals remain approved after step completion; expiry and stale-binding sweeps use separate bounded partial indexes
- approval governance events are manager-only even when other PHI-free ledger events are visible to assigned read-only viewers
- the UI reveals only a pending approval's evidence count and, inside explicit confirmation, an eight-character hash suffix; historical approval confirmation metadata is `null`, and approval-owner UUIDs are not projected
- assigned approvers read only their currently decidable pending row through caller-bound RLS; after a successful service-only decision RPC, the Edge Function rereads exactly that approval by work item, assigned actor, and approval id through the service boundary and returns only the sanitized decision projection
- approve/reject changes ledger handoff state only; IEHP assessment, promotion, document generation, signature, payer submission, billing, and final-record paths are not called

Focused local proof:

```powershell
deno test supabase/functions/agent-work-items/index.test.ts
npm test -- --run tests/agentWorkLedgerApprovalMigration.test.ts src/lib/__tests__/agent-work-ledger.test.ts src/components/agent-work/__tests__/AssessmentWorkLedgerPanel.test.tsx
npm run agent-work:security-contract
npm run validate:tenant
```

The security contract uses synthetic local fixtures and must prove authorized approve/reject, cross-organization denial, expired/revoked authority, hash drift, duplicate/conflicting decisions, rejection behavior, cancellation, and PHI-free audit metadata. Do not use hosted Supabase or real assessment data for this proof.

## Task 13 Monitoring, Replay, And Evaluation

Run the fixed-seed synthetic release gate:

```powershell
npm run test:agent-work:eval
```

The command reads only `scripts/fixtures/agent-work-ledger-eval-fixture.v1.json`, performs no network or provider calls, and emits deterministic sanitized JSON. Transition correctness, tool selection, evidence coverage, and policy compliance are graded before optional model-quality fields. It exits nonzero unless all release thresholds are met:

- cross-tenant access `0`
- false completion `0`
- unverified mutation effects `0`
- PHI payload violations `0`
- approval bypass or stale approval acceptance `0`
- unknown state transitions `0`
- stale running steps beyond the sweeper SLO `0`
- readiness evidence coverage `100%`

The `/monitoring` Agent Trace Replay tab loads `agent-work-operations.v1` only on operator action. The Edge function authenticates the request, resolves the organization and an existing `admin`, `super_admin`, or `monitoring` role, then applies `organization_id` to every service-role query. Each surface is limited to 500 rows and is explicitly presented as a sample. If any surface is truncated, live release-gate evaluation is `blocked_incomplete_sample` and all numeric release signals are unavailable rather than inferred from partial data. Drill-down fields are limited to sanitized work-item/step IDs and machine reason codes.

Non-blocking observations include median time to `needs_review`, accumulated step-state time, retry/abort and human-override rates, duplicate effects prevented, token/cost per completed objective, and workflow/provider/model/version groups. Blocker resolution and clinician administrative time are explicitly unavailable until authoritative timestamps exist; do not infer or synthesize them.

Replay packets are `agent-work-replay.v1`, have `executionAllowed: false`, and contain only workflow/version/status, selector-bound step and transition identifiers, evidence pointer hashes, approval hash/status/timestamps, attempt versions/guardrail outcomes, and effect verification. Replay is an explicit Edge mode and is not loaded by ordinary trace reports. The function validates tokens and hashes before serialization and fails closed when a selector is not step/attempt-bound or any bounded replay surface is incomplete. The CLI accepts one loopback packet only:

```powershell
npx tsx scripts/agent-replay.ts --packet-url http://127.0.0.1:54321/functions/v1/agent-trace-report --request-id <safe-id>
```

Pass a local operator token through the process-only `EDGE_REPLAY_ACCESS_TOKEN` variable when required. The CLI rejects non-loopback URLs, URL credentials, multiple packets, unknown fields, malformed hashes/timestamps, and any executable packet. It never reads `.env*`, contacts a model provider, executes a tool, or mutates ledger/domain state.

Alert and triage ownership is recorded in `docs/OBSERVABILITY_RUNBOOK.md`. On a release-gate violation, stop local scheduler/worker activity, set ledger runtime policy to `disabled`, preserve sanitized evidence, quarantine or drain messages, and reconcile with authoritative domain records. `active` mode is not authorized; only `disabled`, `shadow`, and `advisory` are valid for this increment.
