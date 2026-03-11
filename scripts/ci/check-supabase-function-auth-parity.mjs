import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const REQUIRED_FUNCTIONS = [
  {
    slug: 'feature-flags',
    configPath: path.join(ROOT, 'supabase', 'functions', 'feature-flags', 'function.toml'),
  },
  {
    slug: 'feature-flags-v2',
    configPath: path.join(ROOT, 'supabase', 'functions', 'feature-flags-v2', 'function.toml'),
  },
];

const parseProjectRef = (supabaseUrl) => {
  if (typeof supabaseUrl !== 'string' || supabaseUrl.trim().length === 0) {
    return null;
  }

  try {
    const hostname = new URL(supabaseUrl).hostname;
    const [ref] = hostname.split('.');
    return ref && ref.trim().length > 0 ? ref.trim() : null;
  } catch {
    return null;
  }
};

const parseVerifyJwtFromToml = (source) => {
  const match = source.match(/^\s*verify_jwt\s*=\s*(true|false)\s*$/im);
  if (!match) {
    return null;
  }
  return match[1].toLowerCase() === 'true';
};

const parseFunctionsJson = (rawOutput) => {
  const trimmed = String(rawOutput ?? '').trim();
  if (!trimmed) {
    return [];
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBracket = trimmed.indexOf('[');
    const lastBracket = trimmed.lastIndexOf(']');
    if (firstBracket >= 0 && lastBracket > firstBracket) {
      const candidate = trimmed.slice(firstBracket, lastBracket + 1);
      try {
        return JSON.parse(candidate);
      } catch {
        return null;
      }
    }
    return null;
  }
};

const shouldFailForMissingRuntime = process.env.CI === 'true';

const ensureRuntimePrerequisites = (projectRef) => {
  const missing = [];
  if (!projectRef) {
    missing.push('SUPABASE_URL (or parsable project ref)');
  }
  if (!process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_ACCESS_TOKEN.trim().length === 0) {
    missing.push('SUPABASE_ACCESS_TOKEN');
  }

  if (missing.length === 0) {
    return true;
  }

  const message = `Supabase auth parity check skipped: missing ${missing.join(', ')}`;
  if (shouldFailForMissingRuntime) {
    console.error(`❌ ${message}`);
    process.exitCode = 1;
    return false;
  }

  console.warn(`⚠️ ${message}`);
  return false;
};

const loadExpectedSettings = async () => {
  const expected = [];
  for (const item of REQUIRED_FUNCTIONS) {
    const content = await readFile(item.configPath, 'utf8');
    const verifyJwt = parseVerifyJwtFromToml(content);
    if (verifyJwt === null) {
      throw new Error(`Missing verify_jwt in ${item.configPath}`);
    }

    expected.push({
      slug: item.slug,
      verify_jwt: verifyJwt,
    });
  }
  return expected;
};

const fetchDeployedSettings = (projectRef) => {
  const result = spawnSync(
    'supabase',
    ['functions', 'list', '--project-ref', projectRef, '--output', 'json'],
    {
      cwd: ROOT,
      env: process.env,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    },
  );

  if (result.status !== 0) {
    const details = String(result.stderr || result.stdout || '').trim();
    throw new Error(`Failed to list Supabase functions: ${details || `exit ${result.status}`}`);
  }

  const parsed = parseFunctionsJson(result.stdout);
  if (!Array.isArray(parsed)) {
    throw new Error('Could not parse JSON output from `supabase functions list`.');
  }

  return parsed;
};

const run = async () => {
  const projectRef = parseProjectRef(process.env.SUPABASE_URL);
  if (!ensureRuntimePrerequisites(projectRef)) {
    return;
  }

  const expected = await loadExpectedSettings();
  const deployed = fetchDeployedSettings(projectRef);
  const deployedBySlug = new Map(deployed.map((item) => [item.slug, item]));
  const mismatches = [];

  for (const expectedItem of expected) {
    const deployedItem = deployedBySlug.get(expectedItem.slug);
    if (!deployedItem) {
      mismatches.push(
        `Function "${expectedItem.slug}" missing from deployed project ${projectRef}.`,
      );
      continue;
    }

    const deployedVerifyJwt = Boolean(deployedItem.verify_jwt);
    if (deployedVerifyJwt !== expectedItem.verify_jwt) {
      mismatches.push(
        `Function "${expectedItem.slug}" verify_jwt mismatch (repo=${expectedItem.verify_jwt}, deployed=${deployedVerifyJwt}).`,
      );
    }
  }

  if (mismatches.length > 0) {
    console.error('❌ Supabase function auth parity check failed:');
    for (const mismatch of mismatches) {
      console.error(`- ${mismatch}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Supabase function auth parity check passed (${expected.length} function(s)).`);
};

run().catch((error) => {
  console.error('❌ Supabase function auth parity check failed unexpectedly.');
  console.error(error);
  process.exitCode = 1;
});
