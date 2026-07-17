# BCBA Supervision Workflow Design

**Issue:** WIN-222  
**Lane:** Critical / high-risk human-reviewed  
**Status:** Approved for implementation planning

## Objective

Preserve two separate clinical records while completing the handoff between them:

1. The BT completes and signs the ABA Session Note.
2. BT finalization creates one supervision review request without blocking session close.
3. The request is assigned to a deterministic BCBA when possible.
4. The assigned BCBA reviews the completed BT note from Dashboard.
5. The BCBA completes a separate Supervision Session Note and signs it with a distinct attestation.

The completed BT note remains immutable throughout BCBA review.

## Current State

The repository already has separate BT and supervision note records. `finalize_bt_aba_session_note` completes the BT note and invokes `create_supervision_session_note_request_for_completed_session`. The supervision workflow stores its response in `supervision_session_notes`.

The remaining gaps are:

- request creation never populates `assigned_admin_user_id`;
- standalone `bcba` users can enter Dashboard but current RLS and RPC checks admit only admin-family roles;
- the Dashboard queue does not load the completed BT note or BT attestation;
- supervision completion stamps `signed_at` without a first-class BCBA attestation;
- the reconcile path also creates unassigned requests.

Hosted read-only evidence on 2026-07-17 found 29 pending requests, all unassigned. None resolved through the current client-to-therapist links. The organization has one active exact-BCBA user without a therapist/client link.

## Assignment Design

The database resolves the assignee in this order:

1. Find active, same-organization, exact-`bcba` users connected to the request client through `client_therapist_links` and `user_therapist_links`.
2. If exactly one linked BCBA exists, assign that user.
3. If no linked BCBA exists, find active exact-`bcba` users in the request organization.
4. If exactly one organization BCBA exists, assign that user.
5. Otherwise leave the request unassigned.

Ambiguity never blocks BT session completion. The creator and reconcile paths both use one shared resolver so new requests and backfilled requests behave consistently. A forward migration backfills only pending, unassigned requests that now resolve deterministically.

The existing column name `assigned_admin_user_id` remains for compatibility, but its workflow meaning becomes “assigned supervision reviewer user id.” Renaming it is outside this slice.

## Authorization Boundaries

- An assigned exact-BCBA may read and complete only requests assigned to their authenticated user id in the same organization.
- A different BCBA in the same organization cannot read the request packet or complete the supervision note.
- Org administrators and super administrators retain org-scoped operational visibility, including unassigned requests.
- Administrators cannot silently sign as the assigned BCBA. Completion requires the caller to be the assigned exact-BCBA. Operational reassignment is outside this slice; unassigned requests remain visible for staffing correction.
- BT users retain only their existing closeout authority and cannot read the BCBA queue or create a BCBA attestation.
- Cross-organization access fails closed in policies and security-definer RPCs.
- `user_roles` plus active role state is canonical for exact-BCBA authorization; `profiles.role` and therapist titles are not sufficient.

## Data Access Design

Add a security-definer review-packet RPC rather than widening browser access across several clinical tables. The RPC returns only the fields required by the review screen:

- supervision request id, assignment, status, and timestamps;
- session id, start/end times, place of service, and service metadata already used by the workflow;
- client display name;
- BT display name;
- completed BT ABA responses and immutable BT template snapshot;
- BT attestation role, signature method, and signed timestamp;
- the organization’s Supervision Session Note template.

The RPC authorizes the caller before reading clinical content. It exposes assigned packets to the matching exact-BCBA and org-scoped operational packets to admin-family viewers. It never returns another organization’s data.

The existing pending-request client contract is extended to map the review packet into explicit TypeScript types. The UI must not perform service-role reads.

## BCBA Completion And Signature

The Dashboard review panel has two clearly separated sections:

1. **Completed BT ABA Session Note** — read-only response rendering plus BT signer metadata.
2. **Supervision Session Note** — the independent supervision template form.

The BCBA signature field uses the existing typed/drawn signature interaction pattern, generalized so labels and field keys are not BT-specific. The submitted supervision response contains a structured signature value with `method` and `value`.

The completion RPC validates:

- request is pending and belongs to the caller organization;
- caller is the assigned active exact-BCBA;
- template belongs to the same organization and has type `supervision_session_note`;
- all required and conditionally required responses are present;
- BCBA signature method is `typed` or `drawn`;
- signature value is non-empty and within the accepted size limit;
- required BCBA licensure/credential response is present.

