import { loadPlaywrightEnv } from './lib/load-playwright-env';
import { assertUuid } from './lib/playwright-smoke';
import { assertNonAiSessionsEnvContract } from './lib/playwright-nonai-sessions-contract';

const REDACTED_PLACEHOLDER = '****';

const isNonEmpty = (value: string | undefined): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const assertPresent = (name: string): string => {
  const value = process.env[name];
  if (!isNonEmpty(value)) {
    throw new Error(`${name} is required for deterministic Playwright smoke execution.`);
  }
  if (value.trim() === REDACTED_PLACEHOLDER) {
    throw new Error(`${name} cannot use placeholder value "${REDACTED_PLACEHOLDER}".`);
  }
  return value.trim();
};

const assertUrl = (name: string): string => {
  const value = process.env[name]?.trim() || 'https://app.allincompassing.ai';
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('unsupported protocol');
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    throw new Error(`${name} must be a valid http(s) URL.`);
  }
};

const run = (): void => {
  loadPlaywrightEnv();

  const baseUrl = assertUrl('PW_BASE_URL');
  const adminEmail = assertPresent('PW_ADMIN_EMAIL');
  const adminPassword = assertPresent('PW_ADMIN_PASSWORD');
  const therapistEmail = assertPresent('PW_THERAPIST_EMAIL');
  const therapistPassword = assertPresent('PW_THERAPIST_PASSWORD');
  const foreignClientId = assertUuid(assertPresent('PW_FOREIGN_CLIENT_ID'), 'PW_FOREIGN_CLIENT_ID');
  const foreignTherapistId = assertUuid(assertPresent('PW_FOREIGN_THERAPIST_ID'), 'PW_FOREIGN_THERAPIST_ID');

  if (adminEmail.toLowerCase() === therapistEmail.toLowerCase()) {
    throw new Error('PW_ADMIN_EMAIL and PW_THERAPIST_EMAIL must reference different personas.');
  }
  if (adminPassword === therapistPassword) {
    console.warn(
      'Warning: PW_ADMIN_PASSWORD and PW_THERAPIST_PASSWORD are identical. Consider distinct secrets per persona.',
    );
  }
  if (foreignClientId === foreignTherapistId) {
    throw new Error('PW_FOREIGN_CLIENT_ID and PW_FOREIGN_THERAPIST_ID must be distinct.');
  }
  if (foreignClientId === '00000000-0000-0000-0000-000000000000') {
    throw new Error('PW_FOREIGN_CLIENT_ID must not use the all-zero placeholder UUID.');
  }
  if (foreignTherapistId === '00000000-0000-0000-0000-000000000000') {
    throw new Error('PW_FOREIGN_THERAPIST_ID must not use the all-zero placeholder UUID.');
  }

  const nonAiSessionCandidates = assertNonAiSessionsEnvContract(
    'Non-AI sessions Playwright lifecycle/blocked-close suites',
  );

  console.log(
    JSON.stringify({
      ok: true,
      baseUrl,
      personas: {
        adminEmail,
        therapistEmail,
      },
      entities: {
        foreignClientId,
        foreignTherapistId,
      },
      nonAiSessions: {
        ready: true,
        credentialCandidates: nonAiSessionCandidates.map((candidate) => candidate.label),
      },
      message: 'Playwright preflight contract check passed.',
    }),
  );
};

try {
  run();
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      message: 'Playwright preflight contract check failed.',
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
}
