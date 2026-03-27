# WIN-33 Persona-Route Triage Matrix

Status: Planning/docs-only. No auth/runtime/server code changes.

Issue: `WIN-33`  
Child slice: `WIN-51` (`WIN-33A`)

## Route-Task (fresh)

- classification: `low-risk autonomous`
- lane: `fast`
- why: docs-only triage artifact under `docs/**` to reduce boundary ambiguity before any protected implementation
- triggering paths: `docs/ai/WIN-33-persona-route-triage-matrix.md`
- reviewer required: no (docs-only lane baseline)
- verify-change required: no (docs-only lane baseline)
- mandatory checks: manual validation of commands, file paths, and references (per `docs/ai/verification-matrix.md` docs/process change type)

## Archived Failing Snapshot (Re-Verify Before Implementation)

Historical evidence source: `docs/PHASE3_EXECUTION_STATUS_2026_03_12.md`

| Command | Deterministic result in archived snapshot | Failing route | Persona expectation | Observed behavior |
| --- | --- | --- | --- | --- |
| `npm run playwright:schedule-conflict` | Fail (`env/role`) | `/schedule` | configured schedule-capable persona should load route | redirected/blocked as `/unauthorized` |
| `npm run playwright:therapist-onboarding` | Fail (`env/role`) | `/therapists/new` | configured admin/super-admin should load route | redirected/blocked as `/unauthorized` |
| `npm run ci:playwright` | Fail (downstream) | composite | suite should be green when route-role contracts hold | fails after above preconditions are unmet |

## Ownership Boundary Decision Tree

Use this boundary split before opening implementation work:

1. **Fixture or credential-to-role mismatch**
   - Owner: test-data/auth-ops
   - Typical signals: login succeeds but expected role claims/route access do not match fixture assumptions
2. **Route policy/guard mismatch**
   - Owner: frontend routing/auth guard owner
   - Typical signals: role claims look correct but route protection rules still deny expected path
3. **Server/edge authorization mismatch**
   - Owner: API/edge owner
   - Typical signals: route loads but downstream API/edge contract rejects actor scope

## Escalation Triggers (Force Critical Lane)

If any proposed fix touches these paths, reroute immediately to `critical`:

- `src/lib/auth*`
- `src/lib/runtimeConfig*`
- `src/server/**`
- `supabase/functions/**`
- `supabase/migrations/**`
- `.github/workflows/**`
- `scripts/ci/**`
- `netlify.toml`

Also reroute to `critical` if a proposed change alters authz semantics or tenant-boundary behavior even outside the listed globs (RLS/grants/RPC exposure, impersonation, or secrets-handling paths).

## Minimum Safe Next Step (Non-Protected)

Before implementation:

1. Confirm one primary failing command/spec from current environment run.
2. Record expected vs observed route outcome for that single spec.
3. Assign ownership boundary (fixture/auth-ops vs route guard vs server/edge).
4. Open a narrowly scoped implementation child issue with fresh route-task.

## Acceptance Criteria For This Docs Slice

- Deterministic failing units are documented with command and route.
- Ownership boundary choices are explicit.
- Escalation triggers to protected paths are explicit.
- Next implementation slice can be opened without ambiguity.
