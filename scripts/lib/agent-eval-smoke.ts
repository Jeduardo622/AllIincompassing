import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export type SmokeTargetConfig = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  edgeBaseUrl: string;
  accessToken: string;
};

export type SmokePayloads = {
  aiAgentOptimized: { message: string; context: Record<string, unknown> };
  aiTranscription: { audio: string; language: string; prompt: string };
  aiSessionNote: { prompt: string; session_data: Record<string, unknown> };
};

export type SmokeResult = {
  ok: boolean;
  status: number;
  requestId?: string | null;
  correlationId?: string | null;
  body?: unknown;
  error?: string;
};

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_LANGUAGE = 'en';
const DEFAULT_PROMPT = 'Provide a brief objective summary. Do not perform actions.';
const DEFAULT_AGENT_MESSAGE =
  'Provide a short, read-only summary of today’s schedule status. Do not execute actions.';

const SILENT_WAV_BASE64 =
  'UklGRigAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQQAAAAA';

const normalizeBaseUrl = (value: string): string => (value.endsWith('/') ? value.slice(0, -1) : value);

export const resolveEdgeBaseUrl = (supabaseUrl: string, edgeUrl?: string): string => {
  if (edgeUrl && edgeUrl.trim().length > 0) {
    return normalizeBaseUrl(edgeUrl);
  }
  return `${normalizeBaseUrl(supabaseUrl)}/functions/v1`;
};

export const buildSmokePayloads = (correlationId: string): SmokePayloads => ({
  aiAgentOptimized: {
    message: DEFAULT_AGENT_MESSAGE,
    context: {
      url: 'smoke://agent-eval',
      userAgent: 'agent-eval-smoke',
      conversationId: correlationId,
    },
  },
  aiTranscription: {
    audio: SILENT_WAV_BASE64,
    language: DEFAULT_LANGUAGE,
    prompt:
      'This is a short ABA session transcript. Focus on behavioral observations and objective language.',
  },
  aiSessionNote: {
    prompt: DEFAULT_PROMPT,
    session_data: {
      organization_id: null,
      session_date: new Date().toISOString().split('T')[0],
    },
  },
});

export const writeSmokeReport = (payload: Record<string, unknown>): string => {
  const reportsDir = join(process.cwd(), 'reports');
  mkdirSync(reportsDir, { recursive: true });
  const fileName = `agent-eval-smoke-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const fullPath = join(reportsDir, fileName);
  writeFileSync(fullPath, JSON.stringify(payload, null, 2));
  return fullPath;
};

const withTimeout = async <T>(operation: () => Promise<T>, label: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await operation();
    clearTimeout(timer);
    return result;
  } catch (error) {
    clearTimeout(timer);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} failed: ${message}`);
  }
};

const parseJsonSafely = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

export const callEdge = async (
  target: SmokeTargetConfig,
  path: string,
  payload: Record<string, unknown>,
  requestId: string,
  correlationId: string,
): Promise<SmokeResult> => {
  try {
    const response = await withTimeout(
      () =>
        fetch(`${target.edgeBaseUrl}/${path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: target.supabaseAnonKey,
            Authorization: `Bearer ${target.accessToken}`,
            'x-request-id': requestId,
            'x-correlation-id': correlationId,
          },
          body: JSON.stringify(payload),
        }),
      path,
    );
    const body = await parseJsonSafely(response);
    return {
      ok: response.ok,
      status: response.status,
      requestId: response.headers.get('x-request-id'),
      correlationId: response.headers.get('x-correlation-id'),
      body,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export const runAgentEvalSmoke = async (
  target: SmokeTargetConfig,
  options: { dryRun?: boolean } = {},
): Promise<{ reportPath?: string; results: Record<string, SmokeResult> }> => {
  const requestId = randomUUID();
  const correlationId = `smoke-${requestId}`;
  const payloads = buildSmokePayloads(correlationId);

  if (options.dryRun) {
    return {
      results: {
        aiAgentOptimized: { ok: true, status: 0, body: payloads.aiAgentOptimized },
        aiTranscription: { ok: true, status: 0, body: payloads.aiTranscription },
        aiSessionNoteGenerator: { ok: true, status: 0, body: payloads.aiSessionNote },
      },
    };
  }

  const [aiAgentOptimized, aiTranscription, aiSessionNoteGenerator] = await Promise.all([
    callEdge(target, 'ai-agent-optimized', payloads.aiAgentOptimized, requestId, correlationId),
    callEdge(target, 'ai-transcription', payloads.aiTranscription, requestId, correlationId),
    callEdge(target, 'ai-session-note-generator', payloads.aiSessionNote, requestId, correlationId),
  ]);

  const reportPayload = {
    startedAt: new Date().toISOString(),
    target: {
      supabaseUrl: target.supabaseUrl,
      edgeBaseUrl: target.edgeBaseUrl,
    },
    requestId,
    correlationId,
    results: {
      aiAgentOptimized,
      aiTranscription,
      aiSessionNoteGenerator,
    },
  };

  const reportPath = writeSmokeReport(reportPayload);
  return {
    reportPath,
    results: reportPayload.results,
  };
};
