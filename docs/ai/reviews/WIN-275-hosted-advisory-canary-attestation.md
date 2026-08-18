# WIN-275 Hosted Advisory Canary Review Attestation

## Reviewed intent

The owner-dispatched workflow is a temporary advisory only exception for exact synthetic fixtures. The fixed window uses `* * * * *`, timeout `5000`, and bound `25`; active mode is forbidden.

Review must confirm no provider/model calls, no retention activation, no retention deletion, and no real customer data. The public artifact is limited to sanitized booleans, counts, timings, and hashes.

## Fail-closed invariants

- Hosted preflight is read-only and must run before mutation.
- The workflow starts from disabled and restores disabled first during cleanup.
- The scheduler, four Vault names, generated Edge secrets, canary-installed `pg_cron`, and exact synthetic fixtures must end with zero residue.
- The workflow cannot be dispatched until the PR is merged as current `main`, exact-head CI passes, and the applicable owner/independent-human review route validates.
- The canary does not approve sustained cadence. Its sanitized public artifact supports a later owner decision.

Specialist review identities and protected-surface hashes are recorded in `WIN-275-hosted-advisory-canary-solo-maintainer-attestation.json`.
