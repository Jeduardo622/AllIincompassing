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

## Retention Contract And Policy Encoding

The solo maintainer approved non-destructive policy encoding in WIN-275. A forward migration records the decision without activating retention enforcement:

- `supabase/migrations/20260801100000_agent_work_ledger_retention.sql`
- `supabase/migrations/20260806110223_agent_work_retention_policy_encoding.sql`
- `npm run agent-work:retention-contract`
- immutable decision periods are `ledger_history=365 days`, `queue_archive=90 days`, and `execution_trace=30 days`
- decision provenance is bound to the WIN-275 owner-attestation reference and canonical approval SHA-256
- the decision catalog is forced-RLS, service-role-readable, and rejects updates and deletes
- no operational `agent_work_retention_policies` rows are seeded
- service-role-only sanitized exact-work-item export returns the canonical hash
- holds are machine-coded and org/work-item/category scoped
- prune RPC has no deletion path and denies all three categories with `policy_unapproved` and `deleted_count=0`
- no queue archive or trace deletion is implemented
- no domain cascade exists

The encoded periods are governance input only. Do not infer operational policy activation, prune authority, deletion readiness, or hosted deployment from the decision catalog.

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

## Phase 1 Local Verification

Task 15 closes the local Phase 1 verification path. Clear any hosted project variables for each process, use the complete local Supabase stack, and run stateful contracts from fresh database state so queue or fixture rows cannot leak between checks.

```powershell
npm run ci:check-focused
npm run lint
npm run typecheck
npm run test:ci
npm run validate:tenant
npm run build
npm run verify:local
npm run agent-work:db:reset
npm run agent-work:edge-smoke
npm run agent-work:retention-contract
npm run agent-work:trace-index-contract
npm run agent-work:queue-scheduler:smoke
npm run agent-work:shadow-parity
npm run test:agent-work:chaos
npm run test:agent-work:eval
```

Reset the database again before each destructive stateful contract when reproducing the release evidence. The final branch-level proof passed `test:ci` at 465 of 467 files and 3,930 of 3,935 tests; the remaining two files and five tests are explicitly skipped because their dedicated local Postgres URLs are not configured. `verify:local` passed in 709.3 seconds with the same suite, coverage policy, production build, and 220 of 220 Tier-0 route tests.

The cached Agent Work Ledger Deno set passed 155 tests across 12 shared policy/state, items, runner, sweeper, CalOptima, and generator files with no network permission. The Phase 2 image keeps npm dependencies lockfile-exact and caches Deno npm imports separately with `--node-modules-dir=none`; do not use Deno automatic `node_modules` installation in this image because it can replace npm-locked packages.

The trace-index contract inserts 20,000 transaction-local synthetic rows into each report source, proves all 11 production report query shapes use their eight intended indexes, then rolls back the fixtures. This includes session-audit request, correlation, top-level operation-ID, and nested trace operation-ID containment. The Supabase CLI applies migrations through a SQL pipeline and rejects `CREATE INDEX CONCURRENTLY`; the additive indexes therefore use ordinary `CREATE INDEX`. A future hosted rollout must schedule the migration for a bounded low-write window and inspect table/index size and lock activity before and during application.

The Edge smoke runs in `shadow`, proves create/list/detail/idempotency and tenant denial, rejects owner and approval-decision writes with `advisory_mode_required`, and confirms only cancel, resume, and reconcile remain deferred. Phase 1 does not authorize `active` mode, hosted assessment checks, deployment, or provider calls.

## Phase 2 Container Harness

Run the complete local integration harness from a committed snapshot with Docker Desktop, the standalone `docker-compose` binary, the repository-pinned Supabase CLI, Node, npm, and Git on `PATH`:

```powershell
npm run test:agent-work:phase2
```

The command fails closed before startup when it detects a hosted project reference, non-loopback host URL, remote-capable credential, relevant uncommitted image input, stale Compose resource, or stale Supabase resource. It builds `agent-work-ledger-phase2:local` from `git archive HEAD`, creates the dedicated `agent-work-phase2` network, starts the complete CLI-managed Supabase Docker stack, and starts the app plus the items, runner, and sweeper services from the committed image.

Phase 2 remains local-only. Remote-capable worker configuration is excluded from these local commands.

The fixed check order is:

