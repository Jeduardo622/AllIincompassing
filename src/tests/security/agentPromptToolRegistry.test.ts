import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const readWorkspaceFile = (relativePath: string): string =>
  readFileSync(join(process.cwd(), relativePath), 'utf-8');

describe('agent prompt/tool registry', () => {
  it('includes the migration for prompt/tool versions', () => {
    const migrationPath = join(
      process.cwd(),
      'supabase',
      'migrations',
      '20260201130000_agent_prompt_tool_versions.sql',
    );
    expect(existsSync(migrationPath)).toBe(true);
    const contents = readWorkspaceFile(
      'supabase/migrations/20260201130000_agent_prompt_tool_versions.sql',
    );
    expect(contents).toMatch(/create table if not exists public\.agent_prompt_tool_versions/i);
    expect(contents).toMatch(/is_current boolean not null default false/i);
    expect(contents).toMatch(/agent_prompt_tool_versions_single_current_idx/i);
    expect(contents).toMatch(/agent_prompt_tool_versions_admin_read/i);
  });

  it('wires the ai-agent-optimized function to load the active version', () => {
    const functionPath = join(
      process.cwd(),
      'supabase',
      'functions',
      'ai-agent-optimized',
      'index.ts',
    );
    expect(existsSync(functionPath)).toBe(true);
    const contents = readWorkspaceFile('supabase/functions/ai-agent-optimized/index.ts');
    expect(contents).toMatch(/agent_prompt_tool_versions/);
    expect(contents).toMatch(/prompt_tool\.version\.loaded/);
  });
});
