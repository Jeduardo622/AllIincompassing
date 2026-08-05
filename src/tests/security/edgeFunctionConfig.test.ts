import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const readToml = (relativePath: string): string => readFileSync(join(process.cwd(), relativePath), 'utf-8');

describe('edge function config', () => {
  it('enforces platform JWT or explicit project-bound service auth for every edge function', () => {
    const publicNoJwtFunctions = new Set([
      // Public pre-auth endpoints
      'auth-login',
      'auth-signup',
      'accept-staff-invite',
      // Token-based automation endpoints (no JWT required)
      'admin-actions-retention',
    ]);
    const serviceNoJwtFunctions = new Set([
      'agent-work-runner',
      'agent-work-sweeper',
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
      const shouldVerifyJwt = !publicNoJwtFunctions.has(functionName) &&
        !serviceNoJwtFunctions.has(functionName);
      const verifyJwtMatch = contents.match(/^\s*verify_jwt\s*=\s*(true|false)\s*$/m);
      expect(verifyJwtMatch?.[1]).toBe(shouldVerifyJwt ? 'true' : 'false');

      if (serviceNoJwtFunctions.has(functionName)) {
        const source = readFileSync(indexPath, 'utf-8');
        const serviceAuth = readToml(join(
          'supabase', 'functions', '_shared', 'agent-work', 'service-auth.ts'
        ));
        expect(source).toContain('isAgentWorkServiceRequestAuthorized');
        expect(source).toContain('getInvocationSecret');
        expect(source).toContain('SUPABASE_SERVICE_ROLE_KEY');
        expect(serviceAuth).toContain('request.headers.get("apikey")');
        expect(serviceAuth).toContain('SUPABASE_PUBLISHABLE_KEYS');
        expect(serviceAuth).not.toContain('request.headers.get("authorization")');
      }
    }
  });
});
