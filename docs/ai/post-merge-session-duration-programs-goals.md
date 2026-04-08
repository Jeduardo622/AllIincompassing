# Post-merge cleanup: session duration & Programs/Goals archive

Use this checklist after [PR #382](https://github.com/Jeduardo622/AllIincompassing/pull/382) (or equivalent) merges to `main`.

## Product / support

- [ ] **Smoke the schedule modal:** Create and edit sessions with **non–1-hour** lengths (e.g. 45 min, 90 min). Confirm conflict detection still matches the chosen window.
- [ ] **Smoke Programs & Goals:** Archive a **goal** and a **program** in a test client; confirm they disappear from the live lists and that scheduling/session flows still behave if remaining programs/goals exist.
- [ ] **Set expectations:** “Remove” in the UI **archives** (`status: archived`), not hard delete. Update internal docs or training notes if clinicians expect permanent deletion.

## Engineering

- [ ] **Staging / preview:** Run the same smokes on a deployed environment (not only localhost).
- [ ] **Errors:** Watch Supabase/edge logs for failed `PATCH` on `programs` / `goals` after release (RLS, validation, or network).
- [ ] **Optional test debt:** Add a focused unit or Playwright case for “edit session duration preserves length” and/or archive buttons if regressions are a concern.

## Edge cases (backlog if seen in the wild)

- Sessions crossing **DST** boundaries: verify start/end once around a transition if you operate in non-UTC zones with DST.
- **Cross-midnight** sessions (end before start on the same calendar day): booking APIs may already reject; confirm UX if users report confusion.

## Residual risk

- Archiving a program does **not** auto-archive its goals; orphans are avoided only by product convention. Follow up if the data model should enforce cascades or block archive when goals are active.
