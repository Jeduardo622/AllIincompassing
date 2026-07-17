import { appendFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

export interface BranchDetails {
  id?: string;
  name?: string;
  project_ref?: string;
  parent_project_ref?: string;
  status?: string;
}

export interface ApiKeyDetails {
  type?: string;
  api_key?: string;
}

export interface ClassifiedApiKeys {
  publishableKey: string;
  secretKey: string;
}

export type SupabaseCommandRunner = (args: string[]) => Promise<string>;
export type LifecycleMode = 'create' | 'cleanup';

type Sleep = (milliseconds: number) => Promise<void>;

interface LifecycleOptions {
  parentRef: string;
  branchName: string;
  runner?: SupabaseCommandRunner;
  sleep?: Sleep;
  maxPollAttempts?: number;
  pollIntervalMs?: number;
}

export interface CreateDisposableBranchOptions extends LifecycleOptions {
  githubEnvPath?: string;
  mask?: (value: string) => void;
}

export interface CleanupDisposableBranchOptions extends LifecycleOptions {
  branchId?: string;
}

const execFileAsync = promisify(execFile);

const defaultRunner: SupabaseCommandRunner = async (args) => {
  const { stdout } = await execFileAsync('supabase', args, {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 1024 * 1024,
  });
  return stdout;
};

const defaultSleep: Sleep = async (milliseconds) => {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
};

const assertSingleLineValue = (name: string, value: string): string => {
  const normalized = value.trim();
  if (!normalized || /[\r\n]/.test(normalized)) {
    throw new Error(`${name} must be a non-empty single-line value.`);
  }
  return normalized;
};

const assertProjectRef = (name: string, value: string): string => {
  const normalized = assertSingleLineValue(name, value);
  if (!/^[a-z0-9]{20}$/.test(normalized)) {
    throw new Error(`${name} is not a valid Supabase project ref.`);
  }
  return normalized;
};

const assertBranchName = (value: string): string => {
  const normalized = assertSingleLineValue('branchName', value);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(normalized)) {
    throw new Error('branchName must contain only lowercase letters, numbers, and interior hyphens.');
  }
  return normalized;
};

const assertChildIdentity = (parentRef: string, branch: BranchDetails): void => {
  if (!branch.project_ref || branch.project_ref === parentRef) {
    throw new Error('Refusing production Supabase project.');
  }
  if (branch.parent_project_ref !== parentRef) {
    throw new Error('Disposable branch parent mismatch.');
  }
};

const assertRequestedBranchName = (branchName: string, branch: BranchDetails): void => {
  if (branch.name !== branchName) {
    throw new Error('Disposable branch name mismatch.');
  }
};

export const assertDisposableBranch = (parentRef: string, branch: BranchDetails): void => {
  assertChildIdentity(parentRef, branch);
  if (branch.status !== 'ACTIVE_HEALTHY') {
    throw new Error('Disposable branch is not healthy.');
  }
};

export const classifyApiKeys = (keys: ApiKeyDetails[]): ClassifiedApiKeys => {
  const publishableKeys = keys.filter((key) => key.type === 'publishable' && key.api_key?.trim());
  const secretKeys = keys.filter((key) => key.type === 'secret' && key.api_key?.trim());

  if (publishableKeys.length !== 1) {
    throw new Error('Expected exactly one publishable API key.');
  }
  if (secretKeys.length !== 1) {
    throw new Error('Expected exactly one secret API key.');
  }

  const publishableKey = assertSingleLineValue('publishable API key', publishableKeys[0].api_key ?? '');
  const secretKey = assertSingleLineValue('secret API key', secretKeys[0].api_key ?? '');
  if (publishableKey === secretKey) {
    throw new Error('Publishable and secret API keys must differ.');
  }
  return { publishableKey, secretKey };
};

const parseJson = (raw: string, command: string): unknown => {
  const normalized = raw.replace(/^\uFEFF/, '').trim();
  try {
    return JSON.parse(normalized) as unknown;
  } catch {
    // Some Supabase CLI releases decorate otherwise-valid JSON with status
    // notices. Extract one balanced JSON object/array without ever echoing the
    // raw response, which can include branch credentials.
  }

  const payloads: unknown[] = [];
  for (let start = 0; start < normalized.length; start += 1) {
    const opener = normalized[start];
    if (opener !== '{' && opener !== '[') continue;

    const stack: string[] = [];
    let inString = false;
    let escaped = false;
    for (let end = start; end < normalized.length; end += 1) {
      const character = normalized[end];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
        continue;
      }
      if (character === '{' || character === '[') stack.push(character);
      else if (character === '}' || character === ']') {
        const expected = character === '}' ? '{' : '[';
        if (stack.pop() !== expected) break;
        if (stack.length === 0) {
          try {
            payloads.push(JSON.parse(normalized.slice(start, end + 1)) as unknown);
            start = end;
          } catch {
            // A balanced notice such as "[warning]" is not JSON; keep looking.
          }
          break;
        }
      }
    }
  }

  if (payloads.length !== 1) {
    throw new Error(`Supabase ${command} must return exactly one JSON payload.`);
  }
  return payloads[0];
};

