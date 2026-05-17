import { config as loadEnv } from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_PLAYWRIGHT_BASE_URL = 'https://app.allincompassing.ai';

export const loadPlaywrightEnv = (): void => {
  const explicitEnvFile = process.env.PLAYWRIGHT_ENV_FILE?.trim();
  const candidates = explicitEnvFile
    ? [explicitEnvFile, '.env.local', '.env', '.env.codex']
    : ['.env.local', '.env', '.env.codex'];

  const loaded = new Set<string>();
  for (const candidate of candidates) {
    const envPath = path.resolve(candidate);
    if (loaded.has(envPath)) {
      continue;
    }
    const exists = fs.existsSync(envPath);
    if (!exists) {
      continue;
    }
    loadEnv({ path: envPath, override: false });
    loaded.add(envPath);
  }

  if (explicitEnvFile) {
    const explicitPath = path.resolve(explicitEnvFile);
    if (!loaded.has(explicitPath)) {
      throw new Error(
        `PLAYWRIGHT_ENV_FILE is set but file was not found: ${explicitEnvFile}`,
      );
    }
  }

  if (process.env.SUPABASE_PUBLISHABLE_KEY) {
    process.env.VITE_SUPABASE_ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
    process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  }
  if (process.env.SUPABASE_SECRET_KEY) {
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SECRET_KEY;
  }
};

export const resolvePlaywrightBaseUrl = (): string =>
  process.env.PW_BASE_URL?.trim() || DEFAULT_PLAYWRIGHT_BASE_URL;
