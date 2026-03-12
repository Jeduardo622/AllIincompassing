import { config as loadEnv } from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

export const loadPlaywrightEnv = (): void => {
  const explicitEnvFile = process.env.PLAYWRIGHT_ENV_FILE?.trim();
  const candidates = explicitEnvFile
    ? [explicitEnvFile, '.env', '.env.local', '.env.codex']
    : ['.env', '.env.local', '.env.codex'];

  const loaded = new Set<string>();
  for (const candidate of candidates) {
    const envPath = path.resolve(candidate);
    if (loaded.has(envPath)) {
      continue;
    }
    if (!fs.existsSync(envPath)) {
      continue;
    }
    loadEnv({ path: envPath, override: false });
    loaded.add(envPath);
  }
};
