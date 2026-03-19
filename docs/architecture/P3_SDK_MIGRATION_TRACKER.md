# Priority 3 SDK + Scheduling Migration Tracker

## Objective

Track wrapper deprecation and scheduling decomposition as Priority 3 remediation rolls out.

## Wrapper Convergence Status

| Surface | Current role | Canonical replacement | Status | Owner | Removal target |
| --- | --- | --- | --- | --- | --- |
| `src/lib/sdk/client.ts` | Canonical request client (API + edge) | N/A | active | Platform | N/A |
| `src/lib/api.ts` | Compatibility shim for API/edge callers | `src/lib/sdk/client.ts` | migrating | Platform | 2026-06-30 |
| `src/lib/supabase.ts#callEdge` | Compatibility edge helper | `src/lib/sdk/client.ts` | migrating | Platform | 2026-06-30 |
| `src/lib/edgeInvoke.ts` | Legacy response-shape shim for super-admin flows | `src/lib/sdk/client.ts` (+ typed adapters) | migrating | Platform | 2026-07-15 |

## Scheduling Decomposition Status

| Area | Extracted module | Status | Notes |
| --- | --- | --- | --- |
| Booking transport + payload mapping | `src/features/scheduling/domain/booking.ts` | done | Schedule route now calls domain service |
| Session-start edge invocation | `src/features/scheduling/domain/sessionStart.ts` | done | Session modal uses validated domain request |
| Time normalization/conversion | `src/features/scheduling/domain/time.ts` | done | Session modal uses shared conversion helpers |
| Remaining UI orchestration split | `src/features/scheduling/**` additional hooks/services | in_progress | Continue extracting stateful route logic from Schedule/SessionModal |

## Rollback Guidance

- If a regression is isolated to SDK wrappers, restore callsites to prior shim (`src/lib/api.ts` and `src/lib/supabase.ts#callEdge`) while preserving contract tests.
- If modal/session behavior regresses, revert only `src/features/scheduling/domain/*` callsite wiring in `Schedule`/`SessionModal`; keep tests as failing evidence until fixed.
- Do not remove compatibility shims before callsite inventory is fully migrated and CI parity tests pass.
