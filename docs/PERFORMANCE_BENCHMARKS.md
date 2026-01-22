# Performance Benchmarks

## Goal
Establish repeatable baseline checks for API and database performance before production rollouts.

## Baseline checks
1. **DB performance advisory**
   - Command: `npm run db:check:performance`
   - Expectation: no critical advisories.
2. **Pipeline health**
   - Command: `npm run pipeline:health`
   - Expectation: security + performance checks pass.
3. **Lighthouse audits**
   - Use the latest audits in `audits/lighthouse/` as a baseline.

## Benchmark cadence
- Run before every production release.
- Run weekly for ongoing regression monitoring.

## Notes
- Store a short summary in `reports/` when baselines are updated.
- Track regressions in `docs/SLACK_ALERTING_GAPS_REVIEW.md`.
