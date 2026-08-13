import { createHash } from 'node:crypto';

export type ObserverViewportName = 'desktop' | 'mobile';

export type ObserverViewport = {
  name: ObserverViewportName;
  width: number;
  height: number;
};

export type ObserverArgs = {
  baseUrl: string;
  routes: string[];
  scenario?: ObserverScenario;
};

export type ObserverScenario = 'schedule-overlap' | 'payroll-time' | 'payroll-time-review';

export type LayoutTouchTarget = {
  width: number;
  height: number;
};

export type LayoutMetrics = {
  horizontalOverflow: boolean;
  clippedFixedControls: string[];
  visibleTouchTargets: LayoutTouchTarget[];
};

export type ObserverPolicy = {
  mode: 'read-only';
  allowMutations: false;
  allowExternalRequests: false;
};

export type EvidenceCardInput = {
  route: string;
  viewportName: ObserverViewportName;
  result: 'pass' | 'fail';
  failures: string[];
  metrics: LayoutMetrics;
  screenshotHash: string;
  evidenceHash: string;
  scenario?: ObserverScenario;
};

export const OBSERVER_VIEWPORTS: ObserverViewport[] = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

export const OBSERVER_ARTIFACT_DIR = 'artifacts/responsive-ui-observer';

export const OBSERVER_POLICY: ObserverPolicy = {
  mode: 'read-only',
  allowMutations: false,
  allowExternalRequests: false,
};

const SCHEDULE_OVERLAP_SCENARIO: ObserverScenario = 'schedule-overlap';
const PAYROLL_TIME_SCENARIO: ObserverScenario = 'payroll-time';
const PAYROLL_TIME_REVIEW_SCENARIO: ObserverScenario = 'payroll-time-review';

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const TOKEN_PATTERN =
  /\b(?:eyJ[A-Za-z0-9_-]+|token|bearer|api[_-]?key|secret|password|session[_-]?id)\b/i;
const QUERY_VALUE_PATTERN = /(?:\?|&|^)[^=\s]+=[^&\s]+|[A-Za-z0-9_-]+=[A-Za-z0-9_%.-]+/;

const viewportForName = (viewportName: ObserverViewportName): ObserverViewport => {
  const viewport = OBSERVER_VIEWPORTS.find((candidate) => candidate.name === viewportName);
  if (!viewport) {
    throw new Error(`Unknown viewport "${viewportName}".`);
  }
  return viewport;
};

const uniqueCodes = (codes: string[]): string[] => {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const code of codes) {
    if (!seen.has(code)) {
      seen.add(code);
      ordered.push(code);
    }
  }
  return ordered;
};

export const sha256 = (value: string | Uint8Array): string =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;

export const assertLoopbackBaseUrl = (value: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Base URL must be a valid http loopback URL.');
  }

  const hostname = parsed.hostname.toLowerCase();
  const normalizedHostname = hostname === '::1' ? '[::1]' : hostname;
  if (parsed.protocol !== 'http:') {
    throw new Error('Base URL must use http.');
  }
  if (!LOOPBACK_HOSTNAMES.has(normalizedHostname)) {
    throw new Error('Base URL must target loopback only.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Base URL credentials are not allowed.');
  }
  if (!parsed.port) {
    throw new Error('Base URL must include an explicit port.');
  }
  if (parsed.search) {
    throw new Error('Base URL query strings are not allowed.');
  }
  if (parsed.hash) {
    throw new Error('Base URL fragments are not allowed.');
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new Error('Base URL must not include a path.');
  }

  return parsed.toString().replace(/\/$/, '');
};

