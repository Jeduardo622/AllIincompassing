# WIN-101 Stream B — Session note measurement Playwright roundtrip

Parent: **WIN-101** (Session Data Collection 2.0). Stream A (server write parity) landed in PR `#435` / merge `c961e561`.

## Route-task (this slice)

- **classification:** `low-risk autonomous`
- **lane:** `standard`
- **why:** Tightens Playwright assertions and a stable DOM hook for the existing measurement roundtrip; does not change auth, deploy, or `/api/session-notes/upsert` semantics.

## Audit: how the roundtrip runs today

| Surface | Behavior |
|--------|----------|
| **npm script** | `playwright:session-note-measurement-roundtrip` → `tsx scripts/playwright-session-note-measurement-roundtrip.ts` |
| **`ci:playwright`** | Runs **after** `playwright:schedule-blocked-close` and **includes** `playwright:session-note-measurement-roundtrip` (order enforced by `scripts/ci/check-e2e-reliability-gates.mjs` and `npm run ci:check-focused`) |
| **GitHub Actions `auth-browser-smoke`** | Runs preflight → auth → session-lifecycle → session-complete → schedule-blocked-close → **session-note-measurement-roundtrip**, with `CI_SESSION_PARITY_REQUIRED=true` |

## PR vs push caveat (important)

In `.github/workflows/ci.yml`, the **auth-browser-smoke** step checks required secrets. On **`pull_request`**, if any secret is missing, the step **exits 0** and **does not run Playwright** (warning only). **Push** / merge-queue runs with secrets are the authoritative path that exercises the full gate. A green PR check is **not** proof the roundtrip ran unless secrets were present.

## Stream B changes (this work)

1. **API contract checks:** After each `/api/session-notes/upsert` response, assert `goal_measurements[goalId].data.metric_value` matches the saved value (initial and updated).
2. **Stable selector:** `data-testid="session-note-edit-button"` on the session note **Edit** control; Playwright and `SessionNotesTab.measurementMutation` unit test use it instead of role-only matching.

## Verification

- Local (no cloud secrets): `npm run ci:check-focused` (includes e2e wiring gate), `npm run lint`, `npm run typecheck`, `npx vitest run src/components/__tests__/SessionNotesTab.measurementMutation.test.tsx`
- With full Playwright env: `npm run playwright:session-note-measurement-roundtrip` (or chain after `playwright:schedule-blocked-close` as in CI)

## Residual risk

- Static guard does not prove a given PR executed Playwright; rely on merge/push runs with secrets.
- Non-chained Supabase patterns are out of scope for this script (unchanged).
