import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const FUNCTIONS_DIR = path.join(ROOT, 'supabase', 'functions');
const SKIPPED_DIRECTORY_NAMES = new Set(['_shared']);
const FUNCTION_ENTRYPOINT_CANDIDATES = new Set(['index.ts', 'index.tsx', 'index.js', 'index.mjs']);

const parseProjectRef = (supabaseUrl) => {
  if (typeof supabaseUrl !== 'string' || supabaseUrl.trim().length === 0) {
    return null;
  }

  const normalized = supabaseUrl.trim();
  // Accept direct project-ref values (common CI secret format).
  if (/^[a-z0-9]{20}$/i.test(normalized)) {
    return normalized;
  }

  try {
    const hostname = new URL(normalized).hostname;
    const [ref] = hostname.split('.');
    return ref && ref.trim().length > 0 ? ref.trim() : null;
  } catch {
    return null;
  }
};

const resolveProjectRef = () => {
  const directProjectRef = parseProjectRef(process.env.SUPABASE_PROJECT_REF);
  if (directProjectRef) {
    return directProjectRef;
  }
  return parseProjectRef(process.env.SUPABASE_URL);
};

const parseVerifyJwtFromToml = (source) => {
  const match = source.match(/^\s*verify_jwt\s*=\s*(true|false)\s*$/im);
  if (!match) {
    return null;
  }
  return match[1].toLowerCase() === 'true';
};

const parseBooleanValue = (value) => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }
  return null;
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

const parseBooleanFlag = (value, fallback) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return fallback;
  }
  return /^(1|true|yes)$/i.test(value);
};

const parseScopeList = (value) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return entries.length > 0 ? new Set(entries) : null;
};

const parityRequired = parseBooleanFlag(process.env.CI_SUPABASE_AUTH_PARITY_REQUIRED, process.env.CI === 'true');
const shouldFailForMissingRuntime = parityRequired;

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
  const entries = await readdir(FUNCTIONS_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || SKIPPED_DIRECTORY_NAMES.has(entry.name)) {
      continue;
    }

    const configPath = path.join(FUNCTIONS_DIR, entry.name, 'function.toml');
    let content = null;
    try {
      content = await readFile(configPath, 'utf8');
    } catch {
      const childEntries = await readdir(path.join(FUNCTIONS_DIR, entry.name), { withFileTypes: true });
      const hasFunctionEntrypoint = childEntries.some(
        (child) => child.isFile() && FUNCTION_ENTRYPOINT_CANDIDATES.has(child.name),
      );
      if (hasFunctionEntrypoint) {
        throw new Error(`Missing function.toml for function directory: ${entry.name}`);
      }
      // Skip support directories that are not deployable functions.
      continue;
    }

    const verifyJwt = parseVerifyJwtFromToml(content);
    if (verifyJwt === null) {
      throw new Error(`Missing verify_jwt in ${configPath}`);
    }

    expected.push({
      slug: entry.name,
      verify_jwt: verifyJwt,
    });
  }

  expected.sort((a, b) => a.slug.localeCompare(b.slug));
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
  if (!parityRequired) {
    console.warn('⚠️ Supabase function auth parity check skipped: CI_SUPABASE_AUTH_PARITY_REQUIRED is disabled.');
    return;
  }

  const projectRef = resolveProjectRef();
  if (!ensureRuntimePrerequisites(projectRef)) {
    return;
  }

  const expectedAll = await loadExpectedSettings();
  const scope = parseScopeList(process.env.SUPABASE_FUNCTION_PARITY_SCOPE);
  const expected = scope ? expectedAll.filter((item) => scope.has(item.slug)) : expectedAll;
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

    const deployedVerifyJwt = parseBooleanValue(deployedItem.verify_jwt);
    if (deployedVerifyJwt === null) {
      mismatches.push(
        `Function "${expectedItem.slug}" has non-boolean verify_jwt value in deploy output: ${String(deployedItem.verify_jwt)}.`,
      );
      continue;
    }
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
