import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('verify-coverage normalization helpers', () => {
  it('normalizes absolute module paths to repo-relative POSIX segments', async () => {
    const { normalizeModulePath } = await import('../scripts/ci/verify-coverage.mjs');
    const absolutePath = path.join(process.cwd(), 'src', 'lib', 'authStubSession.ts');

    expect(normalizeModulePath(absolutePath)).toBe('src/lib/authStubSession.ts');
  });

  it('builds a normalized coverage map that ignores the total aggregate entry', async () => {
    const { createCoverageEntryMap } = await import('../scripts/ci/verify-coverage.mjs');
    const coverageMap = createCoverageEntryMap({
      total: { lines: { pct: 97 } },
      './src/lib/authStubSession.ts': { lines: { pct: 95 } },
      'src\\preview\\config.ts': { lines: { pct: 96 } },
    });

    expect(coverageMap.size).toBe(2);
    expect(coverageMap.get('src/lib/authStubSession.ts')).toEqual({ lines: { pct: 95 } });
    expect(coverageMap.get('src/preview/config.ts')).toEqual({ lines: { pct: 96 } });
    expect(coverageMap.has('total')).toBe(false);
  });
});
