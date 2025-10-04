export type SupabaseCliEnvInstruction = {
  readonly varName: string;
  readonly command: string;
  readonly description: string;
};

export const SUPABASE_CLI_ENV_INSTRUCTIONS: readonly SupabaseCliEnvInstruction[] = [
  {
    varName: 'SUPABASE_ACCESS_TOKEN',
    command: 'export SUPABASE_ACCESS_TOKEN="****"',
    description:
      'Exports the Supabase access token in the current shell session so CLI commands authenticate without prompts. Replace **** with your actual token before running the command.',
  },
  {
    varName: 'SUPABASE_URL',
    command: 'export SUPABASE_URL="https://<project-ref>.supabase.co"',
    description:
      'Optional but recommended when scripting; points the CLI to your project URL and avoids interactive selection prompts.',
  },
  {
    varName: 'SUPABASE_ANON_KEY',
    command: 'export SUPABASE_ANON_KEY="****"',
    description:
      'Provides the anon key for local tooling that needs client credentials. Only export if the command requires it.',
  },
];

export const formatSupabaseCliEnvInstructions = (
  instructions: readonly SupabaseCliEnvInstruction[] = SUPABASE_CLI_ENV_INSTRUCTIONS,
): string =>
  instructions
    .map((instruction) =>
      [
        `# ${instruction.varName}`,
        instruction.description,
        '',
        `Command: ${instruction.command}`,
      ].join('\n'),
    )
    .join('\n\n');
