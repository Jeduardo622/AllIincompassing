implementation summary

- Completed the tenant-safe ledger foundation in `supabase/migrations/20260801090000_agent_work_ledger_core.sql` with hardened helper/RPC `search_path`, explicit execute revokes/grants, and tighter approvals read scope.
- Rebuilt `scripts/agent-work-ledger-security-contract.mjs` into an executable local contract that now checks:
  - table existence
  - forced RLS
  - denied anon/authenticated direct mutations
  - org isolation
  - client isolation
  - approval role enforcement
  - append-only events
  - forbidden broad grants
  - helper/RPC execute grants and `search_path`
  - trace FK columns
  - atomic claim/CAS transition behavior
- Regenerated `src/lib/generated/database.types.ts` from the local database after the migration changes.

exact RED and GREEN commands/output

RED

```powershell
npm run agent-work:db:reset
npm run agent-work:security-contract
```

Observed REDs during the TDD loop:

```text
Agent work ledger security contract failed.
app.current_user_can_read_agent_work_row(uuid,uuid) must set search_path to "public, pg_temp" (found "public, app, auth, pg_temp")
```

```text
Agent work ledger security contract failed.
new row for relation "organizations" violates check constraint "organizations_metadata_valid"
```

```text
Agent work ledger security contract failed.
Stale state version
```

GREEN

```powershell
npm run agent-work:security-contract
```

```text
Agent work ledger security contract passed.
```

files changed

- `supabase/migrations/20260801090000_agent_work_ledger_core.sql`
- `scripts/agent-work-ledger-security-contract.mjs`
- `src/lib/generated/database.types.ts`

verification results and known blocked/unrelated gate

- `npm run agent-work:security-contract`
  - pass
- `npm run validate:tenant`
  - pass
  - output: `tenant-safety: all checks passed`
- `npm run typecheck`
  - pass
- `npm run ci:check-focused`
  - fail, known unrelated inventory drift
  - output:

```text
API convergence check failed:
- Runtime exception for assessment-checklist.ts expired on 2026-07-31.
- Runtime exception for assessment-template-layout.ts expired on 2026-07-31.
- Runtime exception for assessment-documents.ts expired on 2026-07-31.
- Runtime exception for assessment-drafts.ts expired on 2026-07-31.
- Runtime exception for assessment-plan-pdf.ts expired on 2026-07-31.
- Runtime exception for assessment-promote.ts expired on 2026-07-31.
- Runtime exception for dashboard.ts expired on 2026-07-31.
- Runtime exception for book.ts expired on 2026-07-31.
- Runtime exception for sessions-start.ts expired on 2026-07-31.
```

self-review findings and concerns

- The migration-side fixes are narrowly scoped to Task 2 surfaces:
  - helper/RPC hardening
  - approval visibility tightening
  - no hosted/project-ref paths
- The contract script is now rerunnable against the same healthy local DB without forcing a reset for every fixture-only change:
  - run-scoped document IDs
  - run-scoped dedupe keys
  - valid synthetic organization metadata
- Residual concern:
  - `ci:check-focused` remains blocked by the unrelated July 31 expired runtime-exception inventory and was intentionally not altered in this slice.

## Fix round 1

### Implementation summary

- `claim_agent_work_step` now locks and explicitly rejects completed, failed, and cancelled work items, validates PHI-free worker identifiers, and excludes `execution_mode = 'human'` steps from claims.
- Running transitions now require `worker_id` and `attempt_id` in `p_sanitized_metadata`, bind them to the current lease owner and running attempt, and reject cross-worker, stale-attempt, and expired-lease calls without changing the fixed six-argument signature.
- Running attempts are finalized atomically for completed, failed, cancelled, requeued, waiting, and approval-handoff transitions, with `finished_at` and event `attempt_id` recorded.
- `needs_approval -> completed` now requires a current, non-expired approved approval matching work item, step, organization, client, exact required role, active `user_roles` authority for the decider, step input hash, and latest step evidence hash.
- Transition event metadata now has an explicit key allowlist, object/primitive-only structure, 128-character string bounds, URL rejection, a bounded machine-code reason, and required PHI-free worker/attempt context for running steps.
- Work-item parent and dependency edges now reject cross-organization, cross-client, null-client mismatch, and endpoint scope mutation. Parent/dependency read policies authorize both endpoints.
- `agent_work_recompute_item_status` is no longer directly executable by runtime roles and is covered by the function privilege contract. New graph trigger/endpoint helpers are also covered.
- Local generated database types were regenerated after the final migration change.

### Exact RED evidence

Each RED used the local-only wrapper with `SUPABASE_PROJECT_REF` and `VITE_SUPABASE_PROJECT_REF` removed from the child PowerShell process:

```powershell
npm run agent-work:security-contract
```

Observed focused RED outputs, one behavior at a time:

