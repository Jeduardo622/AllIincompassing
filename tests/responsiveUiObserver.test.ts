import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  OBSERVER_VIEWPORTS,
  assertLoopbackBaseUrl,
  assertObserverRoute,
  buildEvidenceCard,
  classifyLayout,
  parseObserverArgs,
  sanitizeObserverFailures,
} from '../scripts/lib/responsive-ui-observer';

const baseUrl = 'http://127.0.0.1:4173';
const routes = ['/desk/responsive-check', '/desk/responsive-summary'];

const readOnlyPolicy = {
  mode: 'read-only',
  allowMutations: false,
  allowExternalRequests: false,
} as const;

describe('responsive-ui-observer contract', () => {
  it('keeps the CLI isolated from env files, hosted defaults, and mutable browser state', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'scripts/playwright-responsive-ui-observer.ts'),
      'utf8',
    );

    expect(source).not.toMatch(/dotenv|load-playwright-env|storageState|recordHar|recordVideo|tracing/i);
    expect(source).not.toMatch(/https:\/\//i);
    expect(source).toContain("chromium.launch({ headless: true })");
    expect(source).toContain("serviceWorkers: 'block'");
    expect(source).toContain('pathToFileURL(process.argv[1])');
  });

  it('pins the exact desktop and mobile viewport pair', () => {
    expect(OBSERVER_VIEWPORTS).toEqual([
      { name: 'desktop', width: 1440, height: 900 },
      { name: 'mobile', width: 390, height: 844 },
    ]);
  });

  describe('parseObserverArgs', () => {
    it('accepts an explicit loopback base URL and repeated route flags', () => {
      const parsed = parseObserverArgs([
        'node',
        'scripts/playwright-responsive-ui-observer.ts',
        `--base-url=${baseUrl}`,
        `--route=${routes[0]}`,
        `--route=${routes[1]}`,
      ]);

      expect(parsed).toMatchObject({
        baseUrl,
        routes,
      });
    });

    it('rejects a missing route flag', () => {
      expect(() =>
        parseObserverArgs([
          'node',
          'scripts/playwright-responsive-ui-observer.ts',
          `--base-url=${baseUrl}`,
        ]),
      ).toThrow(/route/i);
    });

    it('rejects unknown arguments', () => {
      expect(() =>
        parseObserverArgs([
          'node',
          'scripts/playwright-responsive-ui-observer.ts',
          `--base-url=${baseUrl}`,
          `--route=${routes[0]}`,
          `--route=${routes[1]}`,
          '--bogus=1',
        ]),
      ).toThrow(/unknown/i);
    });
  });

  describe('assertLoopbackBaseUrl', () => {
    it('accepts only http loopback URLs without credentials, query, or hash', () => {
      expect(() => assertLoopbackBaseUrl('http://localhost:3000')).not.toThrow();
      expect(() => assertLoopbackBaseUrl('http://127.0.0.1:4173')).not.toThrow();
    });

    it('rejects non-loopback or decorated URLs', () => {
      for (const value of [
        'https://127.0.0.1:4173',
        'http://user:pass@127.0.0.1:4173',
        'http://127.0.0.1:4173/?token=abc',
        'http://127.0.0.1:4173/#hash',
        'http://192.168.0.10:4173',
      ]) {
        expect(() => assertLoopbackBaseUrl(value)).toThrow();
      }
    });
  });

  describe('assertObserverRoute', () => {
    it('accepts only relative local routes without query, hash, or traversal', () => {
      for (const value of ['/desk', '/desk/responsive-check', '/observability/local/preview']) {
        expect(() => assertObserverRoute(value)).not.toThrow();
      }
    });

    it('rejects absolute routes, decorated routes, and traversal', () => {
      for (const value of [
        'http://localhost:4173/desk',
        '/desk?token=abc',
        '/desk#hash',
        '/../admin',
        '/desk/../../admin',
        '/desk/%2e%2e/admin',
        '/desk/%2fadmin',
        '/desk/%zz',
      ]) {
        expect(() => assertObserverRoute(value)).toThrow();
      }
    });
  });

  describe('classifyLayout', () => {
    it('flags horizontal overflow', () => {
      expect(
        classifyLayout(
          {
            horizontalOverflow: true,
            clippedFixedControls: [],
            visibleTouchTargets: [{ width: 48, height: 48 }],
          },
          'desktop',
        ),
      ).toEqual(['horizontal-overflow']);
    });

    it('flags clipped fixed controls', () => {
      expect(
        classifyLayout(
          {
            horizontalOverflow: false,
            clippedFixedControls: ['sticky-save'],
            visibleTouchTargets: [{ width: 48, height: 48 }],
          },
          'desktop',
        ),
      ).toEqual(['clipped-fixed-control']);
    });

    it('flags undersized mobile targets on mobile', () => {
      expect(
        classifyLayout(
          {
            horizontalOverflow: false,
            clippedFixedControls: [],
            visibleTouchTargets: [{ width: 32, height: 32 }],
          },
          'mobile',
        ),
      ).toEqual(['undersized-mobile-touch-target']);
    });

    it('ignores the mobile touch-target threshold on desktop', () => {
      expect(
        classifyLayout(
          {
            horizontalOverflow: false,
            clippedFixedControls: [],
            visibleTouchTargets: [{ width: 32, height: 32 }],
          },
          'desktop',
        ),
      ).toEqual([]);
    });
  });

  describe('sanitizeObserverFailures', () => {
    it('collapses sensitive values into machine-safe codes', () => {
      const sanitized = sanitizeObserverFailures([
        'horizontal overflow with alice@example.com in the DOM text',
        'request id 550e8400-e29b-41d4-a716-446655440000',
        'access token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
        'query value foo=bar&secret=baz',
        'button text Save draft for Jane Doe',
      ]);

      expect(sanitized).toEqual([
        'horizontal-overflow',
        'email',
        'uuid',
        'token',
        'query-value',
        'dom-text',
      ]);

      const serialized = JSON.stringify(sanitized);
      for (const value of [
        'alice@example.com',
        '550e8400-e29b-41d4-a716-446655440000',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
        'foo=bar',
        'Save draft',
        'Jane Doe',
      ]) {
        expect(serialized).not.toContain(value);
      }
    });
  });

  describe('buildEvidenceCard', () => {
    it('derives deterministic route slugs and paths while excluding raw payloads', () => {
      const evidenceCard = buildEvidenceCard({
        route: '/desk/responsive-check',
        viewportName: 'desktop',
        result: 'fail',
        failures: ['horizontal-overflow'],
        metrics: {
          horizontalOverflow: true,
          clippedFixedControls: ['sticky-save'],
          visibleTouchTargets: [{ width: 32, height: 32 }],
        },
        screenshotHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
        evidenceHash: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
        rawText: 'Appointment confirmed for alice@example.com',
        rawNetworkBodies: ['{"token":"secret"}'],
      } as any);

      expect(evidenceCard).toMatchObject({
        route: '/desk/responsive-check',
        routeSlug: 'desk-responsive-check',
        viewportName: 'desktop',
        screenshotPath:
          'artifacts/responsive-ui-observer/desk-responsive-check.desktop.1440x900.png',
        evidencePath: 'artifacts/responsive-ui-observer/desk-responsive-check.desktop.1440x900.json',
        policy: readOnlyPolicy,
        result: 'fail',
        hashes: {
          screenshot: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
          evidence: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
        },
      });

      const serialized = JSON.stringify(evidenceCard);
      for (const value of [
        'Appointment confirmed',
        'alice@example.com',
        '{"token":"secret"}',
        'horizontalOverflow',
        'sticky-save',
        'visibleTouchTargets',
      ]) {
        expect(serialized).not.toContain(value);
      }
    });

    it('redacts sensitive route segments from evidence and artifact paths', () => {
      const evidenceCard = buildEvidenceCard({
        route: '/clients/550e8400-e29b-41d4-a716-446655440000/alice@example.com',
        viewportName: 'mobile',
        result: 'pass',
        failures: [],
        metrics: {
          horizontalOverflow: false,
          clippedFixedControls: [],
          visibleTouchTargets: [{ width: 48, height: 48 }],
        },
        screenshotHash: `sha256:${'1'.repeat(64)}`,
        evidenceHash: `sha256:${'2'.repeat(64)}`,
      });

      expect(evidenceCard.route).toBe('/clients/redacted/redacted');
      expect(JSON.stringify(evidenceCard)).not.toContain('550e8400');
      expect(JSON.stringify(evidenceCard)).not.toContain('alice@example.com');
    });
  });
});
