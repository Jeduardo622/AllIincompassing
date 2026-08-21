# WIN-275 Hosted Advisory Canary Run 32433035394

## Status

- classification: `high-risk human-reviewed`
- lane: `critical`
- result: `blocked`
- dispatch: exactly once through the delegated Chrome browser path
- run: `https://github.com/Jeduardo622/AllIincompassing/actions/runs/32433035394`
- immutable main: `faf757b3deaf4d6c4be5cbc9d91797902b562125`
- merged approval PR: `#989`
- repeat dispatch: forbidden until a new owner-reviewed repair is merged and separately acknowledged

## Passed Gates

- owner identity and exactly-one-privileged-human topology revalidated
- all seven required checks passed on PR head `e5446ac273fd86a9fa791f62d7d63297905fb737` and current main
- immutable checkout and immediate pre-hosted-access revalidation passed
- read-only hosted preflight passed
- exact non-PHI synthetic fixtures and shadow baseline passed
- no active mode, provider/model call, retention activation, or retention deletion occurred

## Exact Blockers

The finite measurement failed at `scripts/agent-work-ledger-hosted-advisory-canary.mjs:375` with:

```text
TypeError: firstRow(...).then is not a function
```

Cleanup restored disabled mode first, but the Supabase Management API returned HTTP 400 while dropping the canary-installed `pg_cron` extension. The final disabled fallback also passed. The sanitized public artifact is `agent-work-ledger-hosted-advisory-canary-32433035394-1`.

## Hosted Readback

The independent post-run readback found:

- `pg_cron` OID: `458106`
- cron jobs: `0`
- queue and archive rows: `0`
- Ledger and draft-packet rows: `0`
- canary Vault names: `0`
- synthetic users and organizations: `0`
- ungranted locks: `0`
- active retention policies: `0`
- approved inert retention decisions: `3`

The exact remaining hosted residue is `pg_cron` OID `458106`. Do not drop a different OID and do not perform an unguarded mutation.

## Required Next Slice

Create a new owner-reviewed critical repair that:

1. fixes the synchronous `firstRow` measurement extraction and adds a regression test;
2. diagnoses the Management API HTTP 400 without another hosted dispatch;
3. preserves exact OID `458106`, advisory lock, one-mutation, reconciliation, disabled-mode, non-PHI, and no-active-mode boundaries;
4. proves zero residue before any later canary PR or acknowledgement is requested.

Linear `WIN-275` comment `98764675-ed9f-4ee3-bdd9-d44880102d07` contains the matching live handoff.
