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

  it('pins the staging deploy job to Node 20.16.0', () => {
    const workflowPath = resolve(process.cwd(), '.github/workflows/ci.yml');
    const workflowContents = readFileSync(workflowPath, 'utf8');
    const stagingSection = workflowContents.split('deploy-staging:')[1];

    expect(stagingSection, 'staging job section should exist').toBeDefined();
    expect(stagingSection).toContain('node-version: 20.16.0');
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
    expect(clearinghouseGroup?.requiredInCi).toBe(true);
    expect(clearinghouseGroup?.keys).toEqual([
      'CLEARINGHOUSE_SANDBOX_API_KEY',
      'CLEARINGHOUSE_SANDBOX_CLIENT_ID',
    ]);
    expect(telemetryGroup?.requiredInCi).toBe(true);
    expect(telemetryGroup?.keys).toEqual(['TELEMETRY_WRITE_KEY']);
  });
});
