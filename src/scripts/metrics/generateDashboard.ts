import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ComplianceDashboard,
  GenerateDashboardOptions,
  generateDashboardFromFiles,
  defaultComplianceThresholds
} from '../../server/metrics/complianceDashboard';

type CliArgValue = string | boolean;

type CliArgs = Record<string, CliArgValue>;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const REPORTS_DIR = path.join(PROJECT_ROOT, 'reports');
const EVIDENCE_DIR = path.join(REPORTS_DIR, 'evidence');
const DASHBOARD_BACKUPS_DIR = path.join(REPORTS_DIR, 'dashboard-backups');
const DOCS_ANALYTICS_DIR = path.join(PROJECT_ROOT, 'docs', 'analytics');

const ROUTE_AUDIT_PATTERN = /^route-audit-report-.*\.json$/;

const parseArgs = (argv: readonly string[]): CliArgs => {
  const args: CliArgs = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      continue;
    }

    const [rawKey, rawValue] = token.split('=');
    const key = rawKey.replace(/^--/, '');
    if (rawValue !== undefined) {
      args[key] = rawValue;
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
};

const resolveLatestRouteAuditReport = (customPath?: string): string => {
  if (customPath) {
    return path.isAbsolute(customPath)
      ? customPath
      : path.join(PROJECT_ROOT, customPath);
  }

  const candidates = readdirSync(EVIDENCE_DIR)
    .filter(file => ROUTE_AUDIT_PATTERN.test(file))
    .map(file => path.join(EVIDENCE_DIR, file));

  if (candidates.length === 0) {
    throw new Error(
      `Unable to locate a route audit report in ${EVIDENCE_DIR}. Provide one with --report.`
    );
  }

  const latest = candidates.reduce((selected, current) => {
    if (!selected) {
      return current;
    }
    const selectedStat = statSync(selected);
    const currentStat = statSync(current);
    return currentStat.mtimeMs > selectedStat.mtimeMs ? current : selected;
  }, candidates[0]);

  return latest;
};

const resolvePreviewSmokeLog = (customPath?: string): string | undefined => {
  const candidate = customPath ?? path.join(EVIDENCE_DIR, 'preview-smoke-log.txt');
  const resolved = path.isAbsolute(candidate)
    ? candidate
    : path.join(PROJECT_ROOT, candidate);
  try {
    statSync(resolved);
    return resolved;
  } catch {
    return undefined;
  }
};

const ensureDirectory = (dir: string) => {
  mkdirSync(dir, { recursive: true });
};

const writeDashboardBackup = (dashboard: ComplianceDashboard, dir: string): string => {
  ensureDirectory(dir);
  const timestamp = dashboard.generatedAt.replace(/[:.]/g, '-');
  const filePath = path.join(dir, `compliance-dashboard-${timestamp}.json`);
  writeFileSync(filePath, JSON.stringify(dashboard, null, 2));
  return filePath;
};

const formatMetricLine = (metric: ComplianceDashboard['metrics'][number]): string => {
  const detailSummary = metric.details[0] ?? 'No additional details';
  return `- [${metric.status.toUpperCase()}] ${metric.title}: ${metric.value} (target ${metric.target}) — ${detailSummary}`;
};

const writeMarkdownSummary = (
  dashboard: ComplianceDashboard,
  markdownPath: string
) => {
  ensureDirectory(path.dirname(markdownPath));
  const lines: string[] = [];
  lines.push('# Compliance Dashboard Summary');
  lines.push('');
  lines.push(`- Generated at: ${dashboard.generatedAt}`);
  lines.push(`- Route audit source: ${dashboard.source.routeAuditReport}`);
  if (dashboard.source.previewSmokeLog) {
    lines.push(`- Preview smoke source: ${dashboard.source.previewSmokeLog}`);
  }
  lines.push('');
  lines.push('## Key Metrics');
  lines.push('');
  for (const metric of dashboard.metrics) {
    lines.push(formatMetricLine(metric));
  }
  lines.push('');
  lines.push('## Alerts');
  lines.push('');
  if (dashboard.alerts.length === 0) {
    lines.push('- None — all metrics within thresholds.');
  } else {
    for (const alert of dashboard.alerts) {
      lines.push(`- ${alert}`);
    }
  }

  writeFileSync(markdownPath, `${lines.join('\n')}\n`);
};

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  const reportPath = resolveLatestRouteAuditReport(
    typeof args.report === 'string' ? args.report : undefined
  );
  const previewPath = resolvePreviewSmokeLog(
    typeof args.preview === 'string' ? args.preview : undefined
  );

  const thresholds = { ...defaultComplianceThresholds };
  if (typeof args['min-route-success'] === 'string') {
    thresholds.minRouteSuccessRate = Number(args['min-route-success']);
  }
  if (typeof args['max-render-time'] === 'string') {
    thresholds.maxAverageRenderTimeMs = Number(args['max-render-time']);
  }

  const options: GenerateDashboardOptions = {
    routeAuditPath: reportPath,
    previewSmokePath: previewPath,
    thresholds
  };

  const dashboard = generateDashboardFromFiles(options);

  const backupPath = writeDashboardBackup(dashboard, DASHBOARD_BACKUPS_DIR);
  const markdownPath = path.join(DOCS_ANALYTICS_DIR, 'compliance-dashboard.md');
  writeMarkdownSummary(dashboard, markdownPath);

  const relativeBackupPath = path.relative(PROJECT_ROOT, backupPath);
  const relativeMarkdownPath = path.relative(PROJECT_ROOT, markdownPath);

  const lines = [
    'Compliance dashboard generated successfully.',
    `- Dashboard JSON: ${relativeBackupPath}`,
    `- Markdown summary: ${relativeMarkdownPath}`,
    `- Alerts: ${dashboard.alerts.length}`
  ];

  for (const metric of dashboard.metrics) {
    lines.push(formatMetricLine(metric));
  }

  process.stdout.write(`${lines.join('\n')}\n`);
};

try {
  main();
} catch (error) {
  const message =
    error instanceof Error ? error.message : 'Unknown error generating dashboard';
  process.stderr.write(`❌ Failed to generate compliance dashboard: ${message}\n`);
  process.exitCode = 1;
}
