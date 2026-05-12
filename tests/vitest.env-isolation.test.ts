// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

describe('vitest env isolation', () => {
  it('does not implicitly load cwd .env files into the test runtime', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'vitest-env-isolation-'));
    const sentinelUrl = 'https://sentinel.supabase.co';
    const sentinelKey = 'sb_publishable_sentinel_key_1234567890';
    const probeDir = path.join(tempDir, 'tests');
    const probeFile = path.join(probeDir, 'env-probe.test.ts');
    const childConfigFile = path.join(tempDir, 'vitest.child.config.ts');
    const repoRoot = process.cwd();

    mkdirSync(probeDir, { recursive: true });
    writeFileSync(path.join(tempDir, '.env'), `VITE_SUPABASE_URL=${sentinelUrl}\n`);
    writeFileSync(path.join(tempDir, '.env.local'), `VITE_SUPABASE_ANON_KEY=${sentinelKey}\n`);
    writeFileSync(path.join(tempDir, '.env.codex'), `VITE_SUPABASE_URL=${sentinelUrl}\nVITE_SUPABASE_ANON_KEY=${sentinelKey}\n`);
    writeFileSync(
      probeFile,
      [
        "import { describe, expect, it } from 'vitest';",
        '',
        "describe('probe', () => {",
        "  it('ignores cwd env files', () => {",
        `    expect(process.env.VITE_SUPABASE_URL).not.toBe(${JSON.stringify(sentinelUrl)});`,
        `    expect(process.env.VITE_SUPABASE_ANON_KEY).not.toBe(${JSON.stringify(sentinelKey)});`,
        `    expect((import.meta as { env?: Record<string, string | undefined> }).env?.VITE_SUPABASE_URL).not.toBe(${JSON.stringify(sentinelUrl)});`,
        `    expect((import.meta as { env?: Record<string, string | undefined> }).env?.VITE_SUPABASE_ANON_KEY).not.toBe(${JSON.stringify(sentinelKey)});`,
        '  });',
        '});',
        '',
      ].join('\n'),
    );
    writeFileSync(
      childConfigFile,
      [
        `import baseConfig from ${JSON.stringify(path.resolve(repoRoot, 'vitest.config.ts'))};`,
        'export default {',
        '  ...baseConfig,',
        '  test: {',
        '    ...baseConfig.test,',
        "    environment: 'node',",
        '    setupFiles: [],',
        "    include: ['tests/env-probe.test.ts'],",
        '  },',
        '};',
        '',
      ].join('\n'),
    );

    const vitestEntrypoint = path.resolve(
      repoRoot,
      'node_modules',
      'vitest',
      'vitest.mjs',
    );

    try {
      const result = spawnSync(
        process.execPath,
        [vitestEntrypoint, 'run', 'tests/env-probe.test.ts', '--config', childConfigFile, '--reporter=dot'],
        {
          cwd: tempDir,
          encoding: 'utf8',
          env: { ...process.env },
          timeout: 120_000,
        },
      );

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).not.toContain(sentinelUrl);
      expect(`${result.stdout}\n${result.stderr}`).not.toContain(sentinelKey);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 60000);
});
