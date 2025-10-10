import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ComplianceDashboard } from '../../server/metrics/complianceDashboard';

type CliArgs = Record<string, string | boolean>;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const DASHBOARD_BACKUPS_DIR = path.join(PROJECT_ROOT, 'reports', 'dashboard-backups');

const DASHBOARD_PATTERN = /^compliance-dashboard-.*\.json$/;

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

const findLatestDashboard = (customPath?: string): string => {
  if (customPath) {
    return path.isAbsolute(customPath)
      ? customPath
      : path.join(PROJECT_ROOT, customPath);
  }

  const candidates = readdirSync(DASHBOARD_BACKUPS_DIR)
    .filter(file => DASHBOARD_PATTERN.test(file))
    .map(file => path.join(DASHBOARD_BACKUPS_DIR, file));

  if (candidates.length === 0) {
    throw new Error(
      `No dashboard backups found in ${DASHBOARD_BACKUPS_DIR}. Run metrics:generate first.`
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

const loadDashboard = (filePath: string): ComplianceDashboard => {
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as ComplianceDashboard;
};

const formatMetricLine = (metric: ComplianceDashboard['metrics'][number]): string =>
  `- ${metric.title}: ${metric.value} (${metric.status})`;

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = args['dry-run'] === true || args['dry-run'] === 'true';
  const dashboardPath = findLatestDashboard(
    typeof args.dashboard === 'string' ? args.dashboard : undefined
  );
  const dashboard = loadDashboard(dashboardPath);

  const failing = dashboard.metrics.filter(metric => metric.status === 'fail');
  const warnings = dashboard.metrics.filter(metric => metric.status === 'warning');

  const lines = [
    dryRun
      ? 'Publishing compliance dashboard (dry-run)' 
      : 'Publishing compliance dashboard',
    `- Source: ${path.relative(PROJECT_ROOT, dashboardPath)}`,
    `- Generated at: ${dashboard.generatedAt}`,
    `- Alerts: ${dashboard.alerts.length}`
  ];

  lines.push('Metrics:');
  for (const metric of dashboard.metrics) {
    lines.push(formatMetricLine(metric));
  }

  if (dashboard.alerts.length > 0) {
    lines.push('Alerts:');
    for (const alert of dashboard.alerts) {
      lines.push(`- ${alert}`);
    }
  }

  if (!dryRun && failing.length > 0) {
    lines.push('❌ Blocking publication: one or more metrics are failing.');
    process.stdout.write(`${lines.join('\n')}\n`);
    process.exitCode = 1;
    return;
  }

  if (!dryRun && warnings.length > 0) {
    lines.push('⚠️ Publication succeeded with warnings.');
  } else {
    lines.push('✅ Dashboard publish check complete.');
  }

  process.stdout.write(`${lines.join('\n')}\n`);
};

try {
  main();
} catch (error) {
  const message =
    error instanceof Error ? error.message : 'Unknown error publishing dashboard';
  process.stderr.write(`❌ Failed to publish compliance dashboard: ${message}\n`);
  process.exitCode = 1;
}
