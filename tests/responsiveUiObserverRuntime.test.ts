// @vitest-environment node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { promisify } from 'node:util';

import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  buildFatalObserverSummary,
  getSyntheticScheduleNow,
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

const undersizedHtml = `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0}button{width:16px;height:16px;padding:0}</style></head>
<body><button>OK</button></body></html>`;

const labeledCheckboxHtml = `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0}label{display:flex;align-items:center;width:160px;height:48px}input{width:13px;height:13px}</style></head>
<body><label><input type="checkbox">Receive updates</label></body></html>`;

type ScheduleFixtureMode =
  | 'pass'
  | 'clipped-control'
  | 'missing-dialog'
  | 'missing-trigger'
  | 'unexpected-read'
  | 'mutation-action';

let scheduleFixtureMode: ScheduleFixtureMode = 'pass';

const buildSyntheticScheduleHtml = (mode: ScheduleFixtureMode): string => `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box}body{margin:0;max-width:100vw;overflow-x:hidden}button{min-width:48px;min-height:48px}</style>
</head><body>
${mode === 'clipped-control' ? '<button style="position:fixed;left:-10px;top:500px;width:48px;height:48px">Clipped background</button>' : ''}
<button style="position:fixed;right:20px;bottom:0;width:16px;height:16px;min-width:0;min-height:0">Background</button>
<div id="decoy-dialog" role="dialog" style="position:fixed;right:0;top:100px"><button style="width:16px;height:16px;min-width:0;min-height:0">Decoy</button></div>
<main id="root"></main><script>
${mode === 'unexpected-read' ? "fetch('/unexpected-read').catch(() => {});" : ''}
Promise.all([
  fetch('/api/runtime-config').then((response) => response.json()),
  fetch('/api/payroll-time-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: ${mode === 'mutation-action'
      ? "JSON.stringify({ action: 'record_time_event', event: { occurredAt: '2026-08-12T16:00:00.000Z' } })"
      : "JSON.stringify({ action: 'get_day', localDate: '2026-08-12' })"},
  }).then((response) => response.json()),
  fetch('/rest/v1/rpc/get_schedule_data_batch', { method: 'POST' }).then((response) => response.json()),
  fetch('/rest/v1/rpc/get_dropdown_data', { method: 'POST' }).then((response) => response.json()),
  fetch('/rest/v1/rpc/get_sessions_optimized', { method: 'POST' }).then((response) => response.json()),
  fetch('/rest/v1/message_thread_participants').then((response) => response.json()),
]).then(([runtimeConfig, payrollDay, schedule, dropdowns, optimizedSessions, messageParticipants]) => {
  const auth = JSON.parse(localStorage.getItem('auth-storage') || '{}');
  const authIsValid = auth.user?.role === 'admin_schedule'
    && auth.roleAssignments?.includes('admin_schedule')
    && typeof (auth.accessToken || auth.access_token) === 'string'
    && typeof (auth.refreshToken || auth.refresh_token) === 'string';
  const runtimeConfigIsValid = runtimeConfig.supabaseUrl === location.origin
    && typeof runtimeConfig.supabaseAnonKey === 'string'
    && typeof runtimeConfig.defaultOrganizationId === 'string';
  const payrollDayIsValid = payrollDay?.state === 'feature_disabled';
  const scheduleIsValid = schedule.sessions.length === 12
    && schedule.sessions.every((session) => session.start_time && session.end_time)
    && schedule.therapists.length === 12
    && schedule.clients.length === 12;
  const fallbacksAreValid = dropdowns.therapists.length === 12
    && dropdowns.clients.length === 12
    && Array.isArray(optimizedSessions)
    && Array.isArray(messageParticipants);
  if (!authIsValid || !runtimeConfigIsValid || !payrollDayIsValid || !scheduleIsValid || !fallbacksAreValid) {
    throw new Error('synthetic schedule bootstrap failed');
  }
  setTimeout(() => {
    ${mode === 'missing-trigger' ? 'return;' : ''}
    const root = document.getElementById('root');
    root.innerHTML = '<div data-layout-kind="cluster"><button aria-haspopup="dialog" aria-expanded="false">12 appointments</button></div>';
    root.querySelector('button').addEventListener('click', (event) => {
      event.currentTarget.setAttribute('aria-expanded', 'true');
      event.currentTarget.setAttribute('aria-controls', 'schedule-cluster-synthetic');
      ${mode === 'missing-dialog' ? 'return;' : ''}
      const dialog = document.createElement('div');
      dialog.id = 'schedule-cluster-synthetic';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-label', '12 overlapping appointments');
      dialog.style.position = 'fixed';
      dialog.style.inset = '8px';
      dialog.innerHTML = '<button>Open appointment</button>';
      document.body.append(dialog);
    });
  }, 1000);
});
</script></body></html>`;

const receivedRequests: string[] = [];

