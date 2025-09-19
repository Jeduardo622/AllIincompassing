// import { supabase } from './supabase';
import { errorTracker } from './errorTracking';
import { buildSupabaseEdgeUrl, getSupabaseAnonKey } from './runtimeConfig';

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
  context: {
    url: string;
    userAgent: string;
    conversationId?: string;
  }
): Promise<AIResponse> {
  try {
    // First try the optimized ai-agent endpoint
    const apiUrl = buildSupabaseEdgeUrl('ai-agent-optimized');
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getSupabaseAnonKey()}`
      },
      body: JSON.stringify({ message, context }),
    });
    
    if (!response.ok) {
      console.warn(`Optimized AI agent failed with status: ${response.status}, falling back to process-message`);
      // Fall back to the original process-message function
      const fallbackUrl = buildSupabaseEdgeUrl('process-message');
      const fallbackResponse = await fetch(fallbackUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getSupabaseAnonKey()}`,
        },
        body: JSON.stringify({ message, context }),
      });
      
      if (!fallbackResponse.ok) {
        throw new Error(`HTTP error! status: ${fallbackResponse.status}`);
      }
      
      return await fallbackResponse.json();
    }

    const data = await response.json();
    return data;
  } catch (error) {
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

// Function to get client details
export async function getClientDetails(clientId: string): Promise<any> {
  try {
    const apiUrl = buildSupabaseEdgeUrl('get-client-details');
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getSupabaseAnonKey()}`,
      },
      body: JSON.stringify({ clientId }),
    });

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
export async function getTherapistDetails(therapistId: string): Promise<any> {
  try {
    const apiUrl = buildSupabaseEdgeUrl('get-therapist-details');
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getSupabaseAnonKey()}`,
      },
      body: JSON.stringify({ therapistId }),
    });

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
export async function getAuthorizationDetails(authorizationId: string): Promise<any> {
  try {
    const apiUrl = buildSupabaseEdgeUrl('get-authorization-details');
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getSupabaseAnonKey()}`,
      },
      body: JSON.stringify({ authorizationId }),
    });

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