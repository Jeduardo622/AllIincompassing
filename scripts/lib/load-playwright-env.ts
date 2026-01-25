import { config as loadEnv } from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

export const loadPlaywrightEnv = (): void => {
  const candidates = ['.env.codex', '.env.local', '.env'];
  for (const candidate of candidates) {
    const envPath = path.resolve(candidate);
    if (!fs.existsSync(envPath)) {
      continue;
    }
    loadEnv({ path: envPath, override: false });
  }
};
