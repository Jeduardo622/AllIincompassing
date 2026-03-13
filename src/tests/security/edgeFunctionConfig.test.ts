import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const readToml = (relativePath: string): string => readFileSync(join(process.cwd(), relativePath), 'utf-8');

describe('edge function config', () => {
  it('enforces verify_jwt for all edge functions', () => {
    const publicNoJwtFunctions = new Set([
      // Public pre-auth endpoints
      'auth-login',
      'auth-signup',
      // Token-based automation endpoints (no JWT required)
      'admin-actions-retention',
    ]);

    const functionsRoot = join(process.cwd(), 'supabase', 'functions');
    const functionDirs = readdirSync(functionsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
      .map((entry) => entry.name);

    for (const functionName of functionDirs) {
      const indexPath = join(functionsRoot, functionName, 'index.ts');
      if (!existsSync(indexPath)) {
        continue;
      }

      const tomlRelativePath = join('supabase', 'functions', functionName, 'function.toml');
      const tomlPath = join(process.cwd(), tomlRelativePath);
      expect(existsSync(tomlPath)).toBe(true);

      const contents = readToml(tomlRelativePath);
      const shouldVerifyJwt = !publicNoJwtFunctions.has(functionName);
      const verifyJwtMatch = contents.match(/^\s*verify_jwt\s*=\s*(true|false)\s*$/m);
      expect(verifyJwtMatch?.[1]).toBe(shouldVerifyJwt ? 'true' : 'false');
    }
  });
});
