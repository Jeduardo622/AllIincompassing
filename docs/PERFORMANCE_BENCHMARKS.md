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
4. **Phase 2 application performance baseline**
   - Command: `npm run perf:p2:baseline`
   - Output: `reports/p2-baseline-metrics.json`
5. **Phase 2 performance contract gate**
   - Command: `npm run perf:p2:check`
   - Output: `reports/p2-performance-metrics.json`
   - Expectations:
     - schedule synthetic hot-path improvement >= 25%
     - wildcard payload over-fetch removed from dashboard/report paths
     - route query invalidation is key-scoped (no global active-query invalidation)
     - sessions optimized endpoint includes cursor pagination + SQL-side summary aggregation

## Benchmark cadence
- Run before every production release.
- Run weekly for ongoing regression monitoring.

## Notes
- Store a short summary in `reports/` when baselines are updated.
- Track regressions in `docs/SLACK_ALERTING_GAPS_REVIEW.md`.
