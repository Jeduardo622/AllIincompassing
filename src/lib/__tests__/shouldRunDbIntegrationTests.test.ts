import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { shouldRunDbIntegrationTests } from '../testUtils/shouldRunDbIntegrationTests';

const originalCI = process.env.CI;
const originalRunDbIt = process.env.RUN_DB_IT;

const restoreEnv = (key: 'CI' | 'RUN_DB_IT', value: string | undefined): void => {
  if (typeof value === 'undefined') {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
};

describe('shouldRunDbIntegrationTests', () => {
  beforeEach(() => {
    delete process.env.CI;
    delete process.env.RUN_DB_IT;
  });

  afterEach(() => {
    restoreEnv('CI', originalCI);
    restoreEnv('RUN_DB_IT', originalRunDbIt);
  });

  it('returns true when CI is enabled in process.env', () => {
    process.env.CI = 'true';

    expect(shouldRunDbIntegrationTests()).toBe(true);
  });

  it('returns true when RUN_DB_IT=1 in process.env', () => {
    process.env.RUN_DB_IT = '1';

    expect(shouldRunDbIntegrationTests()).toBe(true);
  });

  it('returns true when CI is enabled via import.meta.env', () => {
    const result = shouldRunDbIntegrationTests({
      importMetaEnv: { CI: 'true' },
      processEnv: {},
    });

    expect(result).toBe(true);
  });

  it('returns false when no CI or RUN_DB_IT flags are present', () => {
    const result = shouldRunDbIntegrationTests({ processEnv: {}, importMetaEnv: {} });

    expect(result).toBe(false);
  });
});
