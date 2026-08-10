# WIN-240 BT Session Closeout Recovery

## Routing

- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Why: the frontend recovery exposed a legacy-role mismatch in tenant-scoped BT closeout RPC authorization.
- Triggering paths: `supabase/migrations/**`, RPC grants, role checks, and session-note finalization side effects.

## Scope

- Restore BT closeout mode for users whose authoritative exact role is legacy `therapist` and whose effective role is `bt`.
- Keep start-session authority restricted to exact `bt` assignments.
- Allow legacy therapist closeout only for the same organization and an active assigned or linked BT/RBT therapist identity.
- Deny elevated `admin`, `admin_schedule`, `midtier`, and `bcba` overlaps.
- Preserve existing billing, capture-capability, note-lock, correction-read, and finalization behavior.
- Do not change global role normalization, table RLS, CI workflows, deployment configuration, or hosted Supabase state.

## Implementation

- `Schedule` now opens the data-only closeout flow only when authoritative role assignments contain exact `bt` without excluded overlaps or exclusive legacy `therapist`; profile-only aliases fail closed.
- Auth stub role assignments preserve exact role names so local and integration tests exercise the same authority boundary as production.
- A new internal, service-role-only helper centralizes the closeout actor predicate for the billing resolver, draft, read, finalize, and supervision-request creator RPCs.
- The helper accepts authoritative active `bt` or legacy `therapist` roles, then applies the existing same-org, active BT/RBT, direct-or-linked assignment, and elevated-role denial checks.
- Resolver, draft, and finalize retain their existing trial-capture capability checks; read and supervision-request creation were not tightened.

## Verification Card

- Required checks: focused migration and Schedule regressions; policy; lint; typecheck; full test suite; tenant validation; build; local SQL reset/smoke; exact-head CI; human protected-path review.
- Focused migration contracts: PASS, 3 files / 22 tests.
- Focused frontend authority regressions: PASS, 2 files / 22 tests (3 Schedule closeout cases and 19 auth-context/stub cases).
- `npm run ci:check-focused`: PASS; DB-backed grant/parity checks skipped because no database URL is configured.
- `npm run lint`: PASS.
- `npm run typecheck`: PASS.
- `NODE_OPTIONS=--max-old-space-size=8192 npm run test:ci`: PASS, 483 files / 4,156 tests; 2 files and 5 environment-gated tests skipped.
- Final `NODE_OPTIONS=--max-old-space-size=8192 npm run verify:local`: NOT GREEN because the aggregate full-suite rerun had two order/load-sensitive `SessionModal` failures; the affected file passed immediately in isolation, 1 file / 165 tests.
- `npm run ci:verify-coverage`: PASS, 92.92% line coverage against the 86% threshold.
- `npm run validate:tenant`: PASS.
- `npm run build`: PASS.
- `npm run test:routes:tier0`: PASS, 7 specs / 220 tests.
- `npm run test:ui:responsive -- --base-url=http://127.0.0.1:4173 --route=/schedule`: FAIL on the unauthenticated route shell with existing `console-error` at both viewports and `undersized-mobile-touch-target` on mobile; sanitized evidence was generated, but it cannot exercise the authenticated BT closeout modal.
- Default-heap `npm run test:ci`: failed at the local approximately 4 GB Node heap limit; the bounded 8 GB rerun passed.
- `npx supabase db reset --local --yes`: BLOCKED because the Docker Desktop Linux engine is unavailable.
- `tests/sql/bt_aba_session_note_closeout_smoke.sql`: not executed locally because the reset database is unavailable; static contracts cover linked legacy success plus unlinked, elevated, and cross-org denials.
- Result: `pass-with-blocked-checks` pending exact-head CI, authenticated responsive evidence, runtime SQL smoke, aggregate-suite stability, and human review.
- Residual risk: the new SQL actor matrix has not run against a reset database in this workspace.

## Review

- Specification, architecture, implementation, code review, test review, Supabase review, and security review are required for this critical slice.
- Code review and Supabase review found no implementation defect after adding the same-org unlinked legacy therapist denial.
- Security review approved after the legacy branch was restricted to an exclusive active `therapist` role and overlap-denial smoke coverage was added.
- Follow-up security review approved the authoritative frontend gate; profile-only and mixed `bt` plus `therapist` assignments remain denied.
- Final merge remains human-controlled; no hosted migration apply or deployment is part of this PR update.

## PR Hygiene

- Branch: `codex/recover-bt-session-closeout`
- Linear: `WIN-240`
- PR: `#919`
- Single-purpose diff: yes.
- Generated artifact drift: none.
- Current external blocker before this update: hosted `auth-browser-smoke` failed during synthetic admin provisioning with `Database error finding users`; `ci-gate` failed only as a consequence.
