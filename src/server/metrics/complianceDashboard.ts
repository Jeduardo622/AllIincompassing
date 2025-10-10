import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface RouteAuditSummary {
  readonly totalRoutes: number;
  readonly successfulRoutes: number;
  readonly failedRoutes: number;
  readonly totalApiCalls?: number;
  readonly uniqueApiCalls?: number;
}

export interface RouteAuditNetworkCall {
  readonly url: string;
  readonly method: string;
  readonly timestamp: string;
}

export interface RouteAuditRoute {
  readonly path: string;
  readonly component?: string;
  readonly role: string | null;
  readonly status: 'success' | 'failed' | 'skipped';
  readonly errors?: readonly string[];
  readonly networkCalls?: readonly RouteAuditNetworkCall[];
  readonly renderTime?: number;
}

export interface RouteAuditReport {
  readonly timestamp?: string;
  readonly summary: RouteAuditSummary;
  readonly routes: readonly RouteAuditRoute[];
  readonly apiCalls?: readonly RouteAuditNetworkCall[];
}

export type ComplianceMetricStatus = 'pass' | 'warning' | 'fail';

export interface ComplianceMetric {
  readonly id: string;
  readonly title: string;
  readonly category: 'route' | 'api' | 'preview';
  readonly status: ComplianceMetricStatus;
  readonly value: number | string | null;
  readonly target: string;
  readonly details: readonly string[];
}

export interface ComplianceDashboard {
  readonly generatedAt: string;
  readonly summary: {
    readonly totalRoutes: number;
    readonly routeSuccessRate: number;
    readonly averageRenderTimeMs: number;
    readonly slowestRoute: { readonly path: string; readonly renderTime: number } | null;
  };
  readonly metrics: readonly ComplianceMetric[];
  readonly alerts: readonly string[];
  readonly source: {
    readonly routeAuditReport: string;
    readonly previewSmokeLog?: string;
  };
}

export interface PreviewSmokeStats {
  readonly previewUrl?: string;
  readonly totalChecks: number;
  readonly passedChecks: number;
  readonly supabaseAuthHealthy: boolean;
  readonly supabaseAnonHealthy: boolean;
  readonly issues: readonly string[];
}

export interface ComplianceThresholds {
  readonly minRouteSuccessRate: number;
  readonly maxAverageRenderTimeMs: number;
  readonly slowRouteRenderTimeMs: number;
  readonly minUniqueApiEndpoints: number;
  readonly maxPreviewIncidents: number;
}

export const defaultComplianceThresholds: ComplianceThresholds = {
  minRouteSuccessRate: 0.99,
  maxAverageRenderTimeMs: 2000,
  slowRouteRenderTimeMs: 2000,
  minUniqueApiEndpoints: 1,
  maxPreviewIncidents: 0
};

const RUNBOOK_ESCALATION_URL =
  'docs/PRODUCTION_READINESS_RUNBOOK.md#incident-response';

const PASS: ComplianceMetricStatus = 'pass';
const WARNING: ComplianceMetricStatus = 'warning';
const FAIL: ComplianceMetricStatus = 'fail';

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const average = (values: readonly number[]): number => {
  if (values.length === 0) {
    return 0;
  }

  const total = values.reduce((acc, value) => acc + value, 0);
  return total / values.length;
};

const toPercentage = (value: number): number =>
  Number.isFinite(value) ? Number((value * 100).toFixed(2)) : 0;

const normalisePath = (filePath: string): string =>
  filePath.replace(new RegExp(`^${path.resolve(process.cwd())}`), '.');

export const loadRouteAuditReport = (filePath: string): RouteAuditReport => {
  const raw = readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw) as RouteAuditReport;

  if (!parsed?.summary || !Array.isArray(parsed.routes)) {
    throw new Error(`Route audit report at ${filePath} is malformed.`);
  }

  return parsed;
};

const parsePreviewLine = (line: string): {
  readonly type: 'url' | 'check' | 'status' | 'other';
  readonly value: string;
} => {
  if (line.includes('http://') || line.includes('https://')) {
    return { type: 'url', value: line.trim() };
  }

  if (line.startsWith('[smoke]')) {
    const [, message] = line.split(']');
    return { type: 'check', value: message?.trim() ?? '' };
  }

  if (line.startsWith('[preview]')) {
    return { type: 'status', value: line.substring('[preview]'.length).trim() };
  }

  return { type: 'other', value: line.trim() };
};

