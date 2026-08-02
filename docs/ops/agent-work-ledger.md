# Agent Work Ledger Ops

## Local Command

Run `npm run agent-work:shadow-parity`.

The package command always goes through `scripts/agent-work-ledger-local-env.ts run -- ...`, then launches `node scripts/agent-work-ledger-shadow-parity.mjs`. The script independently rejects non-loopback URLs, requires the URLs to exactly match the running stack discovered from the pinned local Supabase CLI, defaults the runtime to `shadow`, and fails if `AGENT_WORK_LEDGER_RUNTIME_MODE` is set to anything else.

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

This command tests the pre-runner shadow adapter and supported work-item creation boundary. It does not fabricate final ledger step state or claim to exercise the queue/runner transition path planned for Task 9.

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