1. stack health
2. schema and deterministic seed
3. tenant and security contract
4. items/API smoke
5. deterministic chaos
6. shadow parity
7. retention and trace contracts
8. hosted scheduler transaction contract
9. queue, local scheduler, runner, and sweeper smoke
10. app/API unit tests and production build
11. cached Agent Work Ledger Deno tests
12. cleanup audit

Every destructive check begins with a fresh database reset on the isolated network. The two scheduler checks run last among destructive checks because they enable `pg_cron`; this prevents extension worker activity from racing later resets while still making cleanup audit the terminal database-state check. All waits and retries are bounded. Cleanup removes Compose containers and volumes, the local Supabase stack and volumes, the dedicated network, Cron jobs, Vault entries, queue fixtures, temporary archive context, and listeners, then fails if residue remains.

Sanitized manifests and summary logs are written under `.reports/agent-work-ledger-phase2/<run-id>/`. They contain command status, timing, commit and image identities, SHA-256 fingerprints of redacted PHI-free command output, and cleanup results, but no credentials or command output payloads. The directory is ignored and is not a release artifact.

The final local proof completed two consecutive cold runs from commit `1fc70a7a7a5b156c17770ca2b1051cda0d4453d2` and image `sha256:73931d43b8788096a51932ccb26d290b9b6306d1de00daf6b72ce05a4d1b54da`:

- `20260803T185829Z-d05fc4`: 11 of 11 checks passed in 706,061 ms; summary hash `997ce09f2d564e48f910f0e54fa988762a9c24910acd9ef2ba17be4505a23463`; content evidence hash `5096d5c81921b3fa909f7941a1802ae6da261c4e25198b2523db77183e7453f8`
- `20260803T191036Z-4b2760`: 11 of 11 checks passed in 688,824 ms; summary hash `e608ce716355a3b94df8dca3e8297eb57bc76deb7613023b30c02ce809dae03d`; content evidence hash `ed6b23a21432a9c409eaec3a16ceec3ddfbc51cf245e7f7b762608c4c910f993`

Both runs passed cleanup and left no labeled Supabase/Compose containers, Compose volumes, or `agent-work-phase2` network. This command is local-only. It does not push, deploy, contact a model provider, use `active` mode, or authorize hosted configuration.

## Task 16 CalOptima Adapter

Task 16 is the separately routed critical CalOptima adapter. It prepares approved synthetic or redacted CalOptima evidence as an editable draft program/goal packet for BCBA review and stops at `needs_review`.

- allowed scope:
  - fixed `assessment.caloptima.prepare_draft_review@1` workflow and actor-checked RPCs
  - CalOptima generator ledger envelope, deterministic snapshot, domain draft staging, UI review panel, focused local contracts, and harness compatibility
- non-goals:
  - no hosted, provider, browser, deployment, GitHub, or `.env*` action
  - no `active` mode or autonomous approval, clinical mutation, promotion, publication, signature, billing, submission, or final-record creation
- stop conditions:
  - fail closed when runtime policy is missing, unreadable, unsupported, or `disabled`
  - stop if evidence is not approved, tenant scope does not match, a source token is unbound, or the immutable packet/hash disagrees

Runtime contract:

- Manager roles may initiate and manage the bounded workflow through the existing actor predicate, but v1 clinical ownership and approval decisions require an exact active `bcba` assignment with current client access. Role expansion is a human governance gate under plan Section 9 and is not authorized here.
- The client and Edge function require the exact stable `caloptima-ledger.<work-item-id>` request/correlation identity for Ledger-bound generation. The separately authenticated same-tenant legacy request contract remains outside the Ledger runtime switch; a staged Ledger rollout must set `AGENT_WORK_LEGACY_GENERATION_DISABLED=true` before claiming provider-path isolation.
- The model step is advisory, no-tools, version-snapshotted, and unable to author graph, scope, approval, execution mode, or completion policy.
- The SQL snapshot transaction validates the packet, computes its canonical SHA-256 hash, stores one immutable tenant-scoped replay packet, stages only `assessment_draft_*` rows, records/verifies the effect, and completes the deterministic snapshot step atomically.
- A preparation failure after a valid model claim is recorded through a service-only actor/tenant-bound RPC and atomically transitions the step `running -> failed -> ready`; the next request claims a fresh attempt instead of inheriting a stranded lease.
- Evidence references contain PHI-free exact source-record tokens. The ledger evidence hash includes approved checklist and structured source content; content drift invalidates hash-bound approvals and reopens the decision step.
- Replay reads the immutable packet through an actor-checked service RPC. PostgreSQL recomputes the packet hash from the stored `jsonb`, and the Edge function requires that hash to match both the stored result and the attempt-bound expected hash. Later clinician edits to domain draft rows cannot alter the replayed model result.
- Deterministic fallback is low-confidence and includes `clinician_confirmation_needed`/`evidence_gap`; it never promotes or publishes.