export const assertObserverRoute = (value: string): string => {
  if (!value.startsWith('/')) {
    throw new Error('Route must be an absolute local path beginning with "/".');
  }
  if (value.includes('://')) {
    throw new Error('Route must be relative to the provided base URL.');
  }
  if (value.includes('?')) {
    throw new Error('Route query strings are not allowed.');
  }
  if (value.includes('#')) {
    throw new Error('Route fragments are not allowed.');
  }
  if (value.includes('\\')) {
    throw new Error('Route path separators must use "/".');
  }

  const segments = value.split('/');
  for (const segment of segments) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new Error('Route encoding is invalid.');
    }
    if (decoded === '.' || decoded === '..') {
      throw new Error('Route traversal is not allowed.');
    }
    if (decoded.includes('/') || decoded.includes('\\') || /[\u0000-\u001f\u007f]/.test(decoded)) {
      throw new Error('Route contains a forbidden encoded separator or control character.');
    }
  }

  return value;
};

export const parseObserverArgs = (argv: string[]): ObserverArgs => {
  let baseUrl: string | undefined;
  const routes: string[] = [];
  let scenario: ObserverScenario | undefined;

  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--base-url=')) {
      if (baseUrl) {
        throw new Error('Base URL may be provided only once.');
      }
      baseUrl = assertLoopbackBaseUrl(arg.slice('--base-url='.length));
      continue;
    }
    if (arg.startsWith('--route=')) {
      routes.push(assertObserverRoute(arg.slice('--route='.length)));
      continue;
    }
    if (arg.startsWith('--scenario=')) {
      if (scenario) {
        throw new Error('Scenario may be provided only once.');
      }
      const candidate = arg.slice('--scenario='.length);
      if (
        candidate !== SCHEDULE_OVERLAP_SCENARIO
        && candidate !== PAYROLL_TIME_SCENARIO
        && candidate !== PAYROLL_TIME_REVIEW_SCENARIO
      ) {
        throw new Error(`Unknown observer scenario: ${candidate}`);
      }
      scenario = candidate;
      continue;
    }
    throw new Error(`Unknown observer argument: ${arg}`);
  }

  if (!baseUrl) {
    throw new Error('Missing required --base-url=http://127.0.0.1:<port> argument.');
  }
  if (routes.length === 0) {
    throw new Error('At least one --route=/relative/path argument is required.');
  }
  if (scenario === SCHEDULE_OVERLAP_SCENARIO) {
    if (routes.length !== 1 || routes[0] !== '/schedule') {
      throw new Error('The schedule-overlap scenario requires exactly one --route=/schedule.');
    }
  }
  if (scenario === PAYROLL_TIME_SCENARIO) {
    if (routes.length !== 1 || routes[0] !== '/time') {
      throw new Error('The payroll-time scenario requires exactly one --route=/time.');
    }
  }
  if (scenario === PAYROLL_TIME_REVIEW_SCENARIO) {
    if (routes.length !== 1 || routes[0] !== '/time/review') {
      throw new Error('The payroll-time-review scenario requires exactly one --route=/time/review.');
    }
  }
  return { baseUrl, routes, scenario };
};

export const classifyLayout = (
  metrics: LayoutMetrics,
  viewportName: ObserverViewportName,
): string[] => {
  const failures: string[] = [];
  if (metrics.horizontalOverflow) {
    failures.push('horizontal-overflow');
  }
  if (metrics.clippedFixedControls.length > 0) {
    failures.push('clipped-fixed-control');
  }
  if (
    viewportName === 'mobile'
    && metrics.visibleTouchTargets.some((target) => target.width < 44 || target.height < 44)
  ) {
    failures.push('undersized-mobile-touch-target');
  }
  return failures;
};

