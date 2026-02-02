# Testing Notes

## Vitest hang watchdog

We wrap Vitest through [`scripts/run-vitest.mjs`](../scripts/run-vitest.mjs) so that hung specs
surface quickly instead of sitting silently for several minutes.

- The wrapper strips unsupported Jest flags (`--runInBand`, `--grep`) and forwards the run to
  `npx vitest run ...` so existing commands keep working.
- It watches stdout for the `❯ <test-file>` lines that Vitest prints while executing suites and
  resets a timer whenever output is emitted.
- If no output is observed for 45 seconds (override via `VITEST_HANG_TIMEOUT_MS`), the wrapper:
  - Logs the last active spec path.
  - Kills the Vitest child process (SIGTERM, then SIGKILL after 5 seconds).
  - Prints a suggested follow‑up command such as `npx vitest run src/pages/__tests__/foo.test.tsx`.

Usage examples:

```bash
# Run the full suite (npm test already invokes this script)
npm test

# Run a single spec with the watchdog
node scripts/run-vitest.mjs src/pages/__tests__/Dashboard.noFallback.test.tsx

# Increase the watchdog threshold when debugging locally
VITEST_HANG_TIMEOUT_MS=90000 node scripts/run-vitest.mjs src/pages/__tests__/foo.test.tsx
```

This keeps the entire suite responsive while still allowing individual specs to be diagnosed with
focused commands.

## Agent eval smoke (edge functions)

Run the edge smoke harness against staging/preview using an authenticated user JWT:

```bash
EDGE_SMOKE_ACCESS_TOKEN=<user-jwt> \
SUPABASE_URL=https://wnnjeqheqxxyrgsjmygy.supabase.co \
SUPABASE_ANON_KEY=<anon-key> \
npx tsx scripts/agent-eval-smoke.ts
```

Dry-run (no network) to validate payload construction:

```bash
npx tsx scripts/agent-eval-smoke.ts --dry-run
```
