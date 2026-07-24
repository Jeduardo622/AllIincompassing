# BCBA Production Route Audit

Date: July 23, 2026

Issue: [WIN-244](https://linear.app/winningedgeai/issue/WIN-244/audit-live-bcba-routes-end-to-end)

Environment: `https://app.allincompassing.ai`

## Result

The production BCBA walkthrough is complete for the standard route inventory and the synthetic client-to-first-session workflow. Verified defects were remediated through PRs `#840` through `#851`, all of which are merged. The synthetic QA client and its complete audit-only data graph were permanently removed after the walkthrough.

The only incomplete integration proof is a successful generated AI Assistant response. Production currently returns the expected safe fallback because the upstream OpenAI account reports `insufficient_quota`; the application correctly maps that condition to HTTP 503.

## Scope

The walkthrough covered:

- Dashboard
- Schedule
- Messages
- Clients and client detail
- BT/staff listing
- Authorizations
- Documentation
- Fill Docs
- Billing
- Reports
- Monitoring and Settings route guards
- My Account
- BCBA client creation, authorization, program and goal creation
- First-session creation, start, data save, and completion
- AI Assistant failure handling

Only synthetic data was created for the end-to-end workflow. No real customer records were used as test inputs.

## Workflow Evidence

| Workflow | Result | Local evidence |
| --- | --- | --- |
| Synthetic client created | Pass | `05-created-client-row.jpg`, `42-production-bcba-synthetic-client-basic-info.jpg` |
| Client profile and guardian form | Pass | `42-production-bcba-synthetic-client-basic-info.jpg`, `43-production-bcba-synthetic-client-guardian.jpg` |
| Authorization created | Pass | `07-created-authorization-date-shift.jpg`, `63-production-bcba-route-authorizations.jpg` |
| Program and goal created | Pass | `55-production-bcba-program-and-goal-created.jpg` |
| First session ready | Pass | `56-production-bcba-session-ready-to-start.jpg` |
| First session started | Pass | `57-production-bcba-first-session-started.jpg` |
| Session data saved | Pass | `58-production-bcba-session-data-saved.jpg` |
| First session completed | Pass | `59-production-bcba-first-session-completed.jpg` |
| AI quota failure degrades safely | Pass | `78-bcba-assistant-completion-check-quota-fallback.jpg`, `79-bcba-assistant-completion-check-503-invocation.jpg` |

Evidence files are stored in the local package described below and are intentionally not committed because screenshots include production-visible operational data.

## Route Matrix

| Route or boundary | Result | Evidence |
| --- | --- | --- |
| Dashboard | Pass | `20-bcba-dashboard-fixed.jpg`, `60-production-bcba-route-dashboard.jpg` |
| Schedule | Pass | `21-bcba-schedule.jpg`, `69-production-bcba-route-schedule.jpg` |
| Messages | Pass | `22-bcba-messages.jpg`, `61-production-bcba-route-messages.jpg` |
| Clients and search | Pass | `24-bcba-client-email-search-works.jpg`, `40-production-bcba-client-search-apostrophe.jpg`, `41-production-bcba-client-search-apostrophe-match.jpg`, `62-production-bcba-route-clients.jpg` |
| BT/staff listing | Pass | `25-bcba-staff.jpg` |
| Authorizations | Pass | `26-bcba-authorizations.jpg`, `63-production-bcba-route-authorizations.jpg` |
| Documentation | Pass | `27-bcba-documentation-zero-state.jpg`, `64-production-bcba-route-documentation.jpg` |
| Fill Docs | Pass | `28-bcba-fill-docs.jpg`, `65-production-bcba-route-fill-docs.jpg` |
| Billing | Pass | `29-bcba-billing.jpg`, `66-production-bcba-route-billing.jpg` |
| Reports | Pass | `30-bcba-report-generated.jpg`, `67-production-bcba-route-reports.jpg` |
| My Account | Pass | `35-bcba-my-account.jpg`, `68-production-bcba-route-my-account.jpg` |
| Monitoring denied to BCBA | Pass | `38-production-bcba-monitoring-blocked-to-account.jpg` |
| Settings/admin denied to BCBA | Pass | `39-production-bcba-settings-admin-blocked-to-account.jpg` |
| AI Assistant upstream failure contract | Pass | `74-bcba-assistant-post-win249-deploy-upstream-fallback.png`, `75-bcba-assistant-post-win249-deploy-503-invocations.jpg` |

## Findings And Remediation

| Finding | Resolution |
| --- | --- |
| Supervision queue failed because an RPC result type did not match its declared contract | [PR #840](https://github.com/Jeduardo622/AllIincompassing/pull/840) |
| Date-only fields shifted by one day in the browser | [PR #841](https://github.com/Jeduardo622/AllIincompassing/pull/841) |
| Completed session-note clock values displayed UTC instead of local time | [PR #842](https://github.com/Jeduardo622/AllIincompassing/pull/842) |
| Session Trends called a route that returned the SPA document | [PR #843](https://github.com/Jeduardo622/AllIincompassing/pull/843) |
| Dashboard metrics RPC overload produced ambiguous/zero results | [PR #844](https://github.com/Jeduardo622/AllIincompassing/pull/844) |
| AI Assistant browser preflight rejected trace headers | [PR #845](https://github.com/Jeduardo622/AllIincompassing/pull/845) |
| PR browser setup performed unnecessary work | [PR #846](https://github.com/Jeduardo622/AllIincompassing/pull/846) |
| BCBA could reach privileged monitoring/settings/admin surfaces | [PR #847](https://github.com/Jeduardo622/AllIincompassing/pull/847) |
| Client search controls were unusable below the desktop breakpoint | [PR #848](https://github.com/Jeduardo622/AllIincompassing/pull/848) |
| AI Assistant downgraded an organization-scoped BCBA actor | [PR #849](https://github.com/Jeduardo622/AllIincompassing/pull/849) |
| AI Agent production deployment lacked a governed CI path | [PR #850](https://github.com/Jeduardo622/AllIincompassing/pull/850) |
| OpenAI quota failures were returned as false-success assistant messages | [PR #851](https://github.com/Jeduardo622/AllIincompassing/pull/851) |

## QA Data Cleanup

The synthetic client `QA BCBA Route Audit 20260723` was uniquely identified before deletion. The preflight inventory found:

- 13 direct rows across the client, authorization, contract, program, goal, target/phase, session, session-goal, and session-note graph
- 17 cascade-only rows across authorization services, contract rates, session CPT entries, and session audit logs
- zero guardians, trial events, supervision requests/notes, corrections, amendments, assessment documents, or storage objects

Cleanup used one production transaction with:

- exact client, organization, record ID, relationship, timestamp, and count assertions
- explicit removal of phase evaluation and criteria rows with restrictive foreign keys
- session deletion before program/goal cascades
- an exact final client delete
- rollback on any identity, relationship, or count mismatch

The first attempt failed safely before deletion because a legacy text `client_id` column did not match the UUID safety-scan parameter. The transaction rolled back, the client was reverified, the scan was corrected to compare textual representations, and the single retry committed.

Post-commit verification returned zero rows for every direct and indirect record ID, all client-linked tables, progression/correction chains, assessment residue, and storage paths.

## Evidence Package

The archive contains:

- 68 screenshots from `.tmp\live-bcba-route-audit-2026-07-23`
- this report
- a SHA-256 manifest for every packaged file

The package and its `.sha256` checksum sidecar are stored outside the repository under the operator's local `.tmp` audit workspace. The committed report intentionally does not encode a machine-specific path or archive name. The package must not be committed or attached to a public issue without a separate redaction review.

## Residual Risk

No unresolved application-code defect remains from the BCBA route walkthrough. A successful AI-generated answer still depends on restoring the external OpenAI account quota or key; the deployed application failure behavior is verified.
