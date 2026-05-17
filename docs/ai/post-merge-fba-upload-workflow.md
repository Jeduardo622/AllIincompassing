# Post-merge cleanup: FBA upload + draft workflow

Use this checklist after the merged FBA upload/orchestration work on `main` (notably PRs [#544](https://github.com/Jeduardo622/AllIincompassing/pull/544), [#546](https://github.com/Jeduardo622/AllIincompassing/pull/546), and [#547](https://github.com/Jeduardo622/AllIincompassing/pull/547)).

## Product / support

- [ ] **Smoke the happy path:** In Programs & Goals, upload the tracked redacted sample `7.21.2025_RoVa_CalOptima_FBA_FINAL (1).Redacted.docx.pdf`, confirm the UI reports that the CalOptima FBA was uploaded and the checklist was initialized, then wait for extraction to finish.
- [ ] **Confirm upload restrictions:** The workflow should only offer **CalOptima FBA** in this promotion flow, and the file picker should accept only `.pdf,.docx`.
- [ ] **Review-gate draft generation:** Confirm draft generation stays disabled until extraction completes and at least one structured CalOptima goal section is approved.
- [ ] **Verify existing-draft guidance:** If the uploaded assessment is already in `drafted` state with stored draft rows, confirm the UI tells the user to review existing drafts instead of regenerating.
- [ ] **Verify failure copy:** If extraction fails, confirm users see the extraction-specific guidance rather than generic waiting copy. If no usable checklist evidence exists, the retry/generate action should stay disabled.

## Engineering

- [ ] **Preview/staging smoke:** Repeat the happy-path upload on a deployed environment, not only localhost.
- [ ] **Observe async extraction:** Watch server/edge logs for background extraction failures after upload, especially document fetch, claim, structured-section persistence, and Adobe/PDF parsing failures.
- [ ] **Observe draft generation:** Watch `generate-program-goals` failures separately from upload success so regressions do not get misread as storage issues.
- [ ] **Confirm staged-only safety:** Verify the workflow still writes generated output to assessment drafts first, with BCBA review/promotion remaining the gate before live `programs` / `goals` writes.

## Follow-up debt

- [ ] **Legacy fallback cleanup:** Remove any remaining transitional UI fallback paths around the payload upgrade in `ProgramsGoalsTab` once no old clients depend on them.
- [ ] **Validation hardening:** Add non-breaking DB or contract-level validation for allowed `review_flags` vocabulary on staged draft records if rollout data shows drift risk.
- [ ] **Failure-mode coverage:** Expand targeted tests for rollback behavior, missing program mapping, and fallback schema validation around `generate-program-goals`.

## Residual risk

- Upload success and extraction success are now decoupled. A file can be accepted into storage while the background extraction or draft-generation steps still fail later.
- The workflow is intentionally CalOptima-only in this promotion path. If IEHP or other templates need parity later, treat that as new scoped work rather than reopening this merged slice.