Local proof after the architecture correction:

- focused Vitest: `263/263` across 12 files
- Agent Work Deno tests: `155/155` across 12 files with no network permission
- `npm run ci:check-focused`, `npm run lint`, `npm run typecheck`, and `npm run build`: pass
- fresh `npm run agent-work:db:reset`: pass
- `npm run agent-work:edge-smoke`: pass, including its security preflight, IEHP/CalOptima create and idempotency, list/detail, tenant denial, shadow mutation denial, and deferred routes
- `npm run agent-work:security-contract`: pass from fresh database and queue state, including failed-attempt recording/fresh retry, SQL-owned hashing, database-recomputed immutable replay after draft edits, exact source binding, approved-content drift, approval reopening, and cross-tenant denial
- full Phase 1 and two-run Phase 2 evidence is recorded in the handoff; all required local gates passed

Human protected-path, Supabase, security, clinical, product, and privacy review remains required before any merge.

## Task 9 Local-Only Direction

Task 9 extends the local-first ledger into a durable `pgmq` queue plus runner/sweeper coordination, but only within the local stack. Host-side Supabase/database configuration is loopback-only; Postgres uses fixed `host.docker.internal` callbacks to the loopback-bound host workers.

- allowed runtime modes remain `disabled`, `shadow`, and `advisory`
- no clinical mutations are allowed
- no hosted Supabase, Netlify, or remote queue/scheduler access is allowed
- `enable_local_agent_work_queue_scheduler` remains local-only
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

The nine API-convergence exceptions that originally blocked the Task 9 policy gate were repaired without weakening the gate. The current Task 15 `npm run ci:check-focused` and `npm run verify:local` results are green; use the Phase 1 evidence above rather than the historical Task 9 checkpoint.

## Retention Policy Guardrails

WIN-275 records the owner-approved `365/90/30` periods as non-destructive governance metadata. Retention enforcement remains fail closed until a separately reviewed operational policy and deletion design are approved.

- no active mode
- no hosted action
- no substitution or inference beyond the approved `ledger_history=365`, `queue_archive=90`, and `execution_trace=30` day periods
- no claim of actual prune deletion
- no claim of queue archive or trace deletion
- no claim of domain cascade behavior
- no claim of hosted backup/restore execution
- no claim of production readiness beyond the scaffolded contract

The docs should continue to state the blocking condition plainly: approved periods are encoded, but deletion remains unconfigured while the operational policy registry is empty. The assessment domain remains authoritative for reconciliation after any restore.

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

## Hosted Callable Operation

WIN-275 adds an operator-only hosted scheduler controller without enabling it. The callable boundary remains the authenticated `agent-work-items` function:

1. A manager creates an assessment-preparation or CalOptima draft-review work item through the existing tenant-scoped route.
2. The database enqueues only deterministic ready steps. In `advisory`, the hosted runner may claim and verify those steps; the sweeper recovers leases, waits, approvals, and poison messages.
3. The CalOptima `model_suggested` step is not Cron-owned. An authenticated caller must explicitly invoke `generate-program-goals` with the stable Ledger envelope. That no-tools call can stage editable `assessment_draft_programs` and `assessment_draft_goals`, then stops at human review. It never publishes, signs, bills, submits, or creates a final clinical record.
4. Human handoff and approval remain Ledger decisions only. Assessment-domain records remain authoritative.

Runtime modes are deliberately asymmetric:

