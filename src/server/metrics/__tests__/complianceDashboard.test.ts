import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  GenerateDashboardOptions,
  PreviewSmokeStats,
  RouteAuditReport,
  generateComplianceDashboard,
  generateDashboardFromFiles,
  loadRouteAuditReport,
  parsePreviewSmokeLog
} from '../complianceDashboard';

describe('complianceDashboard', () => {
  const buildReport = (): RouteAuditReport => ({
    summary: {
      totalRoutes: 3,
      successfulRoutes: 3,
      failedRoutes: 0,
      totalApiCalls: 6,
      uniqueApiCalls: 2
    },
    routes: [
      {
        path: '/login',
        role: null,
        status: 'success',
        renderTime: 950,
        networkCalls: []
      },
      {
        path: '/dashboard',
        role: 'admin',
        status: 'success',
        renderTime: 1230,
        networkCalls: []
      },
      {
        path: '/reports',
        role: 'admin',
        status: 'success',
        renderTime: 2500,
        networkCalls: []
      }
    ],
    apiCalls: [
      {
        url: 'https://example.test/api/runtime-config',
        method: 'GET',
        timestamp: '2024-04-15T10:00:00.000Z'
      },
      {
        url: 'https://example.test/api/runtime-config',
        method: 'GET',
        timestamp: '2024-04-15T10:00:01.000Z'
      },
      {
        url: 'https://example.test/api/profile',
        method: 'GET',
        timestamp: '2024-04-15T10:00:02.000Z'
      }
    ]
  });

  const buildPreviewLog = (): string => `
[preview] Smoke configuration -> host=127.0.0.1
[preview] Preview server ready on http://127.0.0.1:4173 serving ./out.
[smoke] index.html -> OK
[smoke] runtime-config -> OK
[smoke] Supabase auth health -> OK
[smoke] Supabase anon auth -> OK
[smoke] PASS
`;

  it('parses preview smoke logs into structured metrics', () => {
    const stats = parsePreviewSmokeLog(buildPreviewLog());
    expect(stats.previewUrl).toContain('http://127.0.0.1:4173');
    expect(stats.totalChecks).toBe(4);
    expect(stats.passedChecks).toBe(4);
    expect(stats.supabaseAuthHealthy).toBe(true);
    expect(stats.supabaseAnonHealthy).toBe(true);
    expect(stats.issues).toHaveLength(0);
  });

  it('generates compliance metrics with warnings for slow routes', () => {
    const previewStats: PreviewSmokeStats = parsePreviewSmokeLog(buildPreviewLog());
    const dashboard = generateComplianceDashboard(buildReport(), previewStats, {
      routeAuditPath: '/reports/evidence/route-audit.json',
      previewSmokePath: '/reports/evidence/preview-smoke-log.txt',
      thresholds: {
        slowRouteRenderTimeMs: 2000,
        maxAverageRenderTimeMs: 1800
      }
    });

    expect(dashboard.summary.totalRoutes).toBe(3);
    expect(dashboard.summary.routeSuccessRate).toBeCloseTo(1);
    expect(dashboard.summary.averageRenderTimeMs).toBeGreaterThan(1300);

    const slowRoutesMetric = dashboard.metrics.find(metric => metric.id === 'slow-routes');
    expect(slowRoutesMetric?.status).toBe('warning');
    expect(slowRoutesMetric?.value).toBe(1);

    const previewMetric = dashboard.metrics.find(
      metric => metric.id === 'preview-supabase-auth'
    );
    expect(previewMetric?.status).toBe('pass');
    expect(dashboard.alerts.length).toBeGreaterThan(0);
  });

  it('falls back to warning when preview log is missing', () => {
    const dashboard = generateComplianceDashboard(buildReport(), undefined, {
      routeAuditPath: '/reports/evidence/route-audit.json'
    });

    const previewCoverage = dashboard.metrics.find(
      metric => metric.id === 'preview-coverage'
    );
    expect(previewCoverage?.status).toBe('warning');
    expect(previewCoverage?.details[0]).toContain('not provided');
  });

  it('loads reports and preview logs from disk via generateDashboardFromFiles', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'metrics-'));
    const reportPath = path.join(tempDir, 'route-audit.json');
    const previewLogPath = path.join(tempDir, 'preview.log');
    writeFileSync(reportPath, JSON.stringify(buildReport()));
    writeFileSync(previewLogPath, buildPreviewLog());

    const options: GenerateDashboardOptions = {
      routeAuditPath: reportPath,
      previewSmokePath: previewLogPath
    };

    const dashboard = generateDashboardFromFiles(options);
    expect(dashboard.source.routeAuditReport).toContain('route-audit.json');
    expect(dashboard.source.previewSmokeLog).toContain('preview.log');
  });

  it('throws when the route audit report is malformed', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'metrics-invalid-'));
    const invalidReportPath = path.join(tempDir, 'invalid.json');
    writeFileSync(invalidReportPath, JSON.stringify({}));

    expect(() => loadRouteAuditReport(invalidReportPath)).toThrowError(
      /malformed/
    );
  });
});