export const sanitizeObserverFailures = (messages: string[]): string[] => {
  const codes: string[] = [];
  const canonicalLayoutCodes = new Set([
    'horizontal-overflow',
    'clipped-fixed-control',
    'undersized-mobile-touch-target',
    'scenario-trigger-missing',
    'scenario-dialog-missing',
    'unexpected-scenario-request',
    'scenario-bootstrap-missing',
    'route-surface-missing',
  ]);

  for (const message of messages) {
    const normalized = message.trim().toLowerCase();

    if (canonicalLayoutCodes.has(normalized)) {
      codes.push(normalized);
      continue;
    }

    if (normalized.includes('horizontal overflow')) {
      codes.push('horizontal-overflow');
    }
    if (normalized.includes('clipped fixed control')) {
      codes.push('clipped-fixed-control');
    }
    if (normalized.includes('undersized mobile')) {
      codes.push('undersized-mobile-touch-target');
    }
    if (normalized.includes('console')) {
      codes.push('console-error');
    }
    if (normalized.includes('pageerror') || normalized.includes('page error')) {
      codes.push('page-error');
    }
    if (normalized.includes('request failed')) {
      codes.push('same-origin-request-failed');
    }
    if (normalized.includes('external origin')) {
      codes.push('external-origin-request');
    }
    if (normalized.includes('method blocked') || normalized.includes('non-read method')) {
      codes.push('non-read-method');
    }
    if (normalized.includes('navigation')) {
      codes.push('navigation-failed');
    }
    if (normalized.includes('layout evaluation')) {
      codes.push('layout-evaluation-failed');
    }
    if (normalized.includes('http response')) {
      codes.push('http-response-failed');
    }
    if (normalized.includes('query value') || QUERY_VALUE_PATTERN.test(message)) {
      codes.push('query-value');
    }
    if (EMAIL_PATTERN.test(message)) {
      codes.push('email');
    }
    if (UUID_PATTERN.test(message)) {
      codes.push('uuid');
    }
    if (TOKEN_PATTERN.test(message)) {
      codes.push('token');
    }
    if (
      normalized.startsWith('dom text')
      || normalized.includes('button text')
      || normalized.includes('innertext')
      || normalized.includes('text content')
    ) {
      codes.push('dom-text');
    }
  }

  return uniqueCodes(codes);
};

export const buildEvidenceCard = (input: EvidenceCardInput) => {
  const viewport = viewportForName(input.viewportName);
  const routeDigest = createHash('sha256').update(input.route).digest('hex');
  const routeId = `sha256:${routeDigest}`;
  const routeSlug = `route-${routeDigest}`;
  const baseName = `${routeSlug}.${input.viewportName}.${viewport.width}x${viewport.height}`;
  const minTouchTarget = input.metrics.visibleTouchTargets.reduce<LayoutTouchTarget | null>(
    (smallest, target) => {
      if (!smallest) {
        return { width: target.width, height: target.height };
      }
      return {
        width: Math.min(smallest.width, target.width),
        height: Math.min(smallest.height, target.height),
      };
    },
    null,
  );
  const touchTargetStatus =
    input.viewportName === 'mobile'
      ? input.metrics.visibleTouchTargets.some((target) => target.width < 44 || target.height < 44)
        ? 'fail'
        : 'pass'
      : 'not-applicable';

  return {
    routeId,
    routeSlug,
    viewportName: input.viewportName,
    viewport: {
      width: viewport.width,
      height: viewport.height,
    },
    scenarioId: input.scenario ?? 'none',
    screenshotPath: `${OBSERVER_ARTIFACT_DIR}/${baseName}.png`,
    evidencePath: `${OBSERVER_ARTIFACT_DIR}/${baseName}.json`,
    policy: OBSERVER_POLICY,
    artifactMode: 'redacted-layout',
    result: input.result,
    failureCodes: sanitizeObserverFailures(input.failures),
    checks: {
      overflowX: input.metrics.horizontalOverflow ? 'fail' : 'pass',
      fixedControlBounds: input.metrics.clippedFixedControls.length > 0 ? 'fail' : 'pass',
      mobileTouchTargetSize: touchTargetStatus,
    },
    metricsSummary: {
      clippedFixedControlCount: input.metrics.clippedFixedControls.length,
      visibleTouchTargetCount: input.metrics.visibleTouchTargets.length,
      minimumVisibleTouchTarget: minTouchTarget,
    },
    hashes: {
      screenshot: input.screenshotHash,
      evidence: input.evidenceHash,
    },
  };
};
