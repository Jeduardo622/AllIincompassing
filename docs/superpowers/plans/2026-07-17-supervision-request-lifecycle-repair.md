# WIN-223 Supervision Request Lifecycle Repair

## Routing

- Classification: high-risk human-reviewed
- Lane: critical
- Protected surfaces: `supabase/migrations/**`, `supabase/functions/sessions-complete/index.ts`
- Required reviewers: code review, test, security, Supabase, and human review before merge

## Bounded scope

- Add auditable cancellation and reopen provenance to the existing one-request-per-session queue.
- Route the edge session-completion path through the canonical packet-aware creator RPC.
- Permit creator-driven `cancelled -> pending` only after the session has a complete structured BT packet.
- Keep completed requests terminal.
- Keep reconciliation create-only for missing packet-complete requests and null-assignee backfill; it must never reopen cancelled requests.
- Preserve sessions, BT notes, attestations, supervision notes, and session audit logs.

## Non-goals

- No new UI or queue shape.
- No fabricated clinical packets or legacy note rewrites.
- No production request identifiers in repository migrations, tests, or documentation.
- No broad date-based production mutation.

## Hosted rollout and cleanup

1. Merge the reviewed branch and confirm both `20260717222331_repair_supervision_request_lifecycle.sql` and the forward-only `20260717235500_align_supervision_request_linked_therapist_authority.sql` are applied. The second migration preserves the issued first migration while aligning request creation with the edge handler's exact linked-therapist closeout authority.
2. Confirm the migration appears in hosted migration history and the lifecycle columns, constraints, and RPC definitions are present.
3. Preflight the separately held allowlist of 28 legacy request IDs. Every row must still be in the expected organization, remain `pending`, refer to a future session, and fail the complete structured BT packet check. Abort on any mismatch.
4. In one protected transaction, update only that exact allowlist to `cancelled`, set cancellation timestamp, reason, and source, and assert exactly 28 rows changed. Do not delete or rewrite clinical records.
5. Verify the single past legacy request remains untouched for manual disposition.
6. Re-audit the queue: zero invalid future legacy requests pending; the past request still present; no source clinical or audit rows changed.
7. A later genuine BT closeout for one of the cancelled sessions may reopen its existing request in place through the canonical creator RPC. Reconciliation alone must not reopen it.

## Verification record

- Targeted Vitest: migration and edge creator-path contracts.
- Synthetic SQL smoke: cancelled request reopens in place after BT finalization, retains cancellation provenance, and gains reopen provenance.
- Required gates: policy checks, lint, typecheck, test CI, tenant validation, route/auth browser gates, build, and `verify:local` where the required local services and credentials exist.
- Any unavailable database or browser check must be recorded as blocked rather than treated as passed.

### Executed locally

- `npx vitest run tests/supervisionRequestLifecycleMigration.test.ts tests/edge/sessions-complete.test.ts`: passed, 44/44 after the linked-therapist authorization regression was added.
- `npm run ci:check-focused`: passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run validate:tenant`: passed.
- `npm run build`: passed.
- `PREVIEW_PORT=4175 npm run test:routes:tier0`: passed, 220/220. The default port was already held by an unrelated preview process.
- `npm run test:ci` and `npm run verify:local`: reached 2,962 passing tests and failed on two reproducible Windows baseline checks outside the WIN-223 diff: a CRLF-sensitive workflow-step regex and a jsdom `Blob.text()` compatibility check.

### Blocked locally

- `tests/sql/bt_aba_session_note_closeout_smoke.sql`: the preserved local Supabase volume was initialized by PostgreSQL 17, while the current local image is PostgreSQL 15.8. The incompatible volume was not deleted or reset.
- `npm run ci:playwright`: preflight stopped because neither the super-admin nor admin Playwright credential pair is available to this process.
- Database-backed policy checks: `SUPABASE_DB_URL` / `DATABASE_URL` is not configured locally.

### Hosted preview proof

- Applied `align_supervision_request_linked_therapist_authority` to the Supabase preview project.
- Ran a rollback-only authenticated SQL smoke using synthetic rows: an exact `user_therapist_links` actor created the request; after removing that exact link inside the transaction, the same actor received SQLSTATE `42501`; rollback confirmation showed the synthetic session did not persist.

### Review verdicts

- Code review: approved after creator/reconcile conflict safety was added.
- Security: approved after schedule-staff caller authority was aligned with session-completion authority.
- Supabase: approved after lock order was normalized to session then request and the conflict loser path re-locks the winning request.
- Test review: no code-level coverage blocker; SQL execution evidence remains required from a compatible preview/CI database.
- Performance: approved with moderate residual reconcile batch-cost risk; current lookups are index-backed.
- Follow-up code review: approved after the issued migration was restored and the authorization correction was isolated in a forward migration.
- Follow-up security review: approved; the link is checked against the exact same-org session therapist and matches the edge handler's delegated-therapist authority model.
- Follow-up Supabase review: approved; the forward migration retains fail-closed search path and existing grants without RLS or tenant-boundary expansion.

## Stop conditions

- Any preflight allowlist row differs from its expected tenant, status, session timing, or packet completeness.
- Required CI or human review is missing.
- Safe completion requires changing RLS, grants, packet shape, or unrelated clinical data.
