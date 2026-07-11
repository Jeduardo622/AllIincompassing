# BCBA Session Auth Recovery Design

Issue: WIN-217

## Goal

Restore the BCBA session workflow when a browser holds an invalid Supabase session and make repeated session-start requests safely idempotent.

## Design

Session start remains server-authoritative. The client accepts a conflict as success only when the structured response contains `rpcCode: "ALREADY_STARTED"`; `INVALID_STATUS` and every other non-success response remain visible failures. After the idempotent result, the existing `onSessionStarted` callback refreshes authoritative session data and closes the modal.

Auth bootstrap and auth-state refresh preserve the HTTP status returned by Supabase profile and role queries. A deterministic query status of 401 triggers the existing fail-closed local-state and credential cleanup path. Missing profiles, RLS denials, network failures, and 5xx responses retain current behavior and cannot expand permissions.

## Scope

- `src/features/scheduling/domain/sessionStart.ts`
- `src/features/scheduling/domain/__tests__/sessionStart.test.ts`
- `src/lib/authContext.tsx`
- existing focused auth-context tests
- this design, implementation plan, and lane handoff

## Non-goals

- No migrations, RLS, grants, role precedence, session-note billing rules, server authority, Edge Functions, runtime configuration, or UI redesign.
- No status-only or message-only conflict recovery.
- No global fetch interception.

## Verification

Use test-first coverage for `ALREADY_STARTED`, `INVALID_STATUS`, confirmed query 401, and transient non-401 failures. Then run the critical auth/session verification matrix and require code, security, and human review before merge.