const parseBranch = (raw: string, command: string): BranchDetails => {
  const parsed = parseJson(raw, command);
  const candidate = parsed && typeof parsed === 'object' && 'branch' in parsed
    ? (parsed as { branch?: unknown }).branch
    : parsed;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error(`Supabase ${command} did not return branch details.`);
  }
  return candidate as BranchDetails;
};

const parseBranchList = (raw: string): BranchDetails[] => {
  const parsed = parseJson(raw, 'branches list');
  const candidate = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'branches' in parsed
    ? (parsed as { branches?: unknown }).branches
    : parsed;
  if (!Array.isArray(candidate)) {
    throw new Error('Supabase branches list did not return an array.');
  }
  return candidate.filter((branch): branch is BranchDetails => Boolean(branch) && typeof branch === 'object');
};

const parseApiKeys = (raw: string): ApiKeyDetails[] => {
  const parsed = parseJson(raw, 'projects api-keys');
  const candidate = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'api_keys' in parsed
    ? (parsed as { api_keys?: unknown }).api_keys
    : parsed;
  if (!Array.isArray(candidate)) {
    throw new Error('Supabase projects api-keys did not return an array.');
  }
  return candidate.filter((key): key is ApiKeyDetails => Boolean(key) && typeof key === 'object');
};

const appendGitHubEnv = (githubEnvPath: string | undefined, values: Record<string, string>): void => {
  if (!githubEnvPath) {
    return;
  }
  const content = Object.entries(values).map(([name, rawValue]) => {
    const value = assertSingleLineValue(name, rawValue);
    return `${name}=${value}\n`;
  }).join('');
  appendFileSync(githubEnvPath, content, { encoding: 'utf8' });
};

const commandArgs = (parts: string[], parentRef: string): string[] => [
  ...parts,
  '--project-ref', parentRef,
  '--output', 'json',
  '--yes',
];

const resolvePollOptions = (options: LifecycleOptions): {
  attempts: number;
  intervalMs: number;
  sleep: Sleep;
} => {
  const attempts = options.maxPollAttempts ?? 24;
  const intervalMs = options.pollIntervalMs ?? 5_000;
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error('maxPollAttempts must be a positive integer.');
  }
  if (!Number.isInteger(intervalMs) || intervalMs < 0) {
    throw new Error('pollIntervalMs must be a non-negative integer.');
  }
  return { attempts, intervalMs, sleep: options.sleep ?? defaultSleep };
};

export const createDisposableBranch = async (
  options: CreateDisposableBranchOptions,
): Promise<BranchDetails> => {
  const parentRef = assertProjectRef('parentRef', options.parentRef);
  const branchName = assertBranchName(options.branchName);
  const runner = options.runner ?? defaultRunner;
  const { attempts, intervalMs, sleep } = resolvePollOptions(options);
  const githubEnvPath = options.githubEnvPath?.trim() || process.env.GITHUB_ENV?.trim();
  const mask = options.mask ?? ((value: string) => process.stdout.write(`::add-mask::${value}\n`));

  // Export the requested name before creation so an unconditional cleanup step can
  // still locate a partially-created branch if the CLI response is incomplete.
  appendGitHubEnv(githubEnvPath, { SUPABASE_BRANCH_NAME: branchName });

  const created = parseBranch(await runner(commandArgs([
    'branches', 'create', branchName,
  ], parentRef)), 'branches create');
  assertChildIdentity(parentRef, created);

  const branchId = assertSingleLineValue('branch id', created.id ?? '');
  const branchRef = assertProjectRef('branch project ref', created.project_ref ?? '');
  appendGitHubEnv(githubEnvPath, {
    SUPABASE_BRANCH_ID: branchId,
    SUPABASE_BRANCH_NAME: branchName,
    SUPABASE_BRANCH_PROJECT_REF: branchRef,
  });
  assertRequestedBranchName(branchName, created);

  let healthyBranch: BranchDetails | undefined;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const branch = parseBranch(await runner(commandArgs([
      'branches', 'get', branchId,
    ], parentRef)), 'branches get');
    assertChildIdentity(parentRef, branch);
    if (branch.id !== branchId || branch.project_ref !== branchRef) {
      throw new Error('Disposable branch identity changed while polling.');
    }
    assertRequestedBranchName(branchName, branch);
    if (branch.status === 'ACTIVE_HEALTHY') {
      healthyBranch = branch;
      break;
    }
    if (branch.status?.includes('FAILED')) {
      throw new Error(`Disposable branch entered failure status: ${branch.status}.`);
    }
    if (attempt + 1 < attempts) {
      await sleep(intervalMs);
    }
  }

  if (!healthyBranch) {
    throw new Error('Disposable branch did not become healthy before the polling limit.');
  }
  assertDisposableBranch(parentRef, healthyBranch);

  const keys = classifyApiKeys(parseApiKeys(await runner([
    'projects', 'api-keys',
    '--project-ref', branchRef,
    '--output', 'json',
  ])));
  mask(keys.publishableKey);
  mask(keys.secretKey);
  appendGitHubEnv(githubEnvPath, {
    SUPABASE_URL: `https://${branchRef}.supabase.co`,
    SUPABASE_PUBLISHABLE_KEY: keys.publishableKey,
    SUPABASE_SECRET_KEY: keys.secretKey,
  });

  return healthyBranch;
};

