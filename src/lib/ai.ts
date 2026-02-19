// import { supabase } from './supabase';
import { errorTracker } from './errorTracking';
import { buildSupabaseEdgeUrl, getSupabaseAnonKey } from './runtimeConfig';
import { fetchWithRetry } from './retry';
import {
  evaluateAssistantGuardrails,
  AssistantGuardrailError,
  type GuardrailActor,
  type AssistantTool,
} from './aiGuardrails';

export interface EdgeAuthContext {
  accessToken: string;
}

const ensureAccessToken = (auth: EdgeAuthContext): string => {
  const token = auth?.accessToken;
  if (!token || typeof token !== 'string' || token.trim().length === 0) {
    throw new Error('Missing Supabase access token for edge function request');
  }
  return token;
};

type EdgeTraceHeaders = {
  requestId?: string;
  correlationId?: string;
};

const extractTraceHeaders = (response: Response): EdgeTraceHeaders => ({
  requestId: typeof response.headers?.get === 'function' ? response.headers.get('x-request-id') ?? undefined : undefined,
  correlationId:
    typeof response.headers?.get === 'function' ? response.headers.get('x-correlation-id') ?? undefined : undefined,
});

const buildEdgeRequestInit = (
  payload: unknown,
  auth: EdgeAuthContext,
  trace?: EdgeTraceHeaders
): RequestInit => {
  const accessToken = ensureAccessToken(auth);

  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: getSupabaseAnonKey(),
      Authorization: `Bearer ${accessToken}`,
      ...(trace?.requestId ? { 'x-request-id': trace.requestId } : {}),
      ...(trace?.correlationId ? { 'x-correlation-id': trace.correlationId } : {}),
    },
    body: JSON.stringify(payload),
  };
};

export interface AssistantRequestContext {
  url: string;
  userAgent: string;
  conversationId?: string;
  actor?: GuardrailActor | null;
  requestedTools?: AssistantTool[];
}

interface AIResponse {
  response: string;
  action?: unknown;
  conversationId?: string;
  cacheHit?: boolean;
  responseTime?: number;
  error?: string;
  requestId?: string;
  correlationId?: string;
}

export interface ProgramGoalDraftGoal {
  title: string;
  description: string;
  original_text: string;
  target_behavior?: string;
  measurement_type?: string;
  baseline_data?: string;
  target_criteria?: string;
}

export interface ProgramGoalDraftResponse {
  program: {
    name: string;
    description?: string;
  };
  goals: ProgramGoalDraftGoal[];
  rationale?: string;
  requestId?: string;
  correlationId?: string;
}

const allowFallbacks = import.meta.env.DEV;