beforeAll(async () => {
  server = http.createServer((request, response) => {
    receivedRequests.push(`${request.method ?? 'GET'} ${request.url ?? '/'}`);
    if (request.url === '/schedule') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(buildSyntheticScheduleHtml(scheduleFixtureMode));
      return;
    }
    if (request.url === '/observer-runtime-undersized') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(undersizedHtml);
      return;
    }
    if (request.url === '/observer-runtime-labeled-checkbox') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(labeledCheckboxHtml);
      return;
    }
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
  it('pins the synthetic schedule clock and overlap to Monday at 9 AM', () => {
    const syntheticNow = getSyntheticScheduleNow();

    expect(syntheticNow).toEqual(new Date(2026, 7, 10, 9, 0));
    expect(getSyntheticScheduleNow()).not.toBe(syntheticNow);
  });

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

  it('still fails an uncovered undersized mobile control', async () => {
    const summary = await runResponsiveUiObserver([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/observer-runtime-undersized',
    ]);

    expect(summary.results).toHaveLength(2);
    expect(summary.results[0].result).toBe('pass');
    expect(summary.results[1].result).toBe('fail');
    expect(summary.results[1].failureCodes).toContain('undersized-mobile-touch-target');
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
    }
  }, 60_000);

  it('measures the clickable label row for a nested native checkbox', async () => {
    const summary = await runResponsiveUiObserver([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/observer-runtime-labeled-checkbox',
    ]);

    expect(summary.ok).toBe(true);
    expect(summary.results).toHaveLength(2);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.result).toBe('pass');
      expect(result.failureCodes).toEqual([]);
    }
  }, 60_000);

  it('runs the fixed synthetic schedule scenario with fulfilled payroll get_day bootstrap and without sending synthetic requests to the server', async () => {
    scheduleFixtureMode = 'pass';
    const requestStart = receivedRequests.length;
    const summary = await runResponsiveUiObserver([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/schedule',
      '--scenario=schedule-overlap',
    ]);

    expect(summary.ok).toBe(true);
    expect(summary.results).toHaveLength(2);
    expect(receivedRequests.slice(requestStart)).toEqual(['GET /schedule', 'GET /schedule']);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.result).toBe('pass');
      expect(result.failureCodes).toEqual([]);
      const evidence = JSON.parse(await readFile(result.evidencePath, 'utf8')) as Record<string, unknown>;
      expect(evidence.scenarioId).toBe('schedule-overlap');
      expect(evidence.metricsSummary).toMatchObject({ visibleTouchTargetCount: 1 });
    }
  }, 60_000);

  it('runs the fixed payroll-time scenario with loopback-only fulfilled authority data', async () => {
    const requestStart = receivedRequests.length;
    const summary = await runResponsiveUiObserver([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/time',
      '--scenario=payroll-time',
    ]);

    expect(summary.ok).toBe(true);
    expect(summary.results).toHaveLength(2);
    expect(receivedRequests.slice(requestStart)).toEqual([]);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.result).toBe('pass');
      expect(result.failureCodes).toEqual([]);
      const evidence = JSON.parse(await readFile(result.evidencePath, 'utf8')) as Record<string, unknown>;
      expect(evidence.scenarioId).toBe('payroll-time');
      expect(JSON.stringify(evidence)).not.toContain('employmentProfileId');
      expect(JSON.stringify(evidence)).not.toContain('client_site');
    }
  }, 60_000);

  it('keeps clipped fixed-control checks document-wide in the schedule scenario', async () => {
    scheduleFixtureMode = 'clipped-control';
    const summary = await runResponsiveUiObserver([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/schedule',
      '--scenario=schedule-overlap',
    ]);

    expect(summary.ok).toBe(false);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.failureCodes).toContain('clipped-fixed-control');
    }
  }, 60_000);

  it('blocks unexpected same-origin reads in the schedule scenario', async () => {
    scheduleFixtureMode = 'unexpected-read';
    const summary = await runResponsiveUiObserver([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/schedule',
      '--scenario=schedule-overlap',
    ]);

    expect(summary.ok).toBe(false);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.failureCodes).toContain('unexpected-scenario-request');
    }
  }, 60_000);

  it('keeps payroll mutation actions fail-closed in the schedule scenario', async () => {
    scheduleFixtureMode = 'mutation-action';
    const summary = await runResponsiveUiObserver([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/schedule',
      '--scenario=schedule-overlap',
    ]);

    expect(summary.ok).toBe(false);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.failureCodes).toContain('non-read-method');
      expect(result.failureCodes).toContain('same-origin-request-failed');
      expect(result.failureCodes).toContain('console-error');
    }
  }, 60_000);

  it.each([
    ['missing-trigger', 'scenario-trigger-missing'],
    ['missing-dialog', 'scenario-dialog-missing'],
  ] as const)('reports the canonical %s scenario failure', async (mode, expectedFailure) => {
    scheduleFixtureMode = mode;
    const summary = await runResponsiveUiObserver([
      'node',
      'scripts/playwright-responsive-ui-observer.ts',
      `--base-url=${baseUrl}`,
      '--route=/schedule',
      '--scenario=schedule-overlap',
    ]);

    expect(summary.ok).toBe(false);
    for (const result of summary.results) {
      artifactPaths.add(result.screenshotPath);
      artifactPaths.add(result.evidencePath);
      expect(result.failureCodes).toContain(expectedFailure);
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
