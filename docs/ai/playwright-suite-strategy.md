# Playwright Suite Strategy

Decision: keep the custom TypeScript script-runner model as the intentional Playwright suite shape for now.

## Why no `playwright.config.ts` yet

The current browser checks are not ordinary stateless specs. They are hosted smoke runners that combine:

- preflight environment validation
- dynamic CI smoke account provisioning
- Supabase fixture setup and cleanup
- route/auth/session parity checks
- generated artifact capture under `artifacts/latest`

Those flows are easier to attribute and terminate through `scripts/playwright-ci-runner.ts` than through a generic Playwright project matrix. The runner logs each child script, enforces per-child timeouts, and stops at the first concrete failing smoke.

## Current command surface

Required or commonly used Playwright commands:

- `npm run playwright:preflight`
- `npm run ci:playwright`
- `npm run ci:playwright:session-smoke`
- `npm run ci:playwright:env-readiness`

Optional hosted smoke:

- `npm run ci:playwright:optional-smoke`

Manual focused smoke scripts remain available through the `playwright:*` npm scripts in `package.json`.

## Revisit criteria

Introduce `playwright.config.ts` only when one of these becomes true:

- the repo needs a real browser/device matrix beyond Chromium-first hosted smoke
- several flows can run as isolated, stateless specs without service-role setup or hosted cleanup
- CI needs shardable Playwright reporting more than per-script attribution
- mobile smoke becomes a required matrix instead of a focused script

Until then, discoverability is handled by `package.json`, `docs/TESTING.md`, and this strategy note.