export const parsePreviewSmokeLog = (logContents: string): PreviewSmokeStats => {
  let previewUrl: string | undefined;
  let totalChecks = 0;
  let passedChecks = 0;
  let supabaseAuthHealthy = false;
  let supabaseAnonHealthy = false;
  const issues: string[] = [];

  for (const rawLine of logContents.split(/\r?\n/)) {
    if (!rawLine) {
      continue;
    }

    const parsed = parsePreviewLine(rawLine);
    if (parsed.type === 'url' && parsed.value.includes('Preview server ready')) {
      const match = parsed.value.match(/(https?:\/\/[^\s]+)/);
      if (match) {
        previewUrl = match[1];
      }
    }

    if (parsed.type === 'check') {
      if (/->/.test(parsed.value)) {
        totalChecks += 1;
        if (parsed.value.includes('-> OK') || parsed.value.includes('-> {')) {
          passedChecks += 1;
        } else {
          issues.push(parsed.value);
        }
      }

      if (parsed.value.includes('Supabase auth health')) {
        supabaseAuthHealthy = parsed.value.includes('OK');
      }

      if (parsed.value.includes('Supabase anon auth')) {
        supabaseAnonHealthy = parsed.value.includes('OK');
      }
    }
  }

  return {
    previewUrl,
    totalChecks,
    passedChecks,
    supabaseAuthHealthy,
    supabaseAnonHealthy,
    issues
  };
};

const buildRouteMetrics = (
  report: RouteAuditReport,
  thresholds: ComplianceThresholds
): ComplianceMetric[] => {
  const { totalRoutes, successfulRoutes } = report.summary;
  const successRate = totalRoutes === 0 ? 0 : successfulRoutes / totalRoutes;

  const renderTimes = report.routes
    .map(route => route.renderTime)
    .filter(isFiniteNumber);
  const avgRenderTime = average(renderTimes);

  const slowRoutes = report.routes
    .filter(route => isFiniteNumber(route.renderTime))
    .filter(route => (route.renderTime as number) > thresholds.slowRouteRenderTimeMs)
    .map(route => `${route.path} (${route.renderTime}ms)`);

  const metrics: ComplianceMetric[] = [
    {
      id: 'route-success-rate',
      title: 'Route success rate',
      category: 'route',
      status: successRate >= thresholds.minRouteSuccessRate ? PASS : FAIL,
      value: toPercentage(successRate),
      target: `>= ${toPercentage(thresholds.minRouteSuccessRate)}%`,
      details: [`${successfulRoutes}/${totalRoutes} routes succeeded`]
    },
    {
      id: 'average-render-time',
      title: 'Average route render time',
      category: 'route',
      status: avgRenderTime <= thresholds.maxAverageRenderTimeMs ? PASS : WARNING,
      value: Number(avgRenderTime.toFixed(0)),
      target: `<= ${thresholds.maxAverageRenderTimeMs}ms`,
      details: [`Collected from ${renderTimes.length} routes`]
    },
    {
      id: 'slow-routes',
      title: 'Routes exceeding render-time budget',
      category: 'route',
      status: slowRoutes.length === 0 ? PASS : WARNING,
      value: slowRoutes.length,
      target: '0 slow routes',
      details: slowRoutes.length > 0 ? slowRoutes : ['All routes within budget']
    }
  ];

  return metrics;
};

const buildApiMetrics = (
  report: RouteAuditReport,
  thresholds: ComplianceThresholds
): ComplianceMetric[] => {
  const uniqueEndpoints = new Set(
    (report.apiCalls ?? []).map(call => call.url.toLowerCase())
  );

  const totalApiCalls = report.summary.totalApiCalls ?? report.apiCalls?.length ?? 0;
  const metrics: ComplianceMetric[] = [
    {
      id: 'api-coverage',
      title: 'Unique API endpoints exercised',
      category: 'api',
      status: uniqueEndpoints.size >= thresholds.minUniqueApiEndpoints ? PASS : WARNING,
      value: uniqueEndpoints.size,
      target: `>= ${thresholds.minUniqueApiEndpoints} endpoint`,
      details: [`${totalApiCalls} total calls recorded`]
    }
  ];

  if (totalApiCalls === 0) {
    metrics.push({
      id: 'api-traffic',
      title: 'API traffic detected',
      category: 'api',
      status: WARNING,
      value: 0,
      target: 'Traffic observed during audit',
      details: ['No API calls were captured in the audit report.']
    });
  }

  return metrics;
};

