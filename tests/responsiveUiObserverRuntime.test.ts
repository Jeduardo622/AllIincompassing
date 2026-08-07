// @vitest-environment node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { promisify } from 'node:util';

import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  buildFatalObserverSummary,
  runResponsiveUiObserver,
} from '../scripts/playwright-responsive-ui-observer';

let server: http.Server;
let baseUrl: string;
const artifactPaths = new Set<string>();
const execFileAsync = promisify(execFile);

const passHtml = `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box}body{margin:0;max-width:100vw;overflow-x:hidden}.control{width:48px;height:48px}.label{width:8px;height:8px}</style>
</head><body><div class="label" data-testid="status" aria-label="Status"></div><button class="control">OK</button></body></html>`;

const blockedHtml = `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0}button{width:48px;height:48px}</style></head>
<body><button>OK</button><script>fetch('/mutate',{method:'POST'}).catch(()=>{});</script></body></html>`;

beforeAll(async () => {
  server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(request.url === '/observer-runtime-blocked' ? blockedHtml : passHtml);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('observer_test_server_address_unavailable'));
        return;
      }
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  await Promise.all([...artifactPaths].map((artifactPath) => rm(artifactPath, { force: true })));
});

describe('responsive UI observer browser runtime', () => {
  it.each([
    new Error('token=super-secret-token'),
    'https://hosted.example.invalid/private-route',
  ])('keeps fatal output on the exact machine-safe summary schema', (failure) => {
    const summary = buildFatalObserverSummary(failure);

    expect(Object.keys(summary)).toEqual(['ok', 'baseUrl', 'results']);
    expect(summary).toEqual({ ok: false, baseUrl: '', results: [] });
    expect(JSON.stringify(summary)).not.toContain('super-secret-token');
    expect(JSON.stringify(summary)).not.toContain('hosted.example.invalid');
  });

  it('emits the exact machine-safe schema from the fatal CLI path', async () => {
    const invocation = execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'scripts/playwright-responsive-ui-observer.ts'],
      { cwd: process.cwd() },
    );

    await expect(invocation).rejects.toMatchObject({ code: 1 });
    try {
      await invocation;
    } catch (error) {
      const stderr = String((error as { stderr?: string }).stderr ?? '').trim();
      expect(JSON.parse(stderr)).toEqual({ ok: false, baseUrl: '', results: [] });
    }
  });

  it('captures passing sanitized evidence at both fixed viewports without treating labeled containers as touch targets', async () => {
    const summary = await runResponsiveUiObserver([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/observer-runtime-pass',
    ]);

    expect(summary.ok).toBe(true);
    expect(summary.results).toHaveLength(2);
    expect(summary.results.map(({ viewportName }) => viewportName)).toEqual(['desktop', 'mobile']);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.result).toBe('pass');
      expect(result.failureCodes).toEqual([]);
      expect(existsSync(result.screenshotPath)).toBe(true);
      expect(existsSync(result.evidencePath)).toBe(true);
      expect(result).not.toHaveProperty('route');
    }
  }, 60_000);

  it('blocks a same-origin mutation and reports machine-safe failures at both viewports', async () => {
    const summary = await runResponsiveUiObserver([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/observer-runtime-blocked',
    ]);

    expect(summary.ok).toBe(false);
    expect(summary.results).toHaveLength(2);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.result).toBe('fail');
      expect(result.failureCodes).toContain('non-read-method');
      expect(JSON.stringify(result)).not.toContain('/mutate');
    }
  }, 60_000);

  it('removes every artifact from a run that fails after writing partial evidence', async () => {
    const route = '/observer-runtime-cleanup';
    const routeDigest = createHash('sha256').update(route).digest('hex');
    const paths = [
      `artifacts/responsive-ui-observer/route-${routeDigest}.desktop.1440x900.png`,
      `artifacts/responsive-ui-observer/route-${routeDigest}.desktop.1440x900.json`,
      `artifacts/responsive-ui-observer/route-${routeDigest}.mobile.390x844.png`,
      `artifacts/responsive-ui-observer/route-${routeDigest}.mobile.390x844.json`,
    ];
    paths.forEach((artifactPath) => artifactPaths.add(artifactPath));
    await Promise.all(paths.map((artifactPath) => rm(artifactPath, { force: true })));

    await expect(runResponsiveUiObserver([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      `--route=${route}`,
    ], {
      launchBrowser: () => chromium.launch({ headless: true }),
      ensureDir: (dirPath) => mkdir(dirPath, { recursive: true }),
      writeBinary: (filePath, payload) => writeFile(filePath, payload),
      writeText: async (filePath, payload) => {
        await writeFile(filePath, payload, 'utf8');
        if (filePath.includes('.mobile.390x844.json')) {
          throw new Error('injected_artifact_write_failure');
        }
      },
      removeFile: (filePath) => rm(filePath, { force: true }),
    })).rejects.toThrow('injected_artifact_write_failure');

    for (const artifactPath of paths) {
      expect(existsSync(artifactPath)).toBe(false);
    }
  }, 60_000);
});
