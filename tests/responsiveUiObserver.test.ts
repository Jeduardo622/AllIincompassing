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
import {
  parsePayrollApprovalReadBody,
  parsePayrollReviewDetailsFixtureResponse,
  parsePayrollReviewQueueFixtureResponse,
} from '../scripts/playwright-responsive-ui-observer';

const baseUrl = 'http://127.0.0.1:4173';
const routes = ['/desk/responsive-check', '/desk/responsive-summary'];

const readOnlyPolicy = {
  mode: 'read-only',
  allowMutations: false,
  allowExternalRequests: false,
} as const;

describe('responsive-ui-observer contract', () => {
  it('accepts only the exact production payroll review read request shapes', () => {
    expect(parsePayrollApprovalReadBody(JSON.stringify({
      action: 'review_queue',
      selectedLocalDate: '2026-08-12',
    }))).toEqual({ action: 'review_queue', selectedLocalDate: '2026-08-12' });
    expect(parsePayrollApprovalReadBody(JSON.stringify({
      action: 'review_details',
      snapshotId: '11111111-1111-1111-1111-111111111111',
      snapshotHash: 'a'.repeat(64),
    }))).toEqual({
      action: 'review_details',
      snapshotId: '11111111-1111-1111-1111-111111111111',
      snapshotHash: 'a'.repeat(64),
    });

    expect(parsePayrollApprovalReadBody(JSON.stringify({
      action: 'review_details',
      selectedLocalDate: '2026-08-12',
      snapshot: {
        id: '11111111-1111-1111-1111-111111111111',
        hash: 'a'.repeat(64),
      },
    }))).toBeNull();
    expect(parsePayrollApprovalReadBody(JSON.stringify({
      action: 'review_queue',
      selectedLocalDate: '2026-08-12',
      leaked: true,
    }))).toBeNull();
  });

  it('accepts only strict canonical payroll review fixture responses', () => {
    const queueResponse = {
      state: 'ok',
      selectedLocalDate: '2026-08-12',
      capabilities: {
        canReviewAssigned: true,
        canApproveAssigned: true,
        canViewCompensation: false,
        hasOrgPayrollAccess: false,
      },
      queue: [{
        employeeLabel: 'Employee 1001',
        employmentProfileId: '99999999-9999-4999-8999-999999999999',
        payPeriodId: '88888888-8888-4888-8888-888888888888',
        periodStart: '2026-08-10',
        periodEnd: '2026-08-16',
        state: 'submitted',
        blockerCount: 0,
        submittedAt: '2026-08-12T18:00:00.000Z',
        snapshot: {
          id: '11111111-1111-1111-1111-111111111111',
          hash: 'a'.repeat(64),
        },
        classifiedSeconds: { regular: 14400, overtime: 0, doubleTime: 0 },
      }],
    };
    const detailsResponse = {
      state: 'ok',
      snapshotId: '11111111-1111-1111-1111-111111111111',
      snapshotHash: 'a'.repeat(64),
      periodStart: '2026-08-10',
      periodEnd: '2026-08-16',
      punches: [{
        id: '77777777-7777-4777-8777-777777777777',
        eventType: 'shift_started',
        occurredAt: '2026-08-12T15:00:00.000Z',
        timezone: 'America/Los_Angeles',
        workLocation: null,
        workCategory: null,
        createdAt: '2026-08-12T15:00:01.000Z',
      }],
      classifiedSeconds: { regular: 14400, overtime: 0, doubleTime: 0 },
      approvalHistory: [{
        action: 'submitted',
        occurredAt: '2026-08-12T18:00:00.000Z',
        comment: null,
        reason: null,
        snapshotId: '11111111-1111-1111-1111-111111111111',
        snapshotHash: 'a'.repeat(64),
      }],
      blockers: [{
        blockerType: 'timekeeping_exception',
        blockerId: '66666666-6666-4666-8666-666666666666',
        state: 'open',
        createdAt: '2026-08-12T17:00:00.000Z',
      }],
      unresolvedBlockerCount: 1,
      compensation: { grossEarningsCents: 123456 },
    };

    expect(parsePayrollReviewQueueFixtureResponse(queueResponse)).toEqual(queueResponse);
    expect(parsePayrollReviewQueueFixtureResponse({
      ...queueResponse,
      queue: [{
        ...queueResponse.queue[0],
        compensation: { grossEarningsCents: 123456 },
      }],
    })).toBeNull();
    expect(parsePayrollReviewDetailsFixtureResponse(detailsResponse)).toEqual(detailsResponse);
    expect(parsePayrollReviewQueueFixtureResponse({ ...queueResponse, leaked: true })).toBeNull();
    expect(parsePayrollReviewDetailsFixtureResponse({
      ...detailsResponse,
      snapshot: {
        id: detailsResponse.snapshotId,
        hash: detailsResponse.snapshotHash,
      },
    })).toBeNull();
    expect(parsePayrollReviewDetailsFixtureResponse({
      ...detailsResponse,
      punches: [{ ...detailsResponse.punches[0], timezone: null }],
    })).toBeNull();
    expect(parsePayrollReviewDetailsFixtureResponse({
      ...detailsResponse,
      blockers: [{
        blockerType: 'timekeeping_exception',
        id: '66666666-6666-4666-8666-666666666666',
        state: 'open',
        createdAt: '2026-08-12T17:00:00.000Z',
      }],
    })).toBeNull();
  });

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
    expect(source).toContain('RESPONSIVE_CAPTURE_REDACTION_CSS');
    expect(source).toContain('redactPageForCapture(page)');
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

    it('accepts only the fixed synthetic schedule-overlap scenario on /schedule', () => {
      expect(parseObserverArgs([
        'node',
        'scripts/playwright-responsive-ui-observer.ts',
        `--base-url=${baseUrl}`,
        '--route=/schedule',
        '--scenario=schedule-overlap',
      ])).toEqual({
        baseUrl,
        routes: ['/schedule'],
        scenario: 'schedule-overlap',
      });

      for (const invalidArgs of [
        ['--route=/schedule', '--scenario=unknown'],
        ['--route=/desk', '--scenario=schedule-overlap'],
        ['--route=/schedule', '--route=/desk', '--scenario=schedule-overlap'],
        ['--route=/schedule', '--scenario=schedule-overlap', '--scenario=schedule-overlap'],
      ]) {
        expect(() => parseObserverArgs([
          'node',
          'scripts/playwright-responsive-ui-observer.ts',
          `--base-url=${baseUrl}`,
          ...invalidArgs,
        ])).toThrow();
      }
    });

    it('accepts only the fixed synthetic payroll-time scenario on /time', () => {
      expect(parseObserverArgs([
        'node',
        'scripts/playwright-responsive-ui-observer.ts',
        `--base-url=${baseUrl}`,
        '--route=/time',
        '--scenario=payroll-time',
      ])).toEqual({
        baseUrl,
        routes: ['/time'],
        scenario: 'payroll-time',
      });

      for (const invalidArgs of [
        ['--route=/schedule', '--scenario=payroll-time'],
        ['--route=/time', '--route=/desk', '--scenario=payroll-time'],
        ['--route=/time', '--scenario=payroll-time', '--scenario=payroll-time'],
      ]) {
        expect(() => parseObserverArgs([
          'node',
          'scripts/playwright-responsive-ui-observer.ts',
          `--base-url=${baseUrl}`,
          ...invalidArgs,
        ])).toThrow();
      }
    });

    it('accepts only the fixed synthetic payroll-time-review scenario on /time/review', () => {
      expect(parseObserverArgs([
        'node',
        'scripts/playwright-responsive-ui-observer.ts',
        `--base-url=${baseUrl}`,
        '--route=/time/review',
        '--scenario=payroll-time-review',
      ])).toEqual({
        baseUrl,
        routes: ['/time/review'],
        scenario: 'payroll-time-review',
      });

      for (const invalidArgs of [
        ['--route=/time', '--scenario=payroll-time-review'],
        ['--route=/time/review', '--route=/desk', '--scenario=payroll-time-review'],
        ['--route=/time/review', '--scenario=payroll-time-review', '--scenario=payroll-time-review'],
      ]) {
        expect(() => parseObserverArgs([
          'node',
          'scripts/playwright-responsive-ui-observer.ts',
          `--base-url=${baseUrl}`,
          ...invalidArgs,
        ])).toThrow();
      }
    });

    it('rejects payroll-administration interception and accepts /payroll only as an ordinary local route', () => {
      expect(parseObserverArgs([
        'node',
        'scripts/playwright-responsive-ui-observer.ts',
        `--base-url=${baseUrl}`,
        '--route=/payroll',
      ])).toEqual({
        baseUrl,
        routes: ['/payroll'],
        scenario: undefined,
      });

      expect(() => parseObserverArgs([
        'node',
        'scripts/playwright-responsive-ui-observer.ts',
        `--base-url=${baseUrl}`,
        '--route=/payroll',
        '--scenario=payroll-administration',
      ])).toThrow(/unknown observer scenario/i);
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
        'http://localhost',
        'http://127.0.0.1',
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
    it('preserves only canonical codes produced by layout classification', () => {
      const classified = classifyLayout({
        horizontalOverflow: true,
        clippedFixedControls: ['sticky-save'],
        visibleTouchTargets: [{ width: 32, height: 32 }],
      }, 'mobile');

      expect(sanitizeObserverFailures(classified)).toEqual([
        'horizontal-overflow',
        'clipped-fixed-control',
        'undersized-mobile-touch-target',
      ]);
    });

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
    it('records fixed synthetic scenario provenance without exposing fixture data', () => {
      const evidenceCard = buildEvidenceCard({
        route: '/schedule',
        viewportName: 'desktop',
        result: 'pass',
        failures: [],
        metrics: {
          horizontalOverflow: false,
          clippedFixedControls: [],
          visibleTouchTargets: [{ width: 48, height: 48 }],
        },
        screenshotHash: `sha256:${'1'.repeat(64)}`,
        evidenceHash: `sha256:${'2'.repeat(64)}`,
        scenario: 'schedule-overlap',
      } as any);

      expect(evidenceCard).toMatchObject({ scenarioId: 'schedule-overlap' });
      expect(JSON.stringify(evidenceCard)).not.toContain('observer-admin');
      expect(JSON.stringify(evidenceCard)).not.toContain('stub-observer');
    });

    it('records fixed payroll-time provenance without exposing payroll payload details', () => {
      const evidenceCard = buildEvidenceCard({
        route: '/time',
        viewportName: 'mobile',
        result: 'pass',
        failures: [],
        metrics: {
          horizontalOverflow: false,
          clippedFixedControls: [],
          visibleTouchTargets: [{ width: 48, height: 48 }],
        },
        screenshotHash: `sha256:${'3'.repeat(64)}`,
        evidenceHash: `sha256:${'4'.repeat(64)}`,
        scenario: 'payroll-time',
      } as any);

      expect(evidenceCard).toMatchObject({ scenarioId: 'payroll-time' });
      expect(JSON.stringify(evidenceCard)).not.toContain('employmentProfileId');
      expect(JSON.stringify(evidenceCard)).not.toContain('sessionAttendance');
    });

    it('records fixed payroll-time-review provenance without exposing approval payload details', () => {
      const evidenceCard = buildEvidenceCard({
        route: '/time/review',
        viewportName: 'mobile',
        result: 'pass',
        failures: [],
        metrics: {
          horizontalOverflow: false,
          clippedFixedControls: [],
          visibleTouchTargets: [{ width: 48, height: 48 }],
        },
        screenshotHash: `sha256:${'5'.repeat(64)}`,
        evidenceHash: `sha256:${'6'.repeat(64)}`,
        scenario: 'payroll-time-review',
      } as any);

      expect(evidenceCard).toMatchObject({ scenarioId: 'payroll-time-review' });
      expect(JSON.stringify(evidenceCard)).not.toContain('blockerId');
      expect(JSON.stringify(evidenceCard)).not.toContain('hourlyRateCents');
    });

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
        routeId: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        routeSlug: expect.stringMatching(/^route-[0-9a-f]{64}$/),
        viewportName: 'desktop',
        screenshotPath: expect.stringMatching(
          /^artifacts\/responsive-ui-observer\/route-[0-9a-f]{64}\.desktop\.1440x900\.png$/,
        ),
        evidencePath: expect.stringMatching(
          /^artifacts\/responsive-ui-observer\/route-[0-9a-f]{64}\.desktop\.1440x900\.json$/,
        ),
        policy: readOnlyPolicy,
        artifactMode: 'redacted-layout',
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

      expect(evidenceCard).not.toHaveProperty('route');
      expect(JSON.stringify(evidenceCard)).not.toContain('550e8400');
      expect(JSON.stringify(evidenceCard)).not.toContain('alice@example.com');
      expect(evidenceCard.routeSlug).toMatch(/^route-[0-9a-f]{64}$/);
    });

    it('keeps distinct redacted dynamic routes on distinct artifact paths', () => {
      const makeCard = (route: string) => buildEvidenceCard({
        route,
        viewportName: 'desktop',
        result: 'pass',
        failures: [],
        metrics: {
          horizontalOverflow: false,
          clippedFixedControls: [],
          visibleTouchTargets: [],
        },
        screenshotHash: `sha256:${'1'.repeat(64)}`,
        evidenceHash: `sha256:${'2'.repeat(64)}`,
      });

      const first = makeCard('/clients/550e8400-e29b-41d4-a716-446655440000');
      const second = makeCard('/clients/6ba7b810-9dad-41d1-80b4-00c04fd430c8');
      expect(first.screenshotPath).not.toBe(second.screenshotPath);
      expect(first.evidencePath).not.toBe(second.evidencePath);
      expect(JSON.stringify(first)).not.toContain('/clients/');
      expect(JSON.stringify(second)).not.toContain('/clients/');
    });
  });
});