```text
Agent work ledger security contract failed.
completed work-item claim unexpectedly succeeded

Agent work ledger security contract failed.
cross-worker transition unexpectedly succeeded

Agent work ledger security contract failed.
completed transition must settle attempt as completed, found running

Agent work ledger security contract failed.
approval bypass without approval unexpectedly succeeded

Agent work ledger security contract failed.
arbitrary event metadata key unexpectedly succeeded

Agent work ledger security contract failed.
nested event metadata value unexpectedly succeeded

Agent work ledger security contract failed.
oversized event metadata string unexpectedly succeeded

Agent work ledger security contract failed.
URL event metadata value unexpectedly succeeded

Agent work ledger security contract failed.
free-text transition reason unexpectedly succeeded

Agent work ledger security contract failed.
cross-client work-item dependency unexpectedly succeeded

Agent work ledger security contract failed.
cross-client parent work item unexpectedly succeeded

Agent work ledger security contract failed.
Dependency read policy must authorize both endpoints, found 1 visible edge(s)

Agent work ledger security contract failed.
Parent read policy must authorize both endpoints, found 1 visible child row(s)

Agent work ledger security contract failed.
agent_work_recompute_item_status(uuid) execute grants mismatch for public: expected false, found true

Agent work ledger security contract failed.
dependency endpoint client mutation unexpectedly succeeded
```

### Exact GREEN evidence

The final migration replay rebuilt the local database and applied `20260801090000_agent_work_ledger_core.sql`. The Supabase CLI then returned a Docker restart `502`; the local fail-closed preflight immediately proved the rebuilt stack healthy, and the full focused contract passed against that fresh database:

```powershell
npm run agent-work:db:reset
npm run agent-work:local:preflight
npm run agent-work:security-contract
```

```text
Applying migration 20260801090000_agent_work_ledger_core.sql...
Restarting containers...
Error status 502: An invalid response was received from the upstream server

Local agent-work preflight passed.
Agent work ledger security contract passed.
```

Local type generation:

```powershell
.\node_modules\.bin\supabase.cmd gen types typescript --local --schema public
```

```text
Connecting to db 5432
```

### Files changed

- `supabase/migrations/20260801090000_agent_work_ledger_core.sql`
- `scripts/agent-work-ledger-security-contract.mjs`
- `src/lib/generated/database.types.ts`
- `.superpowers/sdd/2026-08-01-goal-directed-stateful-agent-work-ledger/task-2-report.md`

### Verification card

- classification: `high-risk human-reviewed`
- lane: `critical`
- change type: database/RLS/migration/tenant isolation/RPC and grant hardening
- required focused checks:
  - `npm run agent-work:security-contract`
  - `npm run validate:tenant`
  - `npm run typecheck`
  - `npm run ci:check-focused`
- executed checks:
  - `npm run agent-work:security-contract` -> pass: `Agent work ledger security contract passed.`
  - `npm run validate:tenant` -> pass: `tenant-safety: all checks passed`
  - `npm run typecheck` -> pass
  - `npm run ci:check-focused` -> fail only on the pre-existing owner-waived July 31, 2026 exception expiry inventory
- blocked checks: `npm run ci:check-focused` -> unrelated expired entries for assessment-checklist, assessment-template-layout, assessment-documents, assessment-drafts, assessment-plan-pdf, assessment-promote, dashboard, book, and sessions-start; inventory intentionally unchanged
- result: `pass-with-blocked-checks`
- reviewer: prior code, Supabase, and security reviews supplied the verified load-bearing findings; this fix commit requires human re-review before merge
- residual risk: Task 4 must add the repository actor/scope gate around service-role worker calls. Task 2 now proves lease owner/current attempt but intentionally does not change the six-argument transition signature or infer repository caller scope.

### Self-review findings and concerns

- The final self-review added endpoint scope-mutation protection after detecting that insert/update edge triggers alone would not prevent later organization/client drift.
- The contract covers terminal and human-step claims; cross-worker, stale-attempt, and expired-lease transitions; attempt settlement; approval/hash/role/expiry bypasses; arbitrary/nested/oversized/URL metadata; cross-client, null-client, cross-org, and endpoint-mutation graph cases; both-endpoint reads; append-only events; and all privileged helper grants.
- Domain assessment tables remain authoritative. The ledger stores only identifiers, state, hashes, machine reason codes, and bounded sanitized metadata.
- No `.env*`, hosted Supabase, project ref, GitHub, Netlify, customer data, PHI, or later-task files were accessed or changed.
- Local Supabase repeatedly returned a post-restart `502` after successfully rebuilding and applying migrations. Immediate preflight and contract runs passed; this is recorded as a local Docker restart concern, not treated as a schema failure.
- The normal Husky commit hook was attempted and failed solely on the same owner-waived `ci:check-focused` exception expiries. The focused local commit therefore used the explicitly authorized `--no-verify` bypass; CI inventory was not changed.
