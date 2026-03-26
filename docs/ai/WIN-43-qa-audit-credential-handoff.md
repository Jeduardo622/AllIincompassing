# WIN-43 Docs-Only QA Audit Credential Handoff

Status: Planning/Docs only. No credential values. No runtime changes.

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

## Safe Verification Notes

- Browser re-audit remains blocked until credentials are provided through approved secure channels.
- This doc unblocks coordination only; it does not satisfy the execution acceptance criteria for `WIN-43`.

## Stop/Go Criteria

Stop:

- Credential workflow requires secret handling inside repo docs.
- Any proposed step requires auth/runtime code edits.

Go:

- Secure credential process owner is assigned.
- Retrieval path is documented by reference (no secret material).
- Audit evidence destination and accountability are explicit.
