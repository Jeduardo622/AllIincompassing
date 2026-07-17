# BT ABA Disposable Browser Proof Design

## Decision

Extend the existing default-branch Supabase Preview manual dispatcher with an explicit BT proof mode that calls a protected reusable workflow. The reusable workflow creates a fresh data-less Supabase preview branch, validates it is a healthy child of the configured production project but never the production project itself, provisions only marker-owned synthetic BT data, runs the existing end-to-end BT ABA closeout browser lifecycle against a branch-bound local preview server, preserves redacted evidence, and deletes the entire branch in a separate unconditional teardown job.

## Boundaries

- Manual entry remains on `.github/workflows/supabase-preview.yml`, which already exists on the default branch and defaults to its unchanged local-preview behavior.
- `.github/workflows/bt-aba-disposable-browser-proof.yml` is `workflow_call`-only and requires immutable PR inputs plus one explicitly mapped `SUPABASE_ACCESS_TOKEN` secret; the caller does not inherit unrelated repository secrets.
- The existing optional remote DB type-generation step retains its required Supabase PAT only at step scope; the local preview job has no job-wide PAT.
- The BT mode is owner-approved and validates an open same-repository PR based on `main` whose head exactly matches the supplied 40-character lowercase commit SHA.
- The source project is fixed to `wnnjeqheqxxyrgsjmygy`; every runtime project ref must differ from it.
- Branch creation is data-less. No production rows are cloned.
- The service-role key is used only inside the runner, masked immediately, and never placed in a client-prefixed environment variable or artifact.
- The fixture owns a newly generated organization, BT auth user/profile/role link, therapist, client, program, goal, authorization, and authorization service. Every human-readable fixture field contains one run marker.
- The browser uses the publishable key. The local preview server invokes the real `session-notes/upsert` handler server-side using the bearer token supplied by the browser.
- Cleanup does not attempt row-by-row production-style deletion. The workflow always deletes the disposable branch and then verifies it is absent.

## Failure model

- Creation, health polling, key discovery, migration application, fixture provisioning, build, browser execution, and teardown each fail closed.
- A missing branch ref cannot fall back to the parent ref.
- A production-ref match aborts before fixture provisioning or browser execution.
- Teardown runs with `if: always()` and reports failure if the branch cannot be proven absent.
- Evidence contains project ref, branch id, lifecycle status, and screenshots/traces, but no API keys, passwords, access tokens, or clinical data.

## Verification

Unit tests cover branch-ref safety, key classification/masking, marker ownership, preview API opt-in, and workflow contract. The protected workflow provides the decisive browser proof on a real disposable branch. Repository policy, lint, typecheck, focused tests, tenant validation, build, and tier-0 route checks remain required before handoff.
