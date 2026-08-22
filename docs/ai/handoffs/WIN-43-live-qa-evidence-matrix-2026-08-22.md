# WIN-43 Live QA Evidence Matrix

Date: 2026-08-22
Issue: `WIN-43`
Status: `incomplete - one owner-gated repair and persistent-persona proof remain`
Observed production `main`: [`e84cb3e559d295ad2cbb2b5a7bafaf7b88a22a1a`](https://github.com/Jeduardo622/AllIincompassing/commit/e84cb3e559d295ad2cbb2b5a7bafaf7b88a22a1a)

## Purpose

This handoff records what the evidence-first QA campaign has and has not proven. It does not authorize a workflow dispatch, credential rotation, protected merge, hosted mutation, or use of production customer data. All persona evidence referenced here is synthetic and non-PHI.

## Routing And Scope

- classification: `low-risk autonomous`
- lane: `fast`
- triggering path: `docs/ai/handoffs/WIN-43-live-qa-evidence-matrix-2026-08-22.md`
- allowed surface: this documentation-only evidence matrix
- non-goals: application, test, workflow, migration, secret, hosted-data, and deployment changes
- stop condition: any action that would dispatch a protected workflow, merge a critical PR, access credentials, or alter hosted data

## Evidence Definitions

- `Proven`: directly supported by a current command, hosted check, workflow artifact, deploy readback, or browser result.
- `Partial`: a narrower synthetic or disposable-fixture check passed, but it does not prove the complete named persona or workflow.
- `Pending`: the required proof has not run or cannot be established from retained evidence.
- `Blocked`: a required owner-only merge or dispatch gate prevents the next proof step.

## Current Release Snapshot

| Surface | Status | Evidence |
| --- | --- | --- |
| GitHub `main` | Proven | `e84cb3e559d295ad2cbb2b5a7bafaf7b88a22a1a`, produced by owner-merged [PR #1008](https://github.com/Jeduardo622/AllIincompassing/pull/1008) |
| Required aggregate CI | Proven | [Run 32574193897](https://github.com/Jeduardo622/AllIincompassing/actions/runs/32574193897) succeeded at the observed `main` SHA |
| Standalone tenant safety | Proven | [Run 32574193896](https://github.com/Jeduardo622/AllIincompassing/actions/runs/32574193896) succeeded at the observed `main` SHA without the former false watchdog termination |
| Hosted auth and session smoke | Proven | The aggregate run passed auth, session lifecycle, BCBA acceptance, evidence upload, and synthetic-actor cleanup at the observed `main` SHA |
| Hosted database checks | Proven | [Run 32574193899](https://github.com/Jeduardo622/AllIincompassing/actions/runs/32574193899) succeeded at the observed `main` SHA |
| Production availability | Partial | `https://app.allincompassing.ai` returned HTTP 200 on 2026-08-22 after the merge; exact Netlify deploy-to-commit attribution is unavailable because the deploy-list API now returns HTTP 401 |
| Supabase Preview external check | Unresolved | Check run `97034066476` failed because remote migration versions were not found in the local migrations directory; this remains migration-drift risk even though the strict GitHub Actions gates passed |

## Owner-Gated Repair Chain

| PR | State | Evidence | Required next action |
| --- | --- | --- | --- |
| [#1008](https://github.com/Jeduardo622/AllIincompassing/pull/1008) `fix(ci): keep tenant safety progress observable` | Merged | Owner merge commit `e84cb3e559d295ad2cbb2b5a7bafaf7b88a22a1a`; exact-main aggregate [run 32574193897](https://github.com/Jeduardo622/AllIincompassing/actions/runs/32574193897) and standalone tenant-safety [run 32574193896](https://github.com/Jeduardo622/AllIincompassing/actions/runs/32574193896) succeeded | None for this PR; retain post-merge evidence |
| [#1007](https://github.com/Jeduardo622/AllIincompassing/pull/1007) `fix(edge): short-circuit Feature Flags preflight (WIN-43)` | Blocked on owner merge | Synchronized head `4bd4d330ae60686acf87083f26477389dd19fb7f`; aggregate [run 32576553720](https://github.com/Jeduardo622/AllIincompassing/actions/runs/32576553720), standalone tenant-safety [run 32576553734](https://github.com/Jeduardo622/AllIincompassing/actions/runs/32576553734), Lighthouse [run 32576553795](https://github.com/Jeduardo622/AllIincompassing/actions/runs/32576553795), Supabase Preview, Netlify, and all applicable checks succeeded | Repository owner personally reviews and merges this critical Edge Function/config PR |

Codex did not merge #1008 and must not merge #1007. Passing CI does not replace owner review.

## Persistent Persona Matrix

The sanitized artifact from [provision run 32393249367](https://github.com/Jeduardo622/AllIincompassing/actions/runs/32393249367) reports that all eight synthetic persona identities and their tenant graph were verified at that run. No `verify-readiness` run exists, and the two credential-rotation attempts failed closed before mutation. Therefore the artifact proves historical provisioning, not current credentials, current route readiness, or complete workflow usability.

| Persona | Provisioned identity and graph | Current readiness | Complete hosted workflow walkthrough |
| --- | --- | --- | --- |
| BT | Proven at provision run | Pending | Pending |
| Therapist | Proven at provision run | Pending | Pending |
| BCBA | Proven at provision run | Pending | Pending |
| Mid Tier | Proven at provision run | Pending | Pending |
| Admin Schedule | Proven at provision run | Pending | Pending |
| Client/guardian | Proven at provision run | Pending | Pending |
| Admin | Proven at provision run | Pending | Pending |
| Super Admin | Proven at provision run | Pending | Pending |

The hosted auth smoke uses disposable synthetic actors. Its success does not prove any named persistent account. Reserved accounts such as Steve Job and MJ were not modified by the persistent-persona workflow.

## Route And Role Truth

Current routing is defined in `src/App.tsx`.

- Public routes: `/login`, `/signup`, `/auth/recovery`, `/accept-invite`, and `/unauthorized`.
- General protected routes: `/`, `/schedule`, `/time`, `/clients`, `/documentation`, `/account`, `/messages`, and their documented child routes.
- Admin or clinical-management routes: `/time/review`, `/payroll`, `/clients/new`, therapist management, `/fill-docs`, `/authorizations`, `/billing`, `/monitoring`, `/reports`, and `/settings`.
- Client-only route: `/family`, with the guardian requirement enforced.
- Super-admin-only routes: feature flags, impersonation, and prompts, including current aliases.

The local responsive observer contains scenarios for schedule overlap, clients directory, account settings, feature flags, payroll time, payroll review, staff dashboard, and staff reports. These are deterministic loopback layout checks at required desktop and mobile viewports. They are not authenticated persistent-persona proof.

## Workflow Evidence Matrix

| Workflow | Status | Evidence boundary |
| --- | --- | --- |
| Login, logout, session restoration, and protected-route entry | Partial | Disposable hosted auth smoke passed; all eight persistent personas still require current readiness proof |
| Schedule booking and session lifecycle | Partial | Current hosted disposable-fixture smoke passed and cleaned its actors; complete per-persona walkthroughs remain pending |
| Clients directory | Partial | Responsive scenario and bounded UI repairs merged; authenticated role-by-role behavior remains pending |
| Dashboard | Partial | Authorized-units and responsive repairs merged; complete role-by-role data and action coverage remains pending |
| Reports | Partial | Date and touch-target repairs plus responsive scenario merged; full authorized hosted workflow remains pending |
| Account settings | Partial | Responsive scenario merged; complete persistent-persona behavior remains pending |
| Super Admin Feature Flags | Blocked | Loading and responsive repairs are merged; the hosted preflight repair is fully green on PR #1007 but remains pending owner merge and post-merge production proof |
| Client/guardian family workflow | Pending | No complete current persistent-client browser walkthrough |
| Messaging and documentation | Pending | No complete current per-persona browser walkthrough |
| Programs, goals, targets, and assignments | Pending | No complete current role-by-role browser walkthrough |
| Staff and client administration | Pending | No complete current authorized and denied action matrix |
| Payroll and time review | Partial | Responsive scenarios exist; complete hosted action and authorization coverage is pending |
| Empty, loading, error, stale-data, accessibility, and mobile states | Partial | Several bounded states and responsive scenarios are covered; complete route-by-route and persona-by-persona proof is pending |

## Defect And PR Ledger

| PR | Campaign result |
| --- | --- |
| [#994](https://github.com/Jeduardo622/AllIincompassing/pull/994) | Merged: protected QA persona readiness and session-browser reliability work |
| [#995](https://github.com/Jeduardo622/AllIincompassing/pull/995) | Merged: Clients responsive observer scenario |
| [#996](https://github.com/Jeduardo622/AllIincompassing/pull/996) | Merged: Clients directory responsive layout |
| [#997](https://github.com/Jeduardo622/AllIincompassing/pull/997) | Merged: Dashboard authorized units |
| [#998](https://github.com/Jeduardo622/AllIincompassing/pull/998) | Merged: staff Dashboard responsive scenario |
| [#999](https://github.com/Jeduardo622/AllIincompassing/pull/999) | Merged: Dashboard reconcile query |
| [#1000](https://github.com/Jeduardo622/AllIincompassing/pull/1000) | Merged: staff Reports responsive scenario |
| [#1001](https://github.com/Jeduardo622/AllIincompassing/pull/1001) | Merged: Reports dates and touch targets |
| [#1002](https://github.com/Jeduardo622/AllIincompassing/pull/1002) | Merged: monitoring unavailable-sample state |
| [#1003](https://github.com/Jeduardo622/AllIincompassing/pull/1003) | Merged: preserve sole booking-target retries |
| [#1004](https://github.com/Jeduardo622/AllIincompassing/pull/1004) | Merged: account responsive observer scenario |
| [#1005](https://github.com/Jeduardo622/AllIincompassing/pull/1005) | Merged: Feature Flags loading state |
| [#1006](https://github.com/Jeduardo622/AllIincompassing/pull/1006) | Merged: Feature Flags responsive scenario |
| [#1007](https://github.com/Jeduardo622/AllIincompassing/pull/1007) | Open critical repair: Feature Flags preflight startup; exact-head checks green, owner merge pending |
| [#1008](https://github.com/Jeduardo622/AllIincompassing/pull/1008) | Owner-merged critical repair: tenant-safety watchdog observability; exact-main checks green |

## Cleanup Evidence

- PR #1008's hosted auth run deleted both disposable synthetic actors after the ten session scripts passed.
- Session scripts report cancellation or cleanup of their marker-owned records.
- Previous campaign checks contain bounded fixture-cleanup evidence, but no final hosted global readback has proven zero residue across every campaign marker.
- Final zero-residue status is therefore `pending`, not inferred from individual test cleanup.

## Required Sequence

1. The repository owner personally reviews and merges PR #1007.
2. Confirm exact-main required CI, production deploy attribution and availability, and the Supabase Preview migration-drift result after that merge.
3. The owner may then dispatch `verify-readiness` only with a fresh exact current-main SHA, the eligible merged WIN-43 PR, and the workflow's exact acknowledgement. No authorization is supplied by this document.
4. If readiness succeeds, execute a separately authorized full persistent-persona workflow audit; the existing readiness workflow proves route entry and denial checks, not complete workflow usability.
5. Run a final marker-owned hosted zero-residue readback and retain sanitized proof.
6. Produce the final CTO memo only after the evidence above is complete.

## Readiness Verdict

The currently deployed ordinary production release is reachable and its strict GitHub Actions gates passed at the observed `main` SHA. The WIN-43 campaign's stronger definition of production usability is **not yet proven**: PR #1007 remains owner-gated, exact production deploy attribution is unavailable, current readiness has not run for the eight persistent personas, complete authenticated persona workflows remain incomplete, migration drift remains unresolved, and final global zero-residue proof is pending.