On success, the RPC atomically:

- inserts the separate `supervision_session_notes` row;
- inserts a `session_note_attestations` row with role `bcba`, the authenticated signer, signature method/value, and signed timestamp;
- marks the request completed.

If any step fails, no note, attestation, or request-state change is committed.

## Error Handling

- Zero or multiple BCBA candidates: create the request unassigned; do not fail BT closeout.
- Missing or invalid signature: return a constraint error and keep the request pending.
- Stale/completed request: return the existing not-pending conflict and do not duplicate notes or attestations.
- Unauthorized caller: return an authorization error without revealing request or clinical-note existence across tenant boundaries.
- Missing BT note during packet load: return a controlled data-integrity error; do not show a partially reviewable packet.
- Dashboard load failure: show a scoped retryable supervision-queue error without hiding unrelated dashboard data.

## UI Behavior

- An exact-BCBA sees only assigned pending requests in “Supervision Notes Due.”
- Admin-family users may see assigned and unassigned pending requests for operational awareness, but the completion control is disabled unless they are also the assigned exact-BCBA.
- Opening a request displays BT content before the supervision form so review precedes signing.
- BT responses are rendered defensively for strings, booleans, arrays, and structured values.
- Submitting the supervision note requires all template requirements plus BCBA signature and credential.
- Successful completion closes the panel and removes the request from the pending queue after refetch.

## Test Strategy

Tests are written before production changes and must cover:

- resolver chooses one linked exact-BCBA;
- resolver falls back to the sole organization exact-BCBA;
- resolver returns null for zero or multiple organization candidates;
- ambiguity does not prevent request creation or BT finalization;
- migration backfills only deterministic pending unassigned requests;
- assigned BCBA can fetch the packet and complete the note;
- another BCBA in the same organization cannot fetch or complete it;
- admin can view operational packets but cannot sign an assigned request;
- cross-tenant callers cannot infer or access requests;
- packet contains BT responses, template snapshot, and BT attestation metadata;
- blank, malformed, oversized, or unsupported signatures are rejected;
- successful completion creates one supervision note and one BCBA attestation atomically;
- Dashboard renders the BT note read-only and uses the signature control for BCBA signature;
- existing BT closeout and supervision-required-field tests remain green.

Critical-lane verification includes focused tests, policy checks, lint, typecheck, the full CI test suite, tenant validation, build, route tier-0, and the auth/session Playwright gate. `verify-change` and `pr-hygiene` produce the final verification and PR-readiness artifacts.

## Files And Responsibilities

- New forward migration under `supabase/migrations/**`: resolver, request creation/reconcile updates, backfill, RLS, review-packet RPC, completion authorization, and BCBA attestation.
- `src/lib/supervision-session-notes.ts`: typed review-packet access and completion contract.
- `src/pages/Dashboard.tsx`: review-first panel, read-only BT note, completion eligibility, and BCBA signature state.
- `src/components/session-notes/SignatureInput.tsx` or a focused replacement beside it: reusable typed/drawn signature input without BT-only naming.
- Focused migration, library, and Dashboard tests: assignment, authorization, packet mapping, rendering, validation, and regression proof.

## Non-Goals

- Combining BT and supervision notes.
- Redesigning the BT ABA template or session-start workflow.
- Adding a general staffing or reassignment UI.
- Renaming `assigned_admin_user_id`.
- Changing billing, authorization, goal capture, or unrelated dashboard behavior.
- Allowing administrators to impersonate or silently sign as a BCBA.
- Reading or embedding production clinical content in fixtures or source control.

## Rollout And Recovery

The migration is forward-only and uses a timestamp newer than the current hosted migration ledger. Before apply, hosted schema and migration order are rechecked. After apply, verification uses aggregate and synthetic evidence only:

- deterministic pending requests receive an assignee;
- ambiguous requests remain pending and unassigned;
- assigned BCBA visibility succeeds;
- non-assigned BCBA visibility fails;
- successful synthetic completion produces separate BT and supervision notes with distinct attestations.

Rollback is a reviewed forward migration that restores prior policies/functions while preserving completed supervision notes and attestations. No destructive production data deletion is part of rollback.
