import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REQUIRED_ENV_GROUPS } from '../../scripts/check-secrets';

describe('day-0 hotfix verification', () => {
  it('pins Node 20.16.0 in .nvmrc', () => {
    const nvmrcPath = resolve(process.cwd(), '.nvmrc');
    const nvmrcContents = readFileSync(nvmrcPath, 'utf8').trim();

    expect(nvmrcContents).toBe('20.16.0');
  });

  it('pins CI workflow jobs to Node 20', () => {
    const workflowPath = resolve(process.cwd(), '.github/workflows/ci.yml');
    const workflowContents = readFileSync(workflowPath, 'utf8');
    const nodeVersionMatches = Array.from(
      workflowContents.matchAll(/node-version:\s*([0-9]+)/g),
    );

    expect(nodeVersionMatches.length).toBeGreaterThan(0);
    for (const match of nodeVersionMatches) {
      expect(match[1]).toBe('20');
    }
  });

  it('requires day-0 secret groups in CI', () => {
    const requiredGroupNames = new Map(
      REQUIRED_ENV_GROUPS.map((group) => [group.name, group]),
    );

    const netlifyGroup = requiredGroupNames.get('Netlify Deploy');
    const clearinghouseGroup = requiredGroupNames.get('Clearinghouse Sandbox');
    const telemetryGroup = requiredGroupNames.get('Telemetry');

    expect(netlifyGroup?.requiredInCi).toBe(true);
    expect(netlifyGroup?.keys).toEqual([
      'NETLIFY_AUTH_TOKEN',
      'NETLIFY_STAGING_SITE_ID',
      'NETLIFY_PRODUCTION_SITE_ID',
    ]);
    expect(clearinghouseGroup?.requiredInCi).toBe(false);
    expect(clearinghouseGroup?.keys).toEqual([
      'CLEARINGHOUSE_SANDBOX_API_KEY',
      'CLEARINGHOUSE_SANDBOX_CLIENT_ID',
    ]);
    expect(telemetryGroup?.requiredInCi).toBe(false);
    expect(telemetryGroup?.keys).toEqual(['TELEMETRY_WRITE_KEY']);
  });
});
