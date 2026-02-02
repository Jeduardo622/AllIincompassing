import process from 'node:process';

import {
  resolveEdgeBaseUrl,
  runAgentEvalSmoke,
  type SmokeTargetConfig,
} from './lib/agent-eval-smoke';

const getEnv = (key: string): string | undefined => {
  const value = process.env[key];
  if (!value || value.trim().length === 0) {
    return undefined;
  }
  return value.trim();
};

const parseFlag = (flag: string): boolean => process.argv.includes(flag);

const resolveTarget = (): SmokeTargetConfig => {
  const supabaseUrl = getEnv('SUPABASE_URL');
  const supabaseAnonKey = getEnv('SUPABASE_ANON_KEY');
  const accessToken =
    getEnv('EDGE_SMOKE_ACCESS_TOKEN') ||
    getEnv('SUPABASE_USER_JWT') ||
    '';

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY.');
  }
  if (!accessToken) {
    throw new Error('Missing EDGE_SMOKE_ACCESS_TOKEN (authenticated user JWT required).');
  }

  const edgeBaseUrl = resolveEdgeBaseUrl(supabaseUrl, getEnv('SUPABASE_EDGE_URL'));
  return {
    supabaseUrl,
    supabaseAnonKey,
    edgeBaseUrl,
    accessToken,
  };
};

const main = async (): Promise<void> => {
  const dryRun = parseFlag('--dry-run');
  if (dryRun) {
    const target = {
      supabaseUrl: 'dry-run',
      supabaseAnonKey: 'dry-run',
      edgeBaseUrl: 'dry-run',
      accessToken: 'dry-run',
    };
    const result = await runAgentEvalSmoke(target, { dryRun: true });
    console.log('[agent-eval] dry-run payloads prepared', result.results);
    return;
  }

  const target = resolveTarget();
  const { reportPath, results } = await runAgentEvalSmoke(target);
  const allOk = Object.values(results).every((entry) => entry.ok);
  if (!allOk) {
    console.error('[agent-eval] FAIL', results);
    process.exitCode = 1;
    return;
  }
  console.log('[agent-eval] PASS', { reportPath });
};

main().catch((error) => {
  console.error('[agent-eval] FAIL', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
