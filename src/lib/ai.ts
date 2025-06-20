import { supabase } from './supabase';
import { errorTracker } from './errorTracking';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  context?: Record<string, any>;
}

interface ChatHistory {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  context: Record<string, any>;
  action_type?: string;
  action_data?: Record<string, any>;
  created_at: string;
}

interface AIResponse {
  response: string;
  action?: any;
  conversationId?: string;
  cacheHit?: boolean;
  responseTime?: number;
}

export async function processMessage(
  message: string,
  context: {
    url: string;
    userAgent: string;
    conversationId?: string;
    conversationId?: string;
  }
): Promise<AIResponse> {
  try {
    // First try the optimized ai-agent endpoint
    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-agent-optimized`;
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ message, context }),
    });
    
    if (!response.ok) {
      console.warn(`Optimized AI agent failed with status: ${response.status}, falling back to process-message`);
      // Fall back to the original process-message function
      const fallbackUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-message`;
      const fallbackResponse = await fetch(fallbackUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
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
    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-client-details`;
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
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
    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-therapist-details`;
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
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
    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-authorization-details`;
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
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