const buildPreviewMetrics = (
  preview: PreviewSmokeStats | undefined,
  thresholds: ComplianceThresholds
): ComplianceMetric[] => {
  if (!preview) {
    return [
      {
        id: 'preview-coverage',
        title: 'Preview smoke checks executed',
        category: 'preview',
        status: WARNING,
        value: null,
        target: 'Smoke log supplied',
        details: ['Preview smoke log was not provided.']
      }
    ];
  }

  const incidents = preview.totalChecks - preview.passedChecks;
  const status: ComplianceMetricStatus =
    incidents > thresholds.maxPreviewIncidents ? WARNING : PASS;

  return [
    {
      id: 'preview-checks',
      title: 'Preview smoke validations',
      category: 'preview',
      status,
      value: `${preview.passedChecks}/${preview.totalChecks}`,
      target: 'All smoke checks pass',
      details: preview.issues.length === 0 ? ['No issues detected'] : preview.issues
    },
    {
      id: 'preview-supabase-auth',
      title: 'Supabase auth health (preview)',
      category: 'preview',
      status: preview.supabaseAuthHealthy && preview.supabaseAnonHealthy ? PASS : FAIL,
      value: preview.supabaseAuthHealthy && preview.supabaseAnonHealthy ? 'healthy' : 'degraded',
      target: 'Auth + anonymous access healthy',
      details: [
        `Auth check: ${preview.supabaseAuthHealthy ? 'OK' : 'FAILED'}`,
        `Anon check: ${preview.supabaseAnonHealthy ? 'OK' : 'FAILED'}`,
        preview.previewUrl ? `Preview URL: ${preview.previewUrl}` : 'Preview URL unavailable'
      ]
    }
  ];
};

const buildAlerts = (metrics: readonly ComplianceMetric[]): string[] =>
  metrics
    .filter(metric => metric.status !== PASS)
    .map(metric =>
      `Metric "${metric.title}" flagged as ${metric.status}. See ${RUNBOOK_ESCALATION_URL}.`
    );

export interface GenerateDashboardOptions {
  readonly routeAuditPath: string;
  readonly previewSmokePath?: string;
  readonly thresholds?: Partial<ComplianceThresholds>;
}

export const generateComplianceDashboard = (
  report: RouteAuditReport,
  preview: PreviewSmokeStats | undefined,
  options: { readonly thresholds?: Partial<ComplianceThresholds>; readonly routeAuditPath: string; readonly previewSmokePath?: string }
): ComplianceDashboard => {
  const thresholds = { ...defaultComplianceThresholds, ...options.thresholds };

  const routeMetrics = buildRouteMetrics(report, thresholds);
  const apiMetrics = buildApiMetrics(report, thresholds);
  const previewMetrics = buildPreviewMetrics(preview, thresholds);
  const metrics = [...routeMetrics, ...apiMetrics, ...previewMetrics];

  const renderTimes = report.routes
    .map(route => route.renderTime)
    .filter(isFiniteNumber) as number[];
  const averageRenderTimeMs = Number(average(renderTimes).toFixed(2));

  const slowestRoute = report.routes.reduce<
    { path: string; renderTime: number } | null
  >((acc, route) => {
    if (!isFiniteNumber(route.renderTime)) {
      return acc;
    }
    if (!acc || route.renderTime! > acc.renderTime) {
      return { path: route.path, renderTime: route.renderTime! };
    }
    return acc;
  }, null);

  const { totalRoutes, successfulRoutes } = report.summary;
  const routeSuccessRate = totalRoutes === 0 ? 0 : successfulRoutes / totalRoutes;

  return {
    generatedAt: new Date().toISOString(),
    source: {
      routeAuditReport: normalisePath(options.routeAuditPath),
      previewSmokeLog: options.previewSmokePath
        ? normalisePath(options.previewSmokePath)
        : undefined
    },
    summary: {
      totalRoutes,
      routeSuccessRate,
      averageRenderTimeMs,
      slowestRoute
    },
    metrics,
    alerts: buildAlerts(metrics)
  };
};

export const generateDashboardFromFiles = (
  options: GenerateDashboardOptions
): ComplianceDashboard => {
  const report = loadRouteAuditReport(options.routeAuditPath);
  const previewLog = options.previewSmokePath
    ? readFileSync(options.previewSmokePath, 'utf-8')
    : undefined;
  const previewStats = previewLog ? parsePreviewSmokeLog(previewLog) : undefined;

  return generateComplianceDashboard(report, previewStats, {
    routeAuditPath: options.routeAuditPath,
    previewSmokePath: options.previewSmokePath,
    thresholds: options.thresholds
  });
};