| Mode       | Work-item API                         | Runner/sweeper              | Ledger model call           | Domain draft staging                  |
| ---------- | ------------------------------------- | --------------------------- | --------------------------- | ------------------------------------- |
| `disabled` | fails closed                          | inert                       | denied                      | none                                  |
| `shadow`   | tenant-scoped create/read observation | inert                       | denied                      | none                                  |
| `advisory` | tenant-scoped management              | deterministic recovery only | explicit authenticated call | editable drafts for human review only |

`active` is forbidden. Runtime-policy lookup failure resolves to disabled behavior. The Ledger runtime switch is not a global model-provider switch: the separately authenticated legacy `generate-program-goals` contract is controlled by `AGENT_WORK_LEGACY_GENERATION_DISABLED`. Keep that value `true` for any rollout claiming that only Ledger-bound generation can contact the provider.

### Hosted Scheduler Setup

The migration creates, but does not grant or call, these operator-only SQL functions:

- `public.enable_hosted_agent_work_queue_scheduler(text, integer, integer)`
- `public.disable_hosted_agent_work_queue_scheduler()`
- `public.hosted_agent_work_queue_scheduler_status()`

Before enablement, a reviewed operator must enable `pg_cron`, `pg_net`, and Vault; generate independent runner and sweeper invocation secrets; inject `AGENT_WORK_RUNNER_SECRET`, `AGENT_WORK_SWEEPER_SECRET`, and the deployment-owned `AGENT_WORK_HOSTED_PROJECT_REF` into the matching Edge Functions; and store the matching values under exactly these Vault names:

- `agent_work_hosted_project_ref`
- `agent_work_hosted_publishable_key`
- `agent_work_hosted_runner_secret`
- `agent_work_hosted_sweeper_secret`

The runner and sweeper are machine-only functions with `verify_jwt = false` and handler-owned service authentication. Each request must carry the configured project publishable key in `apikey` plus the matching dedicated endpoint secret. The publishable key binds the request to the expected Supabase gateway project but is not treated as a secret; the independent endpoint secret provides request authorization. The functions reject missing, malformed, bearer-only, wrong-project-key, or wrong-endpoint-secret requests before creating their privileged Supabase client. `SUPABASE_SERVICE_ROLE_KEY` remains function-internal for authoritative RPCs and must never be stored in scheduler Vault entries, Cron command text, `pg_net` request queues, logs, or artifacts.

The controller does not accept a caller-selected project ref. It reads `agent_work_hosted_project_ref` from Vault, requires the same 20-character lowercase deployment identity configured on the Edge Functions, and derives exact `https://<project-ref>.supabase.co/functions/v1/...` targets. It accepts only a five-field Cron expression, bounds timeout to 1-30,000 ms and sweeper pass size to 1-100, serializes enable/disable operations, and replaces exactly `agent-work-runner-hosted` and `agent-work-sweeper-hosted`. Stored Cron commands query the publishable key and endpoint-specific secret from fixed Vault names at execution time; they never query or transmit a service-role credential. Status aggregates duplicate job rows defensively and reports only extension readiness, a boolean credential-ready signal, and job presence/active/schedule/count metadata.

No hosted cadence is approved by this repository. The local scheduler smoke uses `* * * * *`; the hosted transactional contract uses `0 0 1 1 *` so its jobs cannot fire during command inspection. Both use 5,000 ms and a 25-item sweep bound. These are test fixtures, not production defaults. The owner must choose cadence after measuring queue depth, runner/sweeper latency, lease expiry, retries, poison archives, Cron overlap, and database lock/write activity.

Local proof from a fresh migrated stack:

```powershell
npm run agent-work:hosted-scheduler:contract
```

The command rejects non-local database URLs, enables the three scheduler extensions late in the isolated local stack, uses synthetic generated values, and creates the four fixed Vault entries plus two jobs inside an uncommitted transaction. It proves invalid deployment identity fails closed, exact project binding, absence of service-role credentials from command storage, service-role execution denial for operator controllers, sanitized status, disablement, rollback, and zero fixed job/Vault residue. Extension installation is intentionally outside that transaction and can remain until the isolated local stack is destroyed. The Phase 2 harness runs the same contract before the existing local scheduler smoke and audits both local and hosted fixed names during cleanup.

