import { fileURLToPath } from 'node:url';
import path from 'node:path';

type EnvGroup = {
  readonly name: string;
  readonly keys: readonly string[];
  readonly requiredInCi?: boolean;
  readonly environments?: readonly string[];
};

const normalizeGroupName = (name: string): string => name.trim().toLowerCase();

const parseExplicitFilter = (): Set<string> | undefined => {
  const raw = process.env.CI_REQUIRED_SECRET_GROUPS;
  if (!raw) {
    return undefined;
  }

  const parts = raw
    .split(',')
    .map((part) => normalizeGroupName(part))
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    return undefined;
  }

  return new Set(parts);
};

const shouldCheckGroup = (group: EnvGroup, filter: Set<string> | undefined, envName: string | undefined): boolean => {
  if (filter) {
    return filter.has(normalizeGroupName(group.name));
  }

  if (group.environments && group.environments.length > 0) {
    return group.environments.includes(envName ?? '');
  }

  if (group.requiredInCi && process.env.CI !== 'true' && process.env.REQUIRE_EXTENDED_SECRETS !== '1') {
    return false;
  }

  return true;
};

export const REQUIRED_ENV_GROUPS: readonly EnvGroup[] = [
  {
    name: 'Supabase',
    keys: [
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'SUPABASE_EDGE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'SUPABASE_ACCESS_TOKEN',
    ],
  },
  {
    name: 'OpenAI',
    keys: ['OPENAI_API_KEY', 'OPENAI_ORGANIZATION'],
  },
  {
    name: 'AWS',
    keys: ['AWS_REGION', 'AWS_S3_BUCKET', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
  },
  {
    name: 'SMTP',
    keys: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USERNAME', 'SMTP_PASSWORD'],
  },
  {
    name: 'Test JWTs',
    keys: ['TEST_JWT_ORG_A', 'TEST_JWT_ORG_B', 'TEST_JWT_SUPER_ADMIN'],
  },
  {
    name: 'Netlify Deploy',
    keys: ['NETLIFY_AUTH_TOKEN', 'NETLIFY_STAGING_SITE_ID', 'NETLIFY_PRODUCTION_SITE_ID'],
    requiredInCi: true,
  },
  {
    name: 'Clearinghouse Sandbox',
    keys: ['CLEARINGHOUSE_SANDBOX_API_KEY', 'CLEARINGHOUSE_SANDBOX_CLIENT_ID'],
    requiredInCi: true,
  },
  {
    name: 'Telemetry',
    keys: ['TELEMETRY_WRITE_KEY'],
    requiredInCi: true,
  },
];

export function collectMissingEnvVars(env: NodeJS.ProcessEnv): string[] {
  const filter = parseExplicitFilter();
  const environmentName = process.env.DEPLOYMENT_ENVIRONMENT;

  return REQUIRED_ENV_GROUPS.flatMap((group) => {
    if (!shouldCheckGroup(group, filter, environmentName)) {
      return [];
    }

    return group.keys.filter((key) => {
      const value = env[key];
      if (value === undefined) {
        return true;
      }

      if (typeof value === 'string' && value.trim() === '') {
        return true;
      }

      return false;
    });
  });
}

export function formatMissingMessage(missingKeys: string[]): string {
  if (missingKeys.length === 0) {
    return '✅ All required secrets are configured.';
  }

  const header = '❌ Missing required secrets:';
  const details = missingKeys.map((key) => `  - ${key}`).join('\n');
  const footer = '\nPopulate these values via your local environment or secrets manager before running CI checks.';

  return `${header}\n${details}${footer}`;
}

export function checkSecretsAndReport(env: NodeJS.ProcessEnv): { missing: string[]; exitCode: number } {
  const missing = collectMissingEnvVars(env);
  const exitCode = missing.length === 0 ? 0 : 1;
  const message = formatMissingMessage(missing);
  const output = exitCode === 0 ? console.log : console.error;
  output(message);

  return { missing, exitCode };
}

const moduleFilePath = fileURLToPath(import.meta.url);

const isExecutedDirectly = (() => {
  const executedFile = process.argv[1];
  if (!executedFile) {
    return false;
  }

  const executedFileString =
    typeof executedFile === 'string'
      ? executedFile
      : typeof executedFile === 'object' && executedFile !== null && 'href' in executedFile
        ? String((executedFile as { href: string }).href)
        : String(executedFile);

  if (!executedFileString) {
    return false;
  }

  const normalizedPath = executedFileString.startsWith('file:')
    ? fileURLToPath(executedFileString)
    : path.resolve(executedFileString);

  return path.resolve(normalizedPath) === moduleFilePath;
})();

if (isExecutedDirectly) {
  const { exitCode } = checkSecretsAndReport(process.env);
  process.exit(exitCode);
}
