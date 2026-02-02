import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

import { buildReplayHeaders, parseReplaySeed } from '../src/lib/agentReplay';

type TraceRow = {
  step_name: string;
  replay_payload: { message?: string; context?: Record<string, unknown> } | null;
  correlation_id: string;
  request_id: string;
  created_at: string;
};

const getArg = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) {
    return undefined;
  }
  return process.argv[index + 1];
};

const requireEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing ${key}`);
  }
  return value;
};

const resolveEdgeBaseUrl = (supabaseUrl: string): string => {
  const explicit = process.env.SUPABASE_EDGE_URL;
  if (explicit && explicit.trim().length > 0) {
    return explicit.replace(/\/$/, '');
  }
  return `${supabaseUrl.replace(/\/$/, '')}/functions/v1`;
};

const main = async (): Promise<void> => {
  const correlationId = getArg('--correlation-id');
  const requestId = getArg('--request-id');
  const seedArg = getArg('--seed');
  if (!correlationId && !requestId) {
    throw new Error('Provide --correlation-id or --request-id');
  }

  const supabaseUrl = requireEnv('SUPABASE_URL');
  const supabaseAnonKey = requireEnv('SUPABASE_ANON_KEY');
  const accessToken = requireEnv('EDGE_REPLAY_ACCESS_TOKEN');
  const edgeBaseUrl = resolveEdgeBaseUrl(supabaseUrl);

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  let query = client
    .from('agent_execution_traces')
    .select('step_name,replay_payload,correlation_id,request_id,created_at')
    .order('created_at', { ascending: true });
  if (correlationId) {
    query = query.eq('correlation_id', correlationId);
  } else if (requestId) {
    query = query.eq('request_id', requestId);
  }
  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to load traces: ${error.message}`);
  }

  const requestStep = (data as TraceRow[]).find((row) => row.step_name === 'request.received');
  if (!requestStep?.replay_payload?.message) {
    throw new Error('No replay payload found on request.received step');
  }

  const replaySeed = parseReplaySeed(seedArg);
  const replayContext = {
    ...(requestStep.replay_payload.context ?? {}),
    replaySeed,
  };

  const payload = {
    message: requestStep.replay_payload.message,
    context: replayContext,
  };

  const newRequestId = randomUUID();
  const replayCorrelationId = correlationId ?? requestStep.correlation_id;
  const response = await fetch(`${edgeBaseUrl}/ai-agent-optimized`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
      ...buildReplayHeaders(replayCorrelationId, newRequestId),
    },
    body: JSON.stringify(payload),
  });

  const body = await response.text();
  console.log('[replay] status', response.status);
  console.log('[replay] body', body.slice(0, 2000));
};

main().catch((error) => {
  console.error('[replay] FAIL', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