const findCleanupTarget = (
  branches: BranchDetails[],
  branchName: string,
  branchId?: string,
): BranchDetails | undefined => {
  const byName = branches.filter((branch) => branch.name === branchName);
  if (branchId) {
    const byId = branches.find((branch) => branch.id === branchId);
    if (!byId && byName.length > 0) {
      throw new Error('Disposable branch ID mismatch during cleanup.');
    }
    return byId;
  }
  if (byName.length > 1) {
    throw new Error('Multiple disposable branches match the cleanup name.');
  }
  return byName[0];
};

export const cleanupDisposableBranch = async (
  options: CleanupDisposableBranchOptions,
): Promise<void> => {
  const parentRef = assertProjectRef('parentRef', options.parentRef);
  const branchName = assertBranchName(options.branchName);
  const branchId = options.branchId?.trim()
    ? assertSingleLineValue('branchId', options.branchId)
    : undefined;
  const runner = options.runner ?? defaultRunner;
  const { attempts, intervalMs, sleep } = resolvePollOptions(options);
  const list = async (): Promise<BranchDetails[]> => parseBranchList(await runner(commandArgs([
    'branches', 'list',
  ], parentRef)));

  const target = findCleanupTarget(await list(), branchName, branchId);
  if (!target) {
    return;
  }
  assertChildIdentity(parentRef, target);
  const deleteId = assertSingleLineValue('branch id', target.id ?? '');
  await runner(commandArgs(['branches', 'delete', deleteId], parentRef));

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const remaining = findCleanupTarget(await list(), branchName, deleteId);
    if (!remaining) {
      return;
    }
    if (attempt + 1 < attempts) {
      await sleep(intervalMs);
    }
  }
  throw new Error('Disposable branch still exists after cleanup polling.');
};

const requireEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
};

export const parseLifecycleMode = (args: string[]): LifecycleMode => {
  if (args.length !== 1 || (args[0] !== '--create' && args[0] !== '--cleanup')) {
    throw new Error('Specify exactly one lifecycle mode: --create or --cleanup.');
  }
  return args[0] === '--create' ? 'create' : 'cleanup';
};

const main = async (): Promise<void> => {
  const mode = parseLifecycleMode(process.argv.slice(2));
  // The CLI reads this environment variable itself. Requiring it here prevents
  // accidental interactive or unauthenticated lifecycle attempts.
  requireEnv('SUPABASE_ACCESS_TOKEN');
  const parentRef = requireEnv('SUPABASE_PARENT_PROJECT_REF');
  const branchName = requireEnv('SUPABASE_BRANCH_NAME');

  if (mode === 'cleanup') {
    await cleanupDisposableBranch({
      parentRef,
      branchName,
      branchId: process.env.SUPABASE_BRANCH_ID,
    });
    process.stdout.write(`${JSON.stringify({ ok: true, action: 'deleted_and_verified_absent', branchName })}\n`);
    return;
  }

  const branch = await createDisposableBranch({ parentRef, branchName });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    action: 'created_and_healthy',
    branchId: branch.id,
    projectRef: branch.project_ref,
  })}\n`);
};

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
  && process.env.VITEST !== 'true';

if (isDirectRun) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
