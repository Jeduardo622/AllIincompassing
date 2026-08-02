export interface LocalSupabaseStatusEnv {
  API_URL: string;
  DB_URL: string;
  ANON_KEY: string;
  PUBLISHABLE_KEY: string;
  SERVICE_ROLE_KEY: string;
  SECRET_KEY: string;
  JWT_SECRET?: string;
  [key: string]: string | undefined;
}

export interface LocalSupabaseRuntimeEnv {
  SUPABASE_URL: string;
  VITE_SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  VITE_SUPABASE_ANON_KEY: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  VITE_SUPABASE_PUBLISHABLE_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_EDGE_URL: string;
  VITE_SUPABASE_EDGE_URL: string;
  SUPABASE_DB_URL: string;
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);
const LOCAL_ONLY_ENV_KEYS = [
  "SUPABASE_URL",
  "VITE_SUPABASE_URL",
  "SUPABASE_EDGE_URL",
  "VITE_SUPABASE_EDGE_URL",
  "SUPABASE_DB_URL",
];

const LOCAL_KEY_ENV_KEYS = [
  "SUPABASE_ANON_KEY",
  "VITE_SUPABASE_ANON_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];

const PROJECT_REF_ENV_KEYS = ["SUPABASE_PROJECT_REF", "VITE_SUPABASE_PROJECT_REF"];

const trimValue = (value: string | undefined): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const parseQuotedValue = (value: string): string => {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
};

export const parseSupabaseStatusEnv = (output: string): LocalSupabaseStatusEnv => {
  const result: Record<string, string> = {};

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || !line.includes("=")) {
      continue;
    }
    const equalsIndex = line.indexOf("=");
    const key = line.slice(0, equalsIndex).trim();
    const value = parseQuotedValue(line.slice(equalsIndex + 1).trim());
    if (key) {
      result[key] = value;
    }
  }

  const requiredKeys = [
    "API_URL",
    "DB_URL",
    "ANON_KEY",
    "PUBLISHABLE_KEY",
    "SERVICE_ROLE_KEY",
    "SECRET_KEY",
  ] as const;

  for (const key of requiredKeys) {
    if (!trimValue(result[key])) {
      throw new Error(`supabase status output did not include required ${key}.`);
    }
  }

  return result as LocalSupabaseStatusEnv;
};

export const isLoopbackUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return LOCAL_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
};

const isLoopbackDatabaseUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return LOCAL_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
};

export const assertLocalStatusEnv = (statusEnv: LocalSupabaseStatusEnv): void => {
  if (!isLoopbackUrl(statusEnv.API_URL)) {
    throw new Error(`Local Supabase API_URL must resolve to loopback, got ${statusEnv.API_URL}.`);
  }
  if (!isLoopbackDatabaseUrl(statusEnv.DB_URL)) {
    throw new Error(`Local Supabase DB_URL must resolve to loopback, got ${statusEnv.DB_URL}.`);
  }
};

export const buildLocalRuntimeEnv = (
  statusEnv: LocalSupabaseStatusEnv,
): LocalSupabaseRuntimeEnv => {
  assertLocalStatusEnv(statusEnv);
  const apiUrl = statusEnv.API_URL.replace(/\/$/, "");
  return {
    SUPABASE_URL: apiUrl,
    VITE_SUPABASE_URL: apiUrl,
    SUPABASE_ANON_KEY: statusEnv.ANON_KEY,
    VITE_SUPABASE_ANON_KEY: statusEnv.PUBLISHABLE_KEY,
    SUPABASE_PUBLISHABLE_KEY: statusEnv.PUBLISHABLE_KEY,
    VITE_SUPABASE_PUBLISHABLE_KEY: statusEnv.PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: statusEnv.SERVICE_ROLE_KEY,
    SUPABASE_EDGE_URL: `${apiUrl}/functions/v1`,
    VITE_SUPABASE_EDGE_URL: `${apiUrl}/functions/v1`,
    SUPABASE_DB_URL: statusEnv.DB_URL,
  };
};

const compareExpectedValue = (
  env: Record<string, string | undefined>,
  key: string,
  expected: string,
  errors: string[],
): void => {
  const current = trimValue(env[key]);
  if (!current) {
    return;
  }
  if (current !== expected) {
    errors.push(`${key} does not match the local Supabase value discovered from \`supabase status -o env\`.`);
  }
};

export const validateLocalSupabaseEnv = (
  env: Record<string, string | undefined>,
  statusEnv: LocalSupabaseStatusEnv,
): string[] => {
  const errors: string[] = [];
  assertLocalStatusEnv(statusEnv);
  const expected = buildLocalRuntimeEnv(statusEnv);

  for (const key of LOCAL_ONLY_ENV_KEYS) {
    const value = trimValue(env[key]);
    if (!value) {
      continue;
    }
    if (!isLoopbackUrl(value) && !isLoopbackDatabaseUrl(value)) {
      errors.push(`${key} must target localhost or 127.0.0.1, got ${value}.`);
    }
  }

  for (const key of PROJECT_REF_ENV_KEYS) {
    const value = trimValue(env[key]);
    if (!value) {
      continue;
    }
    errors.push(`${key} must be unset for local-only ledger commands, got ${value}.`);
  }

  compareExpectedValue(env, "SUPABASE_URL", expected.SUPABASE_URL, errors);
  compareExpectedValue(env, "VITE_SUPABASE_URL", expected.VITE_SUPABASE_URL, errors);
  compareExpectedValue(env, "SUPABASE_EDGE_URL", expected.SUPABASE_EDGE_URL, errors);
  compareExpectedValue(env, "VITE_SUPABASE_EDGE_URL", expected.VITE_SUPABASE_EDGE_URL, errors);
  compareExpectedValue(env, "SUPABASE_DB_URL", expected.SUPABASE_DB_URL, errors);

  for (const key of LOCAL_KEY_ENV_KEYS) {
    const value = trimValue(env[key]);
    if (!value) {
      continue;
    }
    const expectedValue = expected[key as keyof LocalSupabaseRuntimeEnv];
    if (!expectedValue) {
      errors.push(`${key} is not an allowed local ledger environment variable.`);
      continue;
    }
    if (value !== expectedValue) {
      errors.push(`${key} does not match the local Supabase key discovered from \`supabase status -o env\`.`);
    }
  }

  return errors;
};
