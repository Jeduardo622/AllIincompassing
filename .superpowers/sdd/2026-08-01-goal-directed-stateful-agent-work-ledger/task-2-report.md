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
