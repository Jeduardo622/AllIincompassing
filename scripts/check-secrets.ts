import { pathToFileURL } from 'node:url';

type EnvGroup = {
  readonly name: string;
  readonly keys: readonly string[];
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
];

export function collectMissingEnvVars(env: NodeJS.ProcessEnv): string[] {
  return REQUIRED_ENV_GROUPS.flatMap((group) =>
    group.keys.filter((key) => {
      const value = env[key];
      if (value === undefined) {
        return true;
      }

      if (typeof value === 'string' && value.trim() === '') {
        return true;
      }

      return false;
    }),
  );
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

const isExecutedDirectly = (() => {
  const executedFile = process.argv[1];
  if (!executedFile) {
    return false;
  }

  return import.meta.url === pathToFileURL(executedFile).href;
})();

if (isExecutedDirectly) {
  const { exitCode } = checkSecretsAndReport(process.env);
  process.exit(exitCode);
}
