import { describe, expect, it } from 'vitest';

import {
  SUPABASE_CLI_ENV_INSTRUCTIONS,
  formatSupabaseCliEnvInstructions,
} from '../supabaseCliAuthInstructions';

describe('supabaseCliAuthInstructions', () => {
  it('includes the access token export command with masking placeholder', () => {
    const accessTokenInstruction = SUPABASE_CLI_ENV_INSTRUCTIONS.find(
      (instruction) => instruction.varName === 'SUPABASE_ACCESS_TOKEN',
    );

    expect(accessTokenInstruction).toBeDefined();
    expect(accessTokenInstruction?.command).toBe('export SUPABASE_ACCESS_TOKEN="****"');
  });

  it('formats instructions into a readable block', () => {
    const formatted = formatSupabaseCliEnvInstructions([
      {
        varName: 'SUPABASE_ACCESS_TOKEN',
        command: 'export SUPABASE_ACCESS_TOKEN="****"',
        description: 'Set the access token for the CLI.',
      },
    ]);

    expect(formatted).toContain('# SUPABASE_ACCESS_TOKEN');
    expect(formatted).toContain('Set the access token for the CLI.');
    expect(formatted).toContain('Command: export SUPABASE_ACCESS_TOKEN="****"');
  });
});
