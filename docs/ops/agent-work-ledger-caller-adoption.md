# Agent Work Ledger Caller Adoption

The Ledger is an application workflow authority, not an engineering task tracker. Engineering agents keep issue state in Linear and implementation evidence in verification cards and markdown handoffs. Prompts, source code, issue descriptions, review notes, and arbitrary engineering work must not enter Ledger payloads, events, traces, or metadata.

## Supported Callers

Supported application callers are deliberately closed to authenticated users whose current server-backed capability permits management of the selected assessment.

| Workflow                                      | Authenticated application entrypoint                                                | Caller payload                                              | Runtime behavior                                                                                                                                             |
| --------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `assessment.iehp.prepare_for_clinical_review` | IEHP review surface -> `POST /agent-work-items/assessment-prep`                     | `assessmentDocumentId`, fixed `workflowVersion`             | Explicit idempotent create/read in `shadow` or `advisory`; deterministic workers remain inert in `shadow`                                                    |
| `assessment.caloptima.prepare_draft_review`   | CalOptima programs/goals surface -> `POST /agent-work-items/caloptima-draft-review` | `assessmentDocumentId`; server-defaulted workflow version 1 | Explicit idempotent create/read; the separate Ledger-bound `generate-program-goals` call is authenticated, advisory-only, and stops at editable human review |

For both workflows:

- the application obtains the caller JWT through the existing authenticated client; there is no engineering-agent credential or MCP write path
- the Edge Function re-derives actor, organization, client, document access, workflow graph, approval state, and runtime policy instead of trusting caller-supplied authority
- create controls are explicit and available only when the current client capability permits management and the read projection reports `no-ledger`; the Edge Function independently rechecks current authority, and duplicate submissions converge through the database idempotency contract
- `disabled` fails closed, `shadow` permits observation/create/read without runner effects, and `advisory` permits only bounded management and recovery actions
- `active` is forbidden at the shared policy and exposed runtime boundaries
- errors shown to callers use sanitized machine-safe states; payloads, prompts, clinical text, secrets, and raw provider output must not enter logs, events, traces, queue messages, or exported artifacts
- assessment-domain tables remain authoritative; no caller or model may approve, promote, publish, sign, bill, submit, or create a final clinical record

Do not add a generic create route, caller-selected workflow key, caller-selected tenant scope, automatic model-triggered invocation, or engineering-agent Ledger skill. A new workflow requires a separately routed design, fixed graph, tenant authority, TDD, and critical-lane review.

Use `docs/ops/agent-work-ledger.md` for the runtime, recovery, retention, and local verification runbook.
