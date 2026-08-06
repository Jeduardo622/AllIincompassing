// @vitest-environment node

import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import http from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runResponsiveUiObserver } from '../scripts/playwright-responsive-ui-observer';

let server: http.Server;
let baseUrl: string;

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
  await Promise.all([
    rm('artifacts/responsive-ui-observer/observer-runtime-pass.desktop.1440x900.png', { force: true }),
    rm('artifacts/responsive-ui-observer/observer-runtime-pass.desktop.1440x900.json', { force: true }),
    rm('artifacts/responsive-ui-observer/observer-runtime-pass.mobile.390x844.png', { force: true }),
    rm('artifacts/responsive-ui-observer/observer-runtime-pass.mobile.390x844.json', { force: true }),
    rm('artifacts/responsive-ui-observer/observer-runtime-blocked.desktop.1440x900.png', { force: true }),
    rm('artifacts/responsive-ui-observer/observer-runtime-blocked.desktop.1440x900.json', { force: true }),
    rm('artifacts/responsive-ui-observer/observer-runtime-blocked.mobile.390x844.png', { force: true }),
    rm('artifacts/responsive-ui-observer/observer-runtime-blocked.mobile.390x844.json', { force: true }),
  ]);
});

describe('responsive UI observer browser runtime', () => {
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
      expect(result.result).toBe('fail');
      expect(result.failureCodes).toContain('non-read-method');
      expect(JSON.stringify(result)).not.toContain('/mutate');
    }
  }, 60_000);
});