export async function processMessage(
  message: string,
  context: AssistantRequestContext,
  auth: EdgeAuthContext
): Promise<AIResponse> {
  if (message.length > 4000) {
    throw new Error('Message exceeds maximum length');
  }
  const requestId =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const correlationId = context.conversationId ?? requestId;
  const guardrailEvaluation = evaluateAssistantGuardrails({
    message,
    actor: context.actor,
    requestedTools: context.requestedTools,
    metadata: {
      url: context.url,
      userAgent: context.userAgent,
      conversationId: context.conversationId,
    },
  });

  const requestPayload = {
    message: guardrailEvaluation.sanitizedMessage,
    context: {
      url: context.url,
      userAgent: context.userAgent,
      conversationId: context.conversationId,
      actor: context.actor,
      guardrails: {
        allowedTools: guardrailEvaluation.allowedTools,
        audit: guardrailEvaluation.auditTrail,
      },
    },
  };

  try {
    // First try the optimized ai-agent endpoint
    const apiUrl = buildSupabaseEdgeUrl('ai-agent-optimized');
    const response = await fetchWithRetry(
      apiUrl,
      buildEdgeRequestInit(requestPayload, auth, { requestId, correlationId }),
      {
        maxAttempts: 2,
        baseDelayMs: 300,
        maxDelayMs: 1500,
        retryOnStatus: [429, 503, 504],
        retryOnNetworkError: true,
      }
    );

    if (!response.ok) {
      console.warn(`Optimized AI agent failed with status: ${response.status}, falling back to process-message`);
      if (!allowFallbacks) {
        throw new Error(`AI fallback disabled in production (status ${response.status})`);
      }
      // Fall back to the original process-message function
      const fallbackUrl = buildSupabaseEdgeUrl('process-message');
      const fallbackResponse = await fetchWithRetry(
        fallbackUrl,
        buildEdgeRequestInit(requestPayload, auth, { requestId, correlationId }),
        {
          maxAttempts: 2,
          baseDelayMs: 300,
          maxDelayMs: 1500,
          retryOnStatus: [429, 503, 504],
          retryOnNetworkError: true,
        }
      );
      
      if (!fallbackResponse.ok) {
        throw new Error(`HTTP error! status: ${fallbackResponse.status}`);
      }

      const fallbackData = (await fallbackResponse.json()) as AIResponse;
      return {
        ...fallbackData,
        ...extractTraceHeaders(fallbackResponse as Response),
      };
    }

    const data = await response.json() as AIResponse;
    return {
      ...data,
      ...extractTraceHeaders(response as Response),
    };
  } catch (error) {
    if (error instanceof AssistantGuardrailError) {
      throw error;
    }
    console.error('Error processing message:', error);
    if (error instanceof Error) {
      console.error('Error details:', error.stack);
      errorTracker.trackAIError(error, {
        functionCalled: 'processMessage',
        errorType: 'upstream_unavailable',
      });
    }
    return {
      response: "I apologize, but I'm having trouble processing your request right now. Please try again in a moment or use the manual interface instead.",
      responseTime: 0,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

export { AssistantGuardrailError } from './aiGuardrails';
export type { AssistantTool, GuardrailActor, GuardrailAudit } from './aiGuardrails';

// Function to get client details
export async function getClientDetails(clientId: string, auth: EdgeAuthContext): Promise<any> {
  try {
    const apiUrl = buildSupabaseEdgeUrl('get-client-details');
    const response = await fetch(apiUrl, buildEdgeRequestInit({ clientId }, auth));

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.client;
  } catch (error) {
    console.error('Error getting client details:', error);
    throw error;
  }
}

// Function to get therapist details
export async function getTherapistDetails(therapistId: string, auth: EdgeAuthContext): Promise<any> {
  try {
    const apiUrl = buildSupabaseEdgeUrl('get-therapist-details');
    const response = await fetch(apiUrl, buildEdgeRequestInit({ therapistId }, auth));

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.therapist;
  } catch (error) {
    console.error('Error getting therapist details:', error);
    throw error;
  }
}

// Function to get authorization details
export async function getAuthorizationDetails(
  authorizationId: string,
  auth: EdgeAuthContext
): Promise<any> {
  try {
    const apiUrl = buildSupabaseEdgeUrl('get-authorization-details');
    const response = await fetch(apiUrl, buildEdgeRequestInit({ authorizationId }, auth));

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.authorization;
  } catch (error) {
    console.error('Error getting authorization details:', error);
    throw error;
  }
}

export async function generateProgramGoalDraft(
  assessmentText: string,
  auth: EdgeAuthContext,
  options?: {
    clientName?: string;
    assessmentDocumentId?: string;
  },
): Promise<ProgramGoalDraftResponse> {
  if (typeof assessmentText !== 'string' || assessmentText.trim().length < 20) {
    throw new Error('Assessment text must be at least 20 characters');
  }

  const requestId =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const correlationId = requestId;

  const payload = {
    assessment_text: assessmentText.trim(),
    client_name: options?.clientName?.trim() || undefined,
    assessment_document_id: options?.assessmentDocumentId?.trim() || undefined,
  };

  const response = await fetch(
    buildSupabaseEdgeUrl('generate-program-goals'),
    buildEdgeRequestInit(payload, auth, { requestId, correlationId }),
  );

  if (!response.ok) {
    throw new Error(`Failed to generate program/goal draft (status ${response.status})`);
  }

  const data = (await response.json()) as ProgramGoalDraftResponse;
  return {
    ...data,
    ...extractTraceHeaders(response as Response),
  };
}