import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8').replace(/\r\n/g, '\n');
const unitTestsStart = workflow.indexOf('\n  unit_tests:');
const buildStart = workflow.indexOf('\n  build:', unitTestsStart);
const unitTestsJob = workflow.slice(unitTestsStart, buildStart);
const deployStart = workflow.indexOf('\n  deploy_session_edge:');
const deployEnd = workflow.indexOf('\n  deploy_ai_agent_edge:', deployStart);
const deployJob = workflow.slice(deployStart, deployEnd);
const ciGateStart = workflow.indexOf('\n  ci_gate:');
const ciGateJob = workflow.slice(ciGateStart);

describe('IEHP FBA parser CI gate', () => {
  it('runs the protected extractor suites before deployment without changing deno.lock', () => {
    expect(unitTestsStart).toBeGreaterThanOrEqual(0);
    expect(buildStart).toBeGreaterThan(unitTestsStart);
    expect(workflow).not.toContain('\n  iehp_fba_parser_tests:');
    expect(unitTestsJob).toContain(
      'uses: denoland/setup-deno@22d081ff2d3a40755e97629de92e3bcbfa7cf2ed # v2.0.5',
    );
    expect(unitTestsJob).toContain('deno-version: 2.8.3');
    expect(unitTestsJob).toContain(
      'deno test --no-lock --node-modules-dir=none --no-prompt --allow-env --allow-read supabase/functions/extract-assessment-fields/adobe-pdf-extract.test.ts supabase/functions/extract-assessment-fields/index.test.ts supabase/functions/extract-assessment-fields/iehp-skills-behaviors.test.ts supabase/functions/extract-assessment-fields/structured-goals.test.ts',
    );
    expect(deployJob).toContain('- unit_tests');
    expect(ciGateJob).toContain('- unit_tests');
    expect(ciGateJob).toContain('UNIT_RESULT: ${{ needs.unit_tests.result }}');
    expect(ciGateJob).toContain('[ "${UNIT_RESULT}" = "success" ] || failed+=("unit-tests=${UNIT_RESULT}")');
  });
});
