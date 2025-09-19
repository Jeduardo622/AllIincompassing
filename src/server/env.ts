import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type EnvMap = Record<string, string>;

interface EnvLoadOptions {
  readonly envPath?: string;
}

const DEFAULT_ENV_FILENAME = '.env.codex';
const envCache = new Map<string, EnvMap>();

const stripInlineComments = (value: string): string => {
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const previous = index > 0 ? value[index - 1] : undefined;

    if (character === "'" && previous !== '\\' && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (character === '"' && previous !== '\\' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (character === '#' && !inSingleQuote && !inDoubleQuote) {
      return value.slice(0, index);
    }
  }

  return value;
};

const unquoteValue = (value: string): string => {
  if (value.length < 2) {
    return value;
  }

  const first = value[0];
  const last = value[value.length - 1];

  if (first !== last || (first !== '"' && first !== "'")) {
    return value;
  }

  const inner = value.slice(1, -1);

  if (first === '"') {
    try {
      return JSON.parse(value);
    } catch {
      return inner
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }
  }

  if (first === "'") {
    return inner
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, '\\');
  }

  return inner;
};

const sanitizeValue = (raw: string | undefined | null): string | undefined => {
  if (typeof raw !== 'string') {
    return undefined;
  }

  const withoutComments = stripInlineComments(raw);
  const trimmed = withoutComments.trim();
  if (!trimmed) {
    return undefined;
  }

  const unquoted = unquoteValue(trimmed);
  const normalized = unquoted.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const parseEnvContent = (content: string): EnvMap => {
  const result: EnvMap = {};

  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return;
    }

    const withoutExport = trimmed.startsWith('export ')
      ? trimmed.slice('export '.length).trim()
      : trimmed;

    const equalsIndex = withoutExport.indexOf('=');
    if (equalsIndex === -1) {
      return;
    }

    const key = withoutExport.slice(0, equalsIndex).trim();
    if (!key) {
      return;
    }

    const value = sanitizeValue(withoutExport.slice(equalsIndex + 1));
    if (value !== undefined) {
      result[key] = value;
    }
  });

  return result;
};

const getEnvFilePath = (explicitPath?: string): string => {
  const configuredPath = explicitPath ?? process.env.CODEX_ENV_PATH ?? DEFAULT_ENV_FILENAME;
  return resolve(process.cwd(), configuredPath);
};

const getCachedEnv = (envPath: string): EnvMap => {
  const cached = envCache.get(envPath);
  if (cached) {
    return cached;
  }

  if (!existsSync(envPath)) {
    const empty: EnvMap = {};
    envCache.set(envPath, empty);
    return empty;
  }

  try {
    const content = readFileSync(envPath, 'utf8');
    const parsed = parseEnvContent(content);
    envCache.set(envPath, parsed);
    return parsed;
  } catch (error) {
    throw new Error(
      `Failed to read ${envPath}: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
};

const getProcessEnvValue = (key: string): string | undefined => {
  const raw = process.env[key];
  const normalized = sanitizeValue(raw);
  if (normalized && raw !== normalized) {
    process.env[key] = normalized;
  }
  return normalized;
};

const loadFromCodex = (keys: string[], { envPath }: EnvLoadOptions = {}): void => {
  const filteredKeys = keys
    .map((key) => key?.trim())
    .filter((key): key is string => typeof key === 'string' && key.length > 0);

  if (filteredKeys.length === 0) {
    return;
  }

  const missingKeys = filteredKeys.filter((key) => !getProcessEnvValue(key));
  if (missingKeys.length === 0) {
    return;
  }

  const resolvedPath = getEnvFilePath(envPath);
  const parsed = getCachedEnv(resolvedPath);

  missingKeys.forEach((key) => {
    const value = parsed[key];
    if (value !== undefined) {
      process.env[key] = value;
    }
  });
};

export const ensureServerEnv = (keys: string[], options?: EnvLoadOptions): void => {
  loadFromCodex(keys, options);
};

export const getOptionalServerEnv = (key: string, options?: EnvLoadOptions): string | undefined => {
  loadFromCodex([key], options);
  return getProcessEnvValue(key);
};

export const getRequiredServerEnv = (key: string, options?: EnvLoadOptions): string => {
  const value = getOptionalServerEnv(key, options);
  if (value) {
    return value;
  }

  const resolvedPath = getEnvFilePath(options?.envPath);
  throw new Error(`Missing required environment variable ${key}. Provide it via process.env or set it in ${resolvedPath}.`);
};

export const resetEnvCacheForTests = (): void => {
  envCache.clear();
};
