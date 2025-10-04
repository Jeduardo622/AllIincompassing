// import { supabase } from './supabase';
import { errorTracker } from './errorTracking';
import { buildSupabaseEdgeUrl, getSupabaseAnonKey } from './runtimeConfig';
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

const buildEdgeRequestInit = (payload: unknown, auth: EdgeAuthContext): RequestInit => {
  const accessToken = ensureAccessToken(auth);

  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: getSupabaseAnonKey(),
      Authorization: `Bearer ${accessToken}`,
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
}

export async function processMessage(
  message: string,
  context: AssistantRequestContext,
  auth: EdgeAuthContext
): Promise<AIResponse> {
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
    const response = await fetch(apiUrl, buildEdgeRequestInit(requestPayload, auth));

    if (!response.ok) {
      console.warn(`Optimized AI agent failed with status: ${response.status}, falling back to process-message`);
      // Fall back to the original process-message function
      const fallbackUrl = buildSupabaseEdgeUrl('process-message');
      const fallbackResponse = await fetch(
        fallbackUrl,
        buildEdgeRequestInit(requestPayload, auth)
      );
      
      if (!fallbackResponse.ok) {
        throw new Error(`HTTP error! status: ${fallbackResponse.status}`);
      }
      
      return await fallbackResponse.json();
    }

    const data = await response.json();
    return data;
  } catch (error) {
    if (error instanceof AssistantGuardrailError) {
      throw error;
    }
    console.error('Error processing message:', error);
    if (error instanceof Error) {
      console.error('Error details:', error.stack);
      errorTracker.trackAIError(error, {
        functionCalled: 'processMessage',
        errorType: 'network_error',
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