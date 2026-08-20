# WIN-43 Docs-Only QA Audit Credential Handoff

Status: Docs-only provisioning retry anchor. No credential values. No runtime changes.

Issue: `WIN-43`  
Sub-slice intent: enable safe handoff for credential-dependent browser audit work without exposing secrets.

## Route-Task (for this docs sub-slice)

- classification: `low-risk autonomous`
- lane: `fast`
- why: docs/process clarification only in `docs/**`; no auth/runtime/protected-path edits
- triggering paths: `docs/ai/WIN-43-qa-audit-credential-handoff.md`
- required agents: none (docs/process only)
- reviewer required: no (route-task docs-only baseline)
- verify-change required: no (route-task docs-only baseline)
- mandatory checks: manual verification of links/commands/paths
- blocking conditions:
  - secure credential workflow owner is not assigned
  - credential retrieval path is undefined
  - evidence destination for audit rerun is undefined
- linear required: no (already scoped as a child docs slice under `WIN-43`)

## Purpose

Document ownership and evidence expectations for QA credential bootstrap so browser re-audits can proceed safely in a human-reviewed workflow.

## Explicit Non-Goals

- Do not store, display, or rotate secrets in this doc.
- Do not validate real credentials in this docs sub-slice.
- Do not modify auth/session/runtime code or test harness behavior.

## Ownership and Handoff Checklist

- [ ] Assign a human owner for QA account lifecycle (create/disable/rotate outside this repo).
- [ ] Confirm non-production environment boundary for QA login usage.
- [ ] Confirm approved role profile (therapist/admin) for Programs and Goals flow.
- [ ] Record where secure credential retrieval is handled (ticket/runbook reference only, no secret values).
- [ ] Confirm a canonical test client identifier source (reference location only).
- [ ] Define evidence storage location for audit rerun outputs (screenshots, pass/fail note, timestamp).

## Canonical upload artifact (Programs & Goals extraction re-audit)

For **production** Playwright MCP runs that exercise **assessment upload → extraction → draft/Programs & Goals** flows, use this **tracked, redacted** sample at the repository root:

- `7.21.2025_RoVa_CalOptima_FBA_FINAL (1).Redacted.docx.pdf`

Pick that file from the local workspace when the upload control prompts for a file (absolute path on your machine will match your clone, e.g. `<repo-root>/7.21.2025_RoVa_CalOptima_FBA_FINAL (1).Redacted.docx.pdf`). Do not substitute unrelated PDFs for WIN-43 evidence unless the scenario explicitly requires a negative test.

## Safe Verification Notes

- Browser re-audit remains blocked until persistent personas are provisioned, the sanitized manifest is validated, and active `PW_*` secrets are rotated through the approved secure channel.
- This doc unblocks coordination only; it does not satisfy the execution acceptance criteria for `WIN-43`.

## Provisioning Retry Anchor (2026-08-20)

This docs-only update establishes a fresh reviewed-current-main anchor for the owner-dispatched `Provision Persistent QA Personas` workflow after unrelated merges moved `main` beyond PR #978.

Sanitized readiness evidence:

- Run `32322146492` failed at exact acknowledgement validation before checkout or provisioning.
- Run `32322929505` failed because the isolated bootstrap secrets were absent; no persistent persona mutation was performed.
- All 16 expected `QA_BOOTSTRAP_*` repository secret names are now present. Values are intentionally not recorded or validated in repository content.
- The retry must use this PR's merge commit as both current `main` and the immutable `commit_sha` input.
- The repository owner must personally review and merge this PR, then separately dispatch the workflow with the exact acknowledgement required by the workflow.
- Automation must not merge this PR, dispatch the protected workflow, expose secret values, or rotate active `PW_*` secrets before the sanitized provisioning manifest and hosted persona graph pass validation.

Post-dispatch acceptance remains:

- the protected workflow succeeds at the exact merged-current-main SHA;
- the sanitized manifest contains all eight expected personas without credentials or PHI;
- hosted read-only verification confirms the expected auth, profile, role, organization, therapist, and client relationships;
- only after those checks pass are active `PW_*` repository secrets eligible for secure rotation and route-persona browser audit use.

## Stop/Go Criteria

Stop:

- Credential workflow requires secret handling inside repo docs.
- Any proposed step requires auth/runtime code edits.

Go:

- Secure credential process owner is assigned.
- Retrieval path is documented by reference (no secret material).
- Audit evidence destination and accountability are explicit.