Intermediate WIN-275 evidence used one command, `npm run test:agent-work:phase2`, from commit `0f5e5ef8c7d9f85756c99486b7381090f5e62d18` and image `sha256:82c380cc0e1539716c593a45d1f785a5eecd1c535fb02a3f915a2b1095609388`. Runs `20260805T001342Z-6a9cc6` and `20260805T002520Z-139f82` each passed all 12 checks and cleanup in `683,030ms` and `640,994ms`; their summary hashes are `873b5edeb7454bfa787e4bb758aed875944a917ba870e183ea7cfffd9d4226f1` and `c3d3e2e3343751ae8a185152aab8ca195568eab085a1376c0692557df6cc74d2`. Final review then found that PostgreSQL `btrim(text)` is space-specific, so these runs are diagnostic rather than final. Commit `ed12965a` replaces that predicate with a POSIX all-whitespace rejection and adds space plus tab/newline cases; final evidence must use that corrected committed source.

Final corrected evidence used commit `3aa56cf7b8b6bfb7de48c3eb506e49116c9a37aa` and image `sha256:96958caa3677f5b71ff1bdcd8e18c170e4ab9cf02c573ae372b61881ebf1ea7f`. Runs `20260805T010300Z-fbf490` and `20260805T011742Z-1fb3a9` each passed all 12 checks and cleanup in `738,736ms` and `763,918ms`. Their summary hashes are `b6bf59bcd826ae28c34efc50af26ab29df0e286c4ebfc89020f5050ff4e00118` and `14cc3d841f8388b78b855a5ce466a8c2d3167332070aa08a6221d65397f33fe9`; their evidence hashes are `cb4b9da961c43046d2a95b3e435d85546a38eef52490a282d81c005b83a84dd2` and `d606504fd11595db88d55e72d7a086b776eee8faa55dba2aae72e53a8571c951`. An independent post-run audit found no labeled containers, volumes, dedicated network, or listeners on ports 54321, 54322, 4173, 8787, or 8788.

The queued-credential review correction supersedes that evidence for the scheduler authentication boundary. Code commit `a4719b0372ae48f837c24eb275725ae1e6236216` and image `sha256:86002d8738990fcbc605c2bb3ad32674620ea3df7edda6d2d7c6a7a53dfb50c4` completed two consecutive cold runs: `20260805T032957Z-afc1d2` passed `12/12` plus cleanup in `661,167ms` with summary hash `996427c99fe71f78b4c8e38667c0bc93361e010a586e159e13d74934d915a1be` and evidence hash `f611cecec3b3be5c4073a0ab6f4bce99b71d9dd3753acf198a5332625f1fd451`; `20260805T034122Z-f8a644` passed `12/12` plus cleanup in `636,992ms` with summary hash `51a0e8d85afbbf15acc657a148e2913307646b05e19c654b18f81022e6593b26` and evidence hash `a2391dd39628abde3882ff718314bd07081ba103a378a41e018d45af846ea9da`. Independent post-run inspection found no labeled containers, volumes, or dedicated network, and the unrelated `deno.lock` diff hash remained `a14e5d005cba9b2d93c5ee23de9678ebdce2be9c`.

### Promotion And Rollback

Deploy code and migrations with runtime `disabled`, zero hosted jobs, and zero hosted Vault names. Promote to `shadow` only after a recorded owner decision and prove synthetic tenant/auth/create/list/detail parity with no runner, model, or draft write. Production `advisory` is additionally blocked until:

- the encoded `365/90/30` periods receive a separately reviewed operational activation and deletion design; current prune status is `policy_unapproved` and deletion remains zero
- human protected-path, Supabase, security, privacy, product, and clinical reviewers approve the rollout
- CalOptima editable draft-table writes are explicitly accepted for advisory mode
- an authenticated synthetic legacy-shaped request returns `503 legacy_generation_disabled` before assessment lookup/provider execution, and scheduler cadence is owner-approved

On any gate, policy, tenant, secret, queue, or postcondition failure: set Ledger mode to `disabled` first, call the hosted disable function, preserve sanitized PHI-free counts/hashes/reason codes, and verify both fixed jobs are absent. Do not silently drain or delete queued work; reconcile it against authoritative domain state. Remove the four hosted Vault names only after the disabled state and evidence are recorded. The operator-only scheduler functions are configuration controls, not promotion authority: do not enable hosted jobs while retention remains `policy_unapproved` or before draft-write and cadence approvals. Logs, Cron bodies, queue messages, events, traces, and exported artifacts must contain no PHI, prompts, source evidence, or secret material.

