# WIN-154 IEHP FBA Matrix Proof Recovery

- Date: August 12, 2026
- Linear: `WIN-154`
- Branch: `codex/win-154-fba-matrix-proof-recovery`
- Classification: `low-risk autonomous`
- Lane: `fast`

## Why This PR Exists

PR `#937` merged the seven-case IEHP PDF catalog and eight-evidence hosted proof contract before the required owner-dispatched Adobe proof ran. PR `#938` then merged the same head as an empty follow-up commit. The protected workflow accepts only an open same-repository PR targeting `main`, so neither merged PR can now provide the missing immutable preview proof.

This docs-only PR restores an eligible open PR head without changing application, parser, test-runner, workflow, Supabase, auth, secret, or deployment behavior. The proof must execute against this PR's exact head and immutable Netlify deploy preview.

## Scope And Safety

- Allowed change: this handoff only.
- Existing proof command: `npm run playwright:iehp-assessment-import-pdf-mini-matrix`.
- Existing production extractor: Adobe-backed hosted extraction through the authenticated upload workflow.
- Expected evidence: seven PDF catalog cases plus one Skills & Behaviors proof case.
- Data boundary: synthetic data only; no customer document, PHI, raw OCR text, credentials, or private logs may enter committed or public artifacts.
- Cleanup boundary: all eight uploaded assessments and storage objects plus the synthetic smoke admin must be cleanup-verified.

## Required Owner Dispatch

From a repository-owner GitHub session, dispatch `.github/workflows/iehp-pdf-mini-matrix-proof.yml` with:

- `commit_sha`: the exact 40-character head SHA of this open PR
- `pull_request_number`: this open PR number
- `approval_acknowledgement`: `I_APPROVE_IEHP_PDF_MINI_MATRIX`

Codex must not supply or infer the protected acknowledgement on the owner's behalf.

## Acceptance Evidence

The workflow is complete only when the curated redacted aggregate reports:

- `totalCases: 8`
- `passedCases: 8`
- `cleanupVerifiedCases: 8`
- `skillsBehaviorsVerifiedCases: 1`

The validation and proof checkouts must match the PR head SHA, the immutable Netlify deploy must match that SHA, all cleanup steps must pass, and curated public artifacts must contain no raw synthetic phone values or private logs.

## Next Slice Gate

Do not add another PDF degradation case until this recovery proof passes. After it passes, the next bounded QA slice should target Skills & Behaviors under document degradation rather than adding another referral-date/phone-only variant.
