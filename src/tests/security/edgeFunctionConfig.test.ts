import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const readToml = (relativePath: string): string => readFileSync(join(process.cwd(), relativePath), 'utf-8');

describe('edge function config', () => {
  it('requires JWT verification for feature flag functions', () => {
    const files = [
      'supabase/functions/feature-flags/function.toml',
      'supabase/functions/feature-flags-v2/function.toml',
    ];

    for (const file of files) {
      const contents = readToml(file);
      expect(contents).toMatch(/verify_jwt\s*=\s*true/);
    }
  });
});
