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

## Repair review scope

Owner-dispatched run `32219271670` stopped before hosted mutation because CLI-rendered secret metadata was not valid JSON. The repair accepts both JSON and ANSI-table forms of the CLI's name/digest-only listing without serializing the response or digest. It captures the CLI-reported Edge digests and returned Vault IDs into private state immediately after each creation step. Edge deletion requires a current digest match; Vault deletion requires the exact captured ID/name pair. A crash before capture or any missing/mismatched ownership proof fails closed without deleting unowned secrets. It also emits fixed-field sanitized failure evidence on each supported phase error. Review must reject any exception text, secret values/digests, foreign secret deletion, automatic redispatch, or change to the disabled/advisory-only authority boundary.

Specialist review identities and protected-surface hashes are recorded in `WIN-275-hosted-advisory-canary-solo-maintainer-attestation.json`.
