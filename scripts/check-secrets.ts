import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

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

const resolveCiEnvironmentName = (): string | undefined => {
  const explicit = process.env.DEPLOYMENT_ENVIRONMENT?.trim();
  if (explicit) {
    return explicit;
  }

  const ref = process.env.GITHUB_REF?.trim();
  const refName = process.env.GITHUB_REF_NAME?.trim();
  if (ref === 'refs/heads/develop' || refName === 'develop') {
    return 'staging';
  }
  if (ref === 'refs/heads/main' || refName === 'main') {
    return 'production';
  }

  return undefined;
};

const shouldCheckGroup = (group: EnvGroup, filter: Set<string> | undefined, envName: string | undefined): boolean => {
  const normalizedName = normalizeGroupName(group.name);
  if (filter && !filter.has(normalizedName)) {
    return false;
  }

  const hasEnvironmentGate = Boolean(group.environments && group.environments.length > 0);
  const environmentMatch = group.environments?.includes(envName ?? '') ?? false;
  const isCi = /^(1|true|yes)$/i.test(process.env.CI ?? '');

  if (isCi) {
    if (hasEnvironmentGate) {
      return environmentMatch;
    }
    return group.requiredInCi ?? false;
  }

  if (hasEnvironmentGate) {
    return environmentMatch;
  }

  if (group.requiredInCi && process.env.REQUIRE_EXTENDED_SECRETS !== '1') {
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
      'SUPABASE_SERVICE_ROLE_KEY',
    ],
    requiredInCi: true,
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
    environments: ['staging'],
    requiredInCi: true,
  },
  {
    name: 'Clearinghouse Sandbox',
    keys: ['CLEARINGHOUSE_SANDBOX_API_KEY', 'CLEARINGHOUSE_SANDBOX_CLIENT_ID'],
    // Gate once clearinghouse integration is production-ready.
    requiredInCi: false,
  },
  {
    name: 'Telemetry',
    keys: ['TELEMETRY_WRITE_KEY'],
    // Gate once telemetry ingestion is fully implemented.
    requiredInCi: false,
  },
];

export function collectMissingEnvVars(env: NodeJS.ProcessEnv): string[] {
  const filter = parseExplicitFilter();
  const environmentName = resolveCiEnvironmentName();

  return REQUIRED_ENV_GROUPS.flatMap((group) => {
    if (!shouldCheckGroup(group, filter, environmentName)) {
      return [];
    }

    return group.keys.filter((key) => {
      const value = env[key];
      if (key === 'SUPABASE_SERVICE_ROLE_KEY') {
        const accessToken = env.SUPABASE_ACCESS_TOKEN;
        const supabaseUrl = env.SUPABASE_URL;
        const canHydrateServiceRole = typeof accessToken === 'string'
          && accessToken.trim().length > 0
          && typeof supabaseUrl === 'string'
          && supabaseUrl.trim().length > 0;
        if (canHydrateServiceRole) {
          return false;
        }
      }
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
  const secretFindings = collectCommittedSecretFindings();
  const hasMissing = missing.length > 0;
  const hasFindings = secretFindings.length > 0;

  if (!hasMissing && !hasFindings) {
    console.log('✅ All required secrets are configured.');
    console.log('✅ No committed secret patterns were detected.');
    return { missing, exitCode: 0 };
  }

  if (hasMissing) {
    console.error(formatMissingMessage(missing));
  }

  if (hasFindings) {
    console.error('❌ Committed secret risk detected:');
    secretFindings.forEach((finding) => {
      console.error(`  - ${finding}`);
    });
    console.error('\nRemove committed secret material and replace with masked placeholders (****).');
  }

  return { missing, exitCode: 1 };
}

const FORBIDDEN_TRACKED_FILES = new Set([
  'artifacts/api-keys.json',
]);

const COMMITTED_SECRET_PATTERNS: ReadonlyArray<{ readonly label: string; readonly regex: RegExp }> = [
  { label: 'Supabase access token', regex: /\bsbp_[A-Za-z0-9]{20,}\b/g },
  { label: 'Supabase secret key', regex: /\bsb_secret_[A-Za-z0-9_-]{12,}\b/g },
  {
    label: 'Hardcoded test user password assignment',
    regex: /\b(?:const|let|var)\s+TEST_USER_PASSWORD\s*=\s*['"`][^'"`\r\n]{4,}['"`]/g,
  },
  {
    label: 'Hardcoded test user email assignment',
    regex: /\b(?:const|let|var)\s+TEST_USER_EMAIL\s*=\s*['"`][^'"`\r\n]+@[^'"`\r\n]+['"`]/g,
  },
  { label: 'JWT token literal', regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { label: 'Credentialed Postgres URL', regex: /\bpostgres(?:ql)?:\/\/[^:\s"'`]+:[^@\s"'`]+@[^/\s"'`]+/g },
  { label: 'Slack webhook URL', regex: /\bhttps:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]{20,}\b/g },
  { label: 'Private key block', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
];

const SCAN_FILE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.sql',
  '.yml',
  '.yaml',
  '.env',
  '.md',
  '.toml',
  '.pem',
  '.key',
  '.p12',
  '.crt',
  '.tfvars',
]);
const SCAN_EXCLUDED_PATH_PREFIXES = [
  'node_modules/',
  'dist/',
  'coverage/',
  '.git/',
] as const;

const listTrackedFiles = (): string[] => {
  try {
    const output = execSync('git ls-files', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
};

const isScannableFile = (filePath: string): boolean => {
  if (SCAN_EXCLUDED_PATH_PREFIXES.some((prefix) => filePath.startsWith(prefix))) {
    return false;
  }

  const baseName = path.basename(filePath).toLowerCase();
  if (baseName.startsWith('.env')) {
    return true;
  }

  const extension = path.extname(filePath);
  return SCAN_FILE_EXTENSIONS.has(extension);
};

const collectCommittedSecretFindings = (): string[] => {
  const findings: string[] = [];
  const trackedFiles = listTrackedFiles();

  for (const filePath of trackedFiles) {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const fileExists = fs.existsSync(normalizedPath);

    if (!fileExists) {
      continue;
    }

    if (FORBIDDEN_TRACKED_FILES.has(normalizedPath)) {
      findings.push(`${normalizedPath} must never be committed.`);
      continue;
    }

    if (!isScannableFile(normalizedPath)) {
      continue;
    }

    let content = '';
    try {
      content = fs.readFileSync(normalizedPath, 'utf8');
    } catch {
      continue;
    }

    for (const { label, regex } of COMMITTED_SECRET_PATTERNS) {
      const matched = regex.test(content);
      regex.lastIndex = 0;
      if (matched) {
        findings.push(`${normalizedPath} contains potential ${label}.`);
      }
    }
  }

  return findings;
};

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