## Hosted Shadow Proof

The hosted shadow proof is owner-dispatched, shadow-only, and human review gated. It starts in `disabled`, temporarily sets only `shadow`, then restores `disabled` before cleanup. It must not enter `advisory` or `active`.

Hosted preflight uses only direct read-only catalog and relation inventory. It fails before synthetic fixture setup if `pg_cron` is installed, because the approved shadow baseline has no hosted scheduler extension or jobs and the read-only executor must not invoke privileged scheduler controls to infer that state.

`agent_execution_traces` is a shared observability table, not a Ledger-owned zero-baseline table. Every hosted trace check matches either deterministic synthetic organization ID or either exact synthetic work-item ID; preflight uses NIL work-item placeholders before creation. Cleanup deletes that same exact synthetic trace scope and final verification requires it to be empty, so a malformed trace cannot evade cleanup through missing or incorrect organization attribution. Historical traces unrelated to those synthetic identities do not block the proof and are never read into artifacts or deleted. Ledger-owned tables, Queue, and archive retain their global-zero preflight requirement; any synthetic-scope attempt, effect, trace, or draft-packet row still fails the shadow proof.

The protected workflow validates the immutable current `main` SHA, checks out only that SHA, requires a successful GitHub Actions `ci-gate` on the exact PR head, and keeps secrets step-scoped. Dispatch must use the `main` workflow ref and identify the merged WIN-275 PR whose merge commit is current `main`. Independent-human approval remains the default and uses acknowledgement `I_APPROVE_AGENT_WORK_LEDGER_HOSTED_SHADOW_PROOF`.

This personal repository may instead use the `solo-maintainer owner-attested critical lane` with acknowledgement `I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_AGENT_WORK_LEDGER_HOSTED_SHADOW_PROOF`. That path requires live personal-owner login and numeric-ID matching, exactly one GitHub human maintainer with write-or-higher access, paginated authority checks, and a committed manifest whose SHA-256 inventory binds passing code, security, test, and Supabase agent reviews to the protected surfaces. Authority is revalidated immediately before hosted access. Any ambiguity fails closed; if another eligible human exists, use independent approval. The single job uploads only sanitized approval and proof evidence, and private temp state never crosses artifacts.

The workflow owns these internal phases; operators must not invoke them directly:

```powershell
node scripts/agent-work-ledger-hosted-shadow-proof.mjs preflight/setup
node scripts/agent-work-ledger-hosted-shadow-proof.mjs proof
node scripts/agent-work-ledger-hosted-shadow-proof.mjs cleanup/verify
```

After disabled restoration, Ledger and queue cleanup runs as one atomic Management API transaction scoped to strictly validated synthetic UUIDs. Foreign keys remain enforced; only the append-only event trigger is disabled around the exact synthetic event delete and re-enabled before commit. A failed transaction rolls that trigger change back. Parameterized queries then remove only the two synthetic auth identities and organizations. Direct disabled-mode restore steps run both before and after cleanup as independent fallbacks. Optional Vault access is guarded by extension detection. This is not a reusable cleanup API or retention deletion path. Sanitized evidence remains PHI-free and limited to fixed booleans, counts, timings, and hashes.

Validate the workflow/script contract locally with `npm run agent-work:hosted-shadow-proof:contract`. After the reviewed PR is merged and remains the current `main` head, the repository owner may dispatch the protected workflow through the applicable review route:

```powershell
gh workflow run agent-work-ledger-hosted-shadow-proof.yml --ref main -f commit_sha=<40-character-main-sha> -f pull_request_number=<merged-pr-number> -f approval_acknowledgement=I_APPROVE_AGENT_WORK_LEDGER_HOSTED_SHADOW_PROOF

# Solo-maintainer route only after the workflow proves eligibility and the owner separately merged the PR.
gh workflow run agent-work-ledger-hosted-shadow-proof.yml --ref main -f commit_sha=<40-character-main-sha> -f pull_request_number=<merged-pr-number> -f approval_acknowledgement=I_ATTEST_SOLO_MAINTAINER_CRITICAL_REVIEW_AND_APPROVE_AGENT_WORK_LEDGER_HOSTED_SHADOW_PROOF
```
