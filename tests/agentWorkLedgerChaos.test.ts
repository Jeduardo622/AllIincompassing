import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const packageJsonPath = path.join(process.cwd(), 'package.json');
const chaosScriptPath = path.join(
  process.cwd(),
  'scripts',
  'agent-work-ledger-chaos.mjs',
);

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
  scripts?: Record<string, string>;
};
const chaosScriptExists = existsSync(chaosScriptPath);
const chaosScriptSource = chaosScriptExists
  ? readFileSync(chaosScriptPath, 'utf8')
  : '';

describe('agent work ledger chaos contract', () => {
  it('exposes the documented local-only chaos command', () => {
    expect(packageJson.scripts?.['test:agent-work:chaos']).toBe(
      'tsx scripts/agent-work-ledger-local-env.ts run -- node scripts/agent-work-ledger-chaos.mjs',
    );
  });

  it('creates the deterministic local-only chaos harness script', () => {
    expect(chaosScriptExists).toBe(true);
  });

  it('covers every required crash boundary and deterministic seed control', () => {
    expect(chaosScriptSource).toMatch(/before_claim/);
    expect(chaosScriptSource).toMatch(/after_claim/);
    expect(chaosScriptSource).toMatch(/before_effect/);
    expect(chaosScriptSource).toMatch(/after_effect_before_record/);
    expect(chaosScriptSource).toMatch(/after_record_before_transition/);
    expect(chaosScriptSource).toMatch(/after_transition_before_archive/);
    expect(chaosScriptSource).toMatch(/during_event_append/);
    expect(chaosScriptSource).toMatch(/seed/i);
    expect(chaosScriptSource).toMatch(/effect_already_applied/);
    expect(chaosScriptSource).toMatch(/postcondition_not_met/);
  });
});